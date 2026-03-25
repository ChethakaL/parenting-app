import { apiFetch } from "./client";

export type InventoryItem = {
  id: string;
  name: string;
  category: string | null;
  quantity: number | null;
  unit: string | null;
  brand: string | null;
  barcode: string | null;
  expiry_date: string | null;
  location: string | null;
  status: string;
  added_via: string | null;
  receipt_id: string | null;
  created_at: string | Date;
  updated_at: string | Date;
};

export async function getInventory(token: string) {
  const res = await apiFetch<{ items: InventoryItem[] }>({
    path: "/inventory",
    method: "GET",
    token,
  });
  return res;
}

export async function addInventoryItems(args: {
  token: string;
  items: Array<{
    name: string;
    category?: string | null;
    quantity?: number | null;
    unit?: string | null;
    brand?: string | null;
    barcode?: string | null;
    expiryDate?: string | null;
    location?: string | null;
  }>;
}) {
  return apiFetch<{ items: InventoryItem[] }>({
    path: "/inventory",
    method: "POST",
    token: args.token,
    body: { items: args.items },
  });
}

export async function updateInventoryItem(args: {
  token: string;
  id: string;
  patch: {
    name?: string;
    category?: string | null;
    quantity?: number | null;
    unit?: string | null;
    brand?: string | null;
    barcode?: string | null;
    expiryDate?: string | null;
    location?: string | null;
    status?: "in_stock" | "low" | "finished";
  };
}) {
  return apiFetch<{ ok: true }>({
    path: `/inventory/${args.id}`,
    method: "PUT",
    token: args.token,
    body: args.patch,
  });
}

export async function deleteInventoryItem(args: { token: string; id: string }) {
  return apiFetch<{ ok: true }>({
    path: `/inventory/${args.id}`,
    method: "DELETE",
    token: args.token,
  });
}

export async function finishInventoryItem(args: { token: string; id: string }) {
  return apiFetch<{ ok: true; groceryItem: unknown }>({
    path: `/inventory/${args.id}/finish`,
    method: "POST",
    token: args.token,
  });
}

