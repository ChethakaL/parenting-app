import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withDbUser } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

const InventoryUpdateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  category: z.string().optional().nullable(),
  quantity: z.number().optional().nullable(),
  unit: z.string().optional().nullable(),
  brand: z.string().optional().nullable(),
  barcode: z.string().optional().nullable(),
  expiryDate: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
  status: z.enum(["in_stock", "low", "finished"]).optional(),
});

function deriveInventoryStatus(quantity: number | null | undefined): "in_stock" | "low" | "finished" {
  if (quantity === null || quantity === undefined || quantity <= 0) return "finished";
  if (quantity <= 1) return "low";
  return "in_stock";
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req);
  const { id } = await params;
  const json = await req.json().catch(() => null);
  const parsed = InventoryUpdateSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid inventory update payload." }, { status: 400 });
  }

  const updates = parsed.data;

  return withDbUser(auth.userId, async (client) => {
    const existingRes = await client.query<{
      id: string;
      name: string;
      category: string | null;
      quantity: number | null;
      unit: string | null;
      brand: string | null;
      barcode: string | null;
      expiry_date: string | null;
      location: string | null;
      status: string;
    }>(
      `SELECT id, name, category, quantity, unit, brand, barcode, expiry_date, location, status
       FROM public.inventory_items
       WHERE id = $1`,
      [id],
    );

    if (existingRes.rowCount !== 1) {
      return NextResponse.json({ error: "Inventory item not found." }, { status: 404 });
    }

    const nextName = updates.name ?? existingRes.rows[0].name;
    const nextCategory = updates.category ?? existingRes.rows[0].category;
    const nextQuantity = updates.quantity ?? existingRes.rows[0].quantity;
    const nextUnit = updates.unit ?? existingRes.rows[0].unit;
    const nextBrand = updates.brand ?? existingRes.rows[0].brand;
    const nextBarcode = updates.barcode ?? existingRes.rows[0].barcode;
    const nextExpiry = updates.expiryDate ?? existingRes.rows[0].expiry_date;
    const nextLocation = updates.location ?? existingRes.rows[0].location;
    const nextStatus = deriveInventoryStatus(nextQuantity);

    await client.query(
      `UPDATE public.inventory_items
         SET name = $1,
             category = $2,
             quantity = $3,
             unit = $4,
             brand = $5,
             barcode = $6,
             expiry_date = $7,
             location = $8,
             status = $9
       WHERE id = $10`,
      [
        nextName,
        nextCategory,
        nextQuantity,
        nextUnit,
        nextBrand,
        nextBarcode,
        nextExpiry,
        nextLocation,
        nextStatus,
        id,
      ],
    );

    return NextResponse.json({ ok: true });
  });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req);
  const { id } = await params;

  return withDbUser(auth.userId, async (client) => {
    const res = await client.query("DELETE FROM public.inventory_items WHERE id = $1", [id]);

    if (res.rowCount !== 1) {
      return NextResponse.json({ error: "Inventory item not found." }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  });
}
