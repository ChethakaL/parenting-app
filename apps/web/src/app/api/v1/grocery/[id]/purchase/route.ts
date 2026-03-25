import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withDbUser } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

const PurchaseBodySchema = z.object({
  quantity: z.number().nullable().optional(),
  unit: z.string().nullable().optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req);
  const { id } = await params;
  const json = await req.json().catch(() => null);
  const parsed = PurchaseBodySchema.safeParse(json);
  const body = parsed.success ? parsed.data : {};

  return withDbUser(auth.userId, async (client) => {
    const itemRes = await client.query<{
      id: string;
      household_id: string;
      name: string;
      quantity: number | null;
      unit: string | null;
      category: string | null;
    }>(
      `SELECT id, household_id, name, quantity, unit, category
       FROM public.grocery_list_items
       WHERE id = $1 AND status != 'purchased'`,
      [id],
    );

    if (itemRes.rowCount !== 1) {
      return NextResponse.json({ error: "Grocery item not found (or already purchased)." }, { status: 404 });
    }

    const item = itemRes.rows[0];
    const quantity =
      typeof body.quantity === "number" && !Number.isNaN(body.quantity) ? body.quantity : item.quantity;
    const unit = typeof body.unit === "string" && body.unit.trim().length > 0 ? body.unit.trim() : item.unit;

    await client.query("UPDATE public.grocery_list_items SET status = 'purchased' WHERE id = $1", [item.id]);

    const invRes = await client.query<{
      id: string;
    }>(
      `INSERT INTO public.inventory_items
        (household_id, name, category, quantity, unit, status, added_via)
       VALUES ($1, $2, $3, $4, $5, 'in_stock', 'manual')
       RETURNING id`,
      [item.household_id, item.name, item.category, quantity, unit],
    );

    return NextResponse.json({ ok: true, inventoryItemId: invRes.rows[0].id });
  });
}
