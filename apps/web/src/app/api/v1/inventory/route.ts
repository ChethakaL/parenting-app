import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withDbUser } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

const InventoryItemCreateSchema = z.object({
  name: z.string().min(1).max(120),
  category: z.string().optional().nullable(),
  quantity: z.number().optional().nullable(),
  unit: z.string().optional().nullable(),
  brand: z.string().optional().nullable(),
  barcode: z.string().optional().nullable(),
  expiryDate: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
});

const InventoryCreateSchema = z.object({
  items: z.array(InventoryItemCreateSchema).min(1),
});

function deriveInventoryStatus(quantity: number | null | undefined): "in_stock" | "low" | "finished" {
  if (quantity === null || quantity === undefined || quantity <= 0) return "finished";
  if (quantity <= 1) return "low";
  return "in_stock";
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);

  try {
    return await withDbUser(auth.userId, async (client) => {
      const householdRes = await client.query<{ id: string }>(
        "SELECT id FROM public.households WHERE owner_id = $1 LIMIT 1",
        [auth.userId],
      );

      if (householdRes.rowCount !== 1) {
        return NextResponse.json({ error: "Household not found. Complete onboarding first." }, { status: 404 });
      }

      const householdId = householdRes.rows[0].id;
      await client.query(
        `UPDATE public.inventory_items
         SET status = CASE
            WHEN quantity IS NULL OR quantity <= 0 THEN 'finished'
            WHEN quantity <= 1 THEN 'low'
            ELSE 'in_stock'
         END
         WHERE household_id = $1
         AND status IS DISTINCT FROM CASE
            WHEN quantity IS NULL OR quantity <= 0 THEN 'finished'
            WHEN quantity <= 1 THEN 'low'
            ELSE 'in_stock'
         END`,
        [householdId],
      );

      const res = await client.query<{
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
        added_via: string | null;
        receipt_id: string | null;
        created_at: Date;
        updated_at: Date;
      }>(
        `SELECT
          id,
          name,
          category,
          quantity,
          unit,
          brand,
          barcode,
          expiry_date,
          location,
          status,
          added_via,
          receipt_id,
          created_at,
          updated_at
         FROM public.inventory_items
         WHERE household_id = $1
         ORDER BY created_at ASC`,
        [householdId],
      );

      return NextResponse.json({ items: res.rows });
    });
  } catch (error) {
    console.error("Inventory GET failed", error);
    return NextResponse.json(
      { error: "Inventory is temporarily unavailable. Please refresh in a moment." },
      { status: 503 },
    );
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  const json = await req.json().catch(() => null);
  const parsed = InventoryCreateSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid inventory payload." }, { status: 400 });
  }

  const { items } = parsed.data;

  return withDbUser(auth.userId, async (client) => {
    const householdRes = await client.query<{ id: string }>(
      "SELECT id FROM public.households WHERE owner_id = $1 LIMIT 1",
      [auth.userId],
    );
    if (householdRes.rowCount !== 1) {
      return NextResponse.json({ error: "Household not found. Complete onboarding first." }, { status: 404 });
    }

    const householdId = householdRes.rows[0].id;

    type CreatedInventoryItem = {
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
      added_via: string | null;
      receipt_id: string | null;
      created_at: Date;
      updated_at: Date;
    };

    const created: CreatedInventoryItem[] = [];
    for (const item of items) {
      const nextStatus = deriveInventoryStatus(item.quantity ?? null);
      const insertRes = await client.query<{
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
        added_via: string | null;
        receipt_id: string | null;
        created_at: Date;
        updated_at: Date;
      }>(
        `INSERT INTO public.inventory_items
          (household_id, name, category, quantity, unit, brand, barcode, expiry_date, location, status, added_via)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'manual')
         RETURNING
           id, name, category, quantity, unit, brand, barcode, expiry_date, location, status, added_via, receipt_id, created_at, updated_at`,
        [
          householdId,
          item.name,
          item.category ?? null,
          item.quantity ?? null,
          item.unit ?? null,
          item.brand ?? null,
          item.barcode ?? null,
          item.expiryDate ?? null,
          item.location ?? null,
          nextStatus,
        ],
      );

      created.push(insertRes.rows[0]);
    }

    return NextResponse.json({ items: created });
  });
}
