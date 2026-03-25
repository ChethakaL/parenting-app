import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withDbUser } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { callClaudeJson } from "@/lib/anthropic";
import { formatISODate, startOfWeekMonday } from "@/lib/date";

const GenerateSchema = z.object({
  weekStart: z.string().optional(), // YYYY-MM-DD
});

type GeneratedMealSlot = {
  day_of_week: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  meal_type: "breakfast" | "lunch" | "dinner" | "snack";
  recipe_name: string;
  serves: number;
  notes?: string | null;
};

async function removeDraftMealPlansForWeek(
  client: import("pg").PoolClient,
  householdId: string,
  weekStartIso: string,
) {
  await client.query(
    `UPDATE public.grocery_list_items
     SET meal_plan_id = NULL
     WHERE meal_plan_id IN (
       SELECT id FROM public.meal_plans
       WHERE household_id = $1 AND week_start = $2::date AND status = 'draft'
     )`,
    [householdId, weekStartIso],
  );
  await client.query(
    `DELETE FROM public.meal_plan_slots
     WHERE meal_plan_id IN (
       SELECT id FROM public.meal_plans
       WHERE household_id = $1 AND week_start = $2::date AND status = 'draft'
     )`,
    [householdId, weekStartIso],
  );
  await client.query(
    `DELETE FROM public.meal_plans
     WHERE household_id = $1 AND week_start = $2::date AND status = 'draft'`,
    [householdId, weekStartIso],
  );
}

const MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack"] as const;

function placeholderSlots(): GeneratedMealSlot[] {
  return Array.from({ length: 28 }).map((_, i) => {
    const dayIndex = Math.floor(i / 4);
    const mealTypeIndex = i % 4;
    return {
      day_of_week: (dayIndex + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7,
      meal_type: MEAL_TYPES[mealTypeIndex],
      recipe_name: "Meal to plan",
      serves: 4,
      notes: null,
    };
  });
}

/** Claude often returns `recipeName` (camelCase) or empty strings; normalize to valid rows. */
function finalizeSlotsFromAi(raw: unknown[]): GeneratedMealSlot[] {
  return raw.map((item, i) => {
    const obj = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const nameRaw = obj.recipe_name ?? obj.recipeName;
    const recipe_name =
      typeof nameRaw === "string" && nameRaw.trim().length > 0 ? nameRaw.trim() : "Meal to plan";
    const dayRaw = obj.day_of_week;
    const day_of_week =
      typeof dayRaw === "number" && dayRaw >= 1 && dayRaw <= 7
        ? (dayRaw as GeneratedMealSlot["day_of_week"])
        : ((Math.floor(i / 4) + 1) as GeneratedMealSlot["day_of_week"]);
    const mtRaw = typeof obj.meal_type === "string" ? obj.meal_type.toLowerCase() : "";
    const meal_type = (MEAL_TYPES as readonly string[]).includes(mtRaw)
      ? (mtRaw as GeneratedMealSlot["meal_type"])
      : MEAL_TYPES[i % 4];
    const serves = typeof obj.serves === "number" && obj.serves > 0 ? obj.serves : 4;
    const notes = typeof obj.notes === "string" && obj.notes.trim() ? obj.notes.trim() : null;
    return { day_of_week, meal_type, recipe_name, serves, notes };
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  const json = await req.json().catch(() => null);
  const parsed = GenerateSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const weekStartDate = parsed.data.weekStart ? new Date(parsed.data.weekStart) : startOfWeekMonday(new Date());
  if (Number.isNaN(weekStartDate.getTime())) {
    return NextResponse.json({ error: "Invalid weekStart." }, { status: 400 });
  }

  const weekStartIso = formatISODate(weekStartDate);

  return withDbUser(auth.userId, async (client) => {
    const hh = await client.query<{ id: string }>(
      "SELECT id FROM public.households WHERE owner_id = $1 LIMIT 1",
      [auth.userId],
    );
    if (hh.rowCount !== 1) {
      return NextResponse.json({ error: "Household not found. Complete onboarding first." }, { status: 404 });
    }
    const householdId = hh.rows[0].id;

    const membersRes = await client.query<{
      name: string;
      gender: string;
      date_of_birth: string | null;
      role: string;
    }>(
      `SELECT name, gender, date_of_birth, role
       FROM public.household_members
       WHERE household_id = $1
       ORDER BY created_at ASC`,
      [householdId],
    );

    const prefRes = await client.query<{
      member_id: string;
      type: string;
      value: string;
      severity: string | null;
    }>(
      `SELECT mp.member_id, mp.type, mp.value, mp.severity
       FROM public.member_preferences mp
       JOIN public.household_members hm ON hm.id = mp.member_id
       WHERE hm.household_id = $1`,
      [householdId],
    );

    const inventoryRes = await client.query<{
      status: string;
      name: string;
    }>(
      `SELECT status, name
       FROM public.inventory_items
       WHERE household_id = $1`,
      [householdId],
    );

    const lowItems = inventoryRes.rows.filter((r) => r.status === "low").slice(0, 10).map((r) => r.name);
    const inStockCount = inventoryRes.rows.filter((r) => r.status === "in_stock").length;
    const lowCount = inventoryRes.rows.filter((r) => r.status === "low").length;

    const weeklyGoalRes = await client.query<{ goal_text: string }>(
      `SELECT goal_text
       FROM public.weekly_goals
       WHERE household_id = $1 AND week_start = $2 AND active = TRUE
       LIMIT 1`,
      [householdId, weekStartIso],
    );

    const weeklyGoal = weeklyGoalRes.rows[0]?.goal_text ?? null;

    const savedRecipesRes = await client.query<{
      name: string;
      tags: string[] | null;
      description: string | null;
    }>(
      `SELECT name, tags, description
       FROM public.saved_recipes
       WHERE household_id = $1
       ORDER BY created_at DESC
       LIMIT 25`,
      [householdId],
    );

    const recentMealLogsRes = await client.query<{
      logged_at: Date;
      meal_type: string | null;
      description: string | null;
    }>(
      `SELECT logged_at, meal_type, description
       FROM public.meal_logs
       WHERE household_id = $1
       ORDER BY logged_at DESC
       LIMIT 40`,
      [householdId],
    );

    await removeDraftMealPlansForWeek(client, householdId, weekStartIso);

    const system = `You are ParentAI, a personal assistant for this household.
Return a meal plan draft as structured JSON. Follow the instructions:
- 7 days (day_of_week 1=Mon..7=Sun)
- For each day include breakfast, lunch, dinner, snack (28 total slots)
- Allergy filtering: never include severity='critical' items from preferences; avoid others when possible
- Age appropriateness: role infant/child/adult affects texture simplicity
- Prefer saved recipes when they fit
- Avoid repeating meals from the recent meal logs
- Prefer meals that use current in-stock ingredients to reduce waste
- Use names that can map to saved recipes later

Return a single JSON object of the form: { "slots": [ ... ] }
Each slot object must use snake_case keys: day_of_week, meal_type, recipe_name (non-empty string), serves, notes.
Return JSON only. No commentary.`;

    const userText = JSON.stringify(
      {
        household: {
          members: membersRes.rows.map((m) => ({
            name: m.name,
            role: m.role,
            gender: m.gender,
            dateOfBirth: m.date_of_birth,
          })),
          preferences: prefRes.rows,
        },
        inventory_summary: `${inStockCount} items in stock, ${lowCount} low`,
        inventory_low_items: lowItems,
        weekly_goal: weeklyGoal,
        recent_meal_logs: recentMealLogsRes.rows.map((log) => ({
          loggedAt: log.logged_at,
          mealType: log.meal_type,
          description: log.description,
        })),
        saved_recipes: savedRecipesRes.rows.map((recipe) => ({
          name: recipe.name,
          tags: recipe.tags ?? [],
          description: recipe.description,
        })),
      },
      null,
      2,
    );

    const model = "claude-opus-4-6" as const;
    let rawSlots: unknown[] = [];
    let claudeUnavailable = false;

    try {
      const { parsed: claudeParsed } = await callClaudeJson<{ slots: unknown[] }>({
        model,
        system,
        userText,
        temperature: 0.2,
        maxTokens: 3800,
      });
      rawSlots = Array.isArray(claudeParsed.slots) ? claudeParsed.slots : [];
    } catch {
      claudeUnavailable = true;
      rawSlots = [];
    }

    const slots =
      !claudeUnavailable && rawSlots.length === 28 ? finalizeSlotsFromAi(rawSlots) : placeholderSlots();

    const mealPlanId = crypto.randomUUID();
    const aiContext = {
      model,
      weekStart: weekStartIso,
      usedPlaceholderFallback: claudeUnavailable || rawSlots.length !== 28,
      claudeUnavailable,
    };

    await client.query(
      `INSERT INTO public.meal_plans
        (id, household_id, week_start, status, weekly_goal, ai_context, created_at)
       VALUES ($1, $2, $3, 'draft', $4, $5::jsonb, NOW())`,
      [mealPlanId, householdId, weekStartIso, weeklyGoal, JSON.stringify(aiContext)],
    );

    for (const s of slots) {
      await client.query(
        `INSERT INTO public.meal_plan_slots
          (meal_plan_id, day_of_week, meal_type, recipe_id, recipe_name, serves, notes, approved)
         VALUES ($1, $2, $3, NULL, $4, $5, $6, FALSE)`,
        [mealPlanId, s.day_of_week, s.meal_type, s.recipe_name, s.serves, s.notes ?? null],
      );
    }

    const degraded = aiContext.usedPlaceholderFallback;
    return NextResponse.json({
      jobId: mealPlanId,
      mealPlanId,
      weekStart: weekStartIso,
      status: "draft",
      degraded,
    });
  });
}
