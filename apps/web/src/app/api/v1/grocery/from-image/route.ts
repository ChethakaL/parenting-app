import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { withDbUser } from "@/lib/db";
import { callClaudeVisionJson } from "@/lib/anthropic";

type UploadedFile = {
  arrayBuffer: () => Promise<ArrayBuffer>;
  type: string;
};

function isUploadedFile(v: unknown): v is UploadedFile {
  if (typeof v !== "object" || v === null) return false;
  const obj = v as { arrayBuffer?: unknown; type?: unknown };
  return typeof obj.arrayBuffer === "function" && typeof obj.type === "string";
}

function parseItems(parsed: unknown): Array<{ name: string; quantity: number | null; unit: string | null }> {
  const root =
    Array.isArray(parsed)
      ? parsed
      : typeof parsed === "object" && parsed !== null
        ? ((parsed as { items?: unknown; grocery_items?: unknown; list?: unknown }).items ??
          (parsed as { grocery_items?: unknown }).grocery_items ??
          (parsed as { list?: unknown }).list)
        : null;
  if (!Array.isArray(root)) return [];
  const out: Array<{ name: string; quantity: number | null; unit: string | null }> = [];
  for (const r of root) {
    if (typeof r === "string") {
      const name = r.trim();
      if (name) out.push({ name, quantity: null, unit: null });
      continue;
    }
    if (typeof r !== "object" || r === null) continue;
    const obj = r as Record<string, unknown>;
    const name = typeof obj.name === "string" ? obj.name.trim() : "";
    if (!name) continue;
    const qRaw = obj.quantity;
    const q = typeof qRaw === "number" ? qRaw : typeof qRaw === "string" ? Number(qRaw.replace(/[^\d.]/g, "")) : null;
    out.push({
      name,
      quantity: Number.isFinite(q ?? NaN) ? q : null,
      unit: typeof obj.unit === "string" && obj.unit.trim() ? obj.unit.trim().toLowerCase() : null,
    });
  }
  return out;
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  const form = await req.formData();
  const imageField = form.get("image");
  if (!isUploadedFile(imageField)) {
    return NextResponse.json({ error: "Missing `image` file." }, { status: 400 });
  }

  const body = Buffer.from(await imageField.arrayBuffer());
  const imageBase64 = body.toString("base64");
  const parsed = await callClaudeVisionJson<unknown>({
    model: "claude-sonnet-4-6",
    system: `Extract grocery items from this image.
Return JSON only:
{
  "items":[{"name":"...", "quantity": number|null, "unit":"ml|l|g|kg|units|pack|bottle|null"}]
}`,
    userText: "Extract grocery items from this image.",
    imageBase64,
    imageMediaType: imageField.type || "image/jpeg",
    temperature: 0.1,
    maxTokens: 2000,
  });

  const items = parseItems(parsed.parsed);
  if (items.length === 0) {
    return NextResponse.json({ ok: true, itemsAdded: 0 });
  }

  const inserted = await withDbUser(auth.userId, async (client) => {
    const hh = await client.query<{ id: string }>("SELECT id FROM public.households WHERE owner_id = $1 LIMIT 1", [auth.userId]);
    if (hh.rowCount !== 1) throw new Error("Household not found.");
    const householdId = hh.rows[0].id;
    let count = 0;
    for (const item of items) {
      await client.query(
        `INSERT INTO public.grocery_list_items
          (household_id, name, quantity, unit, category, priority, status, added_via)
         VALUES ($1,$2,$3,$4,NULL,'normal','needed','ai')`,
        [householdId, item.name, item.quantity, item.unit],
      );
      count += 1;
    }
    return count;
  });

  return NextResponse.json({ ok: true, itemsAdded: inserted });
}

