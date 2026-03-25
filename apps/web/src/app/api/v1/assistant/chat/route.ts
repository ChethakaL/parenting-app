import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { withDbUser } from "@/lib/db";
import { callClaudeJson, callClaudeText } from "@/lib/anthropic";
import { startOfWeekMonday, formatISODate } from "@/lib/date";

type SSEEvent =
  | { type: "text"; content: string }
  | { type: "tool_call"; tool: string; result: unknown }
  | { type: "card"; card_type: string; data: unknown }
  | { type: "done"; conversation_id: string };

const ChatInputSchema = z.object({
  message: z.string().min(1),
  conversation_id: z.string().uuid().optional(),
  input_mode: z.enum(["text", "voice"]).optional().default("text"),
});

type HouseholdMemberOut = {
  id: string;
  name: string;
  role: string;
  ageYears: number;
  ageMonths: number;
  gender: string;
  dateOfBirth: string | null;
  avatarUrl: string | null;
};

function computeAge(dateOfBirth: string | null) {
  if (!dateOfBirth) return { ageYears: 0, ageMonths: 0 };
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return { ageYears: 0, ageMonths: 0 };
  const now = new Date();
  const ageMonths = (now.getTime() - dob.getTime()) / (30.4375 * 24 * 60 * 60 * 1000);
  return { ageYears: ageMonths / 12, ageMonths };
}

async function getHouseholdId(client: import("pg").PoolClient, userId: string): Promise<string> {
  const hh = await client.query<{ id: string }>(
    "SELECT id FROM public.households WHERE owner_id = $1 LIMIT 1",
    [userId],
  );
  if (hh.rowCount !== 1) throw new Error("Household not found.");
  return hh.rows[0].id;
}

type GeneratedMealSlot = {
  day_of_week: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  meal_type: "breakfast" | "lunch" | "dinner" | "snack";
  recipe_name: string;
  serves: number;
  notes?: string | null;
};

const MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack"] as const;

async function removeDraftMealPlansForWeek(
  client: import("pg").PoolClient,
  householdId: string,
  weekStartIso: string,
) {
  await client.query(
    `UPDATE public.grocery_list_items
     SET meal_plan_id = NULL
     WHERE meal_plan_id IN (
       SELECT id FROM public.meal_plans
       WHERE household_id = $1 AND week_start = $2::date AND status = 'draft'
     )`,
    [householdId, weekStartIso],
  );
  await client.query(
    `DELETE FROM public.meal_plan_slots
     WHERE meal_plan_id IN (
       SELECT id FROM public.meal_plans
       WHERE household_id = $1 AND week_start = $2::date AND status = 'draft'
     )`,
    [householdId, weekStartIso],
  );
  await client.query(
    `DELETE FROM public.meal_plans
     WHERE household_id = $1 AND week_start = $2::date AND status = 'draft'`,
    [householdId, weekStartIso],
  );
}

function placeholderSlots(): GeneratedMealSlot[] {
  return Array.from({ length: 28 }).map((_, i) => {
    const dayIndex = Math.floor(i / 4);
    const mealTypeIndex = i % 4;
    return {
      day_of_week: (dayIndex + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7,
      meal_type: MEAL_TYPES[mealTypeIndex],
      recipe_name: "Meal to plan",
      serves: 4,
      notes: null,
    };
  });
}

function finalizeSlotsFromAi(raw: unknown[]): GeneratedMealSlot[] {
  return raw.map((item, i) => {
    const obj = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const nameRaw = obj.recipe_name ?? obj.recipeName;
    const recipe_name =
      typeof nameRaw === "string" && nameRaw.trim().length > 0 ? nameRaw.trim() : "Meal to plan";
    const dayRaw = obj.day_of_week;
    const day_of_week =
      typeof dayRaw === "number" && dayRaw >= 1 && dayRaw <= 7
        ? (dayRaw as GeneratedMealSlot["day_of_week"])
        : ((Math.floor(i / 4) + 1) as GeneratedMealSlot["day_of_week"]);
    const mtRaw = typeof obj.meal_type === "string" ? obj.meal_type.toLowerCase() : "";
    const meal_type = (MEAL_TYPES as readonly string[]).includes(mtRaw)
      ? (mtRaw as GeneratedMealSlot["meal_type"])
      : MEAL_TYPES[i % 4];
    const serves = typeof obj.serves === "number" && obj.serves > 0 ? obj.serves : 4;
    const notes = typeof obj.notes === "string" && obj.notes.trim() ? obj.notes.trim() : null;
    return { day_of_week, meal_type, recipe_name, serves, notes };
  });
}

function isMealPlanningRequest(message: string) {
  return /meal plan|plan meals|plan this week|plan next week|weekly plan|meals for this week/i.test(message);
}

function mealDayToNumber(message: string) {
  const lower = message.toLowerCase();
  const days = [
    ["monday", 1],
    ["tuesday", 2],
    ["wednesday", 3],
    ["thursday", 4],
    ["friday", 5],
    ["saturday", 6],
    ["sunday", 7],
  ] as const;
  const match = days.find(([label]) => lower.includes(label));
  return match ? match[1] : null;
}

function mealTypeFromMessage(message: string) {
  const lower = message.toLowerCase();
  const mealTypes = ["breakfast", "lunch", "dinner", "snack"] as const;
  return mealTypes.find((mealType) => lower.includes(mealType)) ?? null;
}

function isMealSlotEditRequest(message: string) {
  return /\b(change|replace|update|edit|fix)\b/i.test(message) && mealDayToNumber(message) && mealTypeFromMessage(message);
}

function isTodayMealQuestion(message: string) {
  return /\b(what('| i)?s|what is|show|tell me)\b/i.test(message) && /\b(today|breakfast|lunch|dinner|snack)\b/i.test(message);
}

function isCookSuggestionQuestion(message: string) {
  return /\bwhat can i cook\b|\bwhat should i cook\b|\bcook tonight\b|\bmake tonight\b|\bwith what we have\b/i.test(message);
}

function todayHuman(): string {
  const d = new Date();
  // Simple format that matches intent in doc (no strict exact day/month).
  return d.toDateString();
}

function sendSse(controller: ReadableStreamDefaultController<Uint8Array>, event: SSEEvent) {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  controller.enqueue(new TextEncoder().encode(payload));
}

function humanizeAssistantError(error: unknown) {
  const message = error instanceof Error ? error.message : "Assistant error.";
  if (/Missing ANTHROPIC_API_KEY/i.test(message)) {
    return "The assistant is not configured yet. Add the Anthropic API key and restart the web server.";
  }
  if (/Claude API error \(401\)|authentication_error|x-api-key/i.test(message)) {
    return "The assistant API key is invalid or missing in the running web server. Restart the app after fixing the key.";
  }
  if (/fetch failed|ECONNRESET|ENOTFOUND|network/i.test(message)) {
    return "Parent AI could not reach the AI service just now. Please try again in a moment.";
  }
  if (/Claude API error \(529\)|overloaded_error/i.test(message)) {
    return "Parent AI is temporarily overloaded. Please try again in a few seconds.";
  }
  return "Parent AI ran into a server issue and could not answer that request.";
}

function parseQuantityUnit(value: unknown): { quantity: number | null; unit: string | null } {
  if (typeof value === "number") {
    return { quantity: Number.isFinite(value) ? value : null, unit: null };
  }
  if (typeof value !== "string") {
    return { quantity: null, unit: null };
  }
  const trimmed = value.trim();
  if (!trimmed) return { quantity: null, unit: null };
  const m = trimmed.match(/^(\d+(?:\.\d+)?)\s*([a-zA-Z]+)?/);
  if (!m) return { quantity: null, unit: null };
  const quantity = Number(m[1]);
  return {
    quantity: Number.isFinite(quantity) ? quantity : null,
    unit: m[2] ? m[2].toLowerCase() : null,
  };
}

function isGroceryListQuestion(message: string): boolean {
  const lower = message.toLowerCase();
  return /grocery list|shopping list/.test(lower) && /(what|show|fetch|list|my)/.test(lower);
}

function extractReminderGrocery(message: string): { name: string; quantity: number | null; unit: string | null } | null {
  const lower = message.toLowerCase();
  if (!/(remind me to bring|bring|buy|get)\b/.test(lower)) return null;
  const qtyUnit = message.match(/(\d+(?:\.\d+)?)\s*(ml|l|g|kg|pcs|pc|bottle|bottles|pack|packs|can|cans)?/i);
  const quantity = qtyUnit ? Number(qtyUnit[1]) : null;
  const unit = qtyUnit?.[2] ? qtyUnit[2].toLowerCase() : null;

  const nameMatch =
    message.match(/(?:bring|buy|get)\s+(?:\d+(?:\.\d+)?\s*[a-zA-Z]*\s*)?(?:of\s+)?(.+)$/i) ??
    message.match(/remind me to bring\s+(?:\d+(?:\.\d+)?\s*[a-zA-Z]*\s*)?(?:of\s+)?(.+)$/i);
  if (!nameMatch?.[1]) return null;
  const cleaned = nameMatch[1]
    .replace(/[.?!]+$/, "")
    .replace(/\bto the grocery list\b/i, "")
    .trim();
  if (!cleaned) return null;
  return { name: cleaned, quantity: Number.isFinite(quantity ?? NaN) ? quantity : null, unit };
}

function extractGroceryItemsFromMessage(message: string): string[] {
  const lower = message.toLowerCase();
  if (!/grocery|shopping list/.test(lower) || !/\badd\b/.test(lower)) return [];

  const match =
    message.match(/add\s+(.+?)\s+to\s+(?:the\s+)?(?:grocery|shopping)\s+list/i) ??
    message.match(/add\s+(.+?)\s+(?:grocery|shopping)\s+list/i);
  if (!match?.[1]) return [];

  const raw = match[1]
    .replace(/[“”"']/g, "")
    .replace(/\band\b/gi, ",")
    .replace(/\s+/g, " ")
    .trim();

  return raw
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
    .map((v) => v.replace(/^\d+(\.\d+)?\s*/g, "").trim())
    .filter(Boolean);
}

function isToolResultOk(result: unknown): boolean {
  if (typeof result !== "object" || result === null) return false;
  const obj = result as Record<string, unknown>;
  return obj.ok === true;
}

function extractGroceryItemsFromCards(cards: Array<{ card_type: string; data: unknown }>): string[] {
  const names: string[] = [];
  for (const card of cards) {
    if (card.card_type !== "grocery_list" && card.card_type !== "grocery_summary") continue;
    if (typeof card.data !== "object" || card.data === null) continue;
    const data = card.data as Record<string, unknown>;
    const list = Array.isArray(data.items)
      ? data.items
      : Array.isArray(data.items_added)
        ? data.items_added
        : null;
    if (!list) continue;
    for (const item of list) {
      if (typeof item === "string") {
        const name = item.trim();
        if (name) names.push(name);
        continue;
      }
      if (typeof item === "object" && item !== null) {
        const name = (item as Record<string, unknown>).name;
        if (typeof name === "string" && name.trim()) names.push(name.trim());
      }
    }
  }
  return names;
}

async function buildMealPlanCardData(
  client: import("pg").PoolClient,
  householdId: string,
  mealPlanId: string,
) {
  const mealPlanRes = await client.query<{
    id: string;
    week_start: string;
    status: string;
    weekly_goal: string | null;
    approved_at: Date | null;
  }>(
    `SELECT id, week_start, status, weekly_goal, approved_at
     FROM public.meal_plans
     WHERE id = $1 AND household_id = $2
     LIMIT 1`,
    [mealPlanId, householdId],
  );
  if (mealPlanRes.rowCount !== 1) return null;

  const inventoryRes = await client.query<{ name: string; status: string }>(
    `SELECT name, status
     FROM public.inventory_items
     WHERE household_id = $1`,
    [householdId],
  );
  const preferencesRes = await client.query<{
    member_name: string;
    type: string;
    value: string;
    severity: string | null;
  }>(
    `SELECT hm.name AS member_name, mp.type, mp.value, mp.severity
     FROM public.member_preferences mp
     JOIN public.household_members hm ON hm.id = mp.member_id
     WHERE hm.household_id = $1`,
    [householdId],
  );
  const savedRecipesRes = await client.query<{
    id: string;
    name: string;
    ingredients: unknown;
  }>(
    `SELECT id, name, ingredients
     FROM public.saved_recipes
     WHERE household_id = $1`,
    [householdId],
  );
  const slotsRes = await client.query<{
    id: string;
    day_of_week: number;
    meal_type: string;
    recipe_id: string | null;
    recipe_name: string | null;
    approved: boolean;
    notes: string | null;
  }>(
    `SELECT id, day_of_week, meal_type, recipe_id, recipe_name, approved, notes
     FROM public.meal_plan_slots
     WHERE meal_plan_id = $1
     ORDER BY day_of_week ASC,
       CASE meal_type
         WHEN 'breakfast' THEN 1
         WHEN 'lunch' THEN 2
         WHEN 'dinner' THEN 3
         WHEN 'snack' THEN 4
         ELSE 5
       END`,
    [mealPlanId],
  );

  const inventoryByName = new Map(
    inventoryRes.rows.map((item) => [item.name.trim().toLowerCase(), item.status] as const),
  );
  const recipeById = new Map(savedRecipesRes.rows.map((recipe) => [recipe.id, recipe] as const));
  const recipeByName = new Map(savedRecipesRes.rows.map((recipe) => [recipe.name.trim().toLowerCase(), recipe] as const));
  const preferenceAnnotations = preferencesRes.rows.map((preference) =>
    `${preference.member_name}: ${preference.type}${preference.value ? ` — ${preference.value}` : ""}${preference.severity ? ` (${preference.severity})` : ""}`,
  );

  const normalizeIngredientNames = (raw: unknown) => {
    if (!Array.isArray(raw)) return [] as string[];
    return raw
      .map((item) =>
        typeof item === "object" && item !== null && typeof (item as { name?: unknown }).name === "string"
          ? (item as { name: string }).name.trim()
          : "",
      )
      .filter(Boolean);
  };

  const mealPlan = mealPlanRes.rows[0];

  return {
    mealPlan: {
      id: mealPlan.id,
      weekStart: mealPlan.week_start,
      status: mealPlan.status,
      weeklyGoal: mealPlan.weekly_goal,
      approvedAt: mealPlan.approved_at?.toISOString() ?? null,
      slots: slotsRes.rows.map((slot) => {
        const matchedRecipe =
          (slot.recipe_id ? recipeById.get(slot.recipe_id) : null) ??
          (slot.recipe_name ? recipeByName.get(slot.recipe_name.trim().toLowerCase()) : null);
        const ingredientNames = normalizeIngredientNames(matchedRecipe?.ingredients);
        const missingIngredients = ingredientNames.filter((ingredient) => !inventoryByName.has(ingredient.toLowerCase()));
        const inventoryStatus =
          ingredientNames.length === 0
            ? "missing"
            : missingIngredients.length === 0
              ? "in_stock"
              : missingIngredients.length < ingredientNames.length
                ? "partial"
                : "missing";
        return {
          id: slot.id,
          dayOfWeek: slot.day_of_week,
          mealType: slot.meal_type,
          recipeName: slot.recipe_name,
          approved: slot.approved,
          inventoryStatus,
          missingIngredients,
          annotations: slot.notes?.trim() ? [slot.notes.trim(), ...preferenceAnnotations] : preferenceAnnotations,
        };
      }),
    },
  };
}

async function ensureSavedRecipesForSlots(
  client: import("pg").PoolClient,
  householdId: string,
  slots: Array<{
    id?: string;
    day_of_week?: number;
    meal_type?: string;
    recipe_name: string;
    serves?: number | null;
    notes?: string | null;
  }>,
  householdContext: {
    members: Array<{ name: string; role: string; gender: string; dateOfBirth: string | null; age?: unknown }>;
    preferences: unknown[];
    inventorySummary?: string;
  },
) {
  const uniqueNames = Array.from(new Set(slots.map((slot) => slot.recipe_name.trim()).filter(Boolean)));
  if (uniqueNames.length === 0) return new Map<string, string>();

  const existingRecipesRes = await client.query<{ id: string; name: string }>(
    `SELECT id, name
     FROM public.saved_recipes
     WHERE household_id = $1 AND LOWER(name) = ANY($2::text[])`,
    [householdId, uniqueNames.map((name) => name.toLowerCase())],
  );
  const recipeIdByName = new Map<string, string>();
  for (const recipe of existingRecipesRes.rows) {
    recipeIdByName.set(recipe.name.trim().toLowerCase(), recipe.id);
  }

  const missingNames = uniqueNames.filter((name) => !recipeIdByName.has(name.toLowerCase()));
  if (missingNames.length === 0) return recipeIdByName;

  const system = `You turn meal-plan slots into saved recipes.
Return JSON only with:
{
  "recipes": [
    {
      "name": string,
      "description": string | null,
      "ingredients": [{"name": string, "quantity"?: number, "unit"?: string}],
      "instructions": [{"step"?: number, "text": string}],
      "prep_time_mins": number | null,
      "cook_time_mins": number | null,
      "servings": number | null,
      "tags": string[] | null
    }
  ]
}

Requirements:
- One recipe for each requested slot name
- Make ingredients and steps practical and concise
- Respect infant/child/adult context, allergies, and dietary needs
- If notes mention different handling for different family members, include that in instructions
- Keep recipe names exactly aligned with the requested names`;

  const userText = JSON.stringify(
    {
      household: householdContext,
      slots: slots
        .filter((slot) => missingNames.includes(slot.recipe_name.trim()))
        .map((slot) => ({
          dayOfWeek: slot.day_of_week,
          mealType: slot.meal_type,
          recipeName: slot.recipe_name,
          serves: slot.serves ?? null,
          notes: slot.notes ?? null,
        })),
    },
    null,
    2,
  );

  let generatedRecipes: Array<Record<string, unknown>> = [];
  try {
    const { parsed } = await callClaudeJson<{ recipes: Array<Record<string, unknown>> }>({
      model: "claude-opus-4-6",
      system,
      userText,
      temperature: 0.2,
      maxTokens: 2800,
    });
    generatedRecipes = Array.isArray(parsed.recipes) ? parsed.recipes : [];
  } catch {
    generatedRecipes = [];
  }

  for (const name of missingNames) {
    const generated =
      generatedRecipes.find((recipe) => typeof recipe.name === "string" && recipe.name.trim().toLowerCase() === name.toLowerCase()) ??
      null;

    const recipeId = crypto.randomUUID();
    const ingredients = Array.isArray(generated?.ingredients) ? generated.ingredients : [];
    const instructions = Array.isArray(generated?.instructions) ? generated.instructions : [];
    const description = typeof generated?.description === "string" ? generated.description : null;
    const prepTimeMins = typeof generated?.prep_time_mins === "number" ? generated.prep_time_mins : null;
    const cookTimeMins = typeof generated?.cook_time_mins === "number" ? generated.cook_time_mins : null;
    const servings = typeof generated?.servings === "number" ? generated.servings : null;
    const tags = Array.isArray(generated?.tags) ? generated.tags.filter((tag) => typeof tag === "string") : [];

    await client.query(
      `INSERT INTO public.saved_recipes
        (id, household_id, name, source_url, image_url, description, ingredients, instructions,
         prep_time_mins, cook_time_mins, servings, cuisine, tags, nutrition_info, added_via, created_at)
       VALUES ($1,$2,$3,NULL,NULL,$4,$5,$6,$7,$8,$9,NULL,$10,NULL,'manual',NOW())`,
      [
        recipeId,
        householdId,
        name,
        description,
        JSON.stringify(ingredients),
        JSON.stringify(instructions),
        prepTimeMins,
        cookTimeMins,
        servings,
        tags,
      ],
    );
    recipeIdByName.set(name.toLowerCase(), recipeId);
  }

  return recipeIdByName;
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  const json = await req.json().catch(() => null);
  const parsed = ChatInputSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const { message, input_mode, conversation_id } = parsed.data;

  const conversationId = await withDbUser(auth.userId, async (client) => {
    const householdId = await getHouseholdId(client, auth.userId);
    const id = conversation_id ?? crypto.randomUUID();

    if (conversation_id) {
      await client.query(
        `UPDATE public.ai_conversations
         SET updated_at = NOW()
         WHERE id = $1 AND user_id = $2`,
        [id, auth.userId],
      );
    } else {
      await client.query(
        `INSERT INTO public.ai_conversations (id, household_id, user_id, started_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW())`,
        [id, householdId, auth.userId],
      );
    }

    await client.query(
      `INSERT INTO public.ai_messages
        (conversation_id, role, content, tool_calls, tool_results, input_mode)
       VALUES ($1, 'user', $2, NULL, NULL, $3)`,
      [id, message, input_mode],
    );

    return id;
  });

  const context = await withDbUser(auth.userId, async (client) => {
    const householdId = await getHouseholdId(client, auth.userId);
    const membersRes = await client.query<{
      id: string;
      name: string;
      gender: string;
      date_of_birth: string | null;
      role: string;
      avatar_url: string | null;
    }>(
      `SELECT id, name, gender, date_of_birth, role, avatar_url
       FROM public.household_members
       WHERE household_id = $1
       ORDER BY created_at ASC`,
      [householdId],
    );

    const members: HouseholdMemberOut[] = membersRes.rows.map((m) => {
      const { ageYears, ageMonths } = computeAge(m.date_of_birth);
      return {
        id: m.id,
        name: m.name,
        role: m.role,
        ageYears,
        ageMonths,
        gender: m.gender,
        dateOfBirth: m.date_of_birth,
        avatarUrl: m.avatar_url,
      };
    });

    const prefRes = await client.query<{
      member_id: string;
      type: string;
      value: string;
      severity: string | null;
      ai_confidence: number | null;
      source: string;
      notes: string | null;
    }>(
      `SELECT member_id, type, value, severity, ai_confidence, source, notes
       FROM public.member_preferences
       WHERE member_id IN (SELECT id FROM public.household_members WHERE household_id = $1)`,
      [householdId],
    );

    const inventoryRes = await client.query<{
      id: string;
      name: string;
      status: string;
      category: string | null;
      quantity: number | null;
      unit: string | null;
      location: string | null;
    }>(
      `SELECT id, name, status, category, quantity, unit, location
       FROM public.inventory_items
       WHERE household_id = $1`,
      [householdId],
    );

    const low = inventoryRes.rows.filter((i) => i.status === "low");
    const inStock = inventoryRes.rows.filter((i) => i.status === "in_stock");
    const finished = inventoryRes.rows.filter((i) => i.status === "finished");

    const inventory_summary = `${inStock.length} items in stock, ${low.length} low, ${finished.length} finished`;

    const groceryRes = await client.query<{ id: string }>(
      `SELECT id
       FROM public.grocery_list_items
       WHERE household_id = $1 AND status IN ('needed', 'ordered')`,
      [householdId],
    );

    const weekStart = formatISODate(startOfWeekMonday(new Date()));
    const mealPlansRes = await client.query<{
      id: string;
      status: string;
      week_start: string;
      weekly_goal: string | null;
    }>(
      `SELECT id, status, week_start, weekly_goal
       FROM public.meal_plans
       WHERE household_id = $1 AND week_start = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [householdId, weekStart],
    );

    const grocery_list_count = groceryRes.rowCount;
    const weeklyGoal = mealPlansRes.rows[0]?.weekly_goal ?? null;

    const active_meal_plan = mealPlansRes.rows[0]
      ? `Week of ${mealPlansRes.rows[0].week_start} — ${mealPlansRes.rows[0].status}`
      : "No meal plan yet for this week";

    return {
      household: { name: "Household", members, preferences: prefRes.rows },
      inventory_summary,
      active_meal_plan,
      grocery_list_count,
      weekly_goal: weeklyGoal,
      today: todayHuman(),
    };
  });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const sendTextChunks = (text: string) => {
          const chunkSize = 110;
          for (let i = 0; i < text.length; i += chunkSize) {
            const chunk = text.slice(i, i + chunkSize);
            sendSse(controller, { type: "text", content: chunk });
          }
        };

        // Deterministic path for simple grocery list queries (no model dependency).
        if (isGroceryListQuestion(message)) {
          const groceryRows = await withDbUser(auth.userId, async (client) => {
            const householdId = await getHouseholdId(client, auth.userId);
            const rows = await client.query<{
              id: string;
              name: string;
              quantity: number | null;
              unit: string | null;
              priority: string;
            }>(
              `SELECT id, name, quantity, unit, priority
               FROM public.grocery_list_items
               WHERE household_id = $1 AND status IN ('needed','ordered')
               ORDER BY
                 CASE priority WHEN 'urgent' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END ASC,
                 created_at ASC`,
              [householdId],
            );
            return rows.rows;
          });

          const text =
            groceryRows.length === 0
              ? "Your grocery list is empty right now."
              : `Here is your grocery list:\n${groceryRows
                  .map((r) => `- ${r.name}${r.quantity !== null ? ` (${r.quantity}${r.unit ? ` ${r.unit}` : ""})` : ""}`)
                  .join("\n")}`;

          sendTextChunks(text);
          await withDbUser(auth.userId, async (client) => {
            await client.query(
              `INSERT INTO public.ai_messages
                (conversation_id, role, content, tool_calls, tool_results, input_mode)
               VALUES ($1, 'assistant', $2, $3, $4, $5)`,
              [conversationId, text, JSON.stringify([]), JSON.stringify([]), input_mode],
            );
          });
          sendSse(controller, { type: "done", conversation_id: conversationId });
          controller.close();
          return;
        }

        // Deterministic fallback for "remind me to bring ..." grocery intents.
        const reminderItem = extractReminderGrocery(message);
        if (reminderItem) {
          await withDbUser(auth.userId, async (client) => {
            const householdId = await getHouseholdId(client, auth.userId);
            await client.query(
              `INSERT INTO public.grocery_list_items
                (household_id, name, quantity, unit, category, priority, status, added_via)
               VALUES ($1,$2,$3,$4,NULL,'normal','needed','ai')`,
              [householdId, reminderItem.name, reminderItem.quantity, reminderItem.unit],
            );
          });
          const text = `Done. I added ${reminderItem.name} to your grocery list.`;
          sendTextChunks(text);
          await withDbUser(auth.userId, async (client) => {
            await client.query(
              `INSERT INTO public.ai_messages
                (conversation_id, role, content, tool_calls, tool_results, input_mode)
               VALUES ($1, 'assistant', $2, $3, $4, $5)`,
              [conversationId, text, JSON.stringify([]), JSON.stringify([]), input_mode],
            );
          });
          sendSse(controller, { type: "done", conversation_id: conversationId });
          controller.close();
          return;
        }

        if (isTodayMealQuestion(message) || isCookSuggestionQuestion(message)) {
          const text = await withDbUser(auth.userId, async (client) => {
            const householdId = await getHouseholdId(client, auth.userId);
            const weekStartIso = formatISODate(startOfWeekMonday(new Date()));
            const todayJs = new Date().getDay();
            const todayDayOfWeek = todayJs === 0 ? 7 : todayJs;
            const lower = message.toLowerCase();

            const planRes = await client.query<{ id: string; week_start: string; status: string }>(
              `SELECT id, week_start, status
               FROM public.meal_plans
               WHERE household_id = $1 AND week_start = $2
               ORDER BY created_at DESC
               LIMIT 1`,
              [householdId, weekStartIso],
            );
            if (planRes.rowCount !== 1) {
              return "There is no meal plan for this week yet. Ask me to plan the week and I’ll build one.";
            }

            const slotsRes = await client.query<{
              id: string;
              day_of_week: number;
              meal_type: string;
              recipe_name: string | null;
              notes: string | null;
            }>(
              `SELECT id, day_of_week, meal_type, recipe_name, notes
               FROM public.meal_plan_slots
               WHERE meal_plan_id = $1
               ORDER BY day_of_week ASC,
                 CASE meal_type
                   WHEN 'breakfast' THEN 1
                   WHEN 'lunch' THEN 2
                   WHEN 'dinner' THEN 3
                   WHEN 'snack' THEN 4
                   ELSE 5
                 END`,
              [planRes.rows[0].id],
            );

            const mealTypeFilter =
              lower.includes("breakfast") ? "breakfast" :
              lower.includes("lunch") ? "lunch" :
              lower.includes("dinner") ? "dinner" :
              lower.includes("snack") ? "snack" :
              null;

            const todaysSlots = slotsRes.rows.filter((slot) => slot.day_of_week === todayDayOfWeek);
            const filteredSlots = mealTypeFilter
              ? todaysSlots.filter((slot) => slot.meal_type === mealTypeFilter)
              : todaysSlots;

            if (filteredSlots.length === 0) {
              return mealTypeFilter
                ? `There is no ${mealTypeFilter} planned for today yet.`
                : "There are no meals planned for today yet.";
            }

            if (isCookSuggestionQuestion(message)) {
              const inventoryRes = await client.query<{ name: string; status: string }>(
                `SELECT name, status
                 FROM public.inventory_items
                 WHERE household_id = $1 AND status IN ('in_stock', 'low')`,
                [householdId],
              );
              const inStockNames = inventoryRes.rows.map((item) => item.name);
              const preferredSlot =
                filteredSlots.find((slot) => slot.meal_type === "dinner") ??
                filteredSlots.find((slot) => slot.meal_type === "lunch") ??
                filteredSlots[0];
              const notes = preferredSlot.notes?.trim() ? ` ${preferredSlot.notes.trim()}` : "";
              return `Tonight you can make ${preferredSlot.recipe_name ?? "your planned meal"}.${notes}\n\nYou currently have: ${inStockNames.slice(0, 8).join(", ")}${inStockNames.length > 8 ? ", and more" : ""}.`;
            }

            return filteredSlots
              .map((slot) => {
                const title = slot.recipe_name?.trim() || "Meal to plan";
                const note = slot.notes?.trim() ? `\n${slot.notes.trim()}` : "";
                return `${slot.meal_type[0].toUpperCase()}${slot.meal_type.slice(1)}: ${title}${note}`;
              })
              .join("\n\n");
          });

          sendTextChunks(text);
          await withDbUser(auth.userId, async (client) => {
            await client.query(
              `INSERT INTO public.ai_messages
                (conversation_id, role, content, tool_calls, tool_results, input_mode)
               VALUES ($1, 'assistant', $2, $3, $4, $5)`,
              [conversationId, text, JSON.stringify([]), JSON.stringify([]), input_mode],
            );
          });
          sendSse(controller, { type: "done", conversation_id: conversationId });
          controller.close();
          return;
        }

        if (isMealPlanningRequest(message)) {
          sendTextChunks("Checking your household, preferences, inventory, saved recipes, and recent meal logs to build this week’s draft.");

          const mealPlanCard = await withDbUser(auth.userId, async (client) => {
            const householdId = await getHouseholdId(client, auth.userId);
            const weekStartIso = formatISODate(startOfWeekMonday(new Date()));

            const membersRes = await client.query<{
              name: string;
              gender: string;
              date_of_birth: string | null;
              role: string;
            }>(
              `SELECT name, gender, date_of_birth, role
               FROM public.household_members
               WHERE household_id = $1
               ORDER BY created_at ASC`,
              [householdId],
            );

            const prefRes = await client.query<{
              member_id: string;
              type: string;
              value: string;
              severity: string | null;
            }>(
              `SELECT mp.member_id, mp.type, mp.value, mp.severity
               FROM public.member_preferences mp
               JOIN public.household_members hm ON hm.id = mp.member_id
               WHERE hm.household_id = $1`,
              [householdId],
            );

            const inventoryRes = await client.query<{ status: string; name: string }>(
              `SELECT status, name
               FROM public.inventory_items
               WHERE household_id = $1`,
              [householdId],
            );

            const lowItems = inventoryRes.rows.filter((r) => r.status === "low").slice(0, 10).map((r) => r.name);
            const inStockCount = inventoryRes.rows.filter((r) => r.status === "in_stock").length;
            const lowCount = inventoryRes.rows.filter((r) => r.status === "low").length;

            const weeklyGoalRes = await client.query<{ goal_text: string }>(
              `SELECT goal_text
               FROM public.weekly_goals
               WHERE household_id = $1 AND week_start = $2 AND active = TRUE
               LIMIT 1`,
              [householdId, weekStartIso],
            );

            const weeklyGoal = weeklyGoalRes.rows[0]?.goal_text ?? null;

            const savedRecipesRes = await client.query<{
              name: string;
              tags: string[] | null;
              description: string | null;
            }>(
              `SELECT name, tags, description
               FROM public.saved_recipes
               WHERE household_id = $1
               ORDER BY created_at DESC
               LIMIT 25`,
              [householdId],
            );

            const recentMealLogsRes = await client.query<{
              logged_at: Date;
              meal_type: string | null;
              description: string | null;
            }>(
              `SELECT logged_at, meal_type, description
               FROM public.meal_logs
               WHERE household_id = $1
               ORDER BY logged_at DESC
               LIMIT 40`,
              [householdId],
            );

            await removeDraftMealPlansForWeek(client, householdId, weekStartIso);

            const system = `You are ParentAI, a personal assistant for this household.
Return a meal plan draft as structured JSON. Follow the instructions:
- 7 days (day_of_week 1=Mon..7=Sun)
- For each day include breakfast, lunch, dinner, snack (28 total slots)
- Allergy filtering: never include severity='critical' items from preferences; avoid others when possible
- Age appropriateness: role infant/child/adult affects texture simplicity
- Prefer saved recipes when they fit
- Avoid repeating meals from the recent meal logs
- Prefer meals that use current in-stock ingredients to reduce waste
- Use names that can map to saved recipes later
Return a single JSON object of the form: { "slots": [ ... ] }
Each slot object must use snake_case keys: day_of_week, meal_type, recipe_name (non-empty string), serves, notes.
Return JSON only. No commentary.`;

            const userText = JSON.stringify(
              {
                household: {
                  members: membersRes.rows.map((m) => ({
                    name: m.name,
                    role: m.role,
                    gender: m.gender,
                    dateOfBirth: m.date_of_birth,
                  })),
                  preferences: prefRes.rows,
                },
                inventory_summary: `${inStockCount} items in stock, ${lowCount} low`,
                inventory_low_items: lowItems,
                weekly_goal: weeklyGoal,
                recent_meal_logs: recentMealLogsRes.rows.map((log) => ({
                  loggedAt: log.logged_at,
                  mealType: log.meal_type,
                  description: log.description,
                })),
                saved_recipes: savedRecipesRes.rows.map((recipe) => ({
                  name: recipe.name,
                  tags: recipe.tags ?? [],
                  description: recipe.description,
                })),
              },
              null,
              2,
            );

            const model = "claude-opus-4-6" as const;
            let rawSlots: unknown[] = [];
            let claudeUnavailable = false;

            try {
              const { parsed } = await callClaudeJson<{ slots: unknown[] }>({
                model,
                system,
                userText,
                temperature: 0.2,
                maxTokens: 3800,
              });
              rawSlots = Array.isArray(parsed.slots) ? parsed.slots : [];
            } catch {
              claudeUnavailable = true;
              rawSlots = [];
            }

            const slots =
              !claudeUnavailable && rawSlots.length === 28 ? finalizeSlotsFromAi(rawSlots) : placeholderSlots();

            const recipeIdByName = await ensureSavedRecipesForSlots(
              client,
              householdId,
              slots,
              {
                members: membersRes.rows.map((member) => ({
                  name: member.name,
                  role: member.role,
                  gender: member.gender,
                  dateOfBirth: member.date_of_birth,
                  age: computeAge(member.date_of_birth),
                })),
                preferences: prefRes.rows,
                inventorySummary: `${inStockCount} items in stock, ${lowCount} low`,
              },
            );

            const mealPlanId = crypto.randomUUID();
            const aiContext = {
              model,
              weekStart: weekStartIso,
              usedPlaceholderFallback: claudeUnavailable || rawSlots.length !== 28,
              claudeUnavailable,
            };

            await client.query(
              `INSERT INTO public.meal_plans
                (id, household_id, week_start, status, weekly_goal, ai_context, created_at)
               VALUES ($1, $2, $3, 'draft', $4, $5::jsonb, NOW())`,
              [mealPlanId, householdId, weekStartIso, weeklyGoal, JSON.stringify(aiContext)],
            );

            for (const slot of slots) {
              await client.query(
                `INSERT INTO public.meal_plan_slots
                  (meal_plan_id, day_of_week, meal_type, recipe_id, recipe_name, serves, notes, approved)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,FALSE)`,
                [
                  mealPlanId,
                  slot.day_of_week,
                  slot.meal_type,
                  recipeIdByName.get(slot.recipe_name.trim().toLowerCase()) ?? null,
                  slot.recipe_name,
                  slot.serves,
                  slot.notes ?? null,
                ],
              );
            }

            return buildMealPlanCardData(client, householdId, mealPlanId);
          });

          if (mealPlanCard) {
            sendSse(controller, { type: "card", card_type: "meal_plan", data: mealPlanCard });
          }

          sendTextChunks("Your weekly draft is ready to review. You can approve it, regenerate it, or edit it day by day.");
          await withDbUser(auth.userId, async (client) => {
            await client.query(
              `INSERT INTO public.ai_messages
                (conversation_id, role, content, tool_calls, tool_results, input_mode)
               VALUES ($1, 'assistant', $2, $3, $4, $5)`,
              [
                conversationId,
                "Your weekly draft is ready to review. You can approve it, regenerate it, or edit it day by day.",
                JSON.stringify([{ tool: "generate_meal_plan", args: {} }]),
                JSON.stringify([{ tool: "generate_meal_plan", result: { ok: true } }]),
                input_mode,
              ],
            );
          });
          sendSse(controller, { type: "done", conversation_id: conversationId });
          controller.close();
          return;
        }

        if (isMealSlotEditRequest(message)) {
          const updatedMealPlanCard = await withDbUser(auth.userId, async (client) => {
            const householdId = await getHouseholdId(client, auth.userId);
            const weekStartIso = formatISODate(startOfWeekMonday(new Date()));
            const dayOfWeek = mealDayToNumber(message);
            const mealType = mealTypeFromMessage(message);
            if (!dayOfWeek || !mealType) return null;

            const planRes = await client.query<{ id: string }>(
              `SELECT id
               FROM public.meal_plans
               WHERE household_id = $1 AND week_start = $2
               ORDER BY created_at DESC
               LIMIT 1`,
              [householdId, weekStartIso],
            );
            if (planRes.rowCount !== 1) return null;
            const mealPlanId = planRes.rows[0].id;

            const slotRes = await client.query<{
              id: string;
              recipe_name: string | null;
              serves: number | null;
              notes: string | null;
            }>(
              `SELECT id, recipe_name, serves, notes
               FROM public.meal_plan_slots
               WHERE meal_plan_id = $1 AND day_of_week = $2 AND meal_type = $3
               LIMIT 1`,
              [mealPlanId, dayOfWeek, mealType],
            );
            if (slotRes.rowCount !== 1) return null;
            const slot = slotRes.rows[0];

            const membersRes = await client.query<{
              name: string;
              gender: string;
              date_of_birth: string | null;
              role: string;
            }>(
              `SELECT name, gender, date_of_birth, role
               FROM public.household_members
               WHERE household_id = $1
               ORDER BY created_at ASC`,
              [householdId],
            );

            const prefRes = await client.query<{
              member_name: string;
              type: string;
              value: string;
              severity: string | null;
            }>(
              `SELECT hm.name AS member_name, mp.type, mp.value, mp.severity
               FROM public.member_preferences mp
               JOIN public.household_members hm ON hm.id = mp.member_id
               WHERE hm.household_id = $1`,
              [householdId],
            );

            const system = `You update one meal-plan slot for a family.
Return JSON only with keys:
- recipe_name: short user-friendly meal title
- notes: multiline household guidance, with separate lines when guidance differs by family member

Requirements:
- Keep the update focused on the requested slot only
- Respect ages, allergies, dislikes, and dietary context
- If the request asks for different handling for different family members, make that explicit in notes
- For infants/toddlers, prefer soft, mashed, blended, or finely chopped guidance when appropriate
- Do not mention internal systems or model names`;

            const userText = JSON.stringify(
              {
                request: message,
                slot: {
                  dayOfWeek,
                  mealType,
                  currentRecipeName: slot.recipe_name,
                  currentNotes: slot.notes,
                  serves: slot.serves,
                },
                householdMembers: membersRes.rows.map((member) => ({
                  name: member.name,
                  role: member.role,
                  gender: member.gender,
                  dateOfBirth: member.date_of_birth,
                  age: computeAge(member.date_of_birth),
                })),
                preferences: prefRes.rows,
              },
              null,
              2,
            );

            const { parsed } = await callClaudeJson<{ recipe_name?: string; notes?: string | null }>({
              model: "claude-opus-4-6",
              system,
              userText,
              temperature: 0.2,
              maxTokens: 500,
            });

            const nextRecipeName =
              typeof parsed.recipe_name === "string" && parsed.recipe_name.trim()
                ? parsed.recipe_name.trim()
                : slot.recipe_name ?? "Updated meal";
            const nextNotes =
              typeof parsed.notes === "string" && parsed.notes.trim()
                ? parsed.notes.trim()
                : slot.notes ?? null;

            const recipeIdByName = await ensureSavedRecipesForSlots(
              client,
              householdId,
              [
                {
                  id: slot.id,
                  day_of_week: dayOfWeek,
                  meal_type: mealType,
                  recipe_name: nextRecipeName,
                  serves: slot.serves,
                  notes: nextNotes,
                },
              ],
              {
                members: membersRes.rows.map((member) => ({
                  name: member.name,
                  role: member.role,
                  gender: member.gender,
                  dateOfBirth: member.date_of_birth,
                  age: computeAge(member.date_of_birth),
                })),
                preferences: prefRes.rows,
              },
            );

            await client.query(
              `UPDATE public.meal_plan_slots
               SET recipe_name = $1,
                   recipe_id = $2,
                   notes = $3
               WHERE id = $4`,
              [
                nextRecipeName,
                recipeIdByName.get(nextRecipeName.trim().toLowerCase()) ?? null,
                nextNotes,
                slot.id,
              ],
            );

            return buildMealPlanCardData(client, householdId, mealPlanId);
          });

          if (!updatedMealPlanCard) {
            sendTextChunks("I couldn't find that meal slot to update yet. Please mention the day and meal type, for example Sunday snack.");
          } else {
            sendSse(controller, { type: "card", card_type: "meal_plan", data: updatedMealPlanCard });
            sendTextChunks("I updated that meal slot and refreshed your weekly plan.");
          }

          await withDbUser(auth.userId, async (client) => {
            await client.query(
              `INSERT INTO public.ai_messages
                (conversation_id, role, content, tool_calls, tool_results, input_mode)
               VALUES ($1, 'assistant', $2, $3, $4, $5)`,
              [
                conversationId,
                updatedMealPlanCard
                  ? "I updated that meal slot and refreshed your weekly plan."
                  : "I couldn't find that meal slot to update yet. Please mention the day and meal type, for example Sunday snack.",
                JSON.stringify([{ tool: "update_meal_slot", args: { inferredFromMessage: true } }]),
                JSON.stringify([{ tool: "update_meal_slot", result: { ok: Boolean(updatedMealPlanCard) } }]),
                input_mode,
              ],
            );
          });
          sendSse(controller, { type: "done", conversation_id: conversationId });
          controller.close();
          return;
        }

        // Claude decision: toolCalls + responseText + cards
        const toolsSystemPrompt = `You are ParentAI, a personal assistant for this household.

HOUSEHOLD CONTEXT
${JSON.stringify(context, null, 2)}

YOUR TOOLS
You have the following tools available. Always use tools to read and write data — never assume state from conversation alone.

Tools:
- get_household_members
- get_member_preferences
- save_member_preference
- delete_member_preference
- get_inventory
- add_inventory_item
- update_inventory_item
- remove_inventory_item
- mark_inventory_finished
- get_grocery_list
- add_grocery_item
- remove_grocery_item
- clear_purchased_items
- get_meal_plan
- generate_meal_plan
- approve_meal_plan
- update_meal_slot
- get_recipe_substitute
- log_meal
- get_meal_log
- get_saved_recipes
- save_recipe_from_url
- save_recipe_from_text
- add_recipe_to_meal_plan

BEHAVIOUR RULES
- Always confirm before making changes to preferences or inventory.
- Never make medical recommendations.
- When you detect a new food preference, write it immediately and show a confirmation card.
- For clear logging statements like "I bought 200g of potatoes today", update inventory immediately.
- Never claim a change was made unless the matching tool call succeeded.
- Keep responses warm but concise.

OUTPUT FORMAT
Return ONLY valid JSON with keys:
{
  "toolCalls": [{"tool": "<tool name>", "args": {...}}],
  "responseText": "<assistant text>",
  "cards": [{"card_type":"<card type>","data":{...}}]
}
No extra keys.`;

        let toolCalls: Array<{ tool: string; args?: Record<string, unknown> }> = [];
        let cards: Array<{ card_type: string; data: unknown }> = [];
        let responseText = "";
        try {
          const decision = await callClaudeJson<{
            toolCalls: Array<{ tool: string; args?: Record<string, unknown> }>;
            responseText: string;
            cards: Array<{ card_type: string; data: unknown }>;
          }>({
            model: "claude-sonnet-4-6",
            system: toolsSystemPrompt,
            userText: `User message:\n${message}`,
            temperature: 0.2,
            maxTokens: 2500,
          });
          toolCalls = decision.parsed.toolCalls ?? [];
          cards = decision.parsed.cards ?? [];
          responseText = decision.parsed.responseText ?? "";
        } catch (err) {
          const msg = err instanceof Error ? err.message : "";
          if (/Failed to parse Claude JSON\. Raw:/i.test(msg)) {
            const raw = msg.split("Raw:")[1]?.trim();
            responseText = raw && raw.length > 0
              ? raw
              : "I understood your message, but the AI response format was invalid. Please try again.";
          } else
          if (!/Claude API error \(529\)|overloaded_error|fetch failed|ECONNRESET|ENOTFOUND|network/i.test(msg)) {
            throw err;
          } else {
            // Graceful fallback for common grocery add intent when model is overloaded.
            const fallbackItems = extractGroceryItemsFromMessage(message);
            if (fallbackItems.length > 0) {
              toolCalls = fallbackItems.map((name) => ({
                tool: "add_grocery_item",
                args: { name, priority: "normal" },
              }));
              responseText = "I added that to your grocery list.";
            } else {
              responseText = "The AI service is busy right now. Please retry in a few seconds.";
            }
          }
        }
        const groceryFallbackItems = extractGroceryItemsFromMessage(message);
        const usedGroceryFallback = toolCalls.length === 0 && groceryFallbackItems.length > 0;
        const usedMealPlanFallback = toolCalls.length === 0 && isMealPlanningRequest(message);

        if (usedGroceryFallback) {
          toolCalls = groceryFallbackItems.map((name) => ({
            tool: "add_grocery_item",
            args: { name, quantity: 1, unit: null, priority: "normal" },
          }));
        }

        if (usedMealPlanFallback) {
          toolCalls = [{ tool: "generate_meal_plan", args: {} }];
          responseText = "I’m building your weekly draft now with household preferences, inventory, saved recipes, and recent meal history.";
        }

        // Emit cards first (so UI can render interactive elements).
        for (const card of cards) {
          sendSse(controller, { type: "card", card_type: card.card_type, data: card.data });
        }

        const toolResults: Array<{ tool: string; result: unknown }> = [];

        if (toolCalls.length > 0) {
          // Execute tool calls with DB access.
          await withDbUser(auth.userId, async (client) => {
            const householdId = await getHouseholdId(client, auth.userId);

            const memberIdByName = new Map<string, string>();
            const memberRes = await client.query<{ id: string; name: string }>(
              `SELECT id, name FROM public.household_members WHERE household_id = $1`,
              [householdId],
            );
            for (const m of memberRes.rows) memberIdByName.set(m.name.trim().toLowerCase(), m.id);

            const inventoryIdByName = new Map<string, string>();
            const invRes = await client.query<{ id: string; name: string }>(
              `SELECT id, name FROM public.inventory_items WHERE household_id = $1`,
              [householdId],
            );
            for (const i of invRes.rows) inventoryIdByName.set(i.name.trim().toLowerCase(), i.id);

            const recipeIdByName = new Map<string, string>();
            const recipesRes = await client.query<{ id: string; name: string }>(
              `SELECT id, name FROM public.saved_recipes WHERE household_id = $1`,
              [householdId],
            );
            for (const r of recipesRes.rows) recipeIdByName.set(r.name.trim().toLowerCase(), r.id);

            for (const call of toolCalls) {
              const { tool, args = {} } = call;
              let result: unknown = { ok: false, error: "Tool not implemented." };

              const safeString = (v: unknown): string | null => (typeof v === "string" ? v : null);
              const safeNum = (v: unknown): number | null => (typeof v === "number" ? v : null);

              try {
                switch (tool) {
                  case "get_household_members": {
                    const res = await client.query<{
                      id: string;
                      name: string;
                      gender: string;
                      date_of_birth: string | null;
                      role: string;
                      avatar_url: string | null;
                    }>(
                      `SELECT id, name, gender, date_of_birth, role, avatar_url
                       FROM public.household_members
                       WHERE household_id = $1`,
                      [householdId],
                    );

                    const members = res.rows.map((m) => {
                      const { ageYears, ageMonths } = computeAge(m.date_of_birth);
                      return {
                        id: m.id,
                        name: m.name,
                        role: m.role,
                        ageYears,
                        ageMonths,
                        gender: m.gender,
                        dateOfBirth: m.date_of_birth,
                        avatarUrl: m.avatar_url,
                      };
                    });
                    result = { members };
                    break;
                  }

                case "get_member_preferences": {
                  const memberId =
                    safeString((args as Record<string, unknown>)?.memberId) ??
                    (safeString((args as Record<string, unknown>)?.memberName)
                      ? memberIdByName.get(
                          (safeString((args as Record<string, unknown>)?.memberName) ?? "").trim().toLowerCase(),
                        )
                      : null);
                  if (!memberId) {
                    result = { preferences: [] };
                    break;
                  }
                  const pref = await client.query(
                    `SELECT id, member_id, type, value, severity, source, ai_confidence, notes, created_at, updated_at
                     FROM public.member_preferences
                     WHERE member_id = $1
                     ORDER BY created_at ASC`,
                    [memberId],
                  );
                  result = { preferences: pref.rows };
                  break;
                }

                case "save_member_preference": {
                  const memberId =
                    safeString((args as Record<string, unknown>)?.memberId) ??
                    (safeString((args as Record<string, unknown>)?.memberName)
                      ? memberIdByName.get(
                          (safeString((args as Record<string, unknown>)?.memberName) ?? "").trim().toLowerCase(),
                        )
                      : null);
                  const type = safeString((args as Record<string, unknown>)?.type);
                  const value = safeString((args as Record<string, unknown>)?.value);
                  const severity = safeString((args as Record<string, unknown>)?.severity);
                  const source =
                    safeString((args as Record<string, unknown>)?.source) ?? "ai_learned";
                  const ai_confidence = safeNum((args as Record<string, unknown>)?.aiConfidence);
                  const notes = safeString((args as Record<string, unknown>)?.notes);
                  if (!memberId || !type || !value) {
                    result = { ok: false, error: "Missing fields." };
                    break;
                  }
                  // For allergy/dislike, severity is expected by DB constraints.
                  const severityVal =
                    (type === "allergy" || type === "dislike") && severity
                      ? severity
                      : null;
                  const ins = await client.query(
                    `INSERT INTO public.member_preferences
                      (member_id, type, value, severity, source, ai_confidence, notes)
                     VALUES ($1,$2,$3,$4,$5,$6,$7)
                     RETURNING id`,
                    [memberId, type, value, severityVal, source, ai_confidence, notes ?? null],
                  );
                  result = { ok: true, id: ins.rows[0].id };
                  break;
                }

                case "delete_member_preference": {
                  const prefId = safeString((args as Record<string, unknown>)?.prefId);
                  if (!prefId) {
                    result = { ok: false, error: "Missing prefId." };
                    break;
                  }
                  const del = await client.query(
                    `DELETE FROM public.member_preferences
                     WHERE id = $1`,
                    [prefId],
                  );
                  result = { ok: true, deleted: del.rowCount };
                  break;
                }

                case "get_inventory": {
                  const status = safeString((args as Record<string, unknown>)?.status);
                  const category = safeString((args as Record<string, unknown>)?.category);
                  const where: string[] = [];
                  const params: unknown[] = [householdId];
                  if (status) {
                    where.push(`status = $${params.length + 1}`);
                    params.push(status);
                  }
                  if (category) {
                    where.push(`category = $${params.length + 1}`);
                    params.push(category);
                  }
                  const whereSql = where.length ? `AND ${where.join(" AND ")}` : "";
                  const res = await client.query(
                    `SELECT id, name, category, quantity, unit, brand, barcode, expiry_date, location, status, added_via, receipt_id, created_at, updated_at
                     FROM public.inventory_items
                     WHERE household_id = $1 ${whereSql}
                     ORDER BY created_at ASC`,
                    params,
                  );
                  result = { items: res.rows };
                  break;
                }

                case "add_inventory_item": {
                  const rawArgs = args as Record<string, unknown>;
                  const itemsInput =
                    Array.isArray(rawArgs.items)
                      ? rawArgs.items
                      : rawArgs.inventory_item && typeof rawArgs.inventory_item === "object"
                        ? [rawArgs.inventory_item]
                        : typeof rawArgs.name === "string"
                          ? [rawArgs]
                          : null;

                  if (!itemsInput) {
                    result = { ok: false, error: "Expected inventory item details." };
                    break;
                  }
                  const created: unknown[] = [];
                  for (const it of itemsInput) {
                    if (typeof it !== "object" || it === null) continue;
                    const obj = it as Record<string, unknown>;
                    const itemName = safeString(obj.name);
                    if (!itemName) continue;
                    const category = safeString(obj.category);
                    const quantity = obj.quantity;
                    const parsed = parseQuantityUnit(quantity);
                    const q = parsed.quantity;
                    const unit = safeString(obj.unit) ?? parsed.unit;
                    const brand = safeString(obj.brand);
                    const expiry_date = safeString(obj.expiryDate ?? obj.expiry_date);
                    const location = safeString(obj.location);
                    const ins = await client.query(
                      `INSERT INTO public.inventory_items
                        (household_id, name, category, quantity, unit, brand, expiry_date, location, status, added_via)
                       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'in_stock','ai_text')
                       RETURNING id`,
                      [householdId, itemName, category ?? null, q, unit ?? null, brand ?? null, expiry_date ?? null, location ?? null],
                    );
                    created.push({ id: ins.rows[0].id });
                  }
                  result = created.length > 0
                    ? { ok: true, created }
                    : { ok: false, error: "No valid inventory items were provided." };
                  break;
                }

                case "update_inventory_item": {
                  const itemId = safeString((args as Record<string, unknown>)?.id);
                  const patch = (args as Record<string, unknown>)?.patch;
                  if (!itemId || typeof patch !== "object" || patch === null) {
                    result = { ok: false, error: "Missing id/patch." };
                    break;
                  }
                  const p = patch as Record<string, unknown>;
                  const nextName = safeString(p.name);
                  const nextCategory = safeString(p.category);
                  const nextUnit = safeString(p.unit);
                  const nextBrand = safeString(p.brand);
                  const nextLocation = safeString(p.location);
                  const nextStatus = safeString(p.status);
                  const nextQtyParsed = p.quantity !== undefined ? parseQuantityUnit(p.quantity).quantity : undefined;
                  const ins = await client.query(
                    `UPDATE public.inventory_items
                     SET name = COALESCE($1, name),
                         category = COALESCE($2, category),
                         quantity = COALESCE($3, quantity),
                         unit = COALESCE($4, unit),
                         brand = COALESCE($5, brand),
                         location = COALESCE($6, location),
                         status = COALESCE($7, status)
                     WHERE id = $8`,
                    [
                      nextName ?? null,
                      nextCategory ?? null,
                      nextQtyParsed === undefined ? null : nextQtyParsed,
                      nextUnit ?? null,
                      nextBrand ?? null,
                      nextLocation ?? null,
                      nextStatus ?? null,
                      itemId,
                    ],
                  );
                  result = { ok: true, updated: ins.rowCount };
                  break;
                }

                case "remove_inventory_item": {
                  const itemId = safeString((args as Record<string, unknown>)?.id);
                  if (!itemId) {
                    result = { ok: false, error: "Missing id." };
                    break;
                  }
                  const del = await client.query(
                    `DELETE FROM public.inventory_items WHERE id = $1`,
                    [itemId],
                  );
                  result = { ok: true, deleted: del.rowCount };
                  break;
                }

                case "mark_inventory_finished": {
                  const itemId = safeString((args as Record<string, unknown>)?.id);
                  if (!itemId) {
                    result = { ok: false, error: "Missing id." };
                    break;
                  }
                  const itemRes = await client.query<{
                    id: string;
                    name: string;
                    household_id: string;
                    quantity: number | null;
                    unit: string | null;
                    category: string | null;
                  }>(
                    `SELECT id, name, household_id, quantity, unit, category
                     FROM public.inventory_items
                     WHERE id = $1`,
                    [itemId],
                  );
                  if (itemRes.rowCount !== 1) {
                    result = { ok: false, error: "Item not found." };
                    break;
                  }
                  await client.query(
                    `UPDATE public.inventory_items SET status = 'finished' WHERE id = $1`,
                    [itemId],
                  );
                  const grocery = await client.query(
                    `INSERT INTO public.grocery_list_items
                      (household_id, name, quantity, unit, category, priority, status, added_via)
                     VALUES ($1,$2,$3,$4,$5,'normal','needed','inventory_finished')
                     RETURNING id`,
                    [
                      itemRes.rows[0].household_id,
                      itemRes.rows[0].name,
                      itemRes.rows[0].quantity,
                      itemRes.rows[0].unit,
                      itemRes.rows[0].category,
                    ],
                  );
                  result = { ok: true, groceryItemId: grocery.rows[0].id };
                  break;
                }

                case "get_grocery_list": {
                  const hhList = await client.query(
                    `SELECT id, name, quantity, unit, category, priority, status, added_via, notes, created_at
                     FROM public.grocery_list_items
                     WHERE household_id = $1 AND status != 'purchased'`,
                    [householdId],
                  );
                  const all = hhList.rows;
                  const urgent = all.filter((r) => r.priority === "urgent");
                  const normal = all.filter((r) => r.priority === "normal");
                  const whenAvailable = all.filter((r) => r.priority === "when_available");
                  result = { urgent, normal, whenAvailable };
                  break;
                }

                case "add_grocery_item": {
                  const rawArgs = args as Record<string, unknown>;
                  const defaultPriorityRaw = safeString(rawArgs?.priority);
                  const defaultPriority =
                    defaultPriorityRaw === "urgent" || defaultPriorityRaw === "normal" || defaultPriorityRaw === "when_available"
                      ? defaultPriorityRaw
                      : "normal";

                  const itemsInput =
                    Array.isArray(rawArgs.items)
                      ? rawArgs.items
                      : Array.isArray(rawArgs.groceryItems)
                        ? rawArgs.groceryItems
                        : Array.isArray(rawArgs.grocery_items)
                          ? rawArgs.grocery_items
                          : null;

                  const normalizedItems: Array<{
                    name: string;
                    quantity: number | null;
                    unit: string | null;
                    category: string | null;
                    priority: "urgent" | "normal" | "when_available";
                  }> = [];

                  const normalizePriority = (value: string | null): "urgent" | "normal" | "when_available" =>
                    value === "urgent" || value === "normal" || value === "when_available" ? value : defaultPriority;

                  if (itemsInput) {
                    for (const it of itemsInput) {
                      if (typeof it === "string") {
                        const name = it.trim();
                        if (!name) continue;
                        normalizedItems.push({
                          name,
                          quantity: null,
                          unit: null,
                          category: null,
                          priority: defaultPriority,
                        });
                        continue;
                      }
                      if (typeof it !== "object" || it === null) continue;
                      const obj = it as Record<string, unknown>;
                      const name =
                        safeString(obj.name) ??
                        safeString(obj.item) ??
                        safeString(obj.food) ??
                        safeString(obj.product) ??
                        safeString(obj.label);
                      if (!name) continue;
                      const parsed = parseQuantityUnit(obj.quantity);
                      const q = parsed.quantity;
                      normalizedItems.push({
                        name,
                        quantity: q,
                        unit: safeString(obj.unit) ?? parsed.unit,
                        category: safeString(obj.category),
                        priority: normalizePriority(safeString(obj.priority)),
                      });
                    }
                  } else {
                    const name =
                      safeString(rawArgs?.name) ??
                      safeString(rawArgs?.item) ??
                      safeString(rawArgs?.food) ??
                      safeString(rawArgs?.product) ??
                      safeString(rawArgs?.label);
                    if (name) {
                      const parsed = parseQuantityUnit(rawArgs?.quantity);
                      const q = parsed.quantity;
                      normalizedItems.push({
                        name,
                        quantity: q,
                        unit: safeString(rawArgs?.unit) ?? parsed.unit,
                        category: safeString(rawArgs?.category),
                        priority: defaultPriority,
                      });
                    }
                  }

                  if (normalizedItems.length === 0) {
                    result = { ok: false, error: "Missing grocery item name." };
                    break;
                  }

                  const createdIds: string[] = [];
                  for (const item of normalizedItems) {
                    const ins = await client.query<{ id: string }>(
                      `INSERT INTO public.grocery_list_items
                        (household_id, name, quantity, unit, category, priority, status, added_via)
                       VALUES ($1,$2,$3,$4,$5,$6,'needed','ai')
                       RETURNING id`,
                      [householdId, item.name, item.quantity, item.unit, item.category, item.priority],
                    );
                    createdIds.push(ins.rows[0].id);
                  }
                  result = createdIds.length === 1
                    ? { ok: true, groceryItemId: createdIds[0] }
                    : { ok: true, groceryItemIds: createdIds };
                  break;
                }

                case "remove_grocery_item": {
                  const groceryId = safeString((args as Record<string, unknown>)?.id);
                  if (!groceryId) {
                    result = { ok: false, error: "Missing id." };
                    break;
                  }
                  const del = await client.query(
                    `DELETE FROM public.grocery_list_items WHERE id = $1`,
                    [groceryId],
                  );
                  result = { ok: true, deleted: del.rowCount };
                  break;
                }

                case "clear_purchased_items": {
                  const del = await client.query(
                    `DELETE FROM public.grocery_list_items WHERE household_id = $1 AND status='purchased'`,
                    [householdId],
                  );
                  result = { ok: true, deleted: del.rowCount };
                  break;
                }

                case "get_meal_plan": {
                  const weekStartArg = safeString((args as Record<string, unknown>)?.weekStart);
                  const weekStart = weekStartArg ?? formatISODate(startOfWeekMonday(new Date()));
                  const planRes = await client.query(
                    `SELECT id, week_start, status, weekly_goal, created_at, approved_at
                     FROM public.meal_plans
                     WHERE household_id = $1 AND week_start = $2
                     ORDER BY created_at DESC
                     LIMIT 1`,
                    [householdId, weekStart],
                  );
                  if (planRes.rowCount !== 1) {
                    result = { mealPlan: null };
                    break;
                  }
                  const plan = planRes.rows[0];
                  const slotsRes = await client.query(
                    `SELECT id, day_of_week, meal_type, recipe_id, recipe_name, serves, notes, approved
                     FROM public.meal_plan_slots
                     WHERE meal_plan_id = $1`,
                    [plan.id],
                  );
                  result = {
                    mealPlan: {
                      id: plan.id,
                      weekStart: plan.week_start,
                      status: plan.status,
                      weeklyGoal: plan.weekly_goal,
                      createdAt: plan.created_at,
                      approvedAt: plan.approved_at,
                      slots: slotsRes.rows,
                    },
                  };
                  break;
                }

                case "generate_meal_plan": {
                  const weekStartArg = safeString((args as Record<string, unknown>)?.weekStart);
                  const weekStartDate = weekStartArg ? new Date(weekStartArg) : startOfWeekMonday(new Date());
                  const weekStartIso = formatISODate(weekStartDate);

                  const membersRes = await client.query<{
                    name: string;
                    gender: string;
                    date_of_birth: string | null;
                    role: string;
                  }>(
                    `SELECT name, gender, date_of_birth, role
                     FROM public.household_members
                     WHERE household_id = $1
                     ORDER BY created_at ASC`,
                    [householdId],
                  );

                  const prefRes = await client.query<{
                    member_id: string;
                    type: string;
                    value: string;
                    severity: string | null;
                  }>(
                    `SELECT mp.member_id, mp.type, mp.value, mp.severity
                     FROM public.member_preferences mp
                     JOIN public.household_members hm ON hm.id = mp.member_id
                     WHERE hm.household_id = $1`,
                    [householdId],
                  );

                  const inventoryRes = await client.query<{ status: string; name: string }>(
                    `SELECT status, name FROM public.inventory_items WHERE household_id=$1`,
                    [householdId],
                  );
                  const lowItems = inventoryRes.rows.filter((r) => r.status === "low").slice(0, 10).map((r) => r.name);
                  const inStockCount = inventoryRes.rows.filter((r) => r.status === "in_stock").length;
                  const lowCount = inventoryRes.rows.filter((r) => r.status === "low").length;

                  const weeklyGoalRes = await client.query<{ goal_text: string }>(
                    `SELECT goal_text
                     FROM public.weekly_goals
                     WHERE household_id = $1 AND week_start = $2 AND active = TRUE
                     LIMIT 1`,
                    [householdId, weekStartIso],
                  );

                  const weeklyGoal = weeklyGoalRes.rows[0]?.goal_text ?? null;

                  const savedRecipesRes = await client.query<{
                    name: string;
                    tags: string[] | null;
                    description: string | null;
                  }>(
                    `SELECT name, tags, description
                     FROM public.saved_recipes
                     WHERE household_id = $1
                     ORDER BY created_at DESC
                     LIMIT 25`,
                    [householdId],
                  );

                  const recentMealLogsRes = await client.query<{
                    logged_at: Date;
                    meal_type: string | null;
                    description: string | null;
                  }>(
                    `SELECT logged_at, meal_type, description
                     FROM public.meal_logs
                     WHERE household_id = $1
                     ORDER BY logged_at DESC
                     LIMIT 40`,
                    [householdId],
                  );

                  await removeDraftMealPlansForWeek(client, householdId, weekStartIso);

                  const system = `You are ParentAI, a personal assistant for this household.
Return a meal plan draft as structured JSON. Follow the instructions:
- 7 days (day_of_week 1=Mon..7=Sun)
- For each day include breakfast, lunch, dinner, snack (28 total slots)
- Allergy filtering: never include severity='critical' items from preferences; avoid others when possible
- Age appropriateness: role infant/child/adult affects texture simplicity
- Prefer saved recipes when they fit
- Avoid repeating meals from the recent meal logs
- Prefer meals that use current in-stock ingredients to reduce waste
- Use names that can map to saved recipes later
Return a single JSON object of the form: { "slots": [ ... ] }
Each slot object must use snake_case keys: day_of_week, meal_type, recipe_name (non-empty string), serves, notes.
Return JSON only. No commentary.`;

                  const userText = JSON.stringify(
                    {
                      household: { members: membersRes.rows, preferences: prefRes.rows },
                      inventory_summary: `${inStockCount} items in stock, ${lowCount} low`,
                      inventory_low_items: lowItems,
                      weekly_goal: weeklyGoal,
                      recent_meal_logs: recentMealLogsRes.rows.map((log) => ({
                        loggedAt: log.logged_at,
                        mealType: log.meal_type,
                        description: log.description,
                      })),
                      saved_recipes: savedRecipesRes.rows.map((recipe) => ({
                        name: recipe.name,
                        tags: recipe.tags ?? [],
                        description: recipe.description,
                      })),
                    },
                    null,
                    2,
                  );

                  const model = "claude-opus-4-6" as const;
                  let rawSlots: unknown[] = [];
                  let claudeUnavailable = false;

                  try {
                    const { parsed } = await callClaudeJson<{ slots: unknown[] }>({
                      model,
                      system,
                      userText,
                      temperature: 0.2,
                      maxTokens: 3800,
                    });
                    rawSlots = Array.isArray(parsed.slots) ? parsed.slots : [];
                  } catch {
                    claudeUnavailable = true;
                    rawSlots = [];
                  }

                  const slots =
                    !claudeUnavailable && rawSlots.length === 28 ? finalizeSlotsFromAi(rawSlots) : placeholderSlots();

                  const mealPlanId = crypto.randomUUID();
                  const aiContext = {
                    model,
                    weekStart: weekStartIso,
                    usedPlaceholderFallback: claudeUnavailable || rawSlots.length !== 28,
                    claudeUnavailable,
                  };

                  await client.query(
                    `INSERT INTO public.meal_plans
                      (id, household_id, week_start, status, weekly_goal, ai_context, created_at)
                     VALUES ($1, $2, $3, 'draft', $4, $5::jsonb, NOW())`,
                    [mealPlanId, householdId, weekStartIso, weeklyGoal, JSON.stringify(aiContext)],
                  );

                  for (const slot of slots) {
                    await client.query(
                      `INSERT INTO public.meal_plan_slots
                        (meal_plan_id, day_of_week, meal_type, recipe_id, recipe_name, serves, notes, approved)
                       VALUES ($1,$2,$3,NULL,$4,$5,$6,FALSE)`,
                      [
                        mealPlanId,
                        slot.day_of_week,
                        slot.meal_type,
                        slot.recipe_name,
                        slot.serves,
                        slot.notes ?? null,
                      ],
                    );
                  }

                  result = {
                    ok: true,
                    mealPlanId,
                    mealPlan: {
                      id: mealPlanId,
                      weekStart: weekStartIso,
                      status: "draft",
                      weeklyGoal,
                      approvedAt: null,
                      slots: slots.map((slot) => ({
                        id: crypto.randomUUID(),
                        dayOfWeek: slot.day_of_week,
                        mealType: slot.meal_type,
                        recipeName: slot.recipe_name,
                        approved: false,
                        inventoryStatus: "missing",
                        missingIngredients: [],
                        annotations: slot.notes ? [slot.notes] : [],
                      })),
                    },
                  };
                  break;
                }

                case "approve_meal_plan": {
                  const mealPlanId = safeString((args as Record<string, unknown>)?.id) ?? safeString((args as Record<string, unknown>)?.mealPlanId);
                  if (!mealPlanId) {
                    result = { ok: false, error: "Missing meal plan id." };
                    break;
                  }

                  // Reuse simplified approve logic: mark approved and populate groceries from recipes ingredients.
                  await client.query(
                    `UPDATE public.meal_plans SET status='approved', approved_at=NOW() WHERE id=$1 AND household_id=$2`,
                    [mealPlanId, householdId],
                  );

                  const slots = await client.query<{ id: string; recipe_id: string | null; recipe_name: string | null }>(
                    `SELECT id, recipe_id, recipe_name
                     FROM public.meal_plan_slots
                     WHERE meal_plan_id=$1`,
                    [mealPlanId],
                  );

                  const missingSlots = slots.rows.filter((s) => !s.recipe_id && s.recipe_name);
                  if (missingSlots.length > 0) {
                    const names = Array.from(
                      new Set(
                        missingSlots
                          .map((s) => (s.recipe_name ? s.recipe_name.trim().toLowerCase() : ""))
                          .filter(Boolean),
                      ),
                    );
                    const recipes = await client.query<{ id: string; name: string; ingredients: unknown }>(
                      `SELECT id, name, ingredients FROM public.saved_recipes WHERE household_id=$1 AND LOWER(name)=ANY($2::text[])`,
                      [householdId, names],
                    );
                    const byName = new Map<string, { id: string }>();
                    for (const r of recipes.rows) byName.set(r.name.trim().toLowerCase(), { id: r.id });
                    for (const s of missingSlots) {
                      const key = s.recipe_name ? s.recipe_name.trim().toLowerCase() : "";
                      const match = byName.get(key);
                      if (!match) continue;
                      await client.query(
                        `UPDATE public.meal_plan_slots SET recipe_id=$1, recipe_name=$2 WHERE id=$3`,
                        [match.id, s.recipe_name, s.id],
                      );
                    }
                  }

                  const slotsWithRecipes = await client.query<{ recipe_id: string }>(
                    `SELECT recipe_id FROM public.meal_plan_slots WHERE meal_plan_id=$1 AND recipe_id IS NOT NULL`,
                    [mealPlanId],
                  );

                  const recipeIds = Array.from(new Set(slotsWithRecipes.rows.map((s) => s.recipe_id)));
                  if (recipeIds.length === 0) {
                    result = { ok: true, groceryAdded: 0 };
                    break;
                  }

                  const recipesRes = await client.query<{ id: string; ingredients: unknown }>(
                    `SELECT id, ingredients FROM public.saved_recipes WHERE household_id=$1 AND id=ANY($2::uuid[])`,
                    [householdId, recipeIds],
                  );

                  const recipesById = new Map<string, { ingredients: unknown }>();
                  for (const r of recipesRes.rows) recipesById.set(r.id, { ingredients: r.ingredients });

                  const normalizeIngredients = (raw: unknown) => {
                    if (!Array.isArray(raw)) return [];
                    const out: Array<{ name: string; quantity?: number; unit?: string }> = [];
                    for (const it of raw) {
                      if (typeof it !== "object" || it === null) continue;
                      const obj = it as Record<string, unknown>;
                      const nm = typeof obj.name === "string" ? obj.name.trim() : "";
                      if (!nm) continue;
                      const q = typeof obj.quantity === "number" ? obj.quantity : undefined;
                      const unit = typeof obj.unit === "string" ? obj.unit : undefined;
                      out.push({ name: nm, quantity: q, unit });
                    }
                    return out;
                  };

                  let groceryAdded = 0;
                  for (const s of slotsWithRecipes.rows) {
                    const rec = recipesById.get(s.recipe_id);
                    if (!rec) continue;
                    const ingredients = normalizeIngredients(rec.ingredients);
                    for (const ing of ingredients) {
                      const invRes = await client.query<{ id: string }>(
                        `SELECT id FROM public.inventory_items
                         WHERE household_id=$1 AND LOWER(name)=LOWER($2) AND status IN ('in_stock','low')
                         LIMIT 1`,
                        [householdId, ing.name],
                      );
                      if (invRes.rowCount > 0) continue;

                      const existing = await client.query<{ id: string }>(
                        `SELECT id FROM public.grocery_list_items
                         WHERE household_id=$1 AND LOWER(name)=LOWER($2) AND status IN ('needed','ordered')
                         LIMIT 1`,
                        [householdId, ing.name],
                      );
                      if (existing.rowCount > 0) continue;

                      await client.query(
                        `INSERT INTO public.grocery_list_items
                          (household_id, name, quantity, unit, category, priority, status, added_via)
                         VALUES ($1,$2,$3,$4,NULL,'normal','needed','meal_plan')`,
                        [householdId, ing.name, ing.quantity ?? null, ing.unit ?? null],
                      );
                      groceryAdded += 1;
                    }
                  }

                  result = { ok: true, groceryAdded };
                  break;
                }

                case "update_meal_slot": {
                  const slotId = safeString((args as Record<string, unknown>)?.slotId) ?? safeString((args as Record<string, unknown>)?.id);
                  if (!slotId) {
                    result = { ok: false, error: "Missing slotId." };
                    break;
                  }
                  const patch = (args as Record<string, unknown>)?.patch ?? args;
                  const dayOfWeek = patch && typeof patch === "object" ? (patch as Record<string, unknown>).dayOfWeek : undefined;
                  const mealType = patch && typeof patch === "object" ? (patch as Record<string, unknown>).mealType : undefined;
                  const recipeId = patch && typeof patch === "object" ? (patch as Record<string, unknown>).recipeId : undefined;
                  const recipeName = patch && typeof patch === "object" ? (patch as Record<string, unknown>).recipeName : undefined;
                  const serves = patch && typeof patch === "object" ? (patch as Record<string, unknown>).serves : undefined;
                  const notes = patch && typeof patch === "object" ? (patch as Record<string, unknown>).notes : undefined;

                  await client.query(
                    `UPDATE public.meal_plan_slots
                     SET day_of_week = COALESCE($1, day_of_week),
                         meal_type = COALESCE($2, meal_type),
                         recipe_id = COALESCE($3, recipe_id),
                         recipe_name = COALESCE($4, recipe_name),
                         serves = COALESCE($5, serves),
                         notes = COALESCE($6, notes)
                     WHERE id = $7`,
                    [
                      typeof dayOfWeek === "number" ? dayOfWeek : null,
                      typeof mealType === "string" ? mealType : null,
                      typeof recipeId === "string" ? recipeId : null,
                      typeof recipeName === "string" ? recipeName : null,
                      typeof serves === "number" ? serves : null,
                      typeof notes === "string" ? notes : null,
                      slotId,
                    ],
                  );
                  result = { ok: true };
                  break;
                }

                case "get_recipe_substitute": {
                  const missingIngredient = safeString((args as Record<string, unknown>)?.missingIngredient);
                  const recipeName = safeString((args as Record<string, unknown>)?.recipeName);
                  if (!missingIngredient || !recipeName) {
                    result = { ok: false, error: "Missing recipeName/missingIngredient." };
                    break;
                  }
                  const text = await callClaudeText({
                    model: "claude-sonnet-4-6",
                    system: "Suggest a single good substitute ingredient for a missing ingredient in a recipe. Be brief and safe.",
                    userText: `Recipe: ${recipeName}\nMissing: ${missingIngredient}\nSuggest a substitute and a quick way to use it.`,
                    temperature: 0.4,
                    maxTokens: 300,
                  });
                  result = { ok: true, substitute: text.trim() };
                  break;
                }

                case "log_meal": {
                  const mealType = safeString((args as Record<string, unknown>)?.mealType);
                  const memberId = safeString((args as Record<string, unknown>)?.memberId) ?? null;
                  const recipeId = safeString((args as Record<string, unknown>)?.recipeId) ?? null;
                  const description = safeString((args as Record<string, unknown>)?.description) ?? null;
                  const quantity_eaten = safeString((args as Record<string, unknown>)?.quantityEaten) ?? null;
                  const notes = safeString((args as Record<string, unknown>)?.notes) ?? null;
                  const logged_via = safeString((args as Record<string, unknown>)?.loggedVia) ?? "manual";
                  if (!mealType) {
                    result = { ok: false, error: "Missing mealType." };
                    break;
                  }
                  const ins = await client.query(
                    `INSERT INTO public.meal_logs
                      (household_id, member_id, meal_type, recipe_id, description, quantity_eaten, notes, logged_via)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
                    [householdId, memberId, mealType, recipeId, description, quantity_eaten, notes, logged_via],
                  );
                  result = { ok: true, logged: ins.rowCount };
                  break;
                }

                case "get_meal_log": {
                  const from = safeString((args as Record<string, unknown>)?.from);
                  const to = safeString((args as Record<string, unknown>)?.to);
                  const memberId = safeString((args as Record<string, unknown>)?.memberId);
                  let q =
                    `SELECT id, logged_at, meal_type, member_id, recipe_id, description, quantity_eaten, notes, logged_via
                     FROM public.meal_logs
                     WHERE household_id = $1`;
                  const params: unknown[] = [householdId];
                  if (from) {
                    q += ` AND logged_at >= $${params.length + 1}`;
                    params.push(from);
                  }
                  if (to) {
                    q += ` AND logged_at <= $${params.length + 1}`;
                    params.push(to);
                  }
                  if (memberId) {
                    q += ` AND member_id = $${params.length + 1}`;
                    params.push(memberId);
                  }
                  q += " ORDER BY logged_at DESC";
                  const logs = await client.query(q, params);
                  result = { mealLogs: logs.rows };
                  break;
                }

                case "get_saved_recipes": {
                  const queryText = safeString((args as Record<string, unknown>)?.query);
                  const recipes = await client.query(
                    `SELECT id, name, source_url, image_url, description, ingredients,
                            prep_time_mins, cook_time_mins, servings, cuisine, tags, nutrition_info, added_via, created_at
                     FROM public.saved_recipes
                     WHERE household_id=$1 ${queryText ? "AND LOWER(name) LIKE LOWER($2)" : ""}
                     ORDER BY created_at DESC
                     LIMIT ${queryText ? 20 : 20}`,
                    queryText ? [householdId, `%${queryText}%`] : [householdId],
                  );
                  result = { recipes: recipes.rows };
                  break;
                }

                case "save_recipe_from_url": {
                  const url = safeString((args as Record<string, unknown>)?.url);
                  if (!url) {
                    result = { ok: false, error: "Missing url." };
                    break;
                  }
                  const pageRes = await fetch(url, { headers: { "user-agent": "ParentAI/assistant" } });
                  const pageHtml = await pageRes.text();
                  const system = `You extract a structured recipe from an HTML page.
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
- nutrition_info (object or null)`;
                  const { parsed: recipeJsonUnknown } = await callClaudeJson<unknown>({
                    model: "claude-opus-4-6",
                    system,
                    userText: `URL: ${url}\n\nHTML:\n${pageHtml.slice(0, 120000)}\n\nExtract the recipe now.`,
                    temperature: 0.2,
                    maxTokens: 3800,
                  });

                  const recipeObj =
                    typeof recipeJsonUnknown === "object" && recipeJsonUnknown !== null
                      ? (recipeJsonUnknown as Record<string, unknown>)
                      : {};
                  const recipeName = typeof recipeObj.name === "string" ? recipeObj.name : "Saved recipe";
                  const recipeDescription = typeof recipeObj.description === "string" ? recipeObj.description : null;
                  const recipeIngredients = Array.isArray(recipeObj.ingredients) ? recipeObj.ingredients : [];
                  const recipeInstructions = Array.isArray(recipeObj.instructions) ? recipeObj.instructions : [];
                  const prepTimeMins = typeof recipeObj.prep_time_mins === "number" ? recipeObj.prep_time_mins : null;
                  const cookTimeMins = typeof recipeObj.cook_time_mins === "number" ? recipeObj.cook_time_mins : null;
                  const servings = typeof recipeObj.servings === "number" ? recipeObj.servings : null;
                  const cuisine = typeof recipeObj.cuisine === "string" ? recipeObj.cuisine : null;
                  const tags = Array.isArray(recipeObj.tags) ? recipeObj.tags.filter((t) => typeof t === "string") : [];
                  const nutritionInfo = recipeObj.nutrition_info ?? null;

                  // Minimal insert; full fidelity comes later.
                  const recipeId = crypto.randomUUID();
                  await client.query(
                    `INSERT INTO public.saved_recipes
                      (id, household_id, name, source_url, image_url, description, ingredients, instructions,
                       prep_time_mins, cook_time_mins, servings, cuisine, tags, nutrition_info, added_via, created_at)
                     VALUES ($1,$2,$3,$4,NULL,$5,$6,$7,$8,$9,$10,$11,$12,$13,'url',NOW())`,
                    [
                      recipeId,
                      householdId,
                      recipeName,
                      url,
                      recipeDescription,
                      JSON.stringify(recipeIngredients),
                      JSON.stringify(recipeInstructions),
                      prepTimeMins,
                      cookTimeMins,
                      servings,
                      cuisine,
                      tags,
                      nutritionInfo,
                    ],
                  );
                  result = { ok: true, recipeId };
                  break;
                }

                case "save_recipe_from_text": {
                  const description = safeString((args as Record<string, unknown>)?.description);
                  if (!description) {
                    result = { ok: false, error: "Missing description." };
                    break;
                  }
                  const system = `You extract recipes from user text.
Return structured recipe JSON for saving. Return JSON only.
Keys:
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
                  const { parsed: recipeJsonUnknown } = await callClaudeJson<unknown>({
                    model: "claude-opus-4-6",
                    system,
                    userText: `Recipe description:\n${description}\n\nExtract the structured recipe now.`,
                    temperature: 0.2,
                    maxTokens: 3800,
                  });
                  const recipeId = crypto.randomUUID();

                  const recipeObj =
                    typeof recipeJsonUnknown === "object" && recipeJsonUnknown !== null
                      ? (recipeJsonUnknown as Record<string, unknown>)
                      : {};
                  const recipeName = typeof recipeObj.name === "string" ? recipeObj.name : "Saved recipe";
                  const recipeDescription = typeof recipeObj.description === "string" ? recipeObj.description : null;
                  const recipeIngredients = Array.isArray(recipeObj.ingredients) ? recipeObj.ingredients : [];
                  const recipeInstructions = Array.isArray(recipeObj.instructions) ? recipeObj.instructions : [];
                  const prepTimeMins = typeof recipeObj.prep_time_mins === "number" ? recipeObj.prep_time_mins : null;
                  const cookTimeMins = typeof recipeObj.cook_time_mins === "number" ? recipeObj.cook_time_mins : null;
                  const servings = typeof recipeObj.servings === "number" ? recipeObj.servings : null;
                  const cuisine = typeof recipeObj.cuisine === "string" ? recipeObj.cuisine : null;
                  const tags = Array.isArray(recipeObj.tags) ? recipeObj.tags.filter((t) => typeof t === "string") : [];
                  const nutritionInfo = recipeObj.nutrition_info ?? null;

                  await client.query(
                    `INSERT INTO public.saved_recipes
                      (id, household_id, name, source_url, image_url, description, ingredients, instructions,
                       prep_time_mins, cook_time_mins, servings, cuisine, tags, nutrition_info, added_via, created_at)
                     VALUES ($1,$2,$3,NULL,NULL,$4,$5,$6,$7,$8,$9,$10,$11,$12,'manual',NOW())`,
                    [
                      recipeId,
                      householdId,
                      recipeName,
                      recipeDescription,
                      JSON.stringify(recipeIngredients),
                      JSON.stringify(recipeInstructions),
                      prepTimeMins,
                      cookTimeMins,
                      servings,
                      cuisine,
                      tags,
                      nutritionInfo,
                    ],
                  );
                  result = { ok: true, recipeId };
                  break;
                }

                case "add_recipe_to_meal_plan": {
                  const mealPlanId = safeString((args as Record<string, unknown>)?.mealPlanId);
                  const slotId = safeString((args as Record<string, unknown>)?.slotId);
                  const recipeId = safeString((args as Record<string, unknown>)?.recipeId);
                  if (!mealPlanId || !slotId || !recipeId) {
                    result = { ok: false, error: "Missing mealPlanId/slotId/recipeId." };
                    break;
                  }
                  const recipeRes = await client.query<{ name: string }>(
                    `SELECT name FROM public.saved_recipes WHERE id=$1 AND household_id=$2`,
                    [recipeId, householdId],
                  );
                  const recipeName = recipeRes.rowCount === 1 ? recipeRes.rows[0].name : null;
                  await client.query(
                    `UPDATE public.meal_plan_slots
                     SET recipe_id=$1, recipe_name=$2
                     WHERE id=$3 AND meal_plan_id=$4`,
                    [recipeId, recipeName, slotId, mealPlanId],
                  );
                  result = { ok: true };
                  break;
                }

                default: {
                  result = { ok: false, error: `Unknown tool: ${tool}` };
                  break;
                }
                }
              } catch (err) {
                const message = err instanceof Error ? err.message : "Tool execution failed.";
                result = { ok: false, error: message };
              }

              toolResults.push({ tool, result });
              sendSse(controller, { type: "tool_call", tool, result });
            }
          });
        }

        const groceryAddResults = toolResults.filter((r) => r.tool === "add_grocery_item");
        let groceryAddsSucceeded = groceryAddResults.filter((r) => isToolResultOk(r.result)).length;
        const groceryItemsFromCards = extractGroceryItemsFromCards(cards);

        if (groceryAddsSucceeded === 0 && groceryItemsFromCards.length > 0) {
          const inserted = await withDbUser(auth.userId, async (client) => {
            const householdId = await getHouseholdId(client, auth.userId);
            let count = 0;
            for (const name of groceryItemsFromCards) {
              await client.query(
                `INSERT INTO public.grocery_list_items
                  (household_id, name, quantity, unit, category, priority, status, added_via)
                 VALUES ($1,$2,NULL,NULL,NULL,'normal','needed','ai')`,
                [householdId, name],
              );
              count += 1;
            }
            return count;
          });
          groceryAddsSucceeded = inserted;
          const fallbackResult = { ok: inserted > 0, inserted, source: "card_fallback" };
          toolResults.push({ tool: "add_grocery_item", result: fallbackResult });
          sendSse(controller, { type: "tool_call", tool: "add_grocery_item", result: fallbackResult });
        }

        if (usedGroceryFallback) {
          if (groceryAddsSucceeded > 0) {
            const itemText =
              groceryFallbackItems.length === 1
                ? groceryFallbackItems[0]
                : `${groceryAddsSucceeded} items`;
            responseText = `Done. I added ${itemText} to your grocery list.`;
          } else {
            responseText = "I couldn't add those grocery items yet. Please try again in a moment.";
          }
        } else if (groceryAddResults.length > 0 && groceryAddsSucceeded === 0) {
          responseText = "I couldn't add that to the grocery list due to a server issue. Please try again.";
        }

        const mealPlanToolResult = toolResults.find(
          (entry) => entry.tool === "generate_meal_plan" || entry.tool === "get_meal_plan",
        );
        const mealPlanPayload =
          mealPlanToolResult && typeof mealPlanToolResult.result === "object" && mealPlanToolResult.result !== null
            ? (mealPlanToolResult.result as Record<string, unknown>)
            : null;
        const mealPlanIdFromTool =
          typeof mealPlanPayload?.mealPlanId === "string"
            ? mealPlanPayload.mealPlanId
            : typeof mealPlanPayload?.mealPlan === "object" &&
                mealPlanPayload.mealPlan !== null &&
                typeof (mealPlanPayload.mealPlan as Record<string, unknown>).id === "string"
              ? ((mealPlanPayload.mealPlan as Record<string, unknown>).id as string)
              : null;

        if (mealPlanIdFromTool) {
          const mealPlanCard = await withDbUser(auth.userId, async (client) => {
            const householdId = await getHouseholdId(client, auth.userId);
            return buildMealPlanCardData(client, householdId, mealPlanIdFromTool);
          });
          if (mealPlanCard) {
            sendSse(controller, { type: "card", card_type: "meal_plan", data: mealPlanCard });
          }
        }

        // Text events after tool calls.
        sendTextChunks(responseText);

        // Persist assistant message + tool results.
        await withDbUser(auth.userId, async (client) => {
          await client.query(
            `INSERT INTO public.ai_messages
              (conversation_id, role, content, tool_calls, tool_results, input_mode)
             VALUES ($1, 'assistant', $2, $3, $4, $5)`,
            [conversationId, responseText, JSON.stringify(toolCalls), JSON.stringify(toolResults), input_mode],
          );
        });

        sendSse(controller, { type: "done", conversation_id: conversationId });

        controller.close();
      } catch (e) {
        console.error("Assistant chat failed", e);
        const msg = humanizeAssistantError(e);
        // Best-effort error SSE.
        try {
          sendSse(controller, { type: "text", content: msg });
          sendSse(controller, { type: "done", conversation_id: conversationId });
        } catch {
          // ignore
        }
        controller.close();
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
