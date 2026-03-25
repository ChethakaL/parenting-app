import { apiFetch } from "./client";

export type GroceryItem = {
  id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  category: string | null;
  priority: string;
  status: string;
  added_via: string | null;
  notes: string | null;
  created_at: string | Date;
};

export type GroceryGrouped = {
  urgent: GroceryItem[];
  normal: GroceryItem[];
  whenAvailable: GroceryItem[];
};

export async function getGrocery(token: string) {
  return apiFetch<GroceryGrouped>({
    path: "/grocery",
    method: "GET",
    token,
  });
}

export async function purchaseGroceryItem(args: { token: string; id: string }) {
  return apiFetch<{ ok: true; inventoryItemId: string }>({
    path: `/grocery/${args.id}/purchase`,
    method: "POST",
    token: args.token,
  });
}

export async function removeGroceryItem(args: { token: string; id: string; addBackToInventory?: boolean }) {
  return apiFetch<{ ok: true }>({
    path: `/grocery/${args.id}`,
    method: "DELETE",
    token: args.token,
    body: { addBackToInventory: args.addBackToInventory ?? false },
  });
}


