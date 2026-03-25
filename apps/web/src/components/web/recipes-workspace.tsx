"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { apiRequest, formatPrettyDate } from "./api";
import { FilePicker } from "./file-picker";
import { RecipeIcon, UploadIcon } from "./icons";
import { RecipeSummary } from "./types";
import { WorkspaceShell } from "./workspace-shell";

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

  async function importFromUrl(event: FormEvent) {
    event.preventDefault();
    if (!url.trim()) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await apiRequest({ path: "/recipes/url", method: "POST", token, body: { url: url.trim() } });
      setUrl("");
      setNotice("Recipe imported from URL.");
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
      setDescription("");
      setNotice("Recipe extracted from text.");
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
      setPhotoFile(null);
      setPhotoNotes("");
      setNotice("Recipe extracted from photo.");
      await loadRecipes();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to import recipe from photo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wai-view">
      <div className="wai-page-intro">
        <p className="wai-section-kicker">Recipes</p>
        <h2>Capture recipes from URLs, raw text, or photos.</h2>
        <p>This turns the recipe endpoints into a real user workflow instead of leaving them as backend-only utilities.</p>
      </div>

      <div className="wai-three-column">
        <section className="wai-panel">
          <div className="wai-panel-head">
            <div>
              <h3>Import from URL</h3>
              <p>Extract and save a web recipe</p>
            </div>
            <span className="wai-panel-icon"><RecipeIcon /></span>
          </div>
          <form className="wai-form" onSubmit={importFromUrl}>
            <label>
              Recipe URL
              <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://..." />
            </label>
            <button className="wai-primary-button" type="submit" disabled={busy}>Import URL</button>
          </form>
        </section>

        <section className="wai-panel">
          <div className="wai-panel-head">
            <div>
              <h3>Import from text</h3>
              <p>Paste a recipe or rough notes</p>
            </div>
            <span className="wai-panel-icon"><RecipeIcon /></span>
          </div>
          <form className="wai-form" onSubmit={importFromText}>
            <label>
              Recipe text
              <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Paste the recipe details here..." rows={6} />
            </label>
            <button className="wai-primary-button" type="submit" disabled={busy}>Import text</button>
          </form>
        </section>

        <section className="wai-panel">
          <div className="wai-panel-head">
            <div>
              <h3>Import from photo</h3>
              <p>Upload a card, screenshot, or cookbook page</p>
            </div>
            <span className="wai-panel-icon"><UploadIcon /></span>
          </div>
          <form className="wai-form" onSubmit={importFromPhoto}>
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
            <button className="wai-primary-button" type="submit" disabled={busy}>Import photo</button>
          </form>
        </section>
      </div>

      <section className="wai-panel">
        <div className="wai-panel-head">
          <div>
            <h3>Saved recipes</h3>
            <p>{recipes.length} recipes available</p>
          </div>
          <input className="wai-inline-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search recipes" />
        </div>
        <div className="wai-recipe-grid">
          {recipes.length === 0 ? <div className="wai-empty">No recipes saved yet.</div> : null}
          {recipes.map((recipe) => (
            <article key={recipe.id} className="wai-recipe-card">
              {recipe.imageUrl ? (
                <div className="wai-recipe-figure">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={recipe.imageUrl} alt={recipe.name} />
                </div>
              ) : null}
              <div className="wai-stack">
                <div>
                  <strong>{recipe.name}</strong>
                  <p>{recipe.description ?? "No description saved."}</p>
                </div>
                <div className="wai-inline-actions">
                  <span className="wai-tag">{recipe.prepTimeMins ? `${recipe.prepTimeMins} min prep` : "Prep n/a"}</span>
                  <span className="wai-tag">{recipe.servings ? `${recipe.servings} servings` : "Servings n/a"}</span>
                  <span className="wai-tag">{formatPrettyDate(recipe.createdAt)}</span>
                </div>
                {recipe.tags.length > 0 ? (
                  <div className="wai-tag-row">
                    {recipe.tags.map((tag) => (
                      <span key={tag} className="wai-tag">{tag}</span>
                    ))}
                  </div>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
