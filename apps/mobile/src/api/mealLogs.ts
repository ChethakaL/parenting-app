import { apiFetch } from "./client";

export async function getMealLogs(args: {
  token: string;
  from?: string;
  to?: string;
  memberId?: string;
}) {
  const qs = new URLSearchParams();
  if (args.from) qs.set("from", args.from);
  if (args.to) qs.set("to", args.to);
  if (args.memberId) qs.set("memberId", args.memberId);
  const path = `/meal-logs${qs.toString() ? `?${qs.toString()}` : ""}`;

  return apiFetch<{ mealLogs: Array<unknown> }>({
    path,
    method: "GET",
    token: args.token,
  });
}

export async function logMeal(args: {
  token: string;
  mealType: "breakfast" | "lunch" | "dinner" | "snack";
  memberId?: string | null;
  recipeId?: string | null;
  description?: string | null;
  quantityEaten?: string | null;
  notes?: string | null;
  loggedVia?: "manual" | "ai_voice" | "ai_text";
}) {
  return apiFetch<{ ok: true }>({
    path: "/meal-logs",
    method: "POST",
    token: args.token,
    body: {
      mealType: args.mealType,
      memberId: args.memberId ?? null,
      recipeId: args.recipeId ?? null,
      description: args.description ?? null,
      quantityEaten: args.quantityEaten ?? null,
      notes: args.notes ?? null,
      loggedVia: args.loggedVia ?? "manual",
    },
  });
}

