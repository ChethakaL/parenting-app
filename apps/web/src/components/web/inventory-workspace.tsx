"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { apiRequest } from "./api";
import { FilePicker } from "./file-picker";
import { PlusIcon, UploadIcon } from "./icons";
import { InventoryItem } from "./types";
import { WorkspaceShell } from "./workspace-shell";

const PAGE_SIZE = 8;

export function InventoryWorkspace() {
  return (
    <WorkspaceShell activeTab="inventory">
      {({ token, refreshSummary, setError, setNotice }) => (
        <InventoryWorkspaceContent token={token} refreshSummary={refreshSummary} setError={setError} setNotice={setNotice} />
      )}
    </WorkspaceShell>
  );
}

function InventoryWorkspaceContent({
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
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [inventoryName, setInventoryName] = useState("");
  const [inventoryQty, setInventoryQty] = useState("");
  const [inventoryUnit, setInventoryUnit] = useState("");
  const [inventoryLocation, setInventoryLocation] = useState("pantry");
  const [inventorySearch, setInventorySearch] = useState("");
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptBusy, setReceiptBusy] = useState(false);

  const [addInventoryModalOpen, setAddInventoryModalOpen] = useState(false);
  const [uploadReceiptModalOpen, setUploadReceiptModalOpen] = useState(false);

  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editItem, setEditItem] = useState<InventoryItem | null>(null);
  const [editName, setEditName] = useState("");
  const [editQty, setEditQty] = useState("");
  const [editUnit, setEditUnit] = useState("");
  const [editLocation, setEditLocation] = useState("pantry");
  const [pages, setPages] = useState({ inStock: 1, low: 1, finished: 1 });

  const loadInventory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiRequest<{ items: InventoryItem[] }>({ path: "/inventory", method: "GET", token });
      setInventory(response.items);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load inventory.");
    } finally {
      setLoading(false);
    }
  }, [token, setError]);

  useEffect(() => {
    void loadInventory();
  }, [loadInventory]);

  // Keep this page updated if the Assistant modifies inventory elsewhere.
  useEffect(() => {
    const onWorkspaceUpdated = () => {
      void loadInventory();
      void refreshSummary();
    };
    window.addEventListener("parentai:workspace-updated", onWorkspaceUpdated);
    return () => window.removeEventListener("parentai:workspace-updated", onWorkspaceUpdated);
  }, [loadInventory, refreshSummary]);

  const filteredInventory = useMemo(() => {
    const query = inventorySearch.trim().toLowerCase();
    return inventory.filter((item) => (query ? item.name.toLowerCase().includes(query) : true));
  }, [inventory, inventorySearch]);

  const inventoryBuckets = useMemo(
    () => ({
      inStock: filteredInventory.filter((item) => item.status === "in_stock"),
      low: filteredInventory.filter((item) => item.status === "low"),
      finished: filteredInventory.filter((item) => item.status === "finished"),
    }),
    [filteredInventory],
  );

  useEffect(() => {
    const max = {
      inStock: Math.max(1, Math.ceil(inventoryBuckets.inStock.length / PAGE_SIZE)),
      low: Math.max(1, Math.ceil(inventoryBuckets.low.length / PAGE_SIZE)),
      finished: Math.max(1, Math.ceil(inventoryBuckets.finished.length / PAGE_SIZE)),
    };
    setPages((prev) => ({
      inStock: Math.min(prev.inStock, max.inStock),
      low: Math.min(prev.low, max.low),
      finished: Math.min(prev.finished, max.finished),
    }));
  }, [inventoryBuckets]);

  async function addInventory(event: FormEvent) {
    event.preventDefault();
    if (!inventoryName.trim()) return;
    setError(null);
    setNotice(null);

    try {
      await apiRequest({
        path: "/inventory",
        method: "POST",
        token,
        body: {
          items: [
            {
              name: inventoryName.trim(),
              quantity: inventoryQty ? Number(inventoryQty) : null,
              unit: inventoryUnit || null,
              location: inventoryLocation,
            },
          ],
        },
      });

      setInventoryName("");
      setInventoryQty("");
      setInventoryUnit("");
      setInventoryLocation("pantry");
      setNotice("Inventory updated.");
      await Promise.all([loadInventory(), refreshSummary()]);
      setAddInventoryModalOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to add inventory item.");
    }
  }

  async function uploadReceipt(event: FormEvent) {
    event.preventDefault();
    if (!receiptFile) return;
    setReceiptBusy(true);
    setError(null);
    setNotice(null);

    try {
      const form = new FormData();
      form.append("image", receiptFile);
      const res = await apiRequest<{ itemsAdded: number }>({
        path: "/receipts",
        method: "POST",
        token,
        body: form,
        isFormData: true,
      });
      setReceiptFile(null);
      setNotice(`Receipt processed. ${res.itemsAdded} items added.`);
      await Promise.all([loadInventory(), refreshSummary()]);
      setUploadReceiptModalOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Receipt upload failed.");
    } finally {
      setReceiptBusy(false);
    }
  }

  async function finishInventory(id: string) {
    try {
      await apiRequest({ path: `/inventory/${id}/finish`, method: "POST", token });
      setNotice("Item marked finished and added to grocery.");
      await Promise.all([loadInventory(), refreshSummary()]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to finish inventory item.");
    }
  }

  async function deleteInventory(id: string) {
    try {
      await apiRequest({ path: `/inventory/${id}`, method: "DELETE", token });
      setNotice("Inventory item removed.");
      await Promise.all([loadInventory(), refreshSummary()]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to remove inventory item.");
    }
  }

  function openEditModal(item: InventoryItem) {
    setEditItem(item);
    setEditName(item.name);
    setEditQty(item.quantity !== null ? String(item.quantity) : "");
    setEditUnit(item.unit ?? "");
    setEditLocation(item.location ?? "pantry");
    setEditModalOpen(true);
  }

  function closeEditModal() {
    setEditModalOpen(false);
    setEditItem(null);
    setEditName("");
    setEditQty("");
    setEditUnit("");
    setEditLocation("pantry");
  }

  async function saveEditModal(event?: FormEvent) {
    event?.preventDefault();
    if (!editItem) return;

    const name = editName.trim();
    if (!name) return;

    const parsedQty = editQty.trim() ? Number(editQty) : null;
    const quantity = parsedQty !== null && Number.isNaN(parsedQty) ? null : parsedQty;
    const unit = editUnit.trim() ? editUnit.trim() : null;

    try {
      await apiRequest({
        path: `/inventory/${editItem.id}`,
        method: "PUT",
        token,
        body: {
          name,
          quantity,
          unit,
          location: editLocation,
        },
      });
      setNotice("Inventory updated.");
      closeEditModal();
      await Promise.all([loadInventory(), refreshSummary()]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to update inventory item.");
    }
  }

  return (
    <div className="wai-view">
      <div className="wai-page-intro">
        <p className="wai-section-kicker">Inventory</p>
        <h2>Receipt-first where possible, manual correction only when needed.</h2>
        <p>The assistant should be the main way to record what happened. This page is for verification, cleanup, and bulk intake from receipts.</p>
      </div>

      <div className="wai-two-column">
        <section className="wai-panel">
          <div className="wai-panel-head">
            <div>
              <h3>Upload receipt</h3>
              <p>Add multiple items fast</p>
            </div>
            <span className="wai-panel-icon"><UploadIcon /></span>
          </div>
          <button className="wai-primary-button" type="button" onClick={() => setUploadReceiptModalOpen(true)}>
            Upload receipt
          </button>
        </section>

        <section className="wai-panel">
          <div className="wai-panel-head">
            <div>
              <h3>Add inventory</h3>
              <p>Add one item manually</p>
            </div>
            <span className="wai-panel-icon"><PlusIcon /></span>
          </div>
          <button className="wai-secondary-button" type="button" onClick={() => setAddInventoryModalOpen(true)}>
            Add inventory
          </button>
        </section>
      </div>

      {uploadReceiptModalOpen ? (
        <div
          className="wai-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Upload receipt"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setUploadReceiptModalOpen(false);
          }}
        >
          <div className="wai-modal">
            <div className="wai-modal-head">
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <span className="wai-icon-pill" aria-hidden="true">
                  <UploadIcon />
                </span>
                <div>
                  <h3 style={{ margin: 0, fontSize: 18, letterSpacing: "-0.02em" }}>Upload receipt</h3>
                  <p style={{ margin: 0, color: "var(--wai-text-soft)", fontWeight: 650 }}>We will scan and add items to inventory</p>
                </div>
              </div>
              <button className="wai-modal-close" type="button" onClick={() => setUploadReceiptModalOpen(false)} aria-label="Close">
                ✕
              </button>
            </div>

            <form className="wai-modal-body" onSubmit={uploadReceipt}>
              <FilePicker
                label="Choose receipt image"
                accept="image/*"
                file={receiptFile}
                onChange={setReceiptFile}
                helper="PNG or JPG works best for receipt scanning."
              />
              <div className="wai-modal-actions">
                <button className="wai-secondary-button" type="button" onClick={() => setUploadReceiptModalOpen(false)}>
                  Cancel
                </button>
                <button className="wai-grocery-add-confirm" type="submit" disabled={receiptBusy || !receiptFile}>
                  {receiptBusy ? "Uploading..." : "Upload receipt"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {addInventoryModalOpen ? (
        <div
          className="wai-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Add inventory item"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setAddInventoryModalOpen(false);
          }}
        >
          <div className="wai-modal">
            <div className="wai-modal-head">
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <span className="wai-icon-pill" aria-hidden="true">
                  <PlusIcon />
                </span>
                <div>
                  <h3 style={{ margin: 0, fontSize: 18, letterSpacing: "-0.02em" }}>Add inventory</h3>
                  <p style={{ margin: 0, color: "var(--wai-text-soft)", fontWeight: 650 }}>Add one item manually</p>
                </div>
              </div>
              <button className="wai-modal-close" type="button" onClick={() => setAddInventoryModalOpen(false)} aria-label="Close">
                ✕
              </button>
            </div>

            <form className="wai-modal-body" onSubmit={addInventory}>
              <label>
                Name
                <input value={inventoryName} onChange={(event) => setInventoryName(event.target.value)} placeholder="Greek yogurt" autoFocus />
              </label>

              <div className="wai-grid-2">
                <label>
                  Quantity
                  <input value={inventoryQty} onChange={(event) => setInventoryQty(event.target.value)} placeholder="2" />
                </label>
                <label>
                  Unit
                  <input value={inventoryUnit} onChange={(event) => setInventoryUnit(event.target.value)} placeholder="tubs" />
                </label>
              </div>

              <label>
                Location
                <select value={inventoryLocation} onChange={(event) => setInventoryLocation(event.target.value)}>
                  <option value="pantry">Pantry</option>
                  <option value="fridge">Fridge</option>
                  <option value="freezer">Freezer</option>
                </select>
              </label>

              <div className="wai-modal-actions">
                <button className="wai-secondary-button" type="button" onClick={() => setAddInventoryModalOpen(false)}>
                  Cancel
                </button>
                <button className="wai-grocery-add-confirm" type="submit" disabled={!inventoryName.trim()}>
                  Add item
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {editModalOpen && editItem ? (
        <div
          className="wai-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Edit inventory item"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeEditModal();
          }}
        >
          <div className="wai-modal">
            <div className="wai-modal-head">
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <span className="wai-icon-pill" aria-hidden="true">
                  ✏️
                </span>
                <div>
                  <h3 style={{ margin: 0, fontSize: 18, letterSpacing: "-0.02em" }}>Edit inventory</h3>
                  <p style={{ margin: 0, color: "var(--wai-text-soft)", fontWeight: 650 }}>Update item details</p>
                </div>
              </div>
              <button className="wai-modal-close" type="button" onClick={closeEditModal} aria-label="Close">
                ✕
              </button>
            </div>

            <form className="wai-modal-body" onSubmit={(e) => void saveEditModal(e)}>
              <label>
                Name
                <input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Greek yogurt" autoFocus />
              </label>

              <div className="wai-grid-2">
                <label>
                  Quantity
                  <input value={editQty} onChange={(e) => setEditQty(e.target.value)} placeholder="2" />
                </label>
                <label>
                  Unit
                  <input value={editUnit} onChange={(e) => setEditUnit(e.target.value)} placeholder="tubs" />
                </label>
              </div>

              <label>
                Location
                <select value={editLocation} onChange={(e) => setEditLocation(e.target.value)}>
                  <option value="pantry">Pantry</option>
                  <option value="fridge">Fridge</option>
                  <option value="freezer">Freezer</option>
                </select>
              </label>

              <div className="wai-modal-actions">
                <button className="wai-secondary-button" type="button" onClick={closeEditModal}>
                  Cancel
                </button>
                <button className="wai-grocery-add-confirm" type="submit">
                  Save changes
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      <section className="wai-panel">
        <div className="wai-panel-head">
          <div>
            <h3>Inventory items</h3>
            <p>{loading ? "Loading current stock..." : "Review by stock state"}</p>
          </div>
          <input className="wai-inline-input" value={inventorySearch} onChange={(event) => setInventorySearch(event.target.value)} placeholder="Search inventory" />
        </div>

        <div className="wai-three-column">
          <InventoryColumn
            title="In stock"
            items={inventoryBuckets.inStock}
            tone="stock"
            onFinish={finishInventory}
            onEdit={openEditModal}
            onDelete={deleteInventory}
            page={pages.inStock}
            pageSize={PAGE_SIZE}
            onPageChange={(next) => setPages((prev) => ({ ...prev, inStock: next }))}
          />
          <InventoryColumn
            title="Low"
            items={inventoryBuckets.low}
            tone="low"
            onFinish={finishInventory}
            onEdit={openEditModal}
            onDelete={deleteInventory}
            page={pages.low}
            pageSize={PAGE_SIZE}
            onPageChange={(next) => setPages((prev) => ({ ...prev, low: next }))}
          />
          <InventoryColumn
            title="Finished"
            items={inventoryBuckets.finished}
            tone="finished"
            onFinish={finishInventory}
            onEdit={openEditModal}
            onDelete={deleteInventory}
            page={pages.finished}
            pageSize={PAGE_SIZE}
            onPageChange={(next) => setPages((prev) => ({ ...prev, finished: next }))}
          />
        </div>
      </section>
    </div>
  );
}

function InventoryColumn({
  title,
  items,
  tone,
  onFinish,
  onEdit,
  onDelete,
  page,
  pageSize,
  onPageChange,
}: {
  title: string;
  items: InventoryItem[];
  tone: "stock" | "low" | "finished";
  onFinish: (id: string) => Promise<void>;
  onEdit: (item: InventoryItem) => void;
  onDelete: (id: string) => Promise<void>;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}) {
  const formatQtyUnit = (quantity: number | null, unit: string | null) => {
    if (quantity === null && !unit) return "—";
    if (quantity !== null && unit) return `${quantity} ${unit}`;
    if (quantity !== null) return String(quantity);
    return unit ?? "—";
  };

  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(Math.max(page, 1), totalPages);
  const start = (safePage - 1) * pageSize;
  const visibleItems = items.slice(start, start + pageSize);

  return (
    <section className={`wai-column wai-column-${tone}`} style={{ minHeight: 340, maxHeight: 560, display: "flex", flexDirection: "column" }}>
      <div className="wai-column-head">
        <h3>{title}</h3>
        <span>{items.length}</span>
      </div>
      {items.length === 0 ? <div className="wai-empty">No items here.</div> : null}
      <div style={{ overflowY: "auto", paddingRight: 4 }}>
      {visibleItems.map((item) => (
        <article key={item.id} className="wai-list-card">
          <div>
            <strong>{item.name}</strong>
            <span>{formatQtyUnit(item.quantity, item.unit)} {item.location ? `• ${item.location}` : ""}</span>
          </div>
          <div className="wai-inline-actions">
            {item.status !== "finished" ? (
              <button className="wai-chip" type="button" onClick={() => void onFinish(item.id)}>Finish</button>
            ) : null}
            <button className="wai-chip" type="button" onClick={() => onEdit(item)}>Edit</button>
            <button className="wai-chip" type="button" onClick={() => void onDelete(item.id)}>Delete</button>
          </div>
        </article>
      ))}
      </div>
      {items.length > pageSize ? (
        <div style={{ marginTop: "auto", display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 8 }}>
          <button className="wai-chip" type="button" onClick={() => onPageChange(Math.max(1, safePage - 1))} disabled={safePage <= 1}>
            Prev
          </button>
          <span style={{ fontSize: 12, color: "var(--wai-text-soft)" }}>
            Page {safePage} / {totalPages}
          </span>
          <button className="wai-chip" type="button" onClick={() => onPageChange(Math.min(totalPages, safePage + 1))} disabled={safePage >= totalPages}>
            Next
          </button>
        </div>
      ) : null}
    </section>
  );
}
