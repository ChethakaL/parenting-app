"use client";

import Image from "next/image";
import Link from "next/link";
import { Dispatch, FormEvent, ReactNode, SetStateAction, useCallback, useEffect, useMemo, useState } from "react";
import { apiRequest } from "./api";
import { DatePicker } from "./date-picker";
import { navItems, SparklesIcon } from "./icons";
import { AppTab, AuthResponse, GroceryGrouped, HouseholdMe, InventoryItem, WorkspaceOverview } from "./types";

export type WorkspaceShellContext = {
  token: string;
  household: HouseholdMe;
  overview: WorkspaceOverview;
  loadingSummary: boolean;
  refreshSummary: () => Promise<void>;
  setError: Dispatch<SetStateAction<string | null>>;
  setNotice: Dispatch<SetStateAction<string | null>>;
};

type WorkspaceShellProps = {
  activeTab: AppTab;
  children: (context: WorkspaceShellContext) => ReactNode;
};

const todayIso = new Date().toISOString().slice(0, 10);

export function WorkspaceShell({ activeTab, children }: WorkspaceShellProps) {
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [booting, setBooting] = useState(true);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [onboarded, setOnboarded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");

  const [householdName, setHouseholdName] = useState("");
  const [memberName, setMemberName] = useState("");
  const [memberGender, setMemberGender] = useState<"male" | "female" | "other">("female");
  const [memberDob, setMemberDob] = useState("");
  const [allergies, setAllergies] = useState("");

  const [household, setHousehold] = useState<HouseholdMe | null>(null);
  const [overview, setOverview] = useState<WorkspaceOverview>({
    memberCount: 0,
    inStockCount: 0,
    lowStockCount: 0,
    urgentGroceryCount: 0,
    groceryCount: 0,
  });

  const refreshSummary = useCallback(async () => {
    if (!token) return;
    setLoadingSummary(true);
    setError(null);

    try {
      const [hh, inv, gro] = await Promise.all([
        apiRequest<HouseholdMe>({ path: "/households/me", method: "GET", token }),
        apiRequest<{ items: InventoryItem[] }>({ path: "/inventory", method: "GET", token }),
        apiRequest<GroceryGrouped>({ path: "/grocery", method: "GET", token }),
      ]);

      const inventoryItems = inv.items;
      setHousehold(hh);
      setOnboarded(hh.onboarded);
      setOverview({
        memberCount: hh.members.length,
        inStockCount: inventoryItems.filter((item) => item.status === "in_stock").length,
        lowStockCount: inventoryItems.filter((item) => item.status === "low").length,
        urgentGroceryCount: gro.urgent.length,
        groceryCount: gro.urgent.length + gro.normal.length + gro.whenAvailable.length,
      });
      window.localStorage.setItem("parent-ai-web-onboarded", String(hh.onboarded));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load workspace data.");
    } finally {
      setLoadingSummary(false);
    }
  }, [token]);

  useEffect(() => {
    const savedToken = window.localStorage.getItem("parent-ai-web-token");
    const savedOnboarded = window.localStorage.getItem("parent-ai-web-onboarded");
    if (savedToken) {
      setToken(savedToken);
      setOnboarded(savedOnboarded === "true");
    }
    setBooting(false);
  }, []);

  useEffect(() => {
    if (!token || !onboarded) return;
    void refreshSummary();
  }, [token, onboarded, refreshSummary]);

  useEffect(() => {
    if (!notice) return;
    const timeoutId = window.setTimeout(() => setNotice(null), 3200);
    return () => window.clearTimeout(timeoutId);
  }, [notice]);

  useEffect(() => {
    if (!error) return;
    const timeoutId = window.setTimeout(() => setError(null), 5200);
    return () => window.clearTimeout(timeoutId);
  }, [error, setError]);

  const shellContext = useMemo(() => {
    if (!token || !household) return null;
    return {
      token,
      household,
      overview,
      loadingSummary,
      refreshSummary,
      setError,
      setNotice,
    } satisfies WorkspaceShellContext;
  }, [token, household, overview, loadingSummary, refreshSummary]);

  async function handleAuthSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);

    try {
      const res = await apiRequest<AuthResponse>({
        path: authMode === "login" ? "/auth/login" : "/auth/register",
        method: "POST",
        body: authMode === "register"
          ? { email, password, displayName: displayName || undefined }
          : { email, password },
      });

      setToken(res.token);
      setOnboarded(res.onboarded);
      window.localStorage.setItem("parent-ai-web-token", res.token);
      window.localStorage.setItem("parent-ai-web-onboarded", String(res.onboarded));
      setNotice(authMode === "login" ? "Welcome back." : "Account created.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Authentication failed.");
    }
  }

  async function handleOnboardingSubmit(event: FormEvent) {
    event.preventDefault();
    if (!token) return;
    setError(null);
    setNotice(null);

    try {
      await apiRequest({
        path: "/auth/onboarding/household",
        method: "POST",
        token,
        body: {
          householdName,
          userMember: {
            name: memberName,
            gender: memberGender,
            dateOfBirth: memberDob,
          },
          allergies: allergies
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean)
            .map((value) => ({ value, severity: "strong" })),
          dislikes: [],
          likes: [],
          dietary: [],
        },
      });

      setOnboarded(true);
      window.localStorage.setItem("parent-ai-web-onboarded", "true");
      setNotice("Household setup complete.");
      await refreshSummary();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Onboarding failed.");
    }
  }

  function logout() {
    window.localStorage.removeItem("parent-ai-web-token");
    window.localStorage.removeItem("parent-ai-web-onboarded");
    setToken(null);
    setOnboarded(false);
    setHousehold(null);
    setOverview({
      memberCount: 0,
      inStockCount: 0,
      lowStockCount: 0,
      urgentGroceryCount: 0,
      groceryCount: 0,
    });
    setNotice(null);
    setError(null);
  }

  if (booting) {
    return <main className="wai-root"><section className="wai-boot">Loading Parent AI...</section></main>;
  }

  if (!token) {
    return (
      <main className="wai-root wai-auth-layout">
        <section className="wai-auth-visual">
          <div className="wai-eyebrow">
            <span className="wai-icon-pill"><SparklesIcon /></span>
            Parent AI
          </div>
          <h1>Assistant-first food management for real family life.</h1>
          <p>Sign in to manage inventory, groceries, meal plans, recipes, and family context from one web workspace.</p>
          <div className="wai-image-frame">
            <Image
              src="/illustrations/family-kitchen.svg"
              alt="Parent and child cooking together"
              fill
              sizes="(max-width: 960px) 100vw, 50vw"
            />
          </div>
        </section>

        <section className="wai-panel">
          <div className="wai-switch">
            <button type="button" className={authMode === "login" ? "is-active" : ""} onClick={() => setAuthMode("login")}>Login</button>
            <button type="button" className={authMode === "register" ? "is-active" : ""} onClick={() => setAuthMode("register")}>Register</button>
          </div>

          <form className="wai-form" onSubmit={handleAuthSubmit}>
            {authMode === "register" ? (
              <label>
                Display name
                <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Amina" />
              </label>
            ) : null}
            <label>
              Email
              <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" placeholder="parent@example.com" />
            </label>
            <label>
              Password
              <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" placeholder="At least 8 characters" />
            </label>
            {error ? <div className="wai-error">{error}</div> : null}
            {notice ? <div className="wai-notice">{notice}</div> : null}
            <button className="wai-primary-button" type="submit">{authMode === "login" ? "Open workspace" : "Create account"}</button>
          </form>
        </section>
      </main>
    );
  }

  if (!onboarded) {
    return (
      <main className="wai-root wai-onboarding-layout">
        <section className="wai-onboarding-copy">
          <p className="wai-section-kicker">Household setup</p>
          <h1>Put the household and first family member together on one setup page.</h1>
          <p>The assistant uses this information for safer meals, allergy awareness, smarter inventory decisions, and relevant grocery planning.</p>
        </section>

        <section className="wai-panel">
          <form className="wai-form" onSubmit={handleOnboardingSubmit}>
            <label>
              Household name
              <input value={householdName} onChange={(event) => setHouseholdName(event.target.value)} placeholder="The Rahman Family" />
            </label>
            <label>
              Primary caregiver name
              <input value={memberName} onChange={(event) => setMemberName(event.target.value)} placeholder="Amina" />
            </label>
            <label>
              Date of birth
              <DatePicker value={memberDob} onChange={setMemberDob} placeholder="Select date of birth" max={todayIso} />
            </label>
            <label>
              Allergies
              <input value={allergies} onChange={(event) => setAllergies(event.target.value)} placeholder="peanuts, dairy" />
            </label>
            <div className="wai-choice-row">
              {(["female", "male", "other"] as const).map((value) => (
                <button key={value} type="button" className={memberGender === value ? "wai-chip wai-chip-active" : "wai-chip"} onClick={() => setMemberGender(value)}>
                  {value}
                </button>
              ))}
            </div>
            {error ? <div className="wai-error">{error}</div> : null}
            {notice ? <div className="wai-notice">{notice}</div> : null}
            <button className="wai-primary-button" type="submit">Finish setup</button>
          </form>
        </section>
      </main>
    );
  }

  if (!shellContext) {
    return <main className="wai-root"><section className="wai-boot">Loading workspace...</section></main>;
  }

  const leadMember = shellContext.household.members[0];
  const sidebarTitle = shellContext.household.household.name ?? "Parent AI";
  const sidebarUserName = leadMember?.name ?? "Primary caregiver";
  const sidebarUserMeta = leadMember ? `${leadMember.role} profile` : "Household workspace";
  const sidebarInitial = sidebarUserName.charAt(0).toUpperCase();
  return (
    <main className="wai-root wai-root-app">
      <div className="wai-shell-frame">
        <div className="wai-toast-stack" aria-live="polite" aria-atomic="true">
          {error ? (
            <div className="wai-toast wai-toast-error" role="status">
              {error}
            </div>
          ) : null}
          {notice ? (
            <div className="wai-toast wai-toast-success" role="status">
              {notice}
            </div>
          ) : null}
        </div>

        <header className="wai-shell-header">
          <div className="wai-shell-header-bar">
            <div className="wai-shell-brand">
              <span className="wai-shell-brand-mark"><SparklesIcon /></span>
              <div className="wai-shell-brand-copy">
                <span className="wai-shell-kicker">Parent AI</span>
                <strong>{sidebarTitle}</strong>
              </div>
            </div>

            <nav className="wai-shell-nav" aria-label="Primary">
              {navItems.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.key}
                    href={item.href}
                    title={item.title}
                    className={item.key === activeTab ? "wai-nav-link is-active" : "wai-nav-link"}
                  >
                    <span className="wai-nav-icon"><Icon /></span>
                    {item.label}
                  </Link>
                );
              })}
            </nav>

            <div className="wai-shell-actions">
              <span className={loadingSummary ? "wai-shell-status is-syncing" : "wai-shell-status"}>
                {loadingSummary ? "Refreshing" : "Synced"}
              </span>
              <div className="wai-shell-user" aria-label={`Signed in as ${sidebarUserName}`}>
                <span className="wai-shell-avatar">{sidebarInitial}</span>
                <div className="wai-shell-user-copy">
                  <strong>{sidebarUserName}</strong>
                  <span>{sidebarUserMeta}</span>
                </div>
              </div>
              <button className="wai-shell-logout" type="button" onClick={logout}>Log out</button>
            </div>
          </div>

          <div className="wai-shell-subbar">
            <div className="wai-shell-intro">
              <p className="wai-shell-kicker">Household workspace</p>
              <span>{shellContext.household.members.length} profiles connected across inventory, grocery, planning, and assistant flows.</span>
            </div>

            <div className="wai-shell-meta-pills">
              <span className="wai-shell-meta-pill">{overview.memberCount} family members</span>
              <span className="wai-shell-meta-pill">{overview.inStockCount} items in stock</span>
              <span className="wai-shell-meta-pill">{overview.groceryCount} grocery items tracked</span>
            </div>
          </div>
        </header>

        <section className="wai-main wai-main-dashboard">
          {children(shellContext)}
        </section>
      </div>
    </main>
  );
}
