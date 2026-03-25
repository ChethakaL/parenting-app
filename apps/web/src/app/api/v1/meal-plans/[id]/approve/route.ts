import { NextRequest, NextResponse } from "next/server";
import { withDbUser } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

type Ingredient = { name: string; quantity?: number; unit?: string };

function normalizeIngredients(raw: unknown): Ingredient[] {
  if (!Array.isArray(raw)) return [];
  const normalized: Ingredient[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const obj = item as Record<string, unknown>;
    const nameVal = obj.name;
    if (typeof nameVal !== "string") continue;
    const name = nameVal.trim();
    if (!name) continue;

    const quantity =
      typeof obj.quantity === "number" ? obj.quantity : undefined;
    const unit = typeof obj.unit === "string" ? obj.unit : undefined;

    normalized.push({ name, quantity, unit });
  }
  return normalized;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req);
  const { id } = await params;

  return withDbUser(auth.userId, async (client) => {
    const hh = await client.query<{ id: string }>(
      "SELECT id FROM public.households WHERE owner_id = $1 LIMIT 1",
      [auth.userId],
    );
    if (hh.rowCount !== 1) {
      return NextResponse.json({ error: "Household not found. Complete onboarding first." }, { status: 404 });
    }
    const householdId = hh.rows[0].id;

    // Approve meal plan
    const planRes = await client.query<{
      id: string;
      status: string;
    }>("SELECT id, status FROM public.meal_plans WHERE id = $1 AND household_id = $2", [
      id,
      householdId,
    ]);

    if (planRes.rowCount !== 1) {
      return NextResponse.json({ error: "Meal plan not found." }, { status: 404 });
    }

    await client.query(
      "UPDATE public.meal_plans SET status = 'approved', approved_at = NOW() WHERE id = $1",
      [id],
    );

    const slots = await client.query<{
      id: string;
      recipe_id: string | null;
      recipe_name: string | null;
    }>(
      `SELECT id, recipe_id, recipe_name
       FROM public.meal_plan_slots
       WHERE meal_plan_id = $1`,
      [id],
    );

    // Match recipe_name -> saved_recipes when recipe_id is missing
    const missingSlots = slots.rows.filter((s) => !s.recipe_id && s.recipe_name);
    if (missingSlots.length > 0) {
      const names = Array.from(
        new Set(missingSlots.map((s) => (s.recipe_name ? s.recipe_name.trim().toLowerCase() : ""))),
      ).filter(Boolean);

      const recipes = await client.query<{
        id: string;
        name: string;
        ingredients: unknown;
      }>(
        `SELECT id, name, ingredients
         FROM public.saved_recipes
         WHERE household_id = $1 AND LOWER(name) = ANY($2::text[])`,
        [householdId, names],
      );

      const byName = new Map<string, { id: string; ingredients: unknown }>();
      for (const r of recipes.rows) {
        byName.set(r.name.trim().toLowerCase(), { id: r.id, ingredients: r.ingredients });
      }

      for (const s of missingSlots) {
        const key = s.recipe_name ? s.recipe_name.trim().toLowerCase() : "";
        const match = byName.get(key);
        if (!match) continue;

        await client.query(
          `UPDATE public.meal_plan_slots
           SET recipe_id = $1, recipe_name = $2
           WHERE id = $3`,
          [match.id, s.recipe_name, s.id],
        );
      }
    }

    // Reload slots with potential recipe_id updates
    const slotsWithRecipes = await client.query<{
      id: string;
      recipe_id: string;
    }>(
      `SELECT id, recipe_id
       FROM public.meal_plan_slots
       WHERE meal_plan_id = $1 AND recipe_id IS NOT NULL`,
      [id],
    );

    const recipeIds = Array.from(new Set(slotsWithRecipes.rows.map((s) => s.recipe_id)));
    if (recipeIds.length === 0) {
      return NextResponse.json({ ok: true, groceryAdded: 0, message: "No recipes linked to slots." });
    }

    const recipesRes = await client.query<{
      id: string;
      ingredients: unknown;
    }>(
      `SELECT id, ingredients
       FROM public.saved_recipes
       WHERE household_id = $1 AND id = ANY($2::uuid[])`,
      [householdId, recipeIds],
    );

    const recipesById = new Map<string, { ingredients: unknown }>();
    for (const r of recipesRes.rows) {
      recipesById.set(r.id, { ingredients: r.ingredients });
    }

    // Check inventory and add missing ingredients to grocery list.
    let groceryAdded = 0;

    for (const slot of slotsWithRecipes.rows) {
      const recipe = recipesById.get(slot.recipe_id);
      if (!recipe) continue;

      const ingredients = normalizeIngredients(recipe.ingredients);

      for (const ing of ingredients) {
        const ingName = ing.name;
        if (!ingName) continue;

        const quantity = ing.quantity ?? null;
        const unit = ing.unit ?? null;

        const invRes = await client.query<{ id: string }>(
          `SELECT id
           FROM public.inventory_items
           WHERE household_id = $1 AND LOWER(name) = LOWER($2) AND status IN ('in_stock', 'low')
           LIMIT 1`,
          [householdId, ingName],
        );

        if (invRes.rowCount > 0) continue;

        const existingGrocery = await client.query<{ id: string }>(
          `SELECT id
           FROM public.grocery_list_items
           WHERE household_id = $1 AND LOWER(name) = LOWER($2) AND status IN ('needed', 'ordered')
           LIMIT 1`,
          [householdId, ingName],
        );

        if (existingGrocery.rowCount > 0) continue;

        await client.query(
          `INSERT INTO public.grocery_list_items
            (household_id, name, quantity, unit, category, priority, status, added_via)
           VALUES ($1, $2, $3, $4, NULL, 'normal', 'needed', 'meal_plan')`,
          [householdId, ingName, quantity ?? null, unit],
        );

        groceryAdded += 1;
      }
    }

    return NextResponse.json({ ok: true, groceryAdded });
  });
}
