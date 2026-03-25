import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withDbUser } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { callClaudeJson } from "@/lib/anthropic";

const TextRecipeSchema = z.object({
  description: z.string().min(10).max(10000),
});

type Ingredient = { name: string; quantity?: number; unit?: string };

type ClaudeRecipe = {
  name: string;
  description?: string | null;
  ingredients: Ingredient[];
  instructions: Array<{ step?: number; text: string }> | Array<{ step: number; text: string }>;
  prep_time_mins?: number | null;
  cook_time_mins?: number | null;
  servings?: number | null;
  cuisine?: string | null;
  tags?: string[] | null;
  nutrition_info?: unknown;
};

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  const json = await req.json().catch(() => null);
  const parsed = TextRecipeSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const { description } = parsed.data;

  return withDbUser(auth.userId, async (client) => {
    const hh = await client.query<{ id: string }>(
      "SELECT id FROM public.households WHERE owner_id = $1 LIMIT 1",
      [auth.userId],
    );
    if (hh.rowCount !== 1) {
      return NextResponse.json({ error: "Household not found. Complete onboarding first." }, { status: 404 });
    }
    const householdId = hh.rows[0].id;

    const system = `You extract recipes from user text.
Return structured recipe JSON for saving.
Return JSON only. No commentary.
The JSON keys must be:
- name (string)
- description (string or null)
- ingredients: [{name, quantity?, unit?}]
- instructions: [{step?, text}]
- prep_time_mins (number or null)
- cook_time_mins (number or null)
- servings (number or null)
- cuisine (string or null)
- tags: string[] or null
- nutrition_info (object or null)`;

    const { parsed: recipeJson } = await callClaudeJson<ClaudeRecipe>({
      model: "claude-opus-4-6",
      system,
      userText: `Recipe description:\n${description}\n\nExtract the structured recipe now.`,
      temperature: 0.2,
      maxTokens: 3800,
    });

    const recipeId = crypto.randomUUID();
    const tags = recipeJson.tags ?? [];

    await client.query(
      `INSERT INTO public.saved_recipes
        (id, household_id, name, source_url, image_url, description, ingredients, instructions,
         prep_time_mins, cook_time_mins, servings, cuisine, tags, nutrition_info, added_via, created_at)
       VALUES
        ($1, $2, $3, NULL, NULL, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'manual', NOW())`,
      [
        recipeId,
        householdId,
        recipeJson.name,
        recipeJson.description ?? null,
        JSON.stringify(recipeJson.ingredients ?? []),
        JSON.stringify(
          Array.isArray(recipeJson.instructions)
            ? recipeJson.instructions.map((s, idx) => {
                const step = typeof s.step === "number" ? s.step : idx + 1;
                const text = String(s.text ?? "");
                return { step, text };
              })
            : [],
        ),
        recipeJson.prep_time_mins ?? null,
        recipeJson.cook_time_mins ?? null,
        recipeJson.servings ?? null,
        recipeJson.cuisine ?? null,
        tags,
        recipeJson.nutrition_info ?? null,
      ],
    );

    return NextResponse.json({ ok: true, recipeId });
  });
}

