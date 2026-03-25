import { NextRequest, NextResponse } from "next/server";
import { withDbUser } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req);
  const { id } = await params;

  return withDbUser(auth.userId, async (client) => {
    const itemRes = await client.query<{
      id: string;
      name: string;
      household_id: string;
      quantity: number | null;
      unit: string | null;
      category: string | null;
    }>(
      `SELECT id, name, household_id, quantity, unit, category
       FROM public.inventory_items
       WHERE id = $1`,
      [id],
    );

    if (itemRes.rowCount !== 1) {
      return NextResponse.json({ error: "Inventory item not found." }, { status: 404 });
    }

    const item = itemRes.rows[0];

    await client.query("UPDATE public.inventory_items SET status = 'finished' WHERE id = $1", [item.id]);

    const groceryRes = await client.query<{
      id: string;
      name: string;
      quantity: number | null;
      unit: string | null;
      category: string | null;
      status: string;
      priority: string;
      added_via: string | null;
    }>(
      `INSERT INTO public.grocery_list_items
        (household_id, name, quantity, unit, category, priority, status, added_via)
       VALUES ($1, $2, $3, $4, $5, 'normal', 'needed', 'inventory_finished')
       RETURNING id, name, quantity, unit, category, status, priority, added_via`,
      [item.household_id, item.name, item.quantity, item.unit, item.category],
    );

    return NextResponse.json({ ok: true, groceryItem: groceryRes.rows[0] });
  });
}
