import { apiFetch } from "./client";

export type MealPlanSlot = {
  id: string;
  dayOfWeek: number;
  mealType: string;
  recipeId: string | null;
  recipeName: string | null;
  serves: number | null;
  notes: string | null;
  approved: boolean;
};

export type MealPlan = {
  id: string;
  weekStart: string;
  status: string;
  weeklyGoal: string | null;
  createdAt: string | Date;
  approvedAt: string | Date | null;
  slots: MealPlanSlot[];
};

export type GetMealPlanResponse = { mealPlan: MealPlan | null };

export async function getMealPlanForCurrentOrNextWeek(token: string) {
  return apiFetch<GetMealPlanResponse>({
    path: "/meal-plans",
    method: "GET",
    token,
  });
}

export async function generateMealPlan(args: { token: string; weekStart?: string }) {
  return apiFetch<{ jobId: string; mealPlanId: string; weekStart: string; status: string }>({
    path: "/meal-plans/generate",
    method: "POST",
    token: args.token,
    body: args.weekStart ? { weekStart: args.weekStart } : {},
  });
}

export async function approveMealPlan(args: { token: string; mealPlanId: string }) {
  return apiFetch<{ ok: true; groceryAdded: number } | { ok: true; groceryAdded: number; message?: string }>({
    path: `/meal-plans/${args.mealPlanId}/approve`,
    method: "POST",
    token: args.token,
  });
}

export async function updateMealPlanSlot(args: {
  token: string;
  mealPlanId: string;
  slotId: string;
  patch: {
    dayOfWeek?: number;
    mealType?: "breakfast" | "lunch" | "dinner" | "snack";
    recipeId?: string | null;
    recipeName?: string | null;
    serves?: number | null;
    notes?: string | null;
  };
}) {
  return apiFetch<{ ok: true }>({
    path: `/meal-plans/${args.mealPlanId}/slots/${args.slotId}`,
    method: "PUT",
    token: args.token,
    body: {
      dayOfWeek: args.patch.dayOfWeek,
      mealType: args.patch.mealType,
      recipeId: args.patch.recipeId ?? undefined,
      recipeName: args.patch.recipeName ?? undefined,
      serves: args.patch.serves ?? undefined,
      notes: args.patch.notes ?? undefined,
    },
  });
}

