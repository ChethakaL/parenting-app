import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withDbUser } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { callClaudeJson } from "@/lib/anthropic";

const UrlRecipeSchema = z.object({
  url: z.string().url().max(2000),
});

type Ingredient = { name: string; quantity?: number; unit?: string };

type ClaudeRecipe = {
  name: string;
  description?: string | null;
  ingredients: Ingredient[];
  instructions: Array<{ step?: number; text: string }>;
  prep_time_mins?: number | null;
  cook_time_mins?: number | null;
  servings?: number | null;
  cuisine?: string | null;
  tags?: string[] | null;
  nutrition_info?: unknown;
};

function truncateText(s: string, maxChars: number): string {
  return s.length > maxChars ? s.slice(0, maxChars) : s;
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  const json = await req.json().catch(() => null);
  const parsed = UrlRecipeSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const { url } = parsed.data;

  return withDbUser(auth.userId, async (client) => {
    const hh = await client.query<{ id: string }>(
      "SELECT id FROM public.households WHERE owner_id = $1 LIMIT 1",
      [auth.userId],
    );
    if (hh.rowCount !== 1) {
      return NextResponse.json({ error: "Household not found. Complete onboarding first." }, { status: 404 });
    }
    const householdId = hh.rows[0].id;

    const pageRes = await fetch(url, {
      headers: {
        "user-agent": "ParentAI/Phase1",
      },
    });
    const pageHtml = truncateText(await pageRes.text(), 120000);

    const system = `You extract a structured recipe from an HTML page.
Return JSON only with keys:
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
      userText: `URL: ${url}\n\nHTML:\n${pageHtml}\n\nExtract the recipe now.`,
      temperature: 0.2,
      maxTokens: 3800,
    });

    const recipeId = crypto.randomUUID();

    await client.query(
      `INSERT INTO public.saved_recipes
        (id, household_id, name, source_url, image_url, description, ingredients, instructions,
         prep_time_mins, cook_time_mins, servings, cuisine, tags, nutrition_info, added_via, created_at)
       VALUES
        ($1, $2, $3, $4, NULL, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'url', NOW())`,
      [
        recipeId,
        householdId,
        recipeJson.name,
        url,
        recipeJson.description ?? null,
        JSON.stringify(recipeJson.ingredients ?? []),
        JSON.stringify(recipeJson.instructions ?? []),
        recipeJson.prep_time_mins ?? null,
        recipeJson.cook_time_mins ?? null,
        recipeJson.servings ?? null,
        recipeJson.cuisine ?? null,
        recipeJson.tags ?? [],
        recipeJson.nutrition_info ?? null,
      ],
    );

    return NextResponse.json({ ok: true, recipeId });
  });
}

