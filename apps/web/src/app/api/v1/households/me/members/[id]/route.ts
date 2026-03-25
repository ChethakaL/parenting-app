import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withDbUser } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { computeRole } from "@/lib/household";

const GenderSchema = z.enum(["male", "female", "other"]);

const MemberUpdateSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  gender: GenderSchema.optional(),
  dateOfBirth: z.string().min(4).optional(),
  avatarUrl: z.string().max(2048).optional().nullable(),
});

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req);
  const { id } = await params;
  const json = await req.json().catch(() => null);
  const parsed = MemberUpdateSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid member update payload." }, { status: 400 });
  }

  const { name, gender, dateOfBirth, avatarUrl } = parsed.data;

  return withDbUser(auth.userId, async (client) => {
    const existingRes = await client.query<{
      id: string;
      name: string;
      gender: string;
      date_of_birth: string | null;
    }>(
      "SELECT id, name, gender, date_of_birth FROM public.household_members WHERE id = $1",
      [id],
    );

    if (existingRes.rowCount !== 1) {
      return NextResponse.json({ error: "Member not found." }, { status: 404 });
    }

    const nextName = name ?? existingRes.rows[0].name;
    const nextGender = gender ?? existingRes.rows[0].gender;
    const nextDob = dateOfBirth ?? existingRes.rows[0].date_of_birth ?? "";
    const role = computeRole(nextDob);

    await client.query(
      `UPDATE public.household_members
         SET name = $1,
             gender = $2,
             date_of_birth = $3,
             role = $4,
             avatar_url = $5
       WHERE id = $6`,
      [nextName, nextGender, nextDob, role, avatarUrl ?? null, id],
    );

    return NextResponse.json({ ok: true });
  });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req);
  const { id } = await params;

  return withDbUser(auth.userId, async (client) => {
    // Prevent FK errors (member_preferences doesn't cascade).
    await client.query("DELETE FROM public.member_preferences WHERE member_id = $1", [id]);
    await client.query("DELETE FROM public.meal_logs WHERE member_id = $1", [id]);
    const res = await client.query("DELETE FROM public.household_members WHERE id = $1", [id]);

    if (res.rowCount !== 1) {
      return NextResponse.json({ error: "Member not found." }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  });
}
