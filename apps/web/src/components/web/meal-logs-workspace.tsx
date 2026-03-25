"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { apiRequest, formatDateTime } from "./api";
import { LogIcon } from "./icons";
import { HouseholdMe, MealLog } from "./types";
import { WorkspaceShell } from "./workspace-shell";

export function MealLogsWorkspace() {
  return (
    <WorkspaceShell activeTab="meal-logs">
      {({ token, household, setError, setNotice }) => (
        <MealLogsWorkspaceContent token={token} household={household} setError={setError} setNotice={setNotice} />
      )}
    </WorkspaceShell>
  );
}

function MealLogsWorkspaceContent({
  token,
  household,
  setError,
  setNotice,
}: {
  token: string;
  household: HouseholdMe;
  setError: (value: string | null | ((prev: string | null) => string | null)) => void;
  setNotice: (value: string | null | ((prev: string | null) => string | null)) => void;
}) {
  const [mealLogs, setMealLogs] = useState<MealLog[]>([]);
  const [mealType, setMealType] = useState<"breakfast" | "lunch" | "dinner" | "snack">("dinner");
  const [memberId, setMemberId] = useState("");
  const [description, setDescription] = useState("");
  const [quantityEaten, setQuantityEaten] = useState("");
  const [notes, setNotes] = useState("");
  const [filterMemberId, setFilterMemberId] = useState("");

  const memberMap = useMemo(
    () => new Map(household.members.map((member) => [member.id, member.name])),
    [household.members],
  );

  const loadMealLogs = useCallback(async () => {
    try {
      const query = filterMemberId ? `?memberId=${encodeURIComponent(filterMemberId)}` : "";
      const response = await apiRequest<{ mealLogs: MealLog[] }>({ path: `/meal-logs${query}`, method: "GET", token });
      setMealLogs(response.mealLogs);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load meal logs.");
    }
  }, [filterMemberId, token, setError]);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        const query = filterMemberId ? `?memberId=${encodeURIComponent(filterMemberId)}` : "";
        const response = await apiRequest<{ mealLogs: MealLog[] }>({ path: `/meal-logs${query}`, method: "GET", token });
        if (!cancelled) {
          setMealLogs(response.mealLogs);
        }
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Failed to load meal logs.");
        }
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [filterMemberId, token, setError]);

  async function addMealLog(event: FormEvent) {
    event.preventDefault();
    if (!description.trim()) return;
    setError(null);
    setNotice(null);

    try {
      await apiRequest({
        path: "/meal-logs",
        method: "POST",
        token,
        body: {
          mealType,
          memberId: memberId || null,
          description: description.trim(),
          quantityEaten: quantityEaten.trim() || null,
          notes: notes.trim() || null,
          loggedVia: "manual",
        },
      });
      setDescription("");
      setQuantityEaten("");
      setNotes("");
      setNotice("Meal log added.");
      await loadMealLogs();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to add meal log.");
    }
  }

  return (
    <div className="wai-view">
      <div className="wai-page-intro">
        <p className="wai-section-kicker">Meal logs</p>
        <h2>Track what was actually eaten, not just what was planned.</h2>
        <p>Meal logs close the loop between the meal plan and the real household behavior so Parent AI can learn what works.</p>
      </div>

      <div className="wai-two-column">
        <section className="wai-panel">
          <div className="wai-panel-head">
            <div>
              <h3>Add meal log</h3>
              <p>Capture what a child or adult actually ate</p>
            </div>
            <span className="wai-panel-icon"><LogIcon /></span>
          </div>
          <form className="wai-form" onSubmit={addMealLog}>
            <label>
              Meal type
              <select value={mealType} onChange={(event) => setMealType(event.target.value as typeof mealType)}>
                <option value="breakfast">Breakfast</option>
                <option value="lunch">Lunch</option>
                <option value="dinner">Dinner</option>
                <option value="snack">Snack</option>
              </select>
            </label>
            <label>
              Household member
              <select value={memberId} onChange={(event) => setMemberId(event.target.value)}>
                <option value="">Whole household / not specified</option>
                {household.members.map((member) => (
                  <option key={member.id} value={member.id}>{member.name}</option>
                ))}
              </select>
            </label>
            <label>
              Description
              <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Ate chicken rice and cucumber salad." rows={5} />
            </label>
            <div className="wai-grid-2">
              <label>
                Quantity eaten
                <input value={quantityEaten} onChange={(event) => setQuantityEaten(event.target.value)} placeholder="Most of it" />
              </label>
              <label>
                Notes
                <input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Wanted seconds" />
              </label>
            </div>
            <button className="wai-primary-button" type="submit">Save meal log</button>
          </form>
        </section>

        <section className="wai-panel">
          <div className="wai-panel-head">
            <div>
              <h3>Filter logs</h3>
              <p>Review by household member</p>
            </div>
          </div>
          <label>
            Household member
            <select value={filterMemberId} onChange={(event) => setFilterMemberId(event.target.value)}>
              <option value="">All members</option>
              {household.members.map((member) => (
                <option key={member.id} value={member.id}>{member.name}</option>
              ))}
            </select>
          </label>
          <button className="wai-secondary-button" type="button" onClick={() => void loadMealLogs()}>
            Refresh logs
          </button>
        </section>
      </div>

      <section className="wai-panel">
        <div className="wai-panel-head">
          <div>
            <h3>Recent meal logs</h3>
            <p>{mealLogs.length} logs loaded</p>
          </div>
        </div>
        <div className="wai-log-list">
          {mealLogs.length === 0 ? <div className="wai-empty">No meal logs saved yet.</div> : null}
          {mealLogs.map((log) => (
            <article key={log.id} className="wai-log-card">
              <div className="wai-log-meta">
                <strong>{log.mealType}</strong>
                <span>{formatDateTime(log.loggedAt)}</span>
                <span>{log.memberId ? memberMap.get(log.memberId) ?? "Unknown member" : "Household"}</span>
                <span>{log.loggedVia}</span>
              </div>
              <p>{log.description ?? "No description"}</p>
              <div className="wai-inline-actions">
                {log.quantityEaten ? <span className="wai-tag">{log.quantityEaten}</span> : null}
                {log.notes ? <span className="wai-tag">{log.notes}</span> : null}
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
