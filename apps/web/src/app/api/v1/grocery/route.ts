import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withDbUser } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

const PrioritySchema = z.enum(["urgent", "normal", "when_available"]);
const GroceryStatusSchema = z.enum(["needed", "ordered", "purchased"]);

const GroceryItemCreateSchema = z.object({
  name: z.string().min(1).max(160),
  quantity: z.number().optional().nullable(),
  unit: z.string().optional().nullable(),
  category: z.string().optional().nullable(),
  priority: PrioritySchema.optional().default("normal"),
  status: GroceryStatusSchema.optional().default("needed"),
  addedVia: z
    .enum(["manual", "ai", "inventory_finished", "meal_plan", "recipe"])
    .optional()
    .default("manual"),
  notes: z.string().max(2000).optional().nullable(),
});

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);

  return withDbUser(auth.userId, async (client) => {
    const householdRes = await client.query<{ id: string }>(
      "SELECT id FROM public.households WHERE owner_id = $1 LIMIT 1",
      [auth.userId],
    );
    if (householdRes.rowCount !== 1) {
      return NextResponse.json({ error: "Household not found. Complete onboarding first." }, { status: 404 });
    }

    const res = await client.query<{
      id: string;
      name: string;
      quantity: number | null;
      unit: string | null;
      category: string | null;
      priority: string;
      status: string;
      added_via: string | null;
      notes: string | null;
      created_at: Date;
    }>(
      `SELECT
        id,
        name,
        quantity,
        unit,
        category,
        priority,
        status,
        added_via,
        notes,
        created_at
       FROM public.grocery_list_items
       WHERE household_id = $1
       ORDER BY
         CASE priority
           WHEN 'urgent' THEN 1
           WHEN 'normal' THEN 2
           ELSE 3
         END ASC,
         created_at ASC`,
      [householdRes.rows[0].id],
    );

    const urgent = res.rows.filter((r) => r.priority === "urgent" && r.status !== "purchased");
    const normal = res.rows.filter((r) => r.priority === "normal" && r.status !== "purchased");
    const whenAvailable = res.rows.filter((r) => r.priority === "when_available" && r.status !== "purchased");

    return NextResponse.json({ urgent, normal, whenAvailable });
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  const json = await req.json().catch(() => null);
  const parsed = GroceryItemCreateSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid grocery item payload." }, { status: 400 });
  }

  const { name, quantity, unit, category, priority, status, addedVia, notes } = parsed.data;

  return withDbUser(auth.userId, async (client) => {
    const householdRes = await client.query<{ id: string }>(
      "SELECT id FROM public.households WHERE owner_id = $1 LIMIT 1",
      [auth.userId],
    );
    if (householdRes.rowCount !== 1) {
      return NextResponse.json({ error: "Household not found. Complete onboarding first." }, { status: 404 });
    }

    const groceryRes = await client.query<{
      id: string;
      name: string;
      quantity: number | null;
      unit: string | null;
      category: string | null;
      priority: string;
      status: string;
      added_via: string | null;
      notes: string | null;
      created_at: Date;
    }>(
      `INSERT INTO public.grocery_list_items
        (household_id, name, quantity, unit, category, priority, status, added_via, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, name, quantity, unit, category, priority, status, added_via, notes, created_at`,
      [householdRes.rows[0].id, name, quantity ?? null, unit ?? null, category ?? null, priority, status, addedVia, notes ?? null],
    );

    return NextResponse.json({ groceryItem: groceryRes.rows[0] });
  });
}

