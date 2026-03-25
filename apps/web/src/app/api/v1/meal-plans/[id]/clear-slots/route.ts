import { NextRequest, NextResponse } from "next/server";
import { withDbUser } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

/** Clear all slots on this plan (keep rows, null recipe fields). */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(req);
  const { id } = await params;

  return withDbUser(auth.userId, async (client) => {
    const hh = await client.query<{ id: string }>(
      "SELECT id FROM public.households WHERE owner_id = $1 LIMIT 1",
      [auth.userId],
    );
    if (hh.rowCount !== 1) {
      return NextResponse.json({ error: "Household not found." }, { status: 404 });
    }
    const householdId = hh.rows[0].id;

    const planRes = await client.query<{ id: string }>(
      "SELECT id FROM public.meal_plans WHERE id = $1 AND household_id = $2",
      [id, householdId],
    );
    if (planRes.rowCount !== 1) {
      return NextResponse.json({ error: "Meal plan not found." }, { status: 404 });
    }

    await client.query(
      `UPDATE public.meal_plan_slots
         SET recipe_id = NULL,
             recipe_name = NULL,
             serves = NULL,
             notes = NULL,
             approved = FALSE
       WHERE meal_plan_id = $1`,
      [id],
    );

    return NextResponse.json({ ok: true });
  });
}
