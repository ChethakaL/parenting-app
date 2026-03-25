import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withDbUser } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { formatISODate, startOfWeekMonday } from "@/lib/date";

const QuerySchema = z.object({
  week: z.string().optional(),
});

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);

  const query = QuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams.entries()));
  if (!query.success) {
    return NextResponse.json({ error: "Invalid query parameters." }, { status: 400 });
  }

  const weekParam = query.data.week;
  const weekStart = weekParam
    ? new Date(weekParam)
    : startOfWeekMonday(new Date());

  const weekStartIso = formatISODate(weekStart);

  return withDbUser(auth.userId, async (client) => {
    type MealPlanRow = {
      id: string;
      week_start: string;
      status: string;
      weekly_goal: string | null;
      ai_context: unknown;
      created_at: Date;
      approved_at: Date | null;
    };

    const hh = await client.query<{ id: string }>(
      "SELECT id FROM public.households WHERE owner_id = $1 LIMIT 1",
      [auth.userId],
    );
    if (hh.rowCount !== 1) {
      return NextResponse.json({ error: "Household not found. Complete onboarding first." }, { status: 404 });
    }

    let mealPlanRes: MealPlanRow[] | undefined;

    if (weekParam) {
      mealPlanRes = (
        await client.query<MealPlanRow>(
          `SELECT id, week_start, status, weekly_goal, ai_context, created_at, approved_at
           FROM public.meal_plans
           WHERE household_id = $1 AND week_start = $2
           ORDER BY created_at DESC
           LIMIT 1`,
          [hh.rows[0].id, weekStartIso],
        )
      ).rows;
    } else {
      // Current or upcoming: earliest week at/after this Monday; if duplicates, prefer newest draft/row.
      mealPlanRes = (
        await client.query<MealPlanRow>(
          `SELECT id, week_start, status, weekly_goal, ai_context, created_at, approved_at
           FROM public.meal_plans
           WHERE household_id = $1 AND week_start >= $2
           ORDER BY week_start ASC, created_at DESC
           LIMIT 1`,
          [hh.rows[0].id, weekStartIso],
        )
      ).rows;
    }

    const mealPlan = mealPlanRes?.[0];
    if (!mealPlan) {
      const savedRecipesRes = await client.query<{
        id: string;
        name: string;
        source_url: string | null;
        image_url: string | null;
        description: string | null;
        prep_time_mins: number | null;
        cook_time_mins: number | null;
        servings: number | null;
        tags: string[] | null;
        ingredients: unknown;
        instructions: unknown;
        created_at: Date;
      }>(
        `SELECT id, name, source_url, image_url, description, prep_time_mins, cook_time_mins, servings, tags, ingredients, instructions, created_at
         FROM public.saved_recipes
         WHERE household_id = $1
         ORDER BY created_at DESC
         LIMIT 40`,
        [hh.rows[0].id],
      );

      return NextResponse.json({
        mealPlan: null,
        savedRecipes: savedRecipesRes.rows.map((recipe) => ({
          id: recipe.id,
          name: recipe.name,
          sourceUrl: recipe.source_url,
          imageUrl: recipe.image_url,
          description: recipe.description,
          prepTimeMins: recipe.prep_time_mins,
          cookTimeMins: recipe.cook_time_mins,
          servings: recipe.servings,
          tags: recipe.tags ?? [],
          ingredients: Array.isArray(recipe.ingredients)
            ? recipe.ingredients as Array<{ name: string; quantity?: number; unit?: string }>
            : [],
          instructions: Array.isArray(recipe.instructions)
            ? recipe.instructions as Array<{ step?: number; text: string }>
            : [],
          createdAt: recipe.created_at,
        })),
      });
    }

    const inventoryRes = await client.query<{ name: string; status: string }>(
      `SELECT name, status
       FROM public.inventory_items
       WHERE household_id = $1`,
      [hh.rows[0].id],
    );

    const preferencesRes = await client.query<{
      member_name: string;
      type: string;
      value: string;
      severity: string | null;
    }>(
      `SELECT hm.name AS member_name, mp.type, mp.value, mp.severity
       FROM public.member_preferences mp
       JOIN public.household_members hm ON hm.id = mp.member_id
       WHERE hm.household_id = $1`,
      [hh.rows[0].id],
    );

    const recentMealLogsRes = await client.query<{ description: string | null }>(
      `SELECT description
       FROM public.meal_logs
       WHERE household_id = $1
       ORDER BY logged_at DESC
       LIMIT 20`,
      [hh.rows[0].id],
    );

    const savedRecipesRes = await client.query<{
      id: string;
      name: string;
      source_url: string | null;
      image_url: string | null;
      description: string | null;
      prep_time_mins: number | null;
      cook_time_mins: number | null;
      servings: number | null;
      tags: string[] | null;
      ingredients: unknown;
      instructions: unknown;
      created_at: Date;
    }>(
      `SELECT id, name, source_url, image_url, description, prep_time_mins, cook_time_mins, servings, tags, ingredients, instructions, created_at
       FROM public.saved_recipes
       WHERE household_id = $1
       ORDER BY created_at DESC
       LIMIT 40`,
      [hh.rows[0].id],
    );

    const normalizeIngredientNames = (raw: unknown) => {
      if (!Array.isArray(raw)) return [] as string[];
      return raw
        .map((item) => (typeof item === "object" && item !== null && typeof (item as { name?: unknown }).name === "string"
          ? ((item as { name: string }).name.trim())
          : ""))
        .filter(Boolean);
    };

    const inventoryByName = new Map(
      inventoryRes.rows.map((item) => [item.name.trim().toLowerCase(), item.status] as const),
    );
    const recipeById = new Map(savedRecipesRes.rows.map((recipe) => [recipe.id, recipe] as const));
    const recipeByName = new Map(savedRecipesRes.rows.map((recipe) => [recipe.name.trim().toLowerCase(), recipe] as const));
    const preferenceAnnotations = preferencesRes.rows.map((preference) =>
      `${preference.member_name}: ${preference.type}${preference.value ? ` — ${preference.value}` : ""}${preference.severity ? ` (${preference.severity})` : ""}`,
    );
    const recentMealsText = recentMealLogsRes.rows
      .map((entry) => entry.description?.trim())
      .filter((entry): entry is string => Boolean(entry));

    const slotsRes = await client.query<{
      id: string;
      day_of_week: number;
      meal_type: string;
      recipe_id: string | null;
      recipe_name: string | null;
      serves: number | null;
      notes: string | null;
      approved: boolean;
    }>(
      `SELECT id, day_of_week, meal_type, recipe_id, recipe_name, serves, notes, approved
       FROM public.meal_plan_slots
       WHERE meal_plan_id = $1
       ORDER BY day_of_week ASC,
         CASE meal_type
           WHEN 'breakfast' THEN 1
           WHEN 'lunch' THEN 2
           WHEN 'dinner' THEN 3
           WHEN 'snack' THEN 4
           ELSE 5
         END`,
      [mealPlan.id],
    );

    return NextResponse.json({
      mealPlan: {
        id: mealPlan.id,
        weekStart: mealPlan.week_start,
        status: mealPlan.status,
        weeklyGoal: mealPlan.weekly_goal,
        createdAt: mealPlan.created_at,
        approvedAt: mealPlan.approved_at,
        slots: slotsRes.rows.map((s) => ({
          id: s.id,
          dayOfWeek: s.day_of_week,
          mealType: s.meal_type,
          recipeId: s.recipe_id,
          recipeName: s.recipe_name,
          serves: s.serves,
          notes: s.notes,
          approved: s.approved,
          ...(() => {
            const recipe =
              (s.recipe_id ? recipeById.get(s.recipe_id) : undefined)
              ?? (s.recipe_name ? recipeByName.get(s.recipe_name.trim().toLowerCase()) : undefined);
            const ingredientNames = normalizeIngredientNames(recipe?.ingredients);
            const missingIngredients = ingredientNames.filter((name) => !inventoryByName.has(name.toLowerCase()));
            const availableCount = ingredientNames.filter((name) => inventoryByName.has(name.toLowerCase())).length;
            const inventoryStatus =
              ingredientNames.length === 0
                ? "missing"
                : missingIngredients.length === 0
                  ? "in_stock"
                  : availableCount > 0
                    ? "partial"
                    : "missing";
            const annotations = [
              ...preferenceAnnotations.slice(0, 3),
              ...recentMealsText
                .filter((text) => s.recipe_name && text.toLowerCase().includes(s.recipe_name.toLowerCase()))
                .slice(0, 1)
                .map((text) => `Recently served: ${text}`),
            ];

            return {
              inventoryStatus,
              missingIngredients: missingIngredients.slice(0, 4),
              annotations,
            } as const;
          })(),
        })),
      },
      savedRecipes: savedRecipesRes.rows.map((recipe) => ({
        id: recipe.id,
        name: recipe.name,
        sourceUrl: recipe.source_url,
        imageUrl: recipe.image_url,
        description: recipe.description,
        prepTimeMins: recipe.prep_time_mins,
        cookTimeMins: recipe.cook_time_mins,
        servings: recipe.servings,
        tags: recipe.tags ?? [],
        ingredients: Array.isArray(recipe.ingredients)
          ? recipe.ingredients as Array<{ name: string; quantity?: number; unit?: string }>
          : [],
        instructions: Array.isArray(recipe.instructions)
          ? recipe.instructions as Array<{ step?: number; text: string }>
          : [],
        createdAt: recipe.created_at,
      })),
    });
  });
}
