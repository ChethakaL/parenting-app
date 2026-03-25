import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withDbUser } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { getSignedGetUrl } from "@/lib/s3";

const QuerySchema = z.object({
  query: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
});

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);

  const url = new URL(req.url);
  const parsed = QuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query parameters." }, { status: 400 });
  }

  const { query, limit } = parsed.data;

  return withDbUser(auth.userId, async (client) => {
    const hh = await client.query<{ id: string }>(
      "SELECT id FROM public.households WHERE owner_id = $1 LIMIT 1",
      [auth.userId],
    );
    if (hh.rowCount !== 1) {
      return NextResponse.json({ error: "Household not found. Complete onboarding first." }, { status: 404 });
    }
    const householdId = hh.rows[0].id;

    const recipesRes = await client.query<{
      id: string;
      name: string;
      source_url: string | null;
      image_url: string | null;
      description: string | null;
      ingredients: unknown;
      instructions: unknown;
      prep_time_mins: number | null;
      cook_time_mins: number | null;
      servings: number | null;
      tags: string[] | null;
      created_at: Date;
    }>(
      query
        ? `SELECT id, name, source_url, image_url, description, ingredients,
                 instructions, prep_time_mins, cook_time_mins, servings, tags, created_at
            FROM public.saved_recipes
            WHERE household_id = $1
              AND LOWER(name) LIKE LOWER($2)
            ORDER BY created_at DESC
            LIMIT $3`
        : `SELECT id, name, source_url, image_url, description, ingredients,
                 instructions, prep_time_mins, cook_time_mins, servings, tags, created_at
            FROM public.saved_recipes
            WHERE household_id = $1
            ORDER BY created_at DESC
            LIMIT $2`,
      query ? [householdId, `%${query}%`, limit] : [householdId, limit],
    );

    const recipes = await Promise.all(
      recipesRes.rows.map(async (r) => {
        const imageUrl = r.image_url ? await getSignedGetUrl({ key: r.image_url }) : null;
        return {
          id: r.id,
          name: r.name,
          sourceUrl: r.source_url,
          imageUrl,
          description: r.description,
          prepTimeMins: r.prep_time_mins,
          cookTimeMins: r.cook_time_mins,
          servings: r.servings,
          tags: r.tags ?? [],
          ingredients: Array.isArray(r.ingredients) ? r.ingredients as Array<{ name: string; quantity?: number; unit?: string }> : [],
          instructions: Array.isArray(r.instructions) ? r.instructions as Array<{ step?: number; text: string }> : [],
          createdAt: r.created_at,
        };
      }),
    );

    return NextResponse.json({ recipes });
  });
}
