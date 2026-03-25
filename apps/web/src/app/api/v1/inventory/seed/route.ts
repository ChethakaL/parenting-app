import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { withDbUser } from "@/lib/db";

const DEFAULT_SEED = [
  { name: "Milk", category: "dairy", quantity: 1, unit: "l", location: "fridge" },
  { name: "Eggs", category: "dairy", quantity: 12, unit: "units", location: "fridge" },
  { name: "Potatoes", category: "produce", quantity: 1, unit: "kg", location: "pantry" },
  { name: "Onions", category: "produce", quantity: 1, unit: "kg", location: "pantry" },
  { name: "Tomatoes", category: "produce", quantity: 800, unit: "g", location: "fridge" },
  { name: "Yogurt", category: "dairy", quantity: 500, unit: "g", location: "fridge" },
  { name: "Chicken breast", category: "meat", quantity: 1, unit: "kg", location: "freezer" },
  { name: "Rice", category: "pantry", quantity: 2, unit: "kg", location: "pantry" },
];

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  const created = await withDbUser(auth.userId, async (client) => {
    const hh = await client.query<{ id: string }>(
      "SELECT id FROM public.households WHERE owner_id = $1 LIMIT 1",
      [auth.userId],
    );
    if (hh.rowCount !== 1) {
      throw new Error("Household not found.");
    }
    const householdId = hh.rows[0].id;
    let inserted = 0;

    for (const item of DEFAULT_SEED) {
      const existing = await client.query<{ id: string }>(
        `SELECT id
         FROM public.inventory_items
         WHERE household_id = $1 AND LOWER(name) = LOWER($2)
         LIMIT 1`,
        [householdId, item.name],
      );
      if (existing.rowCount > 0) continue;
      await client.query(
        `INSERT INTO public.inventory_items
          (household_id, name, category, quantity, unit, location, status, added_via)
         VALUES ($1,$2,$3,$4,$5,$6,'in_stock','manual')`,
        [householdId, item.name, item.category, item.quantity, item.unit, item.location],
      );
      inserted += 1;
    }

    return inserted;
  });

  return NextResponse.json({ ok: true, itemsInserted: created });
}

