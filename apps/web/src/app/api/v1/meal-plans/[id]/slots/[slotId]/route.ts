import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withDbUser } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

const MealTypeSchema = z.enum(["breakfast", "lunch", "dinner", "snack"]);

const SlotUpdateSchema = z.object({
  dayOfWeek: z.number().int().min(1).max(7).optional(),
  mealType: MealTypeSchema.optional(),
  recipeId: z.union([z.string().uuid(), z.null()]).optional(),
  recipeName: z.preprocess(
    (v) => (v === "" ? null : v),
    z.union([z.string().min(1).max(160), z.null()]).optional(),
  ),
  serves: z.union([z.number().int().positive(), z.null()]).optional(),
  notes: z.preprocess(
    (v) => (v === "" ? null : v),
    z.union([z.string().max(2000), z.null()]).optional(),
  ),
});

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; slotId: string }> },
) {
  const auth = await requireAuth(req);
  const { id, slotId } = await params;
  const json = await req.json().catch(() => null);
  const parsed = SlotUpdateSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid slot update payload." }, { status: 400 });
  }

  const updates = parsed.data;

  return withDbUser(auth.userId, async (client) => {
    // Ensure slot belongs to meal plan the user owns.
    const slotRes = await client.query<{
      id: string;
      meal_plan_id: string;
      day_of_week: number;
      meal_type: string;
      recipe_id: string | null;
      recipe_name: string | null;
      serves: number | null;
      notes: string | null;
    }>(
      `SELECT s.*
       FROM public.meal_plan_slots s
       JOIN public.meal_plans mp ON mp.id = s.meal_plan_id
       WHERE s.id = $1 AND mp.id = $2`,
      [slotId, id],
    );

    if (slotRes.rowCount !== 1) {
      return NextResponse.json({ error: "Slot not found." }, { status: 404 });
    }

    const existing = slotRes.rows[0];

    const nextRecipeId = updates.recipeId === undefined ? existing.recipe_id : updates.recipeId;
    let nextRecipeName =
      updates.recipeName === undefined
        ? existing.recipe_name
        : updates.recipeName;

    if (updates.recipeId !== undefined && updates.recipeId) {
      const recipeRes = await client.query<{ name: string }>(
        `SELECT name
         FROM public.saved_recipes
         WHERE id = $1`,
        [updates.recipeId],
      );
      if (recipeRes.rowCount === 1) {
        nextRecipeName = recipeRes.rows[0].name;
      }
    }

    const nextDayOfWeek = updates.dayOfWeek ?? existing.day_of_week;
    const nextMealType = updates.mealType ?? existing.meal_type;
    const nextServes = updates.serves === undefined ? existing.serves : updates.serves;
    const nextNotes = updates.notes === undefined ? existing.notes : updates.notes;

    await client.query(
      `UPDATE public.meal_plan_slots
         SET day_of_week = $1,
             meal_type = $2,
             recipe_id = $3,
             recipe_name = $4,
             serves = $5,
             notes = $6
       WHERE id = $7`,
      [nextDayOfWeek, nextMealType, nextRecipeId ?? null, nextRecipeName ?? null, nextServes ?? null, nextNotes ?? null, slotId],
    );

    const lowerNotes = typeof nextNotes === "string" ? nextNotes.toLowerCase() : "";
    const dislikeSignals = ["won't eat", "wont eat", "refused", "doesn't like", "doesnt like", "too spicy", "spicy"];
    const shouldLearnPreference = dislikeSignals.some((signal) => lowerNotes.includes(signal));

    if (shouldLearnPreference && typeof nextRecipeName === "string" && nextRecipeName.trim()) {
      const memberRes = await client.query<{ id: string }>(
        `SELECT hm.id
         FROM public.household_members hm
         JOIN public.meal_plans mp ON mp.household_id = hm.household_id
         WHERE mp.id = $1
         ORDER BY hm.created_at ASC
         LIMIT 1`,
        [id],
      );

      if (memberRes.rowCount === 1) {
        await client.query(
          `INSERT INTO public.member_preferences
            (member_id, type, value, severity, source, ai_confidence, notes)
           VALUES ($1, 'dislike', $2, 'mild', 'ai_learned', 0.65, $3)`,
          [memberRes.rows[0].id, nextRecipeName.trim(), nextNotes ?? null],
        );
      }
    }

    return NextResponse.json({ ok: true });
  });
}
