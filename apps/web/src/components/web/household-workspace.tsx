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
  const [preferenceType, setPreferenceType] = useState<"allergy" | "dislike" | "like" | "diet">("allergy");
  const [preferenceValue, setPreferenceValue] = useState("");
  const [preferenceSeverity, setPreferenceSeverity] = useState<"critical" | "strong" | "mild">("strong");
  const [addMemberModalOpen, setAddMemberModalOpen] = useState(false);
  const [addPreferenceModalOpen, setAddPreferenceModalOpen] = useState(false);

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

  function openAddMemberModal() {
    setAddMemberModalOpen(true);
    setNotice(null);
    setError(null);
  }

  function closeAddMemberModal() {
    setAddMemberModalOpen(false);
    setMemberName("");
    setMemberDob("");
    setMemberGender("female");
  }

  function openAddPreferenceModal() {
    setAddPreferenceModalOpen(true);
    setNotice(null);
    setError(null);
  }

  function closeAddPreferenceModal() {
    setAddPreferenceModalOpen(false);
    setPreferenceValue("");
    setPreferenceType("allergy");
    setPreferenceSeverity("strong");
  }

  return (
    <div className="wai-view">
      <div className="wai-page-intro">
        <p className="wai-section-kicker">Household</p>
        <h2>Family setup and ongoing member management together on one page.</h2>
        <p>Add members, update details, and manage allergies or food preferences without bouncing between disconnected forms.</p>
      </div>

      <div className="wai-two-column">
        <section className="wai-panel">
          <div className="wai-panel-head">
            <div>
              <h3>Add family member</h3>
              <p>Extend the household profile</p>
            </div>
            <span className="wai-panel-icon"><FamilyIcon /></span>
          </div>
          <button className="wai-primary-button" type="button" onClick={openAddMemberModal}>
            Add family member
          </button>
        </section>

        <section className="wai-panel">
          <div className="wai-panel-head">
            <div>
              <h3>Family roster</h3>
              <p>Select a member to edit</p>
            </div>
            <span className="wai-panel-icon"><SparklesIcon /></span>
          </div>
          <div className="wai-member-grid">
            {household.members.map((member) => (
              <button key={member.id} type="button" className={resolvedSelectedMemberId === member.id ? "wai-member-card is-active" : "wai-member-card"} onClick={() => setSelectedMemberId(member.id)}>
                <strong>{member.name}</strong>
                <span>{member.role} • {formatDob(member.dateOfBirth)}</span>
              </button>
            ))}
          </div>
        </section>
      </div>

      <div className="wai-two-column wai-household-lower">
        <section className="wai-panel">
          <div className="wai-panel-head">
            <div>
              <h3>Edit selected member</h3>
              <p>{selectedMember ? `Currently editing ${selectedMember.name}` : "Choose a member above"}</p>
            </div>
          </div>
          {selectedMember ? (
            <MemberEditor key={selectedMember.id} member={selectedMember} onSave={updateMember} onDelete={deleteMember} />
          ) : (
            <div className="wai-empty">Select a family member to edit profile details here.</div>
          )}
        </section>

        <section className="wai-panel">
          <div className="wai-panel-head">
            <div>
              <h3>Food preferences</h3>
              <p>{selectedMember ? `Preferences for ${selectedMember.name}` : "Select a family member first"}</p>
            </div>
          </div>
          {selectedMember ? (
            <>
              <button className="wai-secondary-button" type="button" onClick={openAddPreferenceModal}>
                Add preference
              </button>

              <div className="wai-preference-list">
                {preferences.length === 0 ? <div className="wai-empty">No preferences saved yet.</div> : null}
                {preferences.map((preference) => (
                  <article key={preference.id} className="wai-preference-card">
                    <div>
                      <strong>{preference.type} • {preference.value}</strong>
                      <span>{preference.severity ? `Severity: ${preference.severity}` : "No severity"}</span>
                    </div>
                    <button className="wai-danger-button" type="button" onClick={() => void deletePreference(preference.id)}>Delete</button>
                  </article>
                ))}
              </div>
            </>
          ) : (
            <div className="wai-empty">Select a family member to manage allergies and food preferences.</div>
          )}
        </section>
      </div>

      {addMemberModalOpen ? (
        <div
          className="wai-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Add family member"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeAddMemberModal();
          }}
        >
          <div className="wai-modal">
            <div className="wai-modal-head">
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <span className="wai-icon-pill" aria-hidden="true">
                  <FamilyIcon />
                </span>
                <div>
                  <h3 style={{ margin: 0, fontSize: 18, letterSpacing: "-0.02em" }}>Add family member</h3>
                  <p style={{ margin: 0, color: "var(--wai-text-soft)", fontWeight: 650 }}>Add a caregiver or child profile</p>
                </div>
              </div>
              <button className="wai-modal-close" type="button" onClick={closeAddMemberModal} aria-label="Close">
                ✕
              </button>
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
                <button className="wai-secondary-button" type="button" onClick={closeAddMemberModal}>
                  Cancel
                </button>
                <button className="wai-grocery-add-confirm" type="submit" disabled={!memberName.trim() || !memberDob.trim()}>
                  Add member
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {addPreferenceModalOpen && resolvedSelectedMemberId ? (
        <div
          className="wai-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Add food preference"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeAddPreferenceModal();
          }}
        >
          <div className="wai-modal">
            <div className="wai-modal-head">
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <span className="wai-icon-pill" aria-hidden="true">
                  <SparklesIcon />
                </span>
                <div>
                  <h3 style={{ margin: 0, fontSize: 18, letterSpacing: "-0.02em" }}>Add preference</h3>
                  <p style={{ margin: 0, color: "var(--wai-text-soft)", fontWeight: 650 }}>Update allergies or food preferences</p>
                </div>
              </div>
              <button className="wai-modal-close" type="button" onClick={closeAddPreferenceModal} aria-label="Close">
                ✕
              </button>
            </div>

            <form className="wai-modal-body" onSubmit={addPreference}>
              <div className="wai-choice-row">
                {(["allergy", "dislike", "like", "diet"] as const).map((type) => (
                  <button key={type} type="button" className={preferenceType === type ? "wai-chip wai-chip-active" : "wai-chip"} onClick={() => setPreferenceType(type)}>
                    {type}
                  </button>
                ))}
              </div>

              <label>
                Preference
                <input value={preferenceValue} onChange={(event) => setPreferenceValue(event.target.value)} placeholder="Peanuts" />
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

              <div className="wai-modal-actions">
                <button className="wai-secondary-button" type="button" onClick={closeAddPreferenceModal}>
                  Cancel
                </button>
                <button className="wai-grocery-add-confirm" type="submit" disabled={!preferenceValue.trim()}>
                  Add preference
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MemberEditor({
  member,
  onSave,
  onDelete,
}: {
  member: HouseholdMe["members"][number];
  onSave: (values: { name: string; gender: "male" | "female" | "other"; dateOfBirth: string }) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [name, setName] = useState(member.name);
  const [dateOfBirth, setDateOfBirth] = useState(normalizeDateValue(member.dateOfBirth));
  const [gender, setGender] = useState<"male" | "female" | "other">(
    member.gender === "male" || member.gender === "female" || member.gender === "other" ? member.gender : "female",
  );

  return (
    <form
      className="wai-form"
      onSubmit={(event) => {
        event.preventDefault();
        void onSave({ name, gender, dateOfBirth });
      }}
    >
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
      <div className="wai-inline-actions">
        <button className="wai-primary-button" type="submit">Save changes</button>
        <button className="wai-danger-button" type="button" onClick={() => void onDelete()}>Delete member</button>
      </div>
    </form>
  );
}
