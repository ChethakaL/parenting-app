import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withDbUser } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { callClaudeJson, callClaudeVisionJson, callClaudeVisionText } from "@/lib/anthropic";
import { getSignedGetUrl, s3KeyFromRecipeImage, uploadToS3 } from "@/lib/s3";

const PhotoRecipeExtraSchema = z.object({
  notes: z.string().max(2000).optional().nullable(),
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

function normalizeRecipe(recipe: ClaudeRecipe): ClaudeRecipe {
  return {
    ...recipe,
    name: String(recipe.name ?? "").trim(),
    description: recipe.description ? String(recipe.description).trim() : null,
    ingredients: Array.isArray(recipe.ingredients)
      ? recipe.ingredients
          .map((ingredient) => ({
            name: String(ingredient?.name ?? "").trim(),
            quantity: typeof ingredient?.quantity === "number" ? ingredient.quantity : undefined,
            unit: ingredient?.unit ? String(ingredient.unit).trim() : undefined,
          }))
          .filter((ingredient) => ingredient.name.length > 0)
      : [],
    instructions: Array.isArray(recipe.instructions)
      ? recipe.instructions
          .map((step, index) => ({
            step: typeof step?.step === "number" ? step.step : index + 1,
            text: String(step?.text ?? "").trim(),
          }))
          .filter((step) => step.text.length > 0)
      : [],
    tags: Array.isArray(recipe.tags)
      ? recipe.tags.map((tag) => String(tag).trim()).filter(Boolean)
      : [],
  };
}

function hasUsableRecipeBody(recipe: ClaudeRecipe) {
  return recipe.ingredients.length > 0 && recipe.instructions.length > 0;
}

type FormFile = {
  arrayBuffer: () => Promise<ArrayBuffer>;
  type: string;
};

function isFormFile(v: unknown): v is FormFile {
  if (typeof v !== "object" || v === null) return false;
  const obj = v as { arrayBuffer?: unknown; type?: unknown };
  return typeof obj.arrayBuffer === "function" && typeof obj.type === "string";
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  const form = await req.formData();

  const imageField = form.get("image");
  if (!isFormFile(imageField)) {
    return NextResponse.json({ error: "Missing `image` file." }, { status: 400 });
  }

  const notesField = form.get("notes");
  const notesParsed = PhotoRecipeExtraSchema.safeParse(
    notesField ? { notes: String(notesField) } : {},
  );
  const notes = notesParsed.success ? notesParsed.data.notes ?? null : null;

  return withDbUser(auth.userId, async (client) => {
    const hh = await client.query<{ id: string }>(
      "SELECT id FROM public.households WHERE owner_id = $1 LIMIT 1",
      [auth.userId],
    );
    if (hh.rowCount !== 1) {
      return NextResponse.json({ error: "Household not found. Complete onboarding first." }, { status: 404 });
    }
    const householdId = hh.rows[0].id;

    const recipeId = crypto.randomUUID();
    const key = s3KeyFromRecipeImage(householdId, recipeId);

    const arrayBuffer = await imageField.arrayBuffer();
    const body = Buffer.from(arrayBuffer);
    if (body.length > 5 * 1024 * 1024) {
      return NextResponse.json(
        { error: "Image is too large for AI vision. Please upload an image below 5MB." },
        { status: 400 },
      );
    }

    await uploadToS3({
      key,
      contentType: imageField.type || "image/jpeg",
      body,
    });

    const imageBase64 = body.toString("base64");

    const extractionSystem = `You extract recipes from images.
Return JSON only.
Keys required:
- name
- description (string or null)
- ingredients: [{name, quantity?, unit?}]
- instructions: [{step?, text}]
- prep_time_mins (number or null)
- cook_time_mins (number or null)
- servings (number or null)
- cuisine (string or null)
- tags: string[] or null
- nutrition_info (object or null)

Important:
- Only return a successful recipe when ingredients and cooking steps are actually visible or clearly inferable from the provided image.
- Do not leave ingredients or instructions empty unless the image genuinely does not show them.
- If the image is only a title page, story page, or partial recipe page, keep all visible metadata but do not invent missing ingredients or steps.`;

    let recipeJson: ClaudeRecipe;
    try {
      const res = await callClaudeVisionJson<ClaudeRecipe>({
        model: "claude-sonnet-4-6",
        system: extractionSystem,
        userText: `Extract this recipe from the image. ${notes ? `Notes: ${notes}` : ""}`,
        imageBase64,
        imageMediaType: imageField.type || "image/jpeg",
        temperature: 0.2,
        maxTokens: 3800,
      });
      recipeJson = normalizeRecipe(res.parsed);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Recipe extraction failed.";
      if (/image exceeds 5 MB maximum|invalid_request_error/i.test(msg)) {
        return NextResponse.json(
          { error: "Image is too large for AI vision. Please upload an image below 5MB." },
          { status: 400 },
        );
      }
      return NextResponse.json({ error: "Could not extract recipe from that image." }, { status: 422 });
    }

    if (!hasUsableRecipeBody(recipeJson)) {
      try {
        const transcript = await callClaudeVisionText({
          model: "claude-sonnet-4-6",
          system: `Read the cookbook or recipe page exactly as shown.
Return only the recipe-relevant text you can actually see.
Include:
- title
- subtitle
- visible ingredients
- visible method / instructions
- visible timing / servings
- visible notes
Do not invent missing sections that are not present in the image.`,
          userText: `Transcribe the visible recipe text from this image. ${notes ? `Notes: ${notes}` : ""}`,
          imageBase64,
          imageMediaType: imageField.type || "image/jpeg",
          temperature: 0,
          maxTokens: 3200,
        });

        const fallback = await callClaudeJson<ClaudeRecipe>({
          model: "claude-opus-4-6",
          system: `Convert visible cookbook-page text into structured recipe JSON.
Return JSON only with keys:
- name
- description (string or null)
- ingredients: [{name, quantity?, unit?}]
- instructions: [{step?, text}]
- prep_time_mins (number or null)
- cook_time_mins (number or null)
- servings (number or null)
- cuisine (string or null)
- tags: string[] or null
- nutrition_info (object or null)

Important:
- Use only the visible text provided.
- Do not invent ingredients or instructions that are missing from the visible text.
- If ingredients or steps are not present, leave them empty.`,
          userText: `Visible recipe text:\n${transcript}\n\nConvert it into structured recipe JSON now.`,
          temperature: 0.1,
          maxTokens: 3200,
        });

        recipeJson = normalizeRecipe(fallback.parsed);
      } catch {
        // Keep the original parsed result and fail below with a clearer message.
      }
    }

    if (!recipeJson.name || !hasUsableRecipeBody(recipeJson)) {
      return NextResponse.json(
        {
          error: "This photo does not show enough of the recipe to save ingredients and cooking steps. Upload the page that includes the ingredient list and method, or add another clearer recipe image.",
        },
        { status: 422 },
      );
    }

    await client.query(
      `INSERT INTO public.saved_recipes
        (id, household_id, name, source_url, image_url, description, ingredients, instructions,
         prep_time_mins, cook_time_mins, servings, cuisine, tags, nutrition_info, added_via, created_at)
       VALUES
        ($1, $2, $3, NULL, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'photo', NOW())`,
      [
        recipeId,
        householdId,
        recipeJson.name,
        key,
        recipeJson.description ?? null,
        JSON.stringify(recipeJson.ingredients),
        JSON.stringify(
          recipeJson.instructions.map((s, idx) => ({
            step: typeof s.step === "number" ? s.step : idx + 1,
            text: String(s.text ?? ""),
          })),
        ),
        recipeJson.prep_time_mins ?? null,
        recipeJson.cook_time_mins ?? null,
        recipeJson.servings ?? null,
        recipeJson.cuisine ?? null,
        recipeJson.tags ?? [],
        recipeJson.nutrition_info ?? null,
      ],
    );

    const imageUrl = await getSignedGetUrl({ key });
    return NextResponse.json({ ok: true, recipeId, imageUrl });
  });
}
