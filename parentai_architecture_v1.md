# ParentAI — Architecture Document
### Version 1.0 | Phase 1: Household Settings + Meals & Nutrition

---

## Table of Contents

1. [Product Vision](#1-product-vision)
2. [Phase 1 Scope](#2-phase-1-scope)
3. [Tech Stack](#3-tech-stack)
4. [System Architecture Overview](#4-system-architecture-overview)
5. [Data Models](#5-data-models)
6. [Feature Specifications](#6-feature-specifications)
   - 6.1 [Authentication & Onboarding](#61-authentication--onboarding)
   - 6.2 [AI Assistant — Home Screen](#62-ai-assistant--home-screen)
   - 6.3 [Settings — Household Management](#63-settings--household-management)
   - 6.4 [Meals & Nutrition — House Inventory](#64-meals--nutrition--house-inventory)
   - 6.5 [Meals & Nutrition — Meal Planning](#65-meals--nutrition--meal-planning)
   - 6.6 [Meals & Nutrition — Grocery List](#66-meals--nutrition--grocery-list)
   - 6.7 [Meals & Nutrition — Meal Logging](#67-meals--nutrition--meal-logging)
   - 6.8 [Meals & Nutrition — Saved Recipes](#68-meals--nutrition--saved-recipes)
7. [AI Agent Architecture](#7-ai-agent-architecture)
8. [Voice Interface](#8-voice-interface)
9. [Receipt & Image Processing](#9-receipt--image-processing)
10. [Preference Learning System](#10-preference-learning-system)
11. [API Design](#11-api-design)
12. [Platform Strategy — Web + Mobile](#12-platform-strategy--web--mobile)
13. [File & Storage Architecture](#13-file--storage-architecture)
14. [Security & Privacy](#14-security--privacy)
---

## 1. Product Vision

ParentAI is a personal AI assistant for parents. The first version focuses on the household's food life — knowing who lives in the house, what food they have, what they like, and handling the cognitive load of meal planning, grocery management, and nutrition tracking.

The AI assistant is the primary interface. Every feature in the app is something the assistant can also do via natural conversation. The UI is a backup and an overview; the chat is how things get done.

---

## 2. Phase 1 Scope

Phase 1 covers two modules:

| Module | Features |
|---|---|
| **Settings — Household** | Add/edit/delete household members · name, gender, age, food preferences, allergies |
| **Meals & Nutrition** | House inventory · grocery receipt upload · voice/text inventory updates · meal plan generation · grocery list · meal logging · saved recipes · weekly goals |

Everything else (health tracking, scheduling, communications, sleep, etc.) is deferred to later phases. The goal of Phase 1 is to get the meals and nutrition flow perfect before expanding.

---

## 3. Tech Stack

### Frontend
| Layer | Technology | Reason |
|---|---|---|
| Web app | **Next.js 14** (App Router) | SSR, file-based routing, API routes, excellent for PWA |
| Mobile app | **React Native (Expo)** | Shared logic with web, fast iteration, OTA updates |
| Shared UI components | **NativeWind + Tailwind CSS** | One design system across web and mobile |
| State management | **Zustand** | Lightweight, works across web and native |
| Forms | **React Hook Form + Zod** | Type-safe validation, minimal boilerplate |

### Backend
| Layer | Technology | Reason |
|---|---|---|
| API | **Next.js API Routes** (web) + **Express** (dedicated backend) | Start monolithic, split later |
| Database | **PostgreSQL (Supabase)** | Relational, RLS for multi-user security, realtime subscriptions |
| Auth | **Supabase Auth** | Email/password + social login, JWT, built-in RLS |
| File storage | **Supabase Storage** | Receipt images, recipe photos, profile pictures |
| AI / LLM | **Anthropic Claude API** (claude-sonnet-4-6 for routing, claude-opus-4-6 for complex reasoning) | Core intelligence layer |
| Voice input | **OpenAI Whisper API** | Best-in-class speech-to-text, multilingual |
| Voice output (optional) | **ElevenLabs** or **Web Speech API** | Text-to-speech for assistant responses |
| Receipt OCR | **Google Cloud Vision API** or **AWS Textract** | Structured extraction from grocery receipts |
| Image parsing | **Claude Vision (claude-sonnet-4-6)** | Recipe images, food photo identification |
| Background jobs | **Inngest** or **Supabase Edge Functions** | Async processing (OCR, meal plan generation) |
| Push notifications | **Expo Push Notifications** (mobile) + **Web Push API** | Reminders, grocery alerts |

### Infrastructure
| Layer | Technology |
|---|---|
| Hosting | **Vercel** (web) + **Expo EAS** (mobile builds) |
| Database hosting | **Supabase** (managed Postgres) |
| CDN / media | **Supabase Storage** + Cloudflare |
| Monitoring | **Sentry** (errors) + **PostHog** (analytics) |
| Secrets | **Vercel Environment Variables** / **Doppler** |

---

## 4. System Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        CLIENT LAYER                          │
│                                                              │
│   ┌─────────────────┐          ┌─────────────────────────┐  │
│   │   Next.js Web   │          │   React Native (Expo)   │  │
│   │   (PWA-ready)   │          │   iOS + Android         │  │
│   └────────┬────────┘          └───────────┬─────────────┘  │
│            │  HTTPS / WebSocket            │                 │
└────────────┼──────────────────────────────-┼─────────────────┘
             │                               │
┌────────────▼───────────────────────────────▼─────────────────┐
│                       API LAYER (Next.js / Express)           │
│                                                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │  Auth routes │  │  Data routes │  │  AI Agent routes │   │
│  │  /api/auth   │  │  /api/...    │  │  /api/assistant  │   │
│  └──────┬───────┘  └──────┬───────┘  └────────┬─────────┘   │
│         │                 │                    │              │
└─────────┼─────────────────┼────────────────────┼─────────────┘
          │                 │                    │
┌─────────▼─────────────────▼────────────────────▼─────────────┐
│                     SERVICE LAYER                              │
│                                                               │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐    │
│  │  Supabase   │  │  File Store  │  │   AI Orchestr.   │    │
│  │  Postgres   │  │  (Storage)   │  │   (Claude API)   │    │
│  └─────────────┘  └──────────────┘  └──────────────────┘    │
│                                                               │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐    │
│  │   Whisper   │  │  OCR Engine  │  │  Background jobs │    │
│  │  (voice→text│  │  (receipts)  │  │  (Inngest)       │    │
│  └─────────────┘  └──────────────┘  └──────────────────┘    │
└───────────────────────────────────────────────────────────────┘
```

---

## 5. Data Models

### 5.1 `users`
```sql
users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT UNIQUE NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
)
```
Managed by Supabase Auth. Extended via `profiles`.

---

### 5.2 `profiles`
```sql
profiles (
  id              UUID PRIMARY KEY REFERENCES users(id),
  display_name    TEXT,
  timezone        TEXT DEFAULT 'Asia/Dubai',
  locale          TEXT DEFAULT 'en',
  onboarded       BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
)
```

---

### 5.3 `households`
```sql
households (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id        UUID REFERENCES users(id) NOT NULL,
  name            TEXT,                          -- e.g. "The Al-Rashidi Family"
  created_at      TIMESTAMPTZ DEFAULT NOW()
)
```
One user owns one household in Phase 1. Future: shared households (co-parents).

---

### 5.4 `household_members`
```sql
household_members (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id    UUID REFERENCES households(id) NOT NULL,
  name            TEXT NOT NULL,
  gender          TEXT CHECK (gender IN ('male', 'female', 'other')),
  date_of_birth   DATE,                          -- derive age dynamically
  role            TEXT CHECK (role IN ('adult', 'child', 'infant')),
  avatar_url      TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
)
```
Age is never stored — always computed from `date_of_birth`. This means meal plan logic automatically adjusts as children grow up without requiring manual updates.

---

### 5.5 `member_preferences`
Stores food preferences and allergies per member. One row per preference item for easy CRUD.

```sql
member_preferences (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id       UUID REFERENCES household_members(id) NOT NULL,
  type            TEXT CHECK (type IN ('allergy', 'dislike', 'like', 'diet')),
  -- type examples:
  --   allergy: 'peanuts', 'dairy', 'gluten'
  --   dislike: 'broccoli', 'mushrooms'
  --   like:    'pasta', 'chicken'
  --   diet:    'vegetarian', 'halal', 'low-sugar'
  value           TEXT NOT NULL,                 -- e.g. 'broccoli'
  severity        TEXT CHECK (severity IN ('critical', 'strong', 'mild')),
  -- severity only meaningful for allergy + dislike
  -- critical = anaphylaxis risk (never include)
  -- strong   = will refuse to eat
  -- mild     = prefer to avoid
  source          TEXT CHECK (source IN ('manual', 'ai_learned', 'imported')),
  -- source = 'ai_learned' when the assistant detected this from conversation
  ai_confidence   FLOAT,                         -- 0.0–1.0 if source = ai_learned
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
)
```

---

### 5.6 `inventory_items`
```sql
inventory_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id    UUID REFERENCES households(id) NOT NULL,
  name            TEXT NOT NULL,
  category        TEXT,                          -- 'dairy', 'produce', 'pantry', etc.
  quantity        NUMERIC,
  unit            TEXT,                          -- 'litres', 'kg', 'units', 'g'
  brand           TEXT,
  barcode         TEXT,
  expiry_date     DATE,
  location        TEXT,                          -- 'fridge', 'freezer', 'pantry'
  status          TEXT CHECK (status IN ('in_stock', 'low', 'finished'))
                  DEFAULT 'in_stock',
  added_via       TEXT CHECK (added_via IN ('receipt', 'manual', 'ai_voice', 'ai_text')),
  receipt_id      UUID REFERENCES receipts(id),  -- null if not from receipt
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
)
```

---

### 5.7 `receipts`
```sql
receipts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id    UUID REFERENCES households(id) NOT NULL,
  image_url       TEXT NOT NULL,                 -- stored in Supabase Storage
  store_name      TEXT,
  purchase_date   DATE,
  total_amount    NUMERIC,
  currency        TEXT DEFAULT 'AED',
  ocr_raw         JSONB,                         -- raw OCR output
  ocr_parsed      JSONB,                         -- structured line items
  processing_status TEXT CHECK (
    processing_status IN ('pending', 'processing', 'done', 'failed')
  ) DEFAULT 'pending',
  created_at      TIMESTAMPTZ DEFAULT NOW()
)
```

---

### 5.8 `grocery_list_items`
```sql
grocery_list_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id    UUID REFERENCES households(id) NOT NULL,
  name            TEXT NOT NULL,
  quantity        NUMERIC,
  unit            TEXT,
  category        TEXT,
  priority        TEXT CHECK (priority IN ('urgent', 'normal', 'when_available'))
                  DEFAULT 'normal',
  status          TEXT CHECK (status IN ('needed', 'ordered', 'purchased'))
                  DEFAULT 'needed',
  added_via       TEXT CHECK (added_via IN ('manual', 'ai', 'inventory_finished',
                              'meal_plan', 'recipe')),
  meal_plan_id    UUID REFERENCES meal_plans(id),
  recipe_id       UUID REFERENCES saved_recipes(id),
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
)
```

---

### 5.9 `meal_plans`
```sql
meal_plans (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id    UUID REFERENCES households(id) NOT NULL,
  week_start      DATE NOT NULL,                 -- Monday of the week
  status          TEXT CHECK (status IN ('draft', 'approved', 'active', 'archived'))
                  DEFAULT 'draft',
  weekly_goal     TEXT,                          -- e.g. 'healthy', 'budget', 'quick'
  ai_context      JSONB,                         -- snapshot of household state at generation
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  approved_at     TIMESTAMPTZ
)
```

---

### 5.10 `meal_plan_slots`
```sql
meal_plan_slots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meal_plan_id    UUID REFERENCES meal_plans(id) NOT NULL,
  day_of_week     INT CHECK (day_of_week BETWEEN 1 AND 7),  -- 1=Mon
  meal_type       TEXT CHECK (meal_type IN ('breakfast', 'lunch', 'dinner', 'snack')),
  recipe_id       UUID REFERENCES saved_recipes(id),
  recipe_name     TEXT,                          -- denormalised for speed
  serves          INT,
  notes           TEXT,
  approved        BOOLEAN DEFAULT FALSE
)
```

---

### 5.11 `saved_recipes`
```sql
saved_recipes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id    UUID REFERENCES households(id) NOT NULL,
  name            TEXT NOT NULL,
  source_url      TEXT,                          -- link to external recipe
  image_url       TEXT,                          -- uploaded photo or scraped image
  description     TEXT,
  ingredients     JSONB,                         -- [{name, quantity, unit}]
  instructions    JSONB,                         -- [{step, text}]
  prep_time_mins  INT,
  cook_time_mins  INT,
  servings        INT,
  cuisine         TEXT,
  tags            TEXT[],                        -- ['healthy', 'kid-friendly', 'quick']
  nutrition_info  JSONB,                         -- per serving: {calories, protein, ...}
  added_via       TEXT CHECK (added_via IN ('url', 'photo', 'manual', 'ai_suggested')),
  created_at      TIMESTAMPTZ DEFAULT NOW()
)
```

---

### 5.12 `meal_logs`
```sql
meal_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id    UUID REFERENCES households(id) NOT NULL,
  member_id       UUID REFERENCES household_members(id),
  -- null = logged for whole household
  logged_at       TIMESTAMPTZ DEFAULT NOW(),
  meal_type       TEXT CHECK (meal_type IN ('breakfast', 'lunch', 'dinner', 'snack')),
  recipe_id       UUID REFERENCES saved_recipes(id),
  description     TEXT,                          -- free text if no recipe
  quantity_eaten  TEXT,                          -- 'full portion', 'half', 'small amount'
  notes           TEXT,                          -- e.g. 'refused broccoli'
  logged_via      TEXT CHECK (logged_via IN ('manual', 'ai_voice', 'ai_text'))
)
```

---

### 5.13 `ai_conversations`
Full conversation history per session, used to provide the assistant with memory context.

```sql
ai_conversations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id    UUID REFERENCES households(id) NOT NULL,
  user_id         UUID REFERENCES users(id) NOT NULL,
  started_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
)

ai_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES ai_conversations(id) NOT NULL,
  role            TEXT CHECK (role IN ('user', 'assistant', 'system', 'tool')),
  content         TEXT,
  tool_calls      JSONB,                         -- if role = 'assistant' with tool use
  tool_results    JSONB,                         -- if role = 'tool'
  input_mode      TEXT CHECK (input_mode IN ('text', 'voice')),
  created_at      TIMESTAMPTZ DEFAULT NOW()
)
```

---

### 5.14 `weekly_goals`
```sql
weekly_goals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id    UUID REFERENCES households(id) NOT NULL,
  week_start      DATE NOT NULL,
  goal_text       TEXT NOT NULL,                 -- e.g. 'eating healthy this week'
  goal_type       TEXT CHECK (goal_type IN ('health', 'budget', 'variety',
                              'dietary', 'custom')),
  active          BOOLEAN DEFAULT TRUE,
  set_via         TEXT CHECK (set_via IN ('ai', 'manual')),
  created_at      TIMESTAMPTZ DEFAULT NOW()
)
```

---

## 6. Feature Specifications

### 6.1 Authentication & Onboarding

**Flow:**
1. User lands on `/` → redirected to `/login` if no session
2. Login options: email + password, Google OAuth, Apple Sign-In (mobile)
3. On first login → onboarding flow:
   - Step 1: "Tell us about your household" → creates `household` + first `household_member` (the user)
   - Step 2: "Add your children / other members" → optional, can skip and do in Settings
   - Step 3: "Any allergies we should know about?" → quick allergy capture
4. After onboarding → lands on AI assistant home screen

**Technical notes:**
- Supabase Auth handles JWTs and session refresh
- Row Level Security (RLS) on all tables: `household_id = auth.uid()` or via household membership
- `onboarded` flag on `profiles` controls whether onboarding shows

---

### 6.2 AI Assistant — Home Screen

The default screen after login. A full-screen conversational interface.

**"What's happening today" response (Phase 1):**
When the user opens the app and asks "what's happening today", the assistant:
- Checks for any inventory items marked `low` or `finished` → surfaces them
- Checks if there is an active meal plan for the current week → shows today's meals
- Checks if any meal plan slots for today haven't been confirmed → prompts
- Checks grocery list for `urgent` items
- Checks if weekly goal is set → mentions it
- Asks if they want to generate a meal plan if none exists for the week

Example response:
> "Good morning! You're out of milk and low on eggs — I've already added them to your grocery list. Tonight's dinner is salmon with rice from your meal plan. One thing: you said this week you're trying to eat healthy, so I've kept it light. Do you need anything else for today?"

**UI components:**
- Full-screen chat view (messages scroll up, input fixed at bottom)
- Input bar: text field + voice button (mic icon) + send button
- Typing indicator when assistant is processing
- Structured response cards for: meal plans, inventory alerts, grocery lists (tappable, not just text)
- "Quick actions" row below input: "Today's meals", "Grocery list", "Add to inventory"

---

### 6.3 Settings — Household Management

**Route:** `/settings/household` (web) | `Settings > Household` (mobile)

**UI:**

```
Household Members
─────────────────
[+ Add member]

┌─────────────────────────┐
│ 👤 Aliya (You)          │
│ Adult · Female          │
│ Allergies: none         │
│ Diet: halal             │
│              [Edit] [·] │
└─────────────────────────┘

┌─────────────────────────┐
│ 👦 Yusuf                │
│ Child · Male · 18 months│
│ Allergies: none         │
│ Dislikes: —             │
│              [Edit] [·] │
└─────────────────────────┘
```

**Add/Edit Member Form fields:**
- Name (text)
- Gender (select: Male / Female / Other)
- Date of birth (date picker) — age shown as computed label
- Role (auto-derived from age: infant <1yr, child 1–17, adult 18+)
- Food preferences section:
  - Allergies (multi-tag input, severity selector: critical / strong / mild)
  - Dislikes (multi-tag input)
  - Likes / favourite foods (multi-tag)
  - Dietary requirements (multi-select: halal, vegetarian, vegan, gluten-free, dairy-free, low-sugar, low-sodium)

**AI-driven preference updates:**

When the assistant detects a new preference in conversation (e.g. "Yusuf hates broccoli"), it:
1. Extracts: member = Yusuf, type = dislike, value = broccoli, severity = strong, source = ai_learned, confidence = 0.9
2. Writes to `member_preferences` immediately
3. Surfaces a confirmation card: "I've noted that Yusuf dislikes broccoli. You can change this in Settings anytime."

The confirmation card prevents silent drift — the user always knows what the AI has learned.

**Deleting / editing preferences:**
- In the Settings UI, each tag has a delete (×) button
- User can also tell the assistant: "Actually Yusuf likes broccoli now" → updates `severity` or deletes the row

---

### 6.4 Meals & Nutrition — House Inventory

**Route:** `/meals/inventory`

**Three ways to add items:**

#### A — Upload grocery receipt
1. User taps "Upload receipt" (camera capture or file picker)
2. Image uploaded to Supabase Storage at `receipts/{household_id}/{uuid}.jpg`
3. Background job triggered (Inngest):
   - OCR via Google Vision or AWS Textract → raw text
   - Claude (claude-sonnet-4-6) parses OCR text into structured items:
     ```json
     [
       { "name": "Pampers Size 4", "quantity": 1, "unit": "pack", "category": "baby" },
       { "name": "Whole milk", "quantity": 2, "unit": "litres", "category": "dairy" }
     ]
     ```
   - Inserts into `inventory_items` with `added_via = 'receipt'`, `receipt_id`
4. User receives notification: "Receipt processed — 14 items added to your inventory"
5. User can review and correct items on the receipt detail screen

**Receipt parsing prompt (system instruction to Claude):**
```
You are parsing a grocery receipt OCR result into structured inventory items.
Extract each line item. For each item return:
- name: clean product name (remove size/weight from name, put in unit field)
- quantity: numeric amount purchased
- unit: litres, kg, g, units, pack, bottle, can, box
- category: one of: dairy, produce, meat, bakery, pantry, frozen, baby, cleaning, personal_care, other
- brand: if identifiable
Return a JSON array only. No explanation.
```

#### B — Tell the assistant (text or voice)
Natural language inventory updates:
- "Add 2 litres of milk and a bag of rice to the inventory" → inserts items
- "We're out of peanut butter" → sets `status = 'finished'`, adds to grocery list
- "I just bought eggs" → adds eggs to inventory
- "We have apples, bananas, Greek yoghurt, and some leftover pasta" → bulk add

The assistant confirms: "Done — I've added those 4 items to your pantry."

#### C — Manual entry via UI
Simple form: name, quantity, unit, category, location, expiry date (optional).

**Inventory UI:**

```
House Inventory                    [+ Add] [Upload receipt]

Filter: All | Fridge | Freezer | Pantry    Search...

─── DAIRY ───────────────────────────────────────────────
Whole milk              2 litres    Fridge     [✓] [–] [×]
Greek yoghurt           1 tub       Fridge     [✓] [–] [×]
Eggs                    6 units     Fridge  ⚠ Low [✓] [–] [×]

─── PANTRY ──────────────────────────────────────────────
Rice                    1 kg        Pantry     [✓] [–] [×]
Olive oil               1 bottle    Pantry     [✓] [–] [×]

─── BABY ────────────────────────────────────────────────
Pampers Size 4          1 pack      Bathroom ⚠ Low [✓] [–] [×]
```

[✓] = mark as finished → removes from inventory, adds to grocery list
[–] = reduce quantity
[×] = delete entirely

**Low stock logic:**
- Items with `quantity < threshold` are flagged `status = 'low'`
- Thresholds are configurable (defaults: milk < 0.5L, eggs < 4, etc.)
- The assistant surfaces low-stock items in the daily briefing

---

### 6.5 Meals & Nutrition — Meal Planning

**Route:** `/meals/plan`

**Generating a meal plan:**

User initiates via assistant:
> "Can you plan meals for this week?"
> "Plan next week — I'm trying to eat healthy and the kids need simple dinners"

The AI meal planner agent:

1. **Reads context** (via tool calls):
   - All `household_members` with ages and roles
   - All `member_preferences` (allergies, dislikes, dietary requirements)
   - Current `inventory_items` (to use what's already in stock)
   - Active `weekly_goals`
   - Last 2 weeks of `meal_logs` (avoid repeating recent meals)
   - Any `saved_recipes` (prefer these if matching)

2. **Generates a structured meal plan** covering:
   - Breakfast, lunch, dinner, snack for each day Mon–Sun
   - Age-appropriate meals: infant-safe for babies, softer textures for toddlers
   - Allergy filtering: hard block on `severity = critical`, soft avoidance on others
   - Preference weighting: preferred items appear more often
   - Uses in-stock ingredients preferentially to reduce waste

3. **Returns a draft meal plan** as a structured card, not just text:

```
Week of 25 March ─────────────────────────────

MONDAY
  Breakfast  Overnight oats with banana         🟢 In stock
  Lunch      Chicken and rice soup              🟢 In stock
  Dinner     Baked salmon with roasted veg      🛒 Need: ginger
  Snack      Apple slices with peanut butter    ⚠ Yusuf: peanut allergy — replaced with hummus

[Approve plan] [Regenerate] [Edit day by day]
```

4. **Allergy & preference annotations** shown inline — parent can see exactly why a substitution was made.

5. **On approval** → `meal_plan.status` set to `approved` → grocery list auto-generated (see 6.6)

**Editing the plan:**
- Tap any meal slot → "Replace this meal", "Remove", "Use a saved recipe"
- Tell the assistant: "Change Tuesday dinner to pasta" → updates that slot
- "Yusuf won't eat broccoli — fix Monday lunch" → regenerates that slot, saves preference

**Recipe substitution via assistant:**
> "I'm making salmon tonight from my saved recipes but I don't have ginger — what's a good replacement?"

The assistant:
1. Finds the salmon recipe in `saved_recipes`
2. Checks `inventory_items` for ginger → confirms it's not there
3. Responds: "Ginger in salmon can be replaced with a small amount of turmeric and lemon zest, or just lemon and garlic — both work well. Want me to update the recipe?"
4. If yes → writes a note to the `meal_plan_slots` record or `saved_recipes` ingredients

---

### 6.6 Meals & Nutrition — Grocery List

**Route:** `/meals/grocery`

**Automatic population:**
Items are added to the grocery list via:
- Meal plan approval (missing ingredients from approved recipes)
- Inventory item marked as `finished`
- Inventory item flagged `low`
- Assistant instruction: "Add olive oil to the grocery list"
- User removes from inventory: "We're out of milk"

**Removing from grocery list via assistant:**
> "Remove peanut butter from the grocery list — I already have it at home"

The assistant:
1. Removes from `grocery_list_items`
2. Adds peanut butter to `inventory_items` (if not already there) with `added_via = 'ai_text'`
3. Confirms: "Done — removed peanut butter from the list and added it to your inventory."

**Grocery list UI:**

```
Grocery List                               [Share] [Order via elGrocer ↗]

🔴 URGENT
  Nappies (Pampers Size 4)                 1 pack
  Calpol Infant (6+ months)               1 bottle

🛒 THIS WEEK (from meal plan)
  Salmon fillet                            400g
  Ginger                                   1 piece
  Cherry tomatoes                          1 punnet
  Greek yoghurt (plain)                    500g

📦 WHEN YOU CAN
  Rice (basmati)                           2 kg

[+ Add item]                              [Clear purchased]
```

Each item: swipe to mark purchased → moves to purchased state, updates inventory accordingly.

**elGrocer / delivery integration (Phase 1 — deep link):**
"Order via elGrocer ↗" button generates a deep link to elGrocer pre-populated with the grocery list items. This is the Phase 1 integration — no API, no checkout inside the app. The parent is taken to elGrocer to complete the order.

---

### 6.7 Meals & Nutrition — Meal Logging

**Route:** `/meals/log`

**Logging via assistant (primary):**
> "We had the salmon for dinner"
> "Yusuf only ate half his lunch and refused the broccoli"
> "Breakfast was oats for everyone"

The assistant:
1. Creates a `meal_log` entry, linked to the meal plan slot if applicable
2. If a preference signal is detected (e.g. "refused broccoli") → triggers preference learning (see Section 10)
3. Marks the meal plan slot as completed

**Logging via UI (secondary):**
- Meals tab shows today's slots from the meal plan
- Tap slot → "Log this meal" → choose who ate, how much, add notes
- "Add unlisted meal" for anything outside the plan

**Nutrition overview:**
- Phase 1: simple summary — meals logged per day, any missed meals
- Phase 2: calorie / macro breakdown (requires nutrition database integration)

---

### 6.8 Meals & Nutrition — Saved Recipes

**Route:** `/meals/recipes`

**Adding a recipe — three methods:**

#### A — Paste a URL
1. User pastes a recipe link (e.g. from BBC Good Food, AllRecipes, etc.)
2. Backend fetches the page, Claude extracts structured recipe data:
   - Name, ingredients (name + quantity + unit), instructions, prep/cook time, servings, tags
3. Saved to `saved_recipes`, thumbnail image scraped if available
4. Assistant confirms: "Saved! One-pan salmon with couscous — 30 minutes, serves 4."

#### B — Upload a photo
1. User uploads a photo of a recipe (book page, screenshot, handwritten card)
2. Claude Vision extracts text and structured data from the image
3. Saved as above

#### C — Tell the assistant
> "Save a recipe: pasta with tomato sauce — pasta, tinned tomatoes, garlic, olive oil, basil"
> The assistant creates a minimal recipe entry with the described ingredients

**Recipe detail view:**

```
Baked Salmon with Roasted Vegetables
─────────────────────────────────────
Source: bbcgoodfood.com          ⭐ Saved  🕐 35 min  👥 Serves 4

Ingredients
  400g salmon fillet
  2 tbsp olive oil
  1 tsp ginger (fresh)          ⚠ Not in inventory
  Garlic, lemon, cherry tomatoes ✓ In inventory

Instructions
  1. Preheat oven to 200°C...
  ...

[Add to meal plan] [Order missing ingredients] [Find ginger substitute]
```

**"Find substitute" button** → opens assistant with pre-filled context: "I'm making [recipe] but I don't have [ingredient] — what's a good replacement?"

---

## 7. AI Agent Architecture

The assistant uses a **single orchestrating agent** with tool-calling capabilities. All features in Phase 1 are implemented as tools the agent can call.

### 7.1 Model selection
- Routing, quick Q&A, small data ops: `claude-sonnet-4-6` (fast, cost-efficient)
- Meal plan generation, complex reasoning, recipe extraction: `claude-opus-4-6` (best quality)
- Temperature: `0.1–0.2` for structured data operations, `0.4–0.6` for natural conversation

### 7.2 System prompt structure

```
You are ParentAI, a personal assistant for [household_name].

HOUSEHOLD CONTEXT
[Injected at runtime — members, ages, preferences, current inventory summary, active meal plan, weekly goal]

YOUR TOOLS
You have the following tools available. Always use tools to read and write data — never assume state from conversation alone.

BEHAVIOUR RULES
- Always confirm before making changes to preferences or inventory
- Never make medical recommendations — redirect to a doctor
- When you detect a new food preference, write it immediately and show a confirmation card
- Keep responses warm but concise
- Prefer action over advice: if asked to do something, do it and confirm
```

### 7.3 Tool definitions (Phase 1)

```typescript
tools = [
  // HOUSEHOLD
  get_household_members,        // returns all members + ages
  get_member_preferences,       // returns preferences for one or all members
  save_member_preference,       // write a new preference (allergy / dislike / like / diet)
  delete_member_preference,     // remove a preference by id

  // INVENTORY
  get_inventory,                // returns current inventory (filterable by status/category)
  add_inventory_item,           // add one or more items
  update_inventory_item,        // change quantity, status
  remove_inventory_item,        // delete item (and optionally add to grocery list)
  mark_inventory_finished,      // shortcut: status=finished + add to grocery list

  // GROCERY LIST
  get_grocery_list,             // returns current list
  add_grocery_item,             // add item to list
  remove_grocery_item,          // remove item (optionally add back to inventory)
  clear_purchased_items,        // housekeeping

  // MEAL PLANS
  get_meal_plan,                // get current or upcoming week plan
  generate_meal_plan,           // triggers meal plan generation (slow, async)
  approve_meal_plan,            // approve draft → triggers grocery list generation
  update_meal_slot,             // change one slot (day + meal type)
  get_recipe_substitute,        // given recipe + missing ingredient → suggest substitute

  // MEAL LOGGING
  log_meal,                     // record what was eaten (who, what, how much)
  get_meal_log,                 // retrieve logs for a date range

  // SAVED RECIPES
  get_saved_recipes,            // search/list recipes
  save_recipe_from_url,         // fetch + parse a recipe from URL
  save_recipe_from_text,        // create recipe from description
  add_recipe_to_meal_plan,      // assign a saved recipe to a plan slot

  // GOALS
  set_weekly_goal,              // save a weekly nutrition/health goal
  get_active_weekly_goal,       // retrieve current week's goal
]
```

### 7.4 Context injection

Every API call to the assistant injects a fresh context snapshot:

```json
{
  "household": {
    "name": "The Babul Household",
    "members": [
      { "name": "Aliya", "role": "adult", "age": 35, "gender": "female",
        "preferences": [{ "type": "diet", "value": "halal" }] },
      { "name": "Yusuf", "role": "child", "age_months": 18, "gender": "male",
        "preferences": [{ "type": "dislike", "value": "broccoli", "severity": "strong" }] }
    ]
  },
  "inventory_summary": "12 items in stock, 3 low (eggs, milk, nappies)",
  "active_meal_plan": "Week of 25 Mar — approved, today: breakfast oats, lunch chicken soup, dinner salmon",
  "grocery_list_count": 7,
  "weekly_goal": "eating healthy this week",
  "today": "Wednesday 26 March 2025"
}
```

This means the assistant always has current state without needing to call tools just to know the basics.

---

## 8. Voice Interface

### 8.1 Web (browser)
- Use **Web Speech API** (`SpeechRecognition`) for real-time transcription in supported browsers
- Fallback: record audio → upload to **Whisper API** → return transcript → populate text input
- User taps mic → recording starts → tap again or silence → transcription appears in input → user can edit before sending or auto-send after 1.5s silence

### 8.2 Mobile (React Native / Expo)
- **Expo AV** for audio recording
- Upload audio blob to backend endpoint → backend calls **Whisper API** → returns text
- Same UI as web: tap mic, speak, text appears in input

### 8.3 Voice output (Phase 1 optional)
- Web Speech API `speechSynthesis` for TTS in browser — no extra cost, good enough for Phase 1
- Phase 2: ElevenLabs for more natural voice

### 8.4 Voice processing endpoint

```
POST /api/voice/transcribe
Body: FormData { audio: File, language?: string }
Response: { transcript: string, confidence: float }
```

After transcription, the text is sent to the normal assistant endpoint — voice is just an input modality, not a separate pipeline.

---

## 9. Receipt & Image Processing

### 9.1 Receipt OCR pipeline

```
User uploads image
      ↓
Stored in Supabase Storage
      ↓
Receipt record created (status: 'pending')
      ↓
Inngest background job triggered
      ↓
Google Vision API → raw OCR text
      ↓
Claude parses OCR → structured JSON items
      ↓
Items inserted into inventory_items
      ↓
Receipt record updated (status: 'done')
      ↓
User notified: "X items added from receipt"
```

### 9.2 Recipe image extraction pipeline

```
User uploads recipe photo
      ↓
Stored in Supabase Storage
      ↓
Claude Vision (claude-sonnet-4-6) with image + text prompt:
  "Extract this recipe: name, ingredients (with quantities), instructions"
      ↓
Structured recipe JSON returned
      ↓
Saved to saved_recipes
```

### 9.3 Error handling
- OCR failures: mark receipt `status = 'failed'`, notify user, allow manual review
- Low-confidence items: flagged with `ai_confidence < 0.7`, shown for user confirmation
- Duplicate detection: check `name + category + added_within_24h` before inserting

---

## 10. Preference Learning System

The assistant learns preferences continuously from conversation. This needs to be reliable, transparent, and correctable.

### 10.1 Detection triggers
Any message containing signals like:
- Negative: "doesn't like", "won't eat", "hates", "refused", "allergic to", "can't have"
- Positive: "loves", "favourite", "always wants", "really likes"
- Correction: "actually likes now", "is okay with it these days"

### 10.2 Extraction logic

Claude extracts structured preference data from the message:
```json
{
  "member": "Yusuf",
  "type": "dislike",
  "value": "broccoli",
  "severity": "strong",
  "confidence": 0.92,
  "raw_signal": "refused the broccoli"
}
```

### 10.3 Write strategy
- Confidence ≥ 0.85 → write immediately, show confirmation card
- Confidence 0.6–0.85 → show confirmation card first, write on approval
- Confidence < 0.6 → ask: "Did you mean Yusuf doesn't like broccoli?"

### 10.4 Confirmation card (shown inline in chat)
```
┌────────────────────────────────────────┐
│ Preference noted                        │
│ Yusuf · Dislikes broccoli              │
│                                         │
│ [Save]  [Edit]  [Don't save]           │
└────────────────────────────────────────┘
```

### 10.5 Growth-aware preferences
Children's preferences change as they grow. Each `member_preference` record has `created_at` and `updated_at`. The meal planner always checks current preferences. User can review and bulk-clear old dislikes from the Settings page.

---

## 11. API Design

All routes are prefixed `/api/v1/`.

### Authentication
Every request requires `Authorization: Bearer <supabase_jwt>`.
Row Level Security enforced at the database layer — even if API logic is wrong, the DB won't return another household's data.

### Key endpoints

```
# Household
GET    /households/me
POST   /households/me/members
PUT    /households/me/members/:id
DELETE /households/me/members/:id

# Preferences
GET    /members/:id/preferences
POST   /members/:id/preferences
PUT    /members/:id/preferences/:prefId
DELETE /members/:id/preferences/:prefId

# Inventory
GET    /inventory
POST   /inventory
PUT    /inventory/:id
DELETE /inventory/:id
POST   /inventory/:id/finish           # mark finished → adds to grocery list

# Receipts
POST   /receipts                       # upload, triggers OCR job
GET    /receipts/:id                   # check processing status + items

# Grocery list
GET    /grocery
POST   /grocery
DELETE /grocery/:id
POST   /grocery/:id/purchase           # mark purchased

# Meal plans
GET    /meal-plans?week=2025-03-24
POST   /meal-plans/generate            # async: returns job_id
POST   /meal-plans/:id/approve
PUT    /meal-plans/:id/slots/:slotId

# Recipes
GET    /recipes
POST   /recipes/url                    # save from URL
POST   /recipes/photo                  # save from image upload
POST   /recipes/text                   # save from description

# Meal logs
GET    /meal-logs?from=&to=&memberId=
POST   /meal-logs

# Weekly goals
GET    /goals/current
POST   /goals

# Assistant
POST   /assistant/chat                 # main AI endpoint
POST   /assistant/voice/transcribe     # audio → text
```

### Assistant endpoint contract

```typescript
// Request
POST /api/v1/assistant/chat
{
  message: string,           // user message text
  conversation_id?: string,  // for continuing a session
  input_mode: 'text' | 'voice'
}

// Response (streaming SSE)
data: { type: 'text', content: 'Here are...' }
data: { type: 'tool_call', tool: 'get_inventory', result: {...} }
data: { type: 'card', card_type: 'preference_confirmation', data: {...} }
data: { type: 'card', card_type: 'meal_plan_draft', data: {...} }
data: { type: 'done', conversation_id: 'abc123' }
```

Responses are streamed (SSE) so text appears incrementally. Structured cards (preference confirmation, meal plan, grocery list) are sent as typed events so the frontend can render them as interactive components.

---

## 12. Platform Strategy — Web + Mobile

### 12.1 Code sharing

```
/apps
  /web          → Next.js 14 app
  /mobile       → Expo React Native app
/packages
  /shared       → shared business logic, types, API client, Zustand stores
  /ui           → shared UI components (NativeWind compatible)
```

Using a **monorepo** (Turborepo) so the API client, data models, and Zustand stores are written once and used in both web and mobile.

### 12.2 Web app
- Next.js 14 with App Router
- Deployed on Vercel
- PWA configured (manifest + service worker) so it can be "installed" on mobile browsers as an app
- Responsive design — works on mobile browser before native app is ready

### 12.3 Mobile app (React Native / Expo)
- Expo SDK — fast iteration, OTA updates (no app store re-submission for JS changes)
- React Navigation for screen management
- Native capabilities used: camera (receipt capture), microphone (voice input), push notifications
- EAS Build for generating iOS + Android binaries

### 12.4 Feature parity target (Phase 1)

| Feature | Web | Mobile |
|---|---|---|
| AI assistant chat | ✓ | ✓ |
| Voice input | ✓ (browser mic) | ✓ (native mic) |
| Household settings | ✓ | ✓ |
| Inventory management | ✓ | ✓ |
| Receipt upload | ✓ (file picker) | ✓ (camera) |
| Meal plan generation | ✓ | ✓ |
| Grocery list | ✓ | ✓ |
| Saved recipes | ✓ | ✓ |
| Meal logging | ✓ | ✓ |
| Push notifications | ✓ (web push) | ✓ (Expo) |

---

## 13. File & Storage Architecture

All files stored in **Supabase Storage** in the following bucket structure:

```
receipts/
  {household_id}/
    {receipt_id}.jpg

recipe-images/
  {household_id}/
    {recipe_id}.jpg

member-avatars/
  {household_id}/
    {member_id}.jpg

voice-recordings/
  {household_id}/
    temp/
      {uuid}.webm     ← deleted after transcription
```

**Access control:** All buckets are private. Files accessed via signed URLs (expire in 1 hour for display, 30 seconds for upload).

**File size limits:**
- Receipt images: 10MB max, JPEG/PNG/HEIC
- Recipe photos: 10MB max
- Voice recordings: 5MB max (~3 minutes at standard quality)

---

## 14. Security & Privacy

### 14.1 Row Level Security (RLS) — core policy

Every table has RLS enabled. Core policy pattern:

```sql
-- Users can only access data belonging to their household
CREATE POLICY "household_isolation" ON inventory_items
  USING (
    household_id IN (
      SELECT id FROM households WHERE owner_id = auth.uid()
    )
  );
```

This is the most important security control. Even a bug in application code cannot leak one family's data to another.

### 14.2 Data minimisation
- No health data stored beyond what the user explicitly provides
- Voice recordings deleted immediately after transcription
- OCR raw output stored for debugging but can be purged on request
- Allergy data flagged as sensitive — excluded from any analytics pipelines

### 14.3 AI data handling
- Household context injected per-request only — not stored in Anthropic's systems
- Claude API called with `system` prompt containing household data; this data is not used for model training (per Anthropic's enterprise terms)
- Conversation history stored in our own database — we control retention

### 14.4 GDPR / UAE PDPL compliance
- Data export endpoint: `GET /account/export` returns all household data as JSON
- Data deletion endpoint: `DELETE /account` → hard delete all records, cascade
- Consent captured at signup for AI processing of food/health data

---

*Document version: 1.0*
*Last updated: March 2026*
*Owner: Bab Al Ilm AI*
