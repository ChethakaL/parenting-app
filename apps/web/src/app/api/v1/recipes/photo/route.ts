import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withDbUser } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { callClaudeVisionJson } from "@/lib/anthropic";
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

    const system = `You extract recipes from images.
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
- nutrition_info (object or null)`;

    let recipeJson: ClaudeRecipe;
    try {
      const res = await callClaudeVisionJson<ClaudeRecipe>({
        model: "claude-sonnet-4-6",
        system,
        userText: `Extract this recipe from the image. ${notes ? `Notes: ${notes}` : ""}`,
        imageBase64,
        imageMediaType: imageField.type || "image/jpeg",
        temperature: 0.2,
        maxTokens: 3800,
      });
      recipeJson = res.parsed;
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
        JSON.stringify(recipeJson.ingredients ?? []),
        JSON.stringify(
          Array.isArray(recipeJson.instructions)
            ? recipeJson.instructions.map((s, idx) => ({
                step: typeof s.step === "number" ? s.step : idx + 1,
                text: String(s.text ?? ""),
              }))
            : [],
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

