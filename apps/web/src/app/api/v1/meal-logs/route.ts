import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withDbUser } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { formatISODate, startOfWeekMonday } from "@/lib/date";

const MealTypeSchema = z.enum(["breakfast", "lunch", "dinner", "snack"]);

const MealLogCreateSchema = z.object({
  mealType: MealTypeSchema,
  memberId: z.string().uuid().optional().nullable(),
  recipeId: z.string().uuid().optional().nullable(),
  description: z.string().max(2000).optional().nullable(),
  quantityEaten: z.string().max(120).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  loggedVia: z.enum(["manual", "ai_voice", "ai_text"]).optional().default("manual"),
});

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  const json = await req.json().catch(() => null);
  const parsed = MealLogCreateSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid meal log payload." }, { status: 400 });
  }

  const input = parsed.data;

  return withDbUser(auth.userId, async (client) => {
    const hh = await client.query<{ id: string }>(
      "SELECT id FROM public.households WHERE owner_id = $1 LIMIT 1",
      [auth.userId],
    );
    if (hh.rowCount !== 1) {
      return NextResponse.json({ error: "Household not found. Complete onboarding first." }, { status: 404 });
    }
    const householdId = hh.rows[0].id;

    await client.query(
      `INSERT INTO public.meal_logs
        (household_id, member_id, meal_type, recipe_id, description, quantity_eaten, notes, logged_via)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        householdId,
        input.memberId ?? null,
        input.mealType,
        input.recipeId ?? null,
        input.description ?? null,
        input.quantityEaten ?? null,
        input.notes ?? null,
        input.loggedVia,
      ],
    );

    // Mark the corresponding slot as completed for this week when possible.
    const weekStartIso = formatISODate(startOfWeekMonday(new Date()));
    const activePlan = await client.query<{ id: string }>(
      `SELECT id
       FROM public.meal_plans
       WHERE household_id = $1
         AND week_start = $2
         AND status IN ('approved', 'active', 'draft')
       ORDER BY created_at DESC
       LIMIT 1`,
      [householdId, weekStartIso],
    );
    if (activePlan.rowCount === 1) {
      const day = new Date().getDay();
      const dayOfWeek = day === 0 ? 7 : day;
      await client.query(
        `UPDATE public.meal_plan_slots
         SET approved = TRUE
         WHERE meal_plan_id = $1
           AND day_of_week = $2
           AND meal_type = $3`,
        [activePlan.rows[0].id, dayOfWeek, input.mealType],
      );
    }

    return NextResponse.json({ ok: true });
  });
}

const GetMealLogsQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  memberId: z.string().uuid().optional(),
});

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);

  const url = new URL(req.url);
  const parsed = GetMealLogsQuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query parameters." }, { status: 400 });
  }

  const { from, to, memberId } = parsed.data;

  const fromDate = from ? new Date(from) : null;
  const toDate = to ? new Date(to) : null;

  return withDbUser(auth.userId, async (client) => {
    const hh = await client.query<{ id: string }>(
      "SELECT id FROM public.households WHERE owner_id = $1 LIMIT 1",
      [auth.userId],
    );
    if (hh.rowCount !== 1) {
      return NextResponse.json({ error: "Household not found. Complete onboarding first." }, { status: 404 });
    }
    const householdId = hh.rows[0].id;

    let query = `SELECT id, logged_at, meal_type, member_id, recipe_id, description, quantity_eaten, notes, logged_via
                  FROM public.meal_logs
                  WHERE household_id = $1`;
    const params: unknown[] = [householdId];

    if (memberId) {
      query += " AND member_id = $2";
      params.push(memberId);
    }
    if (fromDate) {
      query += ` AND logged_at >= $${params.length + 1}`;
      params.push(fromDate.toISOString());
    }
    if (toDate) {
      query += ` AND logged_at <= $${params.length + 1}`;
      params.push(toDate.toISOString());
    }

    query += " ORDER BY logged_at DESC";

    const res = await client.query<{
      id: string;
      logged_at: Date;
      meal_type: string;
      member_id: string | null;
      recipe_id: string | null;
      description: string | null;
      quantity_eaten: string | null;
      notes: string | null;
      logged_via: string;
    }>(query, params);

    return NextResponse.json({
      mealLogs: res.rows.map((r) => ({
        id: r.id,
        loggedAt: r.logged_at,
        mealType: r.meal_type,
        memberId: r.member_id,
        recipeId: r.recipe_id,
        description: r.description,
        quantityEaten: r.quantity_eaten,
        notes: r.notes,
        loggedVia: r.logged_via,
      })),
    });
  });
}

