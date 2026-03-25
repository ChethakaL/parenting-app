import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withDbUser } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

const AddedViaSchema = z.enum(["receipt", "manual", "ai_voice", "ai_text"]);

const DeleteGroceryBodySchema = z.object({
  addBackToInventory: z.boolean().optional().default(false),
  addedVia: AddedViaSchema.optional().default("manual"),
});

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(req);
  const { id } = await params;
  const json = await req.json().catch(() => null);
  const parsed = DeleteGroceryBodySchema.safeParse(json);
  const body = parsed.success ? parsed.data : { addBackToInventory: false, addedVia: "manual" as const };

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
       WHERE id = $1`,
      [id],
    );

    if (itemRes.rowCount !== 1) {
      return NextResponse.json({ error: "Grocery item not found." }, { status: 404 });
    }

    if (body.addBackToInventory) {
      await client.query(
        `INSERT INTO public.inventory_items
          (household_id, name, category, quantity, unit, status, added_via)
         VALUES ($1, $2, $3, $4, $5, 'in_stock', $6)`,
        [itemRes.rows[0].household_id, itemRes.rows[0].name, itemRes.rows[0].category, itemRes.rows[0].quantity, itemRes.rows[0].unit, body.addedVia],
      );
    }

    await client.query("DELETE FROM public.grocery_list_items WHERE id = $1", [id]);
    return NextResponse.json({ ok: true });
  });
}
