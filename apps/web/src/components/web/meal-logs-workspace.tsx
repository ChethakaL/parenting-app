"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
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
  const [search, setSearch] = useState("");
  const [addModalOpen, setAddModalOpen] = useState(false);

  const memberMap = useMemo(
    () => new Map(household.members.map((member) => [member.id, member.name])),
    [household.members],
  );

  async function loadMealLogs(memberFilter = filterMemberId) {
    try {
      const query = memberFilter ? `?memberId=${encodeURIComponent(memberFilter)}` : "";
      const response = await apiRequest<{ mealLogs: MealLog[] }>({ path: `/meal-logs${query}`, method: "GET", token });
      setMealLogs(response.mealLogs);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load meal logs.");
    }
  }

  useEffect(() => {
    let cancelled = false;

    const fetchLogs = async () => {
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
    };

    void fetchLogs();

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
      setMemberId("");
      setMealType("dinner");
      setNotice("Meal log added.");
      setAddModalOpen(false);
      await loadMealLogs();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to add meal log.");
    }
  }

  const filteredLogs = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return mealLogs;
    return mealLogs.filter((log) => {
      const memberName = log.memberId ? memberMap.get(log.memberId) ?? "" : "household";
      return [log.description ?? "", log.notes ?? "", log.mealType, memberName].some((value) =>
        value.toLowerCase().includes(q),
      );
    });
  }, [mealLogs, memberMap, search]);

  return (
    <div className="wai-view">
      <div className="wai-page-intro">
        <p className="wai-section-kicker">Meal logs</p>
        <h2>Readable meal history with filters and a modal-based add flow.</h2>
        <p>Track what the household actually ate and review entries quickly without digging through oversized cards.</p>
      </div>

      <section className="wai-panel">
        <div className="wai-panel-head">
          <div>
            <h3>Meal log history</h3>
            <p>{filteredLogs.length} entries shown</p>
          </div>
          <div className="wai-inline-actions" style={{ flexWrap: "nowrap", justifyContent: "flex-end", alignItems: "center" }}>
            <input
              className="wai-inline-input"
              style={{ minWidth: "220px", width: "240px", flex: "0 1 240px" }}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search logs"
            />
            <select value={filterMemberId} onChange={(event) => setFilterMemberId(event.target.value)} style={{ minWidth: "220px", flex: "0 1 240px" }}>
              <option value="">All members</option>
              {household.members.map((member) => (
                <option key={member.id} value={member.id}>{member.name}</option>
              ))}
            </select>
            <button className="wai-primary-button" type="button" onClick={() => setAddModalOpen(true)}>Add meal log</button>
          </div>
        </div>

        <div className="wai-data-table-wrap">
          <table className="wai-data-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Meal</th>
                <th>Member</th>
                <th>Description</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={5}><div className="wai-empty">No meal logs saved yet.</div></td>
                </tr>
              ) : null}
              {filteredLogs.map((log) => (
                <tr key={log.id}>
                  <td>{formatDateTime(log.loggedAt)}</td>
                  <td>
                    <div className="wai-table-primary">{log.mealType}</div>
                    <div className="wai-table-secondary">{log.loggedVia}</div>
                  </td>
                  <td>{log.memberId ? memberMap.get(log.memberId) ?? "Unknown member" : "Household"}</td>
                  <td>{log.description ?? "No description"}</td>
                  <td>{[log.quantityEaten, log.notes].filter(Boolean).join(" • ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {addModalOpen ? (
        <div
          className="wai-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Add meal log"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setAddModalOpen(false);
          }}
        >
          <div className="wai-modal">
            <div className="wai-modal-head">
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <span className="wai-icon-pill" aria-hidden="true">
                  <LogIcon />
                </span>
                <div>
                  <h3 style={{ margin: 0, fontSize: 18, letterSpacing: "-0.02em" }}>Add meal log</h3>
                  <p style={{ margin: 0, color: "var(--wai-text-soft)", fontWeight: 650 }}>Capture what was actually eaten</p>
                </div>
              </div>
              <button className="wai-modal-close" type="button" onClick={() => setAddModalOpen(false)} aria-label="Close">✕</button>
            </div>
            <form className="wai-modal-body" onSubmit={addMealLog}>
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
              <div className="wai-modal-actions">
                <button className="wai-secondary-button" type="button" onClick={() => setAddModalOpen(false)}>Cancel</button>
                <button className="wai-primary-button" type="submit" disabled={!description.trim()}>Save meal log</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
