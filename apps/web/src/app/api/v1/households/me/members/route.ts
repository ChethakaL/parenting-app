import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withDbUser } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { computeRole } from "@/lib/household";

const GenderSchema = z.enum(["male", "female", "other"]);
const MemberCreateSchema = z.object({
  name: z.string().min(1).max(80),
  gender: GenderSchema,
  dateOfBirth: z.string().min(4),
  avatarUrl: z.string().max(2048).optional().nullable(),
});

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  const json = await req.json().catch(() => null);
  const parsed = MemberCreateSchema.safeParse(json);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid member payload." }, { status: 400 });
  }

  const { name, gender, dateOfBirth, avatarUrl } = parsed.data;
  const role = computeRole(dateOfBirth);

  return withDbUser(auth.userId, async (client) => {
    const householdRes = await client.query<{ id: string }>(
      "SELECT id FROM public.households WHERE owner_id = $1 LIMIT 1",
      [auth.userId],
    );

    if (householdRes.rowCount !== 1) {
      return NextResponse.json({ error: "Household not found. Complete onboarding first." }, { status: 404 });
    }

    const householdId = householdRes.rows[0].id;

    const memberRes = await client.query<{
      id: string;
      name: string;
      gender: string;
      date_of_birth: string | null;
      role: string;
      avatar_url: string | null;
    }>(
      `INSERT INTO public.household_members
        (household_id, name, gender, date_of_birth, role, avatar_url)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, gender, date_of_birth, role, avatar_url`,
      [householdId, name, gender, dateOfBirth, role, avatarUrl ?? null],
    );

    return NextResponse.json({
      member: {
        id: memberRes.rows[0].id,
        name: memberRes.rows[0].name,
        gender: memberRes.rows[0].gender,
        dateOfBirth: memberRes.rows[0].date_of_birth,
        role: memberRes.rows[0].role,
        avatarUrl: memberRes.rows[0].avatar_url,
      },
    });
  });
}

