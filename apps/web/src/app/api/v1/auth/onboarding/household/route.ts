import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withDbUser } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { randomUUID } from "crypto";

const GenderSchema = z.enum(["male", "female", "other"]);
type MemberRole = "adult" | "child" | "infant";
const SeveritySchema = z.enum(["critical", "strong", "mild"]);

const PreferenceItemSchema = z.object({
  value: z.string().min(1).max(80),
  severity: SeveritySchema.optional().default("strong"),
});

const OnboardingSchema = z.object({
  householdName: z.string().min(1).max(120),
  userMember: z.object({
    name: z.string().min(1).max(80),
    gender: GenderSchema,
    dateOfBirth: z.string().min(4), // validated as Date server-side
  }),
  // Step 3: "Any allergies we should know about?"
  allergies: z.array(PreferenceItemSchema).optional().default([]),
  // Optional: if you want to capture more preferences during onboarding.
  dislikes: z.array(PreferenceItemSchema).optional().default([]),
  likes: z.array(z.string().min(1).max(80)).optional().default([]),
  dietary: z.array(z.string().min(1).max(80)).optional().default([]),
});

function computeRole(dateOfBirth: string): MemberRole {
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) {
    throw new Error("Invalid dateOfBirth.");
  }

  const now = new Date();
  const ageYears = (now.getTime() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000);

  if (ageYears < 1) return "infant";
  if (ageYears < 18) return "child";
  return "adult";
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  const json = await req.json().catch(() => null);
  const parsed = OnboardingSchema.safeParse(json);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid onboarding payload." }, { status: 400 });
  }

  const { householdName, userMember, allergies, dislikes, likes, dietary } = parsed.data;

  try {
    const result = await withDbUser(auth.userId, async (client) => {
      const householdId = randomUUID();
      const memberId = randomUUID();
      const role = computeRole(userMember.dateOfBirth);

      await client.query(
        "INSERT INTO public.households (id, owner_id, name) VALUES ($1, $2, $3)",
        [householdId, auth.userId, householdName],
      );

      await client.query(
        `INSERT INTO public.household_members
          (id, household_id, name, gender, date_of_birth, role)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [memberId, householdId, userMember.name, userMember.gender, userMember.dateOfBirth, role],
      );

      const preferenceRows: Array<
        [string, string, string | null, string | null, string | null]
      > = [];

      for (const allergy of allergies) {
        preferenceRows.push([
          memberId,
          "allergy",
          allergy.value,
          allergy.severity,
          "manual",
        ]);
      }

      for (const dislike of dislikes) {
        preferenceRows.push([
          memberId,
          "dislike",
          dislike.value,
          dislike.severity,
          "manual",
        ]);
      }

      for (const like of likes) {
        preferenceRows.push([memberId, "like", like, null, "manual"]);
      }

      for (const diet of dietary) {
        preferenceRows.push([memberId, "diet", diet, null, "manual"]);
      }

      for (const [memberIdRow, type, value, severity, source] of preferenceRows) {
        await client.query(
          `INSERT INTO public.member_preferences
            (member_id, type, value, severity, source, notes)
           VALUES ($1, $2, $3, $4, $5, NULL)`,
          [memberIdRow, type, value, severity, source],
        );
      }

      await client.query(
        "UPDATE public.profiles SET onboarded = TRUE WHERE id = $1",
        [auth.userId],
      );

      return { householdId, memberId };
    });

    return NextResponse.json({ onboarded: true, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Onboarding failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

