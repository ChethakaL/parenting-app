import { apiFetch } from "./client";
import { API_BASE_URL, API_PREFIX } from "./config";

export type Recipe = {
  id: string;
  name: string;
  sourceUrl: string | null;
  imageUrl: string | null;
  description: string | null;
  prepTimeMins: number | null;
  cookTimeMins: number | null;
  servings: number | null;
  tags: string[];
  createdAt: string | Date;
};

export async function getRecipes(token: string, query?: string, limit = 20) {
  const qs = new URLSearchParams();
  qs.set("limit", String(limit));
  if (query) qs.set("query", query);

  return apiFetch<{ recipes: Recipe[] }>({
    path: `/recipes?${qs.toString()}`,
    method: "GET",
    token,
  });
}

export async function saveRecipeFromText(args: { token: string; description: string }) {
  return apiFetch<{ ok: true; recipeId: string }>({
    path: "/recipes/text",
    method: "POST",
    token: args.token,
    body: { description: args.description },
  });
}

export async function saveRecipeFromUrl(args: { token: string; url: string }) {
  return apiFetch<{ ok: true; recipeId: string }>({
    path: "/recipes/url",
    method: "POST",
    token: args.token,
    body: { url: args.url },
  });
}

export async function saveRecipeFromPhoto(args: { token: string; imageUri: string; mimeType?: string }) {
  const url = `${API_BASE_URL}${API_PREFIX}/recipes/photo`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${args.token}`,
    },
    body: (() => {
      // The blob creation must happen in async code; this wrapper uses the async path below.
      // We keep it as `undefined` here to satisfy TS.
      return undefined as unknown as FormData;
    })(),
  });

  // Above placeholder is not used; real implementation below.
  // (We can't easily create FormData synchronously in React Native.)
  throw new Error("saveRecipeFromPhoto: not implemented yet (need image picker + blob upload).");
}

