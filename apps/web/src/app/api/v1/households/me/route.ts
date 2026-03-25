import { NextRequest, NextResponse } from "next/server";
import { withDbUser } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { computeAge } from "@/lib/household";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);

  return withDbUser(auth.userId, async (client) => {
    const householdRes = await client.query<{ id: string; name: string | null }>(
      "SELECT id, name FROM public.households WHERE owner_id = $1 LIMIT 1",
      [auth.userId],
    );

    if (householdRes.rowCount !== 1) {
      return NextResponse.json({ error: "Household not found. Complete onboarding first." }, { status: 404 });
    }

    const householdId = householdRes.rows[0].id;

    const profileRes = await client.query<{ onboarded: boolean }>(
      "SELECT onboarded FROM public.profiles WHERE id = $1",
      [auth.userId],
    );

    const membersRes = await client.query<{
      id: string;
      name: string;
      gender: string;
      date_of_birth: string | null;
      role: string;
      avatar_url: string | null;
    }>(
      `SELECT
        id,
        name,
        gender,
        date_of_birth,
        role,
        avatar_url
      FROM public.household_members
      WHERE household_id = $1
      ORDER BY created_at ASC`,
      [householdId],
    );

    const members = membersRes.rows.map((m) => {
      const dob = m.date_of_birth ?? "";
      const age = m.date_of_birth ? computeAge(dob) : { ageYears: 0, ageMonths: 0 };
      return {
        id: m.id,
        name: m.name,
        gender: m.gender,
        dateOfBirth: m.date_of_birth,
        role: m.role,
        avatarUrl: m.avatar_url,
        ageYears: age.ageYears,
        ageMonths: age.ageMonths,
      };
    });

    const onboarded = profileRes.rows[0]?.onboarded ?? false;

    return NextResponse.json({
      household: { id: householdId, name: householdRes.rows[0].name },
      members,
      onboarded,
    });
  });
}

