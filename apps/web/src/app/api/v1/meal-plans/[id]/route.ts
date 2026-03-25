import { NextRequest, NextResponse } from "next/server";
import { withDbUser } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

/** Discard draft meal plan (reject) — removes plan, slots, and grocery links. */
export async function DELETE(
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

    const planRes = await client.query<{ status: string }>(
      "SELECT status FROM public.meal_plans WHERE id = $1 AND household_id = $2",
      [id, householdId],
    );
    if (planRes.rowCount !== 1) {
      return NextResponse.json({ error: "Meal plan not found." }, { status: 404 });
    }
    if (planRes.rows[0].status !== "draft") {
      return NextResponse.json(
        { error: "Only draft plans can be discarded. Approved plans stay on record." },
        { status: 400 },
      );
    }

    await client.query(`UPDATE public.grocery_list_items SET meal_plan_id = NULL WHERE meal_plan_id = $1`, [id]);
    await client.query(`DELETE FROM public.meal_plan_slots WHERE meal_plan_id = $1`, [id]);
    await client.query(`DELETE FROM public.meal_plans WHERE id = $1 AND household_id = $2`, [id, householdId]);

    return NextResponse.json({ ok: true });
  });
}
