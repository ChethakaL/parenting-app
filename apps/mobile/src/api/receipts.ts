import { API_BASE_URL, API_PREFIX } from "./config";

export async function uploadReceipt(args: {
  token: string;
  imageUri: string;
  mimeType?: string;
}) {
  const url = `${API_BASE_URL}${API_PREFIX}/receipts`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${args.token}`,
    },
    body: await (async () => {
      const blob = await (await fetch(args.imageUri)).blob();
      const fd = new FormData();
      fd.append("image", blob, "receipt.jpg");
      return fd;
    })(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Receipt upload failed (${res.status}): ${text || "no body"}`);
  }

  return (await res.json()) as { ok: true; receiptId: string; itemsAdded: number; processingStatus: string };
}

