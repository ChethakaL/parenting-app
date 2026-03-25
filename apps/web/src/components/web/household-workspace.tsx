"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { apiRequest, formatDob, normalizeDateValue } from "./api";
import { DatePicker } from "./date-picker";
import { FamilyIcon, SparklesIcon } from "./icons";
import { HouseholdMe, MemberPreference } from "./types";
import { WorkspaceShell } from "./workspace-shell";

const todayIso = new Date().toISOString().slice(0, 10);

export function HouseholdWorkspace() {
  return (
    <WorkspaceShell activeTab="household">
      {({ token, household, refreshSummary, setError, setNotice }) => (
        <HouseholdWorkspaceContent token={token} household={household} refreshSummary={refreshSummary} setError={setError} setNotice={setNotice} />
      )}
    </WorkspaceShell>
  );
}

function HouseholdWorkspaceContent({
  token,
  household,
  refreshSummary,
  setError,
  setNotice,
}: {
  token: string;
  household: HouseholdMe;
  refreshSummary: () => Promise<void>;
  setError: (value: string | null | ((prev: string | null) => string | null)) => void;
  setNotice: (value: string | null | ((prev: string | null) => string | null)) => void;
}) {
  const [memberName, setMemberName] = useState("");
  const [memberDob, setMemberDob] = useState("");
  const [memberGender, setMemberGender] = useState<"male" | "female" | "other">("female");
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(household.members[0]?.id ?? null);
  const [preferences, setPreferences] = useState<MemberPreference[]>([]);
  const [memberSearch, setMemberSearch] = useState("");
  const [preferenceSearch, setPreferenceSearch] = useState("");
  const [preferenceTypeFilter, setPreferenceTypeFilter] = useState("");
  const [preferenceType, setPreferenceType] = useState<"allergy" | "dislike" | "like" | "diet">("allergy");
  const [preferenceValue, setPreferenceValue] = useState("");
  const [preferenceSeverity, setPreferenceSeverity] = useState<"critical" | "strong" | "mild">("strong");
  const [addMemberModalOpen, setAddMemberModalOpen] = useState(false);
  const [editMemberModalOpen, setEditMemberModalOpen] = useState(false);
  const [addPreferenceModalOpen, setAddPreferenceModalOpen] = useState(false);
  const [preferencesModalOpen, setPreferencesModalOpen] = useState(false);

  const resolvedSelectedMemberId = useMemo(
    () => (selectedMemberId && household.members.some((member) => member.id === selectedMemberId)
      ? selectedMemberId
      : household.members[0]?.id ?? null),
    [household.members, selectedMemberId],
  );

  const selectedMember = useMemo(
    () => household.members.find((member) => member.id === resolvedSelectedMemberId) ?? null,
    [household.members, resolvedSelectedMemberId],
  );

  useEffect(() => {
    if (!resolvedSelectedMemberId) return;
    let cancelled = false;

    async function bootstrap() {
      try {
        const response = await apiRequest<{ preferences: MemberPreference[] }>({
          path: `/members/${resolvedSelectedMemberId}/preferences`,
          method: "GET",
          token,
        });
        if (!cancelled) {
          setPreferences(response.preferences);
        }
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Failed to load preferences.");
        }
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [resolvedSelectedMemberId, token, setError]);

  async function addMember(event: FormEvent) {
    event.preventDefault();
    if (!memberName.trim() || !memberDob.trim()) return;

    try {
      await apiRequest({
        path: "/households/me/members",
        method: "POST",
        token,
        body: {
          name: memberName.trim(),
          gender: memberGender,
          dateOfBirth: memberDob,
        },
      });
      setMemberName("");
      setMemberDob("");
      setMemberGender("female");
      setNotice("Family member added.");
      await refreshSummary();
      setAddMemberModalOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to add member.");
    }
  }

  async function updateMember(values: {
    name: string;
    gender: "male" | "female" | "other";
    dateOfBirth: string;
  }) {
    if (!resolvedSelectedMemberId) return;
    try {
      await apiRequest({
        path: `/households/me/members/${resolvedSelectedMemberId}`,
        method: "PUT",
        token,
        body: {
          name: values.name.trim(),
          gender: values.gender,
          dateOfBirth: values.dateOfBirth,
        },
      });
      setNotice("Member updated.");
      await refreshSummary();
      setEditMemberModalOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to update member.");
    }
  }

  async function deleteMember() {
    if (!resolvedSelectedMemberId) return;

    try {
      await apiRequest({ path: `/households/me/members/${resolvedSelectedMemberId}`, method: "DELETE", token });
      setNotice("Member deleted.");
      setSelectedMemberId(null);
      setPreferences([]);
      setEditMemberModalOpen(false);
      await refreshSummary();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to delete member.");
    }
  }

  async function addPreference(event: FormEvent) {
    event.preventDefault();
    if (!resolvedSelectedMemberId || !preferenceValue.trim()) return;

    try {
      await apiRequest({
        path: `/members/${resolvedSelectedMemberId}/preferences`,
        method: "POST",
        token,
        body: {
          type: preferenceType,
          value: preferenceValue.trim(),
          severity: preferenceType === "allergy" || preferenceType === "dislike" ? preferenceSeverity : undefined,
          source: "manual",
        },
      });
      setPreferenceValue("");
      setNotice("Preference added.");
      setAddPreferenceModalOpen(false);
      const response = await apiRequest<{ preferences: MemberPreference[] }>({
        path: `/members/${resolvedSelectedMemberId}/preferences`,
        method: "GET",
        token,
      });
      setPreferences(response.preferences);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to add preference.");
    }
  }

  async function deletePreference(prefId: string) {
    if (!resolvedSelectedMemberId) return;

    try {
      await apiRequest({ path: `/members/${resolvedSelectedMemberId}/preferences/${prefId}`, method: "DELETE", token });
      setNotice("Preference removed.");
      const response = await apiRequest<{ preferences: MemberPreference[] }>({
        path: `/members/${resolvedSelectedMemberId}/preferences`,
        method: "GET",
        token,
      });
      setPreferences(response.preferences);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to delete preference.");
    }
  }

  const filteredMembers = useMemo(() => {
    const q = memberSearch.trim().toLowerCase();
    if (!q) return household.members;
    return household.members.filter((member) =>
      [member.name, member.role, formatDob(member.dateOfBirth)].some((value) => value.toLowerCase().includes(q)),
    );
  }, [household.members, memberSearch]);

  const filteredPreferences = useMemo(() => {
    const q = preferenceSearch.trim().toLowerCase();
    return preferences.filter((preference) => {
      if (preferenceTypeFilter && preference.type !== preferenceTypeFilter) return false;
      if (!q) return true;
      return [preference.type, preference.value, preference.severity ?? "", preference.notes ?? ""].some((value) =>
        value.toLowerCase().includes(q),
      );
    });
  }, [preferences, preferenceSearch, preferenceTypeFilter]);

  return (
    <div className="wai-view">
      <div className="wai-page-intro">
        <p className="wai-section-kicker">Household</p>
        <h2>Member management and food preferences in searchable tables with modal-based edits.</h2>
        <p>Select a member, review the roster, and manage allergies or food preferences without oversized cards getting in the way.</p>
      </div>

      <section className="wai-panel">
          <div className="wai-panel-head">
            <div>
              <h3>Family members</h3>
              <p>{filteredMembers.length} members shown</p>
            </div>
            <div className="wai-inline-actions" style={{ flexWrap: "wrap", justifyContent: "flex-end" }}>
              <input className="wai-inline-input" value={memberSearch} onChange={(event) => setMemberSearch(event.target.value)} placeholder="Search members" />
              <button className="wai-primary-button" type="button" onClick={() => setAddMemberModalOpen(true)}>Add family member</button>
            </div>
          </div>
          <div className="wai-data-table-wrap">
            <table className="wai-data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Date of birth</th>
                  <th>Food preferences</th>
                </tr>
              </thead>
              <tbody>
                {filteredMembers.map((member) => (
                  <tr
                    key={member.id}
                    className={`is-clickable${resolvedSelectedMemberId === member.id ? " is-active" : ""}`}
                    onClick={() => setSelectedMemberId(member.id)}
                  >
                    <td><div className="wai-table-primary">{member.name}</div></td>
                    <td>{member.role}</td>
                    <td>{formatDob(member.dateOfBirth)}</td>
                    <td>
                      <button
                        className="wai-secondary-button"
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelectedMemberId(member.id);
                          setPreferencesModalOpen(true);
                        }}
                        style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
                      >
                        <span
                          className="wai-ghost-action-icon"
                          style={{ width: 14, height: 14, display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "0 0 auto" }}
                        >
                          <SparklesIcon />
                        </span>
                        Food preferences
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {selectedMember ? (
            <div className="wai-inline-actions" style={{ marginTop: 14 }}>
              <button className="wai-secondary-button" type="button" onClick={() => setEditMemberModalOpen(true)}>Edit selected member</button>
            </div>
          ) : null}
        </section>

      {addMemberModalOpen ? (
        <div className="wai-modal-overlay" role="dialog" aria-modal="true" aria-label="Add family member" onMouseDown={(e) => { if (e.target === e.currentTarget) setAddMemberModalOpen(false); }}>
          <div className="wai-modal">
            <div className="wai-modal-head">
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <span className="wai-icon-pill" aria-hidden="true"><FamilyIcon /></span>
                <div>
                  <h3 style={{ margin: 0, fontSize: 18, letterSpacing: "-0.02em" }}>Add family member</h3>
                  <p style={{ margin: 0, color: "var(--wai-text-soft)", fontWeight: 650 }}>Add a caregiver or child profile</p>
                </div>
              </div>
              <button className="wai-modal-close" type="button" onClick={() => setAddMemberModalOpen(false)} aria-label="Close">✕</button>
            </div>
            <form className="wai-modal-body" onSubmit={addMember}>
              <label>
                Name
                <input value={memberName} onChange={(event) => setMemberName(event.target.value)} placeholder="Yusuf" autoFocus />
              </label>
              <label>
                Date of birth
                <DatePicker value={memberDob} onChange={setMemberDob} placeholder="Select date of birth" max={todayIso} />
              </label>
              <div className="wai-choice-row">
                {(["male", "female", "other"] as const).map((gender) => (
                  <button key={gender} type="button" className={memberGender === gender ? "wai-chip wai-chip-active" : "wai-chip"} onClick={() => setMemberGender(gender)}>
                    {gender}
                  </button>
                ))}
              </div>
              <div className="wai-modal-actions">
                <button className="wai-secondary-button" type="button" onClick={() => setAddMemberModalOpen(false)}>Cancel</button>
                <button className="wai-primary-button" type="submit" disabled={!memberName.trim() || !memberDob.trim()}>Add member</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {editMemberModalOpen && selectedMember ? (
        <MemberEditorModal member={selectedMember} onClose={() => setEditMemberModalOpen(false)} onSave={updateMember} onDelete={deleteMember} />
      ) : null}

      {preferencesModalOpen && selectedMember ? (
        <div className="wai-modal-overlay" role="dialog" aria-modal="true" aria-label="Food preferences" onMouseDown={(e) => { if (e.target === e.currentTarget) setPreferencesModalOpen(false); }}>
          <div className="wai-modal wai-modal-wide">
            <div className="wai-modal-head">
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <span className="wai-icon-pill" aria-hidden="true"><SparklesIcon /></span>
                <div>
                  <h3 style={{ margin: 0, fontSize: 18, letterSpacing: "-0.02em" }}>Food preferences</h3>
                  <p style={{ margin: 0, color: "var(--wai-text-soft)", fontWeight: 650 }}>{selectedMember.name}</p>
                </div>
              </div>
              <button className="wai-modal-close" type="button" onClick={() => setPreferencesModalOpen(false)} aria-label="Close">✕</button>
            </div>
            <div className="wai-modal-body">
              <div className="wai-panel-head" style={{ padding: 0 }}>
                <div className="wai-inline-actions" style={{ flexWrap: "wrap", width: "100%", justifyContent: "space-between" }}>
                  <div className="wai-inline-actions" style={{ flexWrap: "wrap" }}>
                    <input className="wai-inline-input" value={preferenceSearch} onChange={(event) => setPreferenceSearch(event.target.value)} placeholder="Search preferences" />
                    <select value={preferenceTypeFilter} onChange={(event) => setPreferenceTypeFilter(event.target.value)}>
                      <option value="">All types</option>
                      <option value="allergy">Allergy</option>
                      <option value="dislike">Dislike</option>
                      <option value="like">Like</option>
                      <option value="diet">Diet</option>
                    </select>
                  </div>
                  <button
                    className="wai-primary-button"
                    type="button"
                    onClick={() => {
                      setPreferenceType("allergy");
                      setPreferenceValue("");
                      setPreferenceSeverity("strong");
                      setAddPreferenceModalOpen((open) => !open);
                    }}
                  >
                    {addPreferenceModalOpen ? "Hide form" : "Add preference"}
                  </button>
                </div>
              </div>
              {addPreferenceModalOpen ? (
                <form
                  className="wai-empty"
                  style={{ marginBottom: 18, display: "grid", gap: 14 }}
                  onSubmit={(event) => {
                    void addPreference(event);
                  }}
                >
                  <div>
                    <div className="wai-table-primary" style={{ marginBottom: 8 }}>Add a new preference</div>
                    <div className="wai-table-secondary">Save an allergy, dislike, like, or diet note for {selectedMember.name}.</div>
                  </div>
                  <div className="wai-choice-row">
                    {(["allergy", "dislike", "like", "diet"] as const).map((type) => (
                      <button key={type} type="button" className={preferenceType === type ? "wai-chip wai-chip-active" : "wai-chip"} onClick={() => setPreferenceType(type)}>
                        {type}
                      </button>
                    ))}
                  </div>
                  <label>
                    Preference
                    <input value={preferenceValue} onChange={(event) => setPreferenceValue(event.target.value)} placeholder="Peanuts" autoFocus />
                  </label>
                  {preferenceType === "allergy" || preferenceType === "dislike" ? (
                    <div className="wai-choice-row">
                      {(["critical", "strong", "mild"] as const).map((severity) => (
                        <button key={severity} type="button" className={preferenceSeverity === severity ? "wai-chip wai-chip-active" : "wai-chip"} onClick={() => setPreferenceSeverity(severity)}>
                          {severity}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <div className="wai-modal-actions" style={{ paddingTop: 0 }}>
                    <button className="wai-secondary-button" type="button" onClick={() => setAddPreferenceModalOpen(false)}>Cancel</button>
                    <button className="wai-primary-button" type="submit" disabled={!preferenceValue.trim()}>Save preference</button>
                  </div>
                </form>
              ) : null}
              <div className="wai-data-table-wrap">
                <table className="wai-data-table">
                  <thead>
                    <tr>
                      <th>Type</th>
                      <th>Value</th>
                      <th>Severity</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPreferences.length === 0 ? (
                      <tr>
                        <td colSpan={4}><div className="wai-empty">No preferences saved yet.</div></td>
                      </tr>
                    ) : null}
                    {filteredPreferences.map((preference) => (
                      <tr key={preference.id}>
                        <td>{preference.type}</td>
                        <td>{preference.value}</td>
                        <td>{preference.severity ?? "—"}</td>
                        <td>
                          <button className="wai-danger-button" type="button" onClick={() => void deletePreference(preference.id)}>Delete</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MemberEditorModal({
  member,
  onClose,
  onSave,
  onDelete,
}: {
  member: HouseholdMe["members"][number];
  onClose: () => void;
  onSave: (values: { name: string; gender: "male" | "female" | "other"; dateOfBirth: string }) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [name, setName] = useState(member.name);
  const [dateOfBirth, setDateOfBirth] = useState(normalizeDateValue(member.dateOfBirth));
  const [gender, setGender] = useState<"male" | "female" | "other">(
    member.gender === "male" || member.gender === "female" || member.gender === "other" ? member.gender : "female",
  );

  return (
    <div className="wai-modal-overlay" role="dialog" aria-modal="true" aria-label="Edit family member" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="wai-modal">
        <div className="wai-modal-head">
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <span className="wai-icon-pill" aria-hidden="true"><FamilyIcon /></span>
            <div>
              <h3 style={{ margin: 0, fontSize: 18, letterSpacing: "-0.02em" }}>Edit family member</h3>
              <p style={{ margin: 0, color: "var(--wai-text-soft)", fontWeight: 650 }}>{member.name}</p>
            </div>
          </div>
          <button className="wai-modal-close" type="button" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <form className="wai-modal-body" onSubmit={(event) => { event.preventDefault(); void onSave({ name, gender, dateOfBirth }); }}>
          <label>
            Name
            <input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label>
            Date of birth
            <DatePicker value={dateOfBirth} onChange={setDateOfBirth} placeholder="Select date of birth" max={todayIso} />
          </label>
          <div className="wai-choice-row">
            {(["male", "female", "other"] as const).map((value) => (
              <button key={value} type="button" className={gender === value ? "wai-chip wai-chip-active" : "wai-chip"} onClick={() => setGender(value)}>
                {value}
              </button>
            ))}
          </div>
          <div className="wai-modal-actions">
            <button className="wai-danger-button" type="button" onClick={() => void onDelete()}>Delete member</button>
            <div className="wai-inline-actions">
              <button className="wai-secondary-button" type="button" onClick={onClose}>Cancel</button>
              <button className="wai-primary-button" type="submit">Save changes</button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
