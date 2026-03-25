"use client";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { apiRequest } from "./api";
import { CartIcon } from "./icons";
import { GroceryGrouped, GroceryItem } from "./types";
import { WorkspaceShell } from "./workspace-shell";

export function GroceryWorkspace() {
  return (
    <WorkspaceShell activeTab="grocery">
      {({ token, refreshSummary, setError, setNotice }) => (
        <GroceryWorkspaceContent token={token} refreshSummary={refreshSummary} setError={setError} setNotice={setNotice} />
      )}
    </WorkspaceShell>
  );
}

function GroceryWorkspaceContent({
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
  const [grocery, setGrocery] = useState<GroceryGrouped | null>(null);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [purchaseModalOpen, setPurchaseModalOpen] = useState(false);
  const [purchaseItem, setPurchaseItem] = useState<GroceryItem | null>(null);
  const [groceryName, setGroceryName] = useState("");
  const [groceryQty, setGroceryQty] = useState("");
  const [groceryUnit, setGroceryUnit] = useState("");
  const [groceryPriority, setGroceryPriority] = useState<"urgent" | "normal" | "when_available">("normal");
  const [purchaseQty, setPurchaseQty] = useState("");
  const [purchaseUnit, setPurchaseUnit] = useState("");

  const loadGrocery = useCallback(async () => {
    setError(null);
    try {
      const response = await apiRequest<GroceryGrouped>({ path: "/grocery", method: "GET", token });
      setGrocery(response);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load grocery list.");
    }
  }, [token, setError]);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        const response = await apiRequest<GroceryGrouped>({ path: "/grocery", method: "GET", token });
        if (!cancelled) {
          setGrocery(response);
        }
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Failed to load grocery list.");
        }
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [token, setError]);

  // If another workspace tab (like Assistant) updates the DB, refetch this page too.
  useEffect(() => {
    const onWorkspaceUpdated = () => {
      void loadGrocery();
      void refreshSummary();
    };
    window.addEventListener("parentai:workspace-updated", onWorkspaceUpdated);
    return () => window.removeEventListener("parentai:workspace-updated", onWorkspaceUpdated);
  }, [loadGrocery, refreshSummary]);

  function resetModalFields() {
    setGroceryName("");
    setGroceryQty("");
    setGroceryUnit("");
    setGroceryPriority("normal");
  }

  function openAddModal() {
    setAddModalOpen(true);
    setError(null);
    setNotice(null);
  }

  function closeAddModal() {
    setAddModalOpen(false);
    resetModalFields();
  }

  async function submitAddGrocery(event?: FormEvent) {
    event?.preventDefault();
    if (!groceryName.trim()) return;

    try {
      await apiRequest({
        path: "/grocery",
        method: "POST",
        token,
        body: {
          name: groceryName.trim(),
          quantity: groceryQty ? Number(groceryQty) : null,
          unit: groceryUnit || null,
          priority: groceryPriority,
        },
      });

      setNotice("Grocery item added.");
      closeAddModal();
      await Promise.all([loadGrocery(), refreshSummary()]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to add grocery item.");
    }
  }

  async function purchaseGrocery(item: GroceryItem, overrides?: { quantity: number | null; unit: string | null }) {
    try {
      await apiRequest({
        path: `/grocery/${item.id}/purchase`,
        method: "POST",
        token,
        body: overrides
          ? {
              quantity: overrides.quantity,
              unit: overrides.unit,
            }
          : undefined,
      });
      setNotice("Item marked purchased and moved into inventory.");
      await Promise.all([loadGrocery(), refreshSummary()]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to purchase grocery item.");
    }
  }

  function openPurchaseModal(item: GroceryItem) {
    setPurchaseItem(item);
    setPurchaseQty(item.quantity !== null ? String(item.quantity) : "");
    setPurchaseUnit(item.unit ?? "");
    setPurchaseModalOpen(true);
  }

  function closePurchaseModal() {
    setPurchaseModalOpen(false);
    setPurchaseItem(null);
    setPurchaseQty("");
    setPurchaseUnit("");
  }

  async function handleBoughtClick(item: GroceryItem) {
    const hasQuantity = item.quantity !== null;
    const hasUnit = typeof item.unit === "string" && item.unit.trim().length > 0;
    if (hasQuantity && hasUnit) {
      await purchaseGrocery(item);
      return;
    }
    openPurchaseModal(item);
  }

  async function submitPurchaseModal(event?: FormEvent) {
    event?.preventDefault();
    if (!purchaseItem) return;
    const rawQuantity = purchaseQty.trim();
    const parsedQuantity = rawQuantity ? Number(rawQuantity) : null;
    const quantityValue =
      parsedQuantity !== null && Number.isNaN(parsedQuantity) ? null : parsedQuantity;
    const unitValue = purchaseUnit.trim() ? purchaseUnit.trim() : null;
    await purchaseGrocery(purchaseItem, { quantity: quantityValue, unit: unitValue });
    closePurchaseModal();
  }

  async function removeGrocery(id: string) {
    try {
      await apiRequest({
        path: `/grocery/${id}`,
        method: "DELETE",
        token,
        body: { addBackToInventory: false, addedVia: "manual" },
      });
      setNotice("Grocery item removed.");
      await Promise.all([loadGrocery(), refreshSummary()]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to remove grocery item.");
    }
  }

  return (
    <div className="wai-view">
      <div className="wai-page-intro">
        <p className="wai-section-kicker">Grocery</p>
        <h2>Scan urgency fast, then mark what was actually bought.</h2>
        <p>Let the assistant create the list first. This page is for prioritizing, purchasing, and keeping the list clean.</p>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 12 }}>
        <button className="wai-grocery-add-button" type="button" onClick={openAddModal}>
          Add grocery
        </button>
      </div>

      <div className="wai-three-column">
        <GroceryColumn title="Urgent" items={grocery?.urgent ?? []} tone="urgent" onPurchase={handleBoughtClick} onRemove={removeGrocery} />
        <GroceryColumn title="This week" items={grocery?.normal ?? []} tone="normal" onPurchase={handleBoughtClick} onRemove={removeGrocery} />
        <GroceryColumn title="When available" items={grocery?.whenAvailable ?? []} tone="soft" onPurchase={handleBoughtClick} onRemove={removeGrocery} />
      </div>

      {addModalOpen ? (
        <div
          className="wai-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Add grocery item"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeAddModal();
          }}
        >
          <div className="wai-modal">
            <div className="wai-modal-head">
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <span className="wai-icon-pill" aria-hidden="true">
                  <CartIcon />
                </span>
                <div>
                  <h3 style={{ margin: 0, fontSize: 18, letterSpacing: "-0.02em" }}>Add grocery item</h3>
                  <p style={{ margin: 0, color: "var(--wai-text-soft)", fontWeight: 650 }}>Add one item to your grocery queue</p>
                </div>
              </div>
              <button className="wai-modal-close" type="button" onClick={closeAddModal} aria-label="Close">
                ✕
              </button>
            </div>

            <form className="wai-modal-body" onSubmit={(e) => void submitAddGrocery(e)}>
              <label>
                Item name
                <input
                  value={groceryName}
                  onChange={(event) => setGroceryName(event.target.value)}
                  placeholder="Milk"
                  autoFocus
                />
              </label>

              <div className="wai-grid-2">
                <label>
                  Quantity
                  <input value={groceryQty} onChange={(event) => setGroceryQty(event.target.value)} placeholder="2" />
                </label>
                <label>
                  Unit
                  <input value={groceryUnit} onChange={(event) => setGroceryUnit(event.target.value)} placeholder="bottles" />
                </label>
              </div>

              <div style={{ display: "grid", gap: 10 }}>
                <div style={{ fontWeight: 700, color: "var(--wai-text-soft)" }}>Priority</div>
                <div className="wai-choice-row" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
                  {(["urgent", "normal", "when_available"] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      className={groceryPriority === p ? "wai-chip wai-chip-active" : "wai-chip"}
                      onClick={() => setGroceryPriority(p)}
                    >
                      {p === "when_available" ? "When available" : p === "urgent" ? "Urgent" : "Normal"}
                    </button>
                  ))}
                </div>
              </div>

              <div className="wai-modal-actions">
                <button className="wai-secondary-button" type="button" onClick={closeAddModal}>
                  Cancel
                </button>
                <button className="wai-grocery-add-confirm" type="submit" disabled={!groceryName.trim()}>
                  Add to grocery
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {purchaseModalOpen && purchaseItem ? (
        <div
          className="wai-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Confirm purchased amount"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closePurchaseModal();
          }}
        >
          <div className="wai-modal">
            <div className="wai-modal-head">
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <span className="wai-icon-pill" aria-hidden="true">
                  <CartIcon />
                </span>
                <div>
                  <h3 style={{ margin: 0, fontSize: 18, letterSpacing: "-0.02em" }}>How much did you buy?</h3>
                  <p style={{ margin: 0, color: "var(--wai-text-soft)", fontWeight: 650 }}>{purchaseItem.name}</p>
                </div>
              </div>
              <button className="wai-modal-close" type="button" onClick={closePurchaseModal} aria-label="Close">
                ✕
              </button>
            </div>

            <form className="wai-modal-body" onSubmit={(e) => void submitPurchaseModal(e)}>
              <div className="wai-grid-2">
                <label>
                  Quantity
                  <input value={purchaseQty} onChange={(event) => setPurchaseQty(event.target.value)} placeholder="2" />
                </label>
                <label>
                  Unit
                  <input value={purchaseUnit} onChange={(event) => setPurchaseUnit(event.target.value)} placeholder="bottles" />
                </label>
              </div>

              <div className="wai-modal-actions">
                <button className="wai-secondary-button" type="button" onClick={closePurchaseModal}>
                  Cancel
                </button>
                <button className="wai-grocery-add-confirm" type="submit">
                  Save and mark bought
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function GroceryColumn({
  title,
  items,
  tone,
  onPurchase,
  onRemove,
}: {
  title: string;
  items: GroceryItem[];
  tone: "urgent" | "normal" | "soft";
  onPurchase: (item: GroceryItem) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}) {
  const formatQtyUnit = (quantity: number | null, unit: string | null) => {
    if (quantity === null && !unit) return "—";
    if (quantity !== null && unit) return `${quantity} ${unit}`;
    if (quantity !== null) return String(quantity);
    return unit ?? "—";
  };

  return (
    <section className={`wai-column wai-column-${tone}`}>
      <div className="wai-column-head">
        <h3>{title}</h3>
        <span>{items.length}</span>
      </div>
      {items.length === 0 ? <div className="wai-empty">No items here.</div> : null}
      {items.map((item) => (
        <article key={item.id} className="wai-list-card">
          <div>
            <strong>{item.name}</strong>
            <span>{formatQtyUnit(item.quantity, item.unit)}</span>
          </div>
          <div className="wai-inline-actions">
            <button className="wai-chip wai-grocery-chip-bought" type="button" onClick={() => void onPurchase(item)}>
              Bought
            </button>
            <button className="wai-chip wai-grocery-chip-remove" type="button" onClick={() => void onRemove(item.id)}>
              Remove
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}
