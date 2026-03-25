import { NextRequest, NextResponse } from "next/server";
import { withDbUser } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { deleteFromS3 } from "@/lib/s3";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function DELETE(req: NextRequest, context: RouteContext) {
  const auth = await requireAuth(req);
  const { id } = await context.params;

  return withDbUser(auth.userId, async (client) => {
    const hh = await client.query<{ id: string }>(
      "SELECT id FROM public.households WHERE owner_id = $1 LIMIT 1",
      [auth.userId],
    );
    if (hh.rowCount !== 1) {
      return NextResponse.json({ error: "Household not found. Complete onboarding first." }, { status: 404 });
    }

    const householdId = hh.rows[0].id;

    const recipeRes = await client.query<{ id: string; image_url: string | null; name: string }>(
      `SELECT id, image_url, name
       FROM public.saved_recipes
       WHERE id = $1 AND household_id = $2
       LIMIT 1`,
      [id, householdId],
    );

    if (recipeRes.rowCount !== 1) {
      return NextResponse.json({ error: "Recipe not found." }, { status: 404 });
    }

    const recipe = recipeRes.rows[0];

    await client.query("UPDATE public.meal_plan_slots SET recipe_id = NULL WHERE recipe_id = $1", [id]);
    await client.query("UPDATE public.grocery_list_items SET recipe_id = NULL WHERE recipe_id = $1", [id]);
    await client.query("UPDATE public.meal_logs SET recipe_id = NULL WHERE recipe_id = $1", [id]);
    await client.query("DELETE FROM public.saved_recipes WHERE id = $1 AND household_id = $2", [id, householdId]);

    if (recipe.image_url) {
      try {
        await deleteFromS3({ key: recipe.image_url });
      } catch {
        // Deletion of the DB row is the primary action; do not fail the request on image cleanup.
      }
    }

    return NextResponse.json({ ok: true, recipeId: recipe.id, name: recipe.name });
  });
}
