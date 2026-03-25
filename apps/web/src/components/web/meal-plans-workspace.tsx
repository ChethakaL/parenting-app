"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { apiRequest, formatPrettyDate } from "./api";
import { CalendarIcon } from "./icons";
import { MealPlan, MealPlanSlot, MealPlanWorkspaceData, RecipeSummary } from "./types";
import { WorkspaceShell } from "./workspace-shell";

const dayNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const MEAL_ORDER: Record<string, number> = {
  breakfast: 0,
  lunch: 1,
  dinner: 2,
  snack: 3,
};

function sortSlotsByMealType(slots: MealPlanSlot[]) {
  return [...slots].sort((a, b) => (MEAL_ORDER[a.mealType] ?? 9) - (MEAL_ORDER[b.mealType] ?? 9));
}

/** Label for grid + cards; DB may still have null/empty legacy rows. */
function slotRecipeLabel(recipeName: string | null | undefined) {
  const t = recipeName?.trim();
  return t && t.length > 0 ? t : "Unplanned meal";
}

function inventoryLabel(status: MealPlanSlot["inventoryStatus"] | undefined) {
  if (status === "in_stock") return "Ready";
  if (status === "partial") return "Partial";
  return "Shop";
}

const assistantMealPlanPrompt =
  "Plan meals for this week using our household members, allergies, likes, inventory, saved recipes, weekly goal, and recent meal logs. Show a draft I can review.";

export function MealPlansWorkspace() {
  return (
    <WorkspaceShell activeTab="meal-plans">
      {({ token, refreshSummary, setError, setNotice }) => (
        <MealPlansWorkspaceContent token={token} refreshSummary={refreshSummary} setError={setError} setNotice={setNotice} />
      )}
    </WorkspaceShell>
  );
}

function MealPlansWorkspaceContent({
  token,
  refreshSummary,
  setError,
  setNotice,
}: {
  token: string;
  refreshSummary: () => Promise<void>;
  setError: (value: string | null | ((prev: string | null) => string | null)) => void;
  setNotice: (value: string | null | ((prev: string | null) => string | null)) => void;
}) {
  const searchParams = useSearchParams();
  const [mealPlan, setMealPlan] = useState<MealPlan | null>(null);
  const [savedRecipes, setSavedRecipes] = useState<MealPlanWorkspaceData["savedRecipes"]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [recipeName, setRecipeName] = useState("");
  const [savedRecipeId, setSavedRecipeId] = useState("");
  const [serves, setServes] = useState("");
  const [notes, setNotes] = useState("");
  const [substituteSuggestion, setSubstituteSuggestion] = useState("");

  const loadMealPlan = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiRequest<MealPlanWorkspaceData>({ path: "/meal-plans", method: "GET", token });
      setMealPlan(response.mealPlan);
      setSavedRecipes(response.savedRecipes);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load meal plan.");
    } finally {
      setLoading(false);
    }
  }, [token, setError]);

  useEffect(() => {
    void loadMealPlan();
  }, [loadMealPlan]);

  useEffect(() => {
    const requestedSlotId = searchParams.get("slot");
    if (!requestedSlotId || !mealPlan?.slots?.some((slot) => slot.id === requestedSlotId)) return;
    setSelectedSlotId(requestedSlotId);
  }, [mealPlan?.slots, searchParams]);

  const selectedSlot = useMemo(
    () => mealPlan?.slots.find((slot) => slot.id === selectedSlotId) ?? null,
    [mealPlan?.slots, selectedSlotId],
  );

  useEffect(() => {
    if (!selectedSlot) {
      setRecipeName("");
      setServes("");
      setNotes("");
      return;
    }
    setRecipeName(selectedSlot.recipeName ?? "");
    setSavedRecipeId(selectedSlot.recipeId ?? "");
    setServes(selectedSlot.serves ? String(selectedSlot.serves) : "");
    setNotes(selectedSlot.notes ?? "");
    setSubstituteSuggestion("");
  }, [selectedSlot]);

  const slotsByDay = useMemo(() => {
    const grouped = new Map<number, MealPlanSlot[]>();
    for (const slot of mealPlan?.slots ?? []) {
      const existing = grouped.get(slot.dayOfWeek) ?? [];
      existing.push(slot);
      grouped.set(slot.dayOfWeek, existing);
    }
    return grouped;
  }, [mealPlan?.slots]);

  const todayDayOfWeek = useMemo(() => {
    const day = new Date().getDay();
    return day === 0 ? 7 : day;
  }, []);

  const selectedRecipe = useMemo<RecipeSummary | null>(() => {
    if (!selectedSlot) return null;
    if (selectedSlot.recipeId) {
      const matchedById = savedRecipes.find((recipe) => recipe.id === selectedSlot.recipeId);
      if (matchedById) return matchedById;
    }
    if (!selectedSlot.recipeName) return null;
    return savedRecipes.find((recipe) => recipe.name.toLowerCase() === selectedSlot.recipeName?.toLowerCase()) ?? null;
  }, [savedRecipes, selectedSlot]);

  const selectedRecipeIngredients = selectedRecipe?.ingredients ?? [];
  const selectedRecipeInstructions = selectedRecipe?.instructions ?? [];
  const selectedInstructionPreview = selectedRecipeInstructions.slice(0, 3);
  const guidanceAnnotations = useMemo(
    () => (selectedSlot?.annotations ?? []).filter((a) => a !== selectedSlot?.notes?.trim()),
    [selectedSlot?.annotations, selectedSlot?.notes],
  );

  async function clearSlot() {
    if (!mealPlan || !selectedSlot) return;
    const hadDetails = !!(
      selectedSlot.recipeId ||
      selectedSlot.recipeName?.trim() ||
      selectedSlot.notes?.trim() ||
      selectedSlot.serves
    );
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await apiRequest({
        path: `/meal-plans/${mealPlan.id}/slots/${selectedSlot.id}`,
        method: "PUT",
        token,
        body: {
          recipeId: null,
          recipeName: null,
          serves: null,
          notes: null,
        },
      });
      setNotice(
        hadDetails
          ? "Meal cleared — slot is unplanned until you add a recipe."
          : "This slot was already empty.",
      );
      await loadMealPlan();
      setSelectedSlotId(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to clear slot.");
    } finally {
      setBusy(false);
    }
  }

  async function saveSlot(event: FormEvent) {
    event.preventDefault();
    if (!mealPlan || !selectedSlot) return;

    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await apiRequest({
        path: `/meal-plans/${mealPlan.id}/slots/${selectedSlot.id}`,
        method: "PUT",
        token,
        body: {
          recipeId: savedRecipeId || null,
          recipeName: recipeName.trim() || null,
          serves: serves ? Number(serves) : null,
          notes: notes.trim() || null,
        },
      });
      setNotice("Meal slot updated.");
      await loadMealPlan();
      setSelectedSlotId(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to update slot.");
    } finally {
      setBusy(false);
    }
  }

  async function orderMissingIngredients() {
    if (!selectedSlot?.missingIngredients?.length) return;

    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await Promise.all(
        selectedSlot.missingIngredients.map((ingredient) =>
          apiRequest({
            path: "/grocery",
            method: "POST",
            token,
            body: {
              name: ingredient,
              priority: "normal",
              status: "needed",
              addedVia: "meal_plan",
            },
          }),
        ),
      );
      setNotice("Missing ingredients were added to the grocery list.");
      await refreshSummary();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to add missing ingredients.");
    } finally {
      setBusy(false);
    }
  }

  async function findSubstitute() {
    const ingredient = selectedSlot?.missingIngredients?.[0];
    if (!selectedSlot?.recipeName || !ingredient) return;

    setBusy(true);
    setError(null);
    try {
      const response = await apiRequest<{ suggestion: string }>({
        path: "/meal-plans/substitute",
        method: "POST",
        token,
        body: {
          recipeName: selectedSlot.recipeName,
          missingIngredient: ingredient,
        },
      });
      setSubstituteSuggestion(response.suggestion);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to find substitute.");
    } finally {
      setBusy(false);
    }
  }

  function closeSlotModal() {
    setSelectedSlotId(null);
  }

  return (
    <div className="wai-view">
      <div className="wai-page-intro">
        <p className="wai-section-kicker">Meal plans</p>
        <h2>Week at a glance for review, edits, and grocery follow-through.</h2>
        <p>The assistant is the primary place to generate, approve, and regenerate the weekly draft. This screen stays focused on reviewing and editing each slot.</p>
      </div>

      <section className="wai-panel">
        <div className="wai-panel-head">
          <div>
            <h3>Plan overview</h3>
            <p>{mealPlan ? `Week of ${formatPrettyDate(mealPlan.weekStart)}` : "No plan yet — generate one to fill the week."}</p>
          </div>
          <span className="wai-panel-icon"><CalendarIcon /></span>
        </div>

        <div className="wai-stack">
          <div className="wai-empty" style={{ marginTop: 4 }}>
            Generate, approve, or regenerate the weekly draft in the assistant. This page is for day-by-day review, edits, substitutions, and grocery follow-through.
          </div>
          <div className="wai-meal-overview-bar">
            <div className="wai-meal-overview-stats">
              <div className="wai-meal-overview-stat">
                <strong>{loading ? "…" : mealPlan?.status ?? "—"}</strong>
                <span>Status</span>
              </div>
              <div className="wai-meal-overview-stat">
                <strong>{loading ? "…" : mealPlan?.slots.length ?? 0}</strong>
                <span>Slots</span>
              </div>
              <div className="wai-meal-overview-stat">
                <strong>{loading ? "…" : mealPlan?.approvedAt ? "Yes" : "No"}</strong>
                <span>Approved</span>
              </div>
              <div className="wai-meal-overview-stat">
                <strong>{savedRecipes.length}</strong>
                <span>Saved recipes</span>
              </div>
            </div>
            <div className="wai-inline-actions" style={{ flexWrap: "wrap", justifyContent: "flex-end" }}>
              <Link className="wai-chip" href="/grocery">
                Review grocery
              </Link>
              <Link className="wai-chip" href="/inventory">
                Check inventory
              </Link>
              <Link
                className="wai-primary-button"
                href={`/?prompt=${encodeURIComponent(assistantMealPlanPrompt)}`}
                title="Open the assistant to generate or change the weekly plan"
              >
                Open assistant to plan
              </Link>
            </div>
          </div>

          {mealPlan?.weeklyGoal ? (
            <div className="wai-empty" style={{ marginTop: 4 }}>
              Weekly goal: {mealPlan.weeklyGoal}
            </div>
          ) : null}
        </div>
      </section>

      <section className="wai-panel">
        <div className="wai-panel-head">
          <div>
            <h3>This week</h3>
            <p>{loading ? "Loading…" : "Tap a meal to edit or review ingredients. Today is highlighted."}</p>
          </div>
        </div>
        <div className="wai-meal-week-board" role="list">
          {dayNames.map((dayName, index) => {
            const day = index + 1;
            const slots = sortSlotsByMealType(slotsByDay.get(day) ?? []);
            const isToday = day === todayDayOfWeek;
            return (
              <div key={dayName} className={`wai-meal-day-column${isToday ? " is-today" : ""}`} role="listitem">
                <div className="wai-meal-day-col-head">
                  <strong>{dayName}</strong>
                  <span>{isToday ? "Today" : `${slots.length} slot${slots.length === 1 ? "" : "s"}`}</span>
                </div>
                {slots.length === 0 ? <div className="wai-empty" style={{ padding: 12, fontSize: "0.85rem" }}>Empty</div> : null}
                {slots.map((slot) => (
                  <button
                    key={slot.id}
                    type="button"
                    className={`wai-meal-slot-compact${selectedSlotId === slot.id ? " is-active" : ""}`}
                    onClick={() => setSelectedSlotId(slot.id)}
                  >
                    <strong>{slot.mealType}</strong>
                    <span className="wai-meal-slot-title">{slotRecipeLabel(slot.recipeName)}</span>
                    <span className={`wai-slot-status wai-slot-status-${slot.inventoryStatus ?? "missing"}`}>
                      {inventoryLabel(slot.inventoryStatus)}
                    </span>
                    {slot.approved ? <span className="wai-meal-slot-meta">Completed</span> : null}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      </section>

      {selectedSlot ? (
        <div
          className="wai-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Meal slot"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeSlotModal();
          }}
        >
          <div className="wai-modal wai-modal-wide">
            <div className="wai-modal-head">
              <div style={{ display: "flex", gap: 12, alignItems: "center", minWidth: 0 }}>
                <span className="wai-icon-pill" aria-hidden="true">
                  <CalendarIcon />
                </span>
                <div style={{ minWidth: 0 }}>
                  <h3 style={{ margin: 0, fontSize: 18, letterSpacing: "-0.02em" }}>
                    {dayNames[selectedSlot.dayOfWeek - 1]} · {selectedSlot.mealType}
                  </h3>
                  <p style={{ margin: 0, color: "var(--wai-text-soft)", fontWeight: 650, fontSize: 14 }}>
                    {slotRecipeLabel(recipeName.trim() || selectedSlot.recipeName)}
                  </p>
                </div>
              </div>
              <button className="wai-modal-close" type="button" onClick={closeSlotModal} aria-label="Close">
                ✕
              </button>
            </div>

            <div className="wai-modal-body">
              <div className="wai-empty" style={{ marginTop: 0 }}>
                Review ingredients, household notes, cooking steps, and slot instructions here. Save changes to update the weekly draft.
              </div>
              <div className="wai-meal-hero" style={{ marginTop: 0 }}>
                <div className="wai-stack">
                  <span className={`wai-slot-status wai-slot-status-${selectedSlot.inventoryStatus ?? "missing"}`}>
                    {selectedSlot.inventoryStatus === "in_stock"
                      ? "Ready from inventory"
                      : selectedSlot.inventoryStatus === "partial"
                        ? "Mostly ready"
                        : "Needs grocery support"}
                  </span>
                  <p style={{ margin: 0, color: "var(--wai-text-soft)", fontWeight: 600 }}>
                    {selectedRecipe?.description ?? "Choose a saved recipe or type a meal idea."}
                  </p>
                </div>
                <div className="wai-meal-hero-metrics">
                  <div className="wai-summary-card">
                    <strong>{selectedSlot.serves ?? selectedRecipe?.servings ?? "—"}</strong>
                    <span>Serves</span>
                  </div>
                  <div className="wai-summary-card">
                    <strong>{selectedRecipe ? `${(selectedRecipe.prepTimeMins ?? 0) + (selectedRecipe.cookTimeMins ?? 0)}m` : "—"}</strong>
                    <span>Total time</span>
                  </div>
                </div>
              </div>

              <div className="wai-meal-detail-grid">
                <div className="wai-stack">
                  <div className="wai-column-head">
                    <h3>Ingredients</h3>
                    <span>{selectedRecipeIngredients.length}</span>
                  </div>
                  {selectedRecipeIngredients.length ? (
                    <div className="wai-ingredient-list">
                      {selectedRecipeIngredients.map((ingredient) => {
                        const ingredientName = ingredient.name?.trim() ?? "";
                        const isMissing = selectedSlot.missingIngredients?.some(
                          (missing) => missing.toLowerCase() === ingredientName.toLowerCase(),
                        );
                        return (
                          <div key={`${selectedSlot.id}-${ingredientName}`} className={isMissing ? "wai-ingredient-item is-missing" : "wai-ingredient-item"}>
                            <strong>{ingredientName}</strong>
                            <span>
                              {ingredient.quantity
                                ? `${ingredient.quantity}${ingredient.unit ? ` ${ingredient.unit}` : ""}`
                                : isMissing
                                  ? "Need to buy"
                                  : "In inventory"}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="wai-empty">No ingredient list for this recipe yet.</div>
                  )}
                </div>

                <div className="wai-stack">
                  <div className="wai-column-head">
                    <h3>Household context</h3>
                    <span>{selectedInstructionPreview.length || guidanceAnnotations.length || 0}</span>
                  </div>
                  {guidanceAnnotations.length ? (
                    <div className="wai-tag-row">
                      {guidanceAnnotations.map((annotation) => (
                        <div key={annotation} className="wai-tag">
                          {annotation}
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {selectedInstructionPreview.length ? (
                    <div className="wai-stack">
                      {selectedInstructionPreview.map((instruction, idx) => (
                        <div key={`${selectedSlot.id}-instruction-${idx}`} className="wai-empty">
                          Step {instruction.step ?? idx + 1}: {instruction.text}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="wai-empty">No saved cooking steps yet.</div>
                  )}
                  {substituteSuggestion ? <div className="wai-empty">{substituteSuggestion}</div> : null}
                </div>
              </div>

              <form className="wai-form" onSubmit={saveSlot} style={{ marginTop: 8 }}>
                <label>
                  Saved recipe
                  <select value={savedRecipeId} onChange={(event) => setSavedRecipeId(event.target.value)}>
                    <option value="">Type manually</option>
                    {savedRecipes.map((recipe) => (
                      <option key={recipe.id} value={recipe.id}>
                        {recipe.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="wai-form-grid">
                  <label>
                    Recipe name
                    <input value={recipeName} onChange={(event) => setRecipeName(event.target.value)} placeholder="Simple vegetable curry" />
                  </label>
                  <label>
                    Serves
                    <input value={serves} onChange={(event) => setServes(event.target.value)} placeholder="4" />
                  </label>
                </div>
                <label>
                  Notes for this slot
                  <textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Keep it mild for the children." rows={4} />
                </label>
                {selectedSlot.missingIngredients?.length ? (
                  <div className="wai-empty">Missing: {selectedSlot.missingIngredients.join(", ")}</div>
                ) : null}
                <div className="wai-inline-actions">
                  <button
                    className="wai-secondary-button"
                    type="button"
                    onClick={() => void findSubstitute()}
                    disabled={!selectedSlot.missingIngredients?.length || busy}
                  >
                    Find substitute
                  </button>
                  <button
                    className="wai-secondary-button"
                    type="button"
                    onClick={() => void orderMissingIngredients()}
                    disabled={!selectedSlot.missingIngredients?.length || busy}
                  >
                    Add missing to grocery
                  </button>
                </div>
                <div className="wai-modal-actions" style={{ padding: "8px 0 0", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                  <button className="wai-secondary-button" type="button" onClick={closeSlotModal}>
                    Cancel
                  </button>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    <button
                      className="wai-secondary-button"
                      type="button"
                      onClick={() => void clearSlot()}
                      disabled={busy}
                    >
                      Clear meal
                    </button>
                    <button className="wai-primary-button" type="submit" disabled={busy}>
                      Save slot
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </div>
        </div>
      ) : null}

    </div>
  );
}
