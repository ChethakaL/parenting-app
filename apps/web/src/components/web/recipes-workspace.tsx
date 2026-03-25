"use client";

import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { apiRequest, formatPrettyDate } from "./api";
import { FilePicker } from "./file-picker";
import { RecipeIcon } from "./icons";
import { RecipeSummary } from "./types";
import { WorkspaceShell } from "./workspace-shell";

type RecipeModalMode = "url" | "text" | "photo" | null;

export function RecipesWorkspace() {
  return (
    <WorkspaceShell activeTab="recipes">
      {({ token, setError, setNotice }) => (
        <RecipesWorkspaceContent token={token} setError={setError} setNotice={setNotice} />
      )}
    </WorkspaceShell>
  );
}

function RecipesWorkspaceContent({
  token,
  setError,
  setNotice,
}: {
  token: string;
  setError: (value: string | null | ((prev: string | null) => string | null)) => void;
  setNotice: (value: string | null | ((prev: string | null) => string | null)) => void;
}) {
  const [recipes, setRecipes] = useState<RecipeSummary[]>([]);
  const [query, setQuery] = useState("");
  const [selectedRecipeId, setSelectedRecipeId] = useState<string | null>(null);
  const [modalMode, setModalMode] = useState<RecipeModalMode>(null);
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoNotes, setPhotoNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const loadRecipes = useCallback(async () => {
    try {
      const response = await apiRequest<{ recipes: RecipeSummary[] }>({
        path: `/recipes${query.trim() ? `?query=${encodeURIComponent(query.trim())}` : ""}`,
        method: "GET",
        token,
      });
      setRecipes(response.recipes);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load recipes.");
    }
  }, [query, token, setError]);

  useEffect(() => {
    void loadRecipes();
  }, [loadRecipes]);

  const selectedRecipe = useMemo(
    () => recipes.find((recipe) => recipe.id === selectedRecipeId) ?? null,
    [recipes, selectedRecipeId],
  );

  function resetImportState() {
    setUrl("");
    setDescription("");
    setPhotoFile(null);
    setPhotoNotes("");
  }

  async function importFromUrl(event: FormEvent) {
    event.preventDefault();
    if (!url.trim()) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await apiRequest({ path: "/recipes/url", method: "POST", token, body: { url: url.trim() } });
      setNotice("Recipe imported from URL.");
      setModalMode(null);
      resetImportState();
      await loadRecipes();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to import recipe from URL.");
    } finally {
      setBusy(false);
    }
  }

  async function importFromText(event: FormEvent) {
    event.preventDefault();
    if (!description.trim()) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await apiRequest({ path: "/recipes/text", method: "POST", token, body: { description: description.trim() } });
      setNotice("Recipe extracted from text.");
      setModalMode(null);
      resetImportState();
      await loadRecipes();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to import recipe from text.");
    } finally {
      setBusy(false);
    }
  }

  async function importFromPhoto(event: FormEvent) {
    event.preventDefault();
    if (!photoFile) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const form = new FormData();
      form.append("image", photoFile);
      if (photoNotes.trim()) form.append("notes", photoNotes.trim());
      await apiRequest({ path: "/recipes/photo", method: "POST", token, body: form, isFormData: true });
      setNotice("Recipe extracted from photo.");
      setModalMode(null);
      resetImportState();
      await loadRecipes();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to import recipe from photo.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteRecipe(recipeId: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await apiRequest({ path: `/recipes/${recipeId}`, method: "DELETE", token });
      setNotice("Recipe deleted.");
      setSelectedRecipeId(null);
      await loadRecipes();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to delete recipe.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wai-view">
      <div className="wai-page-intro">
        <p className="wai-section-kicker">Recipes</p>
        <h2>Saved recipes in a readable list with modal-based import and detail views.</h2>
        <p>Use the buttons on the right to add recipes from a URL, free text, or a photo. Open any row to review ingredients and steps.</p>
      </div>

      <section className="wai-panel">
        <div className="wai-panel-head">
          <div>
            <h3>Recipe library</h3>
            <p>{recipes.length} recipes available</p>
          </div>
          <div className="wai-inline-actions" style={{ flexWrap: "nowrap", justifyContent: "flex-end", alignItems: "center" }}>
            <input
              className="wai-inline-input"
              style={{ minWidth: "220px", width: "240px", flex: "0 1 240px" }}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search recipes"
            />
            <div className="wai-inline-actions" style={{ flexWrap: "nowrap", gap: "12px" }}>
              <button className="wai-secondary-button" type="button" onClick={() => setModalMode("url")}>Add from URL</button>
              <button className="wai-secondary-button" type="button" onClick={() => setModalMode("text")}>Add from text</button>
              <button className="wai-primary-button" type="button" onClick={() => setModalMode("photo")}>Add from photo</button>
            </div>
          </div>
        </div>

        <div className="wai-data-table-wrap">
          <table className="wai-data-table">
            <thead>
              <tr>
                <th>Recipe</th>
                <th>Prep</th>
                <th>Serves</th>
                <th>Tags</th>
                <th>Saved</th>
              </tr>
            </thead>
            <tbody>
              {recipes.length === 0 ? (
                <tr>
                  <td colSpan={5}><div className="wai-empty">No recipes saved yet.</div></td>
                </tr>
              ) : null}
              {recipes.map((recipe) => (
                <tr key={recipe.id} className="is-clickable" onClick={() => setSelectedRecipeId(recipe.id)}>
                  <td>
                    <div className="wai-table-primary">{recipe.name}</div>
                    <div className="wai-table-secondary">{recipe.description ?? "No description saved."}</div>
                  </td>
                  <td>{recipe.prepTimeMins ? `${recipe.prepTimeMins} min` : "n/a"}</td>
                  <td>{recipe.servings ?? "n/a"}</td>
                  <td>{recipe.tags.length ? recipe.tags.join(", ") : "—"}</td>
                  <td>{formatPrettyDate(recipe.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {modalMode === "url" ? (
        <RecipeImportModal
          title="Add Recipe From URL"
          subtitle="Paste a recipe link and we will extract the details."
          onClose={() => setModalMode(null)}
        >
          <form className="wai-modal-body" onSubmit={importFromUrl}>
            <label>
              Recipe URL
              <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://..." autoFocus />
            </label>
            <div className="wai-modal-actions">
              <button className="wai-secondary-button" type="button" onClick={() => setModalMode(null)}>Cancel</button>
              <button className="wai-primary-button" type="submit" disabled={busy || !url.trim()}>Import URL</button>
            </div>
          </form>
        </RecipeImportModal>
      ) : null}

      {modalMode === "text" ? (
        <RecipeImportModal
          title="Add Recipe From Text"
          subtitle="Paste notes, ingredients, or a full recipe and we will structure it."
          onClose={() => setModalMode(null)}
        >
          <form className="wai-modal-body" onSubmit={importFromText}>
            <label>
              Recipe text
              <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Paste the recipe details here..." rows={7} autoFocus />
            </label>
            <div className="wai-modal-actions">
              <button className="wai-secondary-button" type="button" onClick={() => setModalMode(null)}>Cancel</button>
              <button className="wai-primary-button" type="submit" disabled={busy || !description.trim()}>Import text</button>
            </div>
          </form>
        </RecipeImportModal>
      ) : null}

      {modalMode === "photo" ? (
        <RecipeImportModal
          title="Add Recipe From Photo"
          subtitle="Upload a screenshot, cookbook page, or recipe card."
          onClose={() => setModalMode(null)}
        >
          <form className="wai-modal-body" onSubmit={importFromPhoto}>
            <FilePicker
              label="Choose recipe image"
              accept="image/*"
              file={photoFile}
              onChange={setPhotoFile}
              helper="Upload a recipe card, cookbook page, or screenshot."
            />
            <label>
              Notes
              <textarea value={photoNotes} onChange={(event) => setPhotoNotes(event.target.value)} placeholder="Optional notes for the extractor..." rows={4} />
            </label>
            <div className="wai-modal-actions">
              <button className="wai-secondary-button" type="button" onClick={() => setModalMode(null)}>Cancel</button>
              <button className="wai-primary-button" type="submit" disabled={busy || !photoFile}>Import photo</button>
            </div>
          </form>
        </RecipeImportModal>
      ) : null}

      {selectedRecipe ? (
        <RecipeImportModal
          title={selectedRecipe.name}
          subtitle={selectedRecipe.description ?? "Saved recipe details"}
          onClose={() => setSelectedRecipeId(null)}
        >
          <div className="wai-modal-body">
            <div className="wai-form-grid">
              <div className="wai-empty">Prep: {selectedRecipe.prepTimeMins ? `${selectedRecipe.prepTimeMins} min` : "n/a"}</div>
              <div className="wai-empty">Serves: {selectedRecipe.servings ?? "n/a"}</div>
            </div>
            <div className="wai-meal-detail-grid">
              <div className="wai-stack">
                <div className="wai-column-head">
                  <h3>Ingredients</h3>
                  <span>{selectedRecipe.ingredients?.length ?? 0}</span>
                </div>
                {selectedRecipe.ingredients?.length ? selectedRecipe.ingredients.map((ingredient, index) => (
                  <div key={`${selectedRecipe.id}-ingredient-${index}`} className="wai-empty">
                    {ingredient.quantity ? `${ingredient.quantity}${ingredient.unit ? ` ${ingredient.unit}` : ""} ` : ""}{ingredient.name}
                  </div>
                )) : <div className="wai-empty">No ingredients saved yet.</div>}
              </div>
              <div className="wai-stack">
                <div className="wai-column-head">
                  <h3>Instructions</h3>
                  <span>{selectedRecipe.instructions?.length ?? 0}</span>
                </div>
                {selectedRecipe.instructions?.length ? selectedRecipe.instructions.map((instruction, index) => (
                  <div key={`${selectedRecipe.id}-instruction-${index}`} className="wai-empty">
                    Step {instruction.step ?? index + 1}: {instruction.text}
                  </div>
                )) : <div className="wai-empty">No cooking steps saved yet.</div>}
              </div>
            </div>
            <div className="wai-modal-actions" style={{ padding: "8px 0 0" }}>
              <button
                className="wai-danger-button"
                type="button"
                disabled={busy}
                onClick={() => void deleteRecipe(selectedRecipe.id)}
              >
                Delete recipe
              </button>
            </div>
          </div>
        </RecipeImportModal>
      ) : null}
    </div>
  );
}

function RecipeImportModal({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className="wai-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="wai-modal wai-modal-wide">
        <div className="wai-modal-head">
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <span className="wai-icon-pill" aria-hidden="true">
              <RecipeIcon />
            </span>
            <div>
              <h3 style={{ margin: 0, fontSize: 18, letterSpacing: "-0.02em" }}>{title}</h3>
              <p style={{ margin: 0, color: "var(--wai-text-soft)", fontWeight: 650 }}>{subtitle}</p>
            </div>
          </div>
          <button className="wai-modal-close" type="button" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
