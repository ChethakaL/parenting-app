export type AppTab =
  | "assistant"
  | "inventory"
  | "grocery"
  | "household"
  | "meal-plans"
  | "recipes"
  | "meal-logs";

export type AuthResponse = { token: string; onboarded: boolean };

export type Member = {
  id: string;
  name: string;
  gender: string;
  dateOfBirth: string | null;
  role: string;
  avatarUrl: string | null;
  ageYears: number;
  ageMonths: number;
};

export type HouseholdMe = {
  household: { id: string; name: string | null };
  members: Member[];
  onboarded: boolean;
};

export type MemberPreference = {
  id: string;
  type: "allergy" | "dislike" | "like" | "diet";
  value: string;
  severity: "critical" | "strong" | "mild" | null;
  source: "manual" | "ai_learned" | "imported";
  ai_confidence: number | null;
  notes: string | null;
};

export type InventoryItem = {
  id: string;
  name: string;
  category: string | null;
  quantity: number | null;
  unit: string | null;
  location: string | null;
  status: "in_stock" | "low" | "finished";
};

export type GroceryItem = {
  id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  category: string | null;
  priority: "urgent" | "normal" | "when_available";
  status: "needed" | "ordered" | "purchased";
};

export type GroceryGrouped = {
  urgent: GroceryItem[];
  normal: GroceryItem[];
  whenAvailable: GroceryItem[];
};

export type ChatCard = { card_type: string; data: unknown };

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  cards?: ChatCard[];
};

export type MealPlanSlot = {
  id: string;
  dayOfWeek: number;
  mealType: "breakfast" | "lunch" | "dinner" | "snack";
  recipeId: string | null;
  recipeName: string | null;
  serves: number | null;
  notes: string | null;
  approved: boolean;
  inventoryStatus?: "in_stock" | "partial" | "missing";
  missingIngredients?: string[];
  annotations?: string[];
  completed?: boolean;
};

export type MealPlan = {
  id: string;
  weekStart: string;
  status: string;
  weeklyGoal: string | null;
  createdAt: string;
  approvedAt: string | null;
  slots: MealPlanSlot[];
};

export type MealPlanWorkspaceData = {
  mealPlan: MealPlan | null;
  savedRecipes: RecipeSummary[];
};

export type RecipeSummary = {
  id: string;
  name: string;
  sourceUrl: string | null;
  imageUrl: string | null;
  description: string | null;
  prepTimeMins: number | null;
  cookTimeMins: number | null;
  servings: number | null;
  tags: string[];
  ingredients?: Array<{ name: string; quantity?: number; unit?: string }>;
  instructions?: Array<{ step?: number; text: string }>;
  createdAt: string;
};

export type MealLog = {
  id: string;
  loggedAt: string;
  mealType: "breakfast" | "lunch" | "dinner" | "snack";
  memberId: string | null;
  recipeId: string | null;
  description: string | null;
  quantityEaten: string | null;
  notes: string | null;
  loggedVia: string;
};

export type WorkspaceOverview = {
  memberCount: number;
  inStockCount: number;
  lowStockCount: number;
  urgentGroceryCount: number;
  groceryCount: number;
};
