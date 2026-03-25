-- ParentAI v1 Phase 1 (Household Settings + Meals & Nutrition)
-- Supabase-free: implement the same tables/intent using vanilla Postgres + RLS.
--
-- Run with:
--   psql "$DATABASE_URL" -f apps/web/db/001_init.sql
--
-- Note: This migration creates only the schema + RLS policies.
-- Application code is responsible for:
--   - setting auth context via `SET LOCAL app.user_id = <uuid>`
--   - issuing the bearer JWT and passing it in Authorization header.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ----------------------------
-- Helpers: updated_at triggers
-- ----------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------
-- 5.1 users
-- ----------------------------
CREATE TABLE IF NOT EXISTS public.users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT UNIQUE NOT NULL,
  password_hash  TEXT NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_users_updated_at ON public.users;
CREATE TRIGGER trg_users_updated_at
BEFORE UPDATE ON public.users
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------
-- 5.2 profiles
-- ----------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id              UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  display_name    TEXT,
  timezone        TEXT DEFAULT 'Asia/Dubai',
  locale          TEXT DEFAULT 'en',
  onboarded       BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_profiles_updated_at ON public.profiles;
CREATE TRIGGER trg_profiles_updated_at
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------
-- 5.3 households
-- ----------------------------
CREATE TABLE IF NOT EXISTS public.households (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id        UUID REFERENCES public.users(id) NOT NULL,
  name            TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------
-- 5.4 household_members
-- ----------------------------
CREATE TABLE IF NOT EXISTS public.household_members (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id    UUID REFERENCES public.households(id) NOT NULL,
  name            TEXT NOT NULL,
  gender          TEXT CHECK (gender IN ('male', 'female', 'other')),
  date_of_birth   DATE,
  role            TEXT CHECK (role IN ('adult', 'child', 'infant')),
  avatar_url      TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_household_members_updated_at ON public.household_members;
CREATE TRIGGER trg_household_members_updated_at
BEFORE UPDATE ON public.household_members
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------
-- 5.5 member_preferences
-- ----------------------------
CREATE TABLE IF NOT EXISTS public.member_preferences (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id       UUID REFERENCES public.household_members(id) NOT NULL,
  type            TEXT CHECK (type IN ('allergy', 'dislike', 'like', 'diet')),
  value           TEXT NOT NULL,
  severity        TEXT CHECK (severity IN ('critical', 'strong', 'mild')),
  source          TEXT CHECK (source IN ('manual', 'ai_learned', 'imported')),
  ai_confidence   FLOAT,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_member_preferences_updated_at ON public.member_preferences;
CREATE TRIGGER trg_member_preferences_updated_at
BEFORE UPDATE ON public.member_preferences
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------
-- 5.6 inventory_items
-- ----------------------------
CREATE TABLE IF NOT EXISTS public.inventory_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id    UUID REFERENCES public.households(id) NOT NULL,
  name            TEXT NOT NULL,
  category        TEXT,
  quantity        NUMERIC,
  unit            TEXT,
  brand           TEXT,
  barcode         TEXT,
  expiry_date     DATE,
  location        TEXT,
  status          TEXT CHECK (status IN ('in_stock', 'low', 'finished')) DEFAULT 'in_stock',
  added_via       TEXT CHECK (added_via IN ('receipt', 'manual', 'ai_voice', 'ai_text')),
  -- FK is added after `receipts` is created (table order).
  receipt_id      UUID,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_inventory_items_updated_at ON public.inventory_items;
CREATE TRIGGER trg_inventory_items_updated_at
BEFORE UPDATE ON public.inventory_items
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------
-- 5.7 receipts
-- ----------------------------
CREATE TABLE IF NOT EXISTS public.receipts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id    UUID REFERENCES public.households(id) NOT NULL,
  image_url       TEXT NOT NULL,
  store_name      TEXT,
  purchase_date   DATE,
  total_amount    NUMERIC,
  currency        TEXT DEFAULT 'AED',
  ocr_raw         JSONB,
  ocr_parsed      JSONB,
  processing_status TEXT CHECK (
    processing_status IN ('pending', 'processing', 'done', 'failed')
  ) DEFAULT 'pending',
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------
-- 5.8 grocery_list_items
-- ----------------------------
CREATE TABLE IF NOT EXISTS public.grocery_list_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id    UUID REFERENCES public.households(id) NOT NULL,
  name            TEXT NOT NULL,
  quantity        NUMERIC,
  unit            TEXT,
  category        TEXT,
  priority        TEXT CHECK (priority IN ('urgent', 'normal', 'when_available')) DEFAULT 'normal',
  status          TEXT CHECK (status IN ('needed', 'ordered', 'purchased')) DEFAULT 'needed',
  added_via       TEXT CHECK (added_via IN ('manual', 'ai', 'inventory_finished', 'meal_plan', 'recipe')),
  -- FKs are added after `meal_plans` / `saved_recipes` are created (table order).
  meal_plan_id    UUID,
  recipe_id       UUID,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------
-- 5.9 meal_plans
-- ----------------------------
CREATE TABLE IF NOT EXISTS public.meal_plans (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id    UUID REFERENCES public.households(id) NOT NULL,
  week_start      DATE NOT NULL,
  status          TEXT CHECK (status IN ('draft', 'approved', 'active', 'archived')) DEFAULT 'draft',
  weekly_goal     TEXT,
  ai_context      JSONB,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  approved_at     TIMESTAMPTZ
);

-- ----------------------------
-- 5.10 meal_plan_slots
-- ----------------------------
CREATE TABLE IF NOT EXISTS public.meal_plan_slots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meal_plan_id    UUID REFERENCES public.meal_plans(id) NOT NULL,
  day_of_week     INT CHECK (day_of_week BETWEEN 1 AND 7),
  meal_type       TEXT CHECK (meal_type IN ('breakfast', 'lunch', 'dinner', 'snack')),
  -- FK is added after `saved_recipes` is created (table order).
  recipe_id       UUID,
  recipe_name     TEXT,
  serves          INT,
  notes           TEXT,
  approved        BOOLEAN DEFAULT FALSE
);

-- ----------------------------
-- 5.11 saved_recipes
-- ----------------------------
CREATE TABLE IF NOT EXISTS public.saved_recipes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id    UUID REFERENCES public.households(id) NOT NULL,
  name            TEXT NOT NULL,
  source_url      TEXT,
  image_url       TEXT,
  description     TEXT,
  ingredients     JSONB,
  instructions    JSONB,
  prep_time_mins  INT,
  cook_time_mins  INT,
  servings        INT,
  cuisine         TEXT,
  tags            TEXT[],
  nutrition_info  JSONB,
  added_via       TEXT CHECK (added_via IN ('url', 'photo', 'manual', 'ai_suggested')),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------
-- Add foreign keys now that referenced tables exist
-- ----------------------------
ALTER TABLE public.inventory_items
  ADD CONSTRAINT inventory_items_receipt_id_fkey
  FOREIGN KEY (receipt_id) REFERENCES public.receipts(id);

ALTER TABLE public.grocery_list_items
  ADD CONSTRAINT grocery_list_items_meal_plan_id_fkey
  FOREIGN KEY (meal_plan_id) REFERENCES public.meal_plans(id);

ALTER TABLE public.grocery_list_items
  ADD CONSTRAINT grocery_list_items_recipe_id_fkey
  FOREIGN KEY (recipe_id) REFERENCES public.saved_recipes(id);

ALTER TABLE public.meal_plan_slots
  ADD CONSTRAINT meal_plan_slots_recipe_id_fkey
  FOREIGN KEY (recipe_id) REFERENCES public.saved_recipes(id);

-- ----------------------------
-- 5.12 meal_logs
-- ----------------------------
CREATE TABLE IF NOT EXISTS public.meal_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id    UUID REFERENCES public.households(id) NOT NULL,
  member_id       UUID REFERENCES public.household_members(id),
  logged_at       TIMESTAMPTZ DEFAULT NOW(),
  meal_type       TEXT CHECK (meal_type IN ('breakfast', 'lunch', 'dinner', 'snack')),
  recipe_id       UUID REFERENCES public.saved_recipes(id),
  description     TEXT,
  quantity_eaten  TEXT,
  notes           TEXT,
  logged_via      TEXT CHECK (logged_via IN ('manual', 'ai_voice', 'ai_text'))
);

-- ----------------------------
-- 5.13 ai_conversations + ai_messages
-- ----------------------------
CREATE TABLE IF NOT EXISTS public.ai_conversations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id    UUID REFERENCES public.households(id) NOT NULL,
  user_id         UUID REFERENCES public.users(id) NOT NULL,
  started_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_ai_conversations_updated_at ON public.ai_conversations;
CREATE TRIGGER trg_ai_conversations_updated_at
BEFORE UPDATE ON public.ai_conversations
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.ai_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES public.ai_conversations(id) NOT NULL,
  role            TEXT CHECK (role IN ('user', 'assistant', 'system', 'tool')),
  content         TEXT,
  tool_calls      JSONB,
  tool_results    JSONB,
  input_mode      TEXT CHECK (input_mode IN ('text', 'voice')),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------
-- 5.14 weekly_goals
-- ----------------------------
CREATE TABLE IF NOT EXISTS public.weekly_goals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id    UUID REFERENCES public.households(id) NOT NULL,
  week_start      DATE NOT NULL,
  goal_text       TEXT NOT NULL,
  goal_type       TEXT CHECK (goal_type IN ('health', 'budget', 'variety', 'dietary', 'custom')),
  active          BOOLEAN DEFAULT TRUE,
  set_via         TEXT CHECK (set_via IN ('ai', 'manual')),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------
-- RLS: enforce household isolation via owner_id -> users
-- We rely on `SET LOCAL app.user_id = <uuid>` done per request.
-- ----------------------------

-- users / profiles
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS users_isolation ON public.users;
CREATE POLICY users_isolation
ON public.users
FOR ALL
USING (id = current_setting('app.user_id', true)::uuid)
WITH CHECK (id = current_setting('app.user_id', true)::uuid);

-- Used during login to look up a user by email before we know the user_id in-session.
-- Application must set: SET LOCAL app.user_email = '<email>'
DROP POLICY IF EXISTS users_login_lookup ON public.users;
CREATE POLICY users_login_lookup
ON public.users
FOR SELECT
USING (email = current_setting('app.user_email', true)::text);

DROP POLICY IF EXISTS profiles_isolation ON public.profiles;
CREATE POLICY profiles_isolation
ON public.profiles
FOR ALL
USING (id = current_setting('app.user_id', true)::uuid)
WITH CHECK (id = current_setting('app.user_id', true)::uuid);

-- households
ALTER TABLE public.households ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS households_owner_isolation ON public.households;
CREATE POLICY households_owner_isolation
ON public.households
FOR ALL
USING (owner_id = current_setting('app.user_id', true)::uuid)
WITH CHECK (owner_id = current_setting('app.user_id', true)::uuid);

-- household_members
ALTER TABLE public.household_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_members_isolation ON public.household_members;
CREATE POLICY household_members_isolation
ON public.household_members
FOR ALL
USING (
  EXISTS (
    SELECT 1
    FROM public.households h
    WHERE h.id = household_members.household_id
      AND h.owner_id = current_setting('app.user_id', true)::uuid
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.households h
    WHERE h.id = household_members.household_id
      AND h.owner_id = current_setting('app.user_id', true)::uuid
  )
);

-- member_preferences
ALTER TABLE public.member_preferences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS member_preferences_isolation ON public.member_preferences;
CREATE POLICY member_preferences_isolation
ON public.member_preferences
FOR ALL
USING (
  EXISTS (
    SELECT 1
    FROM public.household_members hm
    JOIN public.households h ON h.id = hm.household_id
    WHERE hm.id = member_preferences.member_id
      AND h.owner_id = current_setting('app.user_id', true)::uuid
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.household_members hm
    JOIN public.households h ON h.id = hm.household_id
    WHERE hm.id = member_preferences.member_id
      AND h.owner_id = current_setting('app.user_id', true)::uuid
  )
);

-- inventory_items
ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS inventory_items_isolation ON public.inventory_items;
CREATE POLICY inventory_items_isolation
ON public.inventory_items
FOR ALL
USING (
  EXISTS (
    SELECT 1
    FROM public.households h
    WHERE h.id = inventory_items.household_id
      AND h.owner_id = current_setting('app.user_id', true)::uuid
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.households h
    WHERE h.id = inventory_items.household_id
      AND h.owner_id = current_setting('app.user_id', true)::uuid
  )
);

-- receipts
ALTER TABLE public.receipts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS receipts_isolation ON public.receipts;
CREATE POLICY receipts_isolation
ON public.receipts
FOR ALL
USING (
  EXISTS (
    SELECT 1
    FROM public.households h
    WHERE h.id = receipts.household_id
      AND h.owner_id = current_setting('app.user_id', true)::uuid
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.households h
    WHERE h.id = receipts.household_id
      AND h.owner_id = current_setting('app.user_id', true)::uuid
  )
);

-- grocery_list_items
ALTER TABLE public.grocery_list_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS grocery_list_items_isolation ON public.grocery_list_items;
CREATE POLICY grocery_list_items_isolation
ON public.grocery_list_items
FOR ALL
USING (
  EXISTS (
    SELECT 1
    FROM public.households h
    WHERE h.id = grocery_list_items.household_id
      AND h.owner_id = current_setting('app.user_id', true)::uuid
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.households h
    WHERE h.id = grocery_list_items.household_id
      AND h.owner_id = current_setting('app.user_id', true)::uuid
  )
);

-- meal_plans
ALTER TABLE public.meal_plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS meal_plans_isolation ON public.meal_plans;
CREATE POLICY meal_plans_isolation
ON public.meal_plans
FOR ALL
USING (
  EXISTS (
    SELECT 1
    FROM public.households h
    WHERE h.id = meal_plans.household_id
      AND h.owner_id = current_setting('app.user_id', true)::uuid
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.households h
    WHERE h.id = meal_plans.household_id
      AND h.owner_id = current_setting('app.user_id', true)::uuid
  )
);

-- meal_plan_slots (via meal_plans)
ALTER TABLE public.meal_plan_slots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS meal_plan_slots_isolation ON public.meal_plan_slots;
CREATE POLICY meal_plan_slots_isolation
ON public.meal_plan_slots
FOR ALL
USING (
  EXISTS (
    SELECT 1
    FROM public.meal_plans mp
    JOIN public.households h ON h.id = mp.household_id
    WHERE mp.id = meal_plan_slots.meal_plan_id
      AND h.owner_id = current_setting('app.user_id', true)::uuid
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.meal_plans mp
    JOIN public.households h ON h.id = mp.household_id
    WHERE mp.id = meal_plan_slots.meal_plan_id
      AND h.owner_id = current_setting('app.user_id', true)::uuid
  )
);

-- saved_recipes
ALTER TABLE public.saved_recipes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS saved_recipes_isolation ON public.saved_recipes;
CREATE POLICY saved_recipes_isolation
ON public.saved_recipes
FOR ALL
USING (
  EXISTS (
    SELECT 1
    FROM public.households h
    WHERE h.id = saved_recipes.household_id
      AND h.owner_id = current_setting('app.user_id', true)::uuid
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.households h
    WHERE h.id = saved_recipes.household_id
      AND h.owner_id = current_setting('app.user_id', true)::uuid
  )
);

-- meal_logs
ALTER TABLE public.meal_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS meal_logs_isolation ON public.meal_logs;
CREATE POLICY meal_logs_isolation
ON public.meal_logs
FOR ALL
USING (
  EXISTS (
    SELECT 1
    FROM public.households h
    WHERE h.id = meal_logs.household_id
      AND h.owner_id = current_setting('app.user_id', true)::uuid
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.households h
    WHERE h.id = meal_logs.household_id
      AND h.owner_id = current_setting('app.user_id', true)::uuid
  )
);

-- ai_conversations
ALTER TABLE public.ai_conversations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_conversations_isolation ON public.ai_conversations;
CREATE POLICY ai_conversations_isolation
ON public.ai_conversations
FOR ALL
USING (
  user_id = current_setting('app.user_id', true)::uuid
)
WITH CHECK (
  user_id = current_setting('app.user_id', true)::uuid
);

-- ai_messages (via conversation -> ai_conversations -> user_id)
ALTER TABLE public.ai_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_messages_isolation ON public.ai_messages;
CREATE POLICY ai_messages_isolation
ON public.ai_messages
FOR ALL
USING (
  EXISTS (
    SELECT 1
    FROM public.ai_conversations ac
    WHERE ac.id = ai_messages.conversation_id
      AND ac.user_id = current_setting('app.user_id', true)::uuid
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.ai_conversations ac
    WHERE ac.id = ai_messages.conversation_id
      AND ac.user_id = current_setting('app.user_id', true)::uuid
  )
);

-- weekly_goals
ALTER TABLE public.weekly_goals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS weekly_goals_isolation ON public.weekly_goals;
CREATE POLICY weekly_goals_isolation
ON public.weekly_goals
FOR ALL
USING (
  EXISTS (
    SELECT 1
    FROM public.households h
    WHERE h.id = weekly_goals.household_id
      AND h.owner_id = current_setting('app.user_id', true)::uuid
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.households h
    WHERE h.id = weekly_goals.household_id
      AND h.owner_id = current_setting('app.user_id', true)::uuid
  )
);

-- Optional: tighten by forcing RLS.
ALTER TABLE public.users FORCE ROW LEVEL SECURITY;
ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.households FORCE ROW LEVEL SECURITY;
ALTER TABLE public.household_members FORCE ROW LEVEL SECURITY;
ALTER TABLE public.member_preferences FORCE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_items FORCE ROW LEVEL SECURITY;
ALTER TABLE public.receipts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.grocery_list_items FORCE ROW LEVEL SECURITY;
ALTER TABLE public.meal_plans FORCE ROW LEVEL SECURITY;
ALTER TABLE public.meal_plan_slots FORCE ROW LEVEL SECURITY;
ALTER TABLE public.saved_recipes FORCE ROW LEVEL SECURITY;
ALTER TABLE public.meal_logs FORCE ROW LEVEL SECURITY;
ALTER TABLE public.ai_conversations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.ai_messages FORCE ROW LEVEL SECURITY;
ALTER TABLE public.weekly_goals FORCE ROW LEVEL SECURITY;

COMMIT;

