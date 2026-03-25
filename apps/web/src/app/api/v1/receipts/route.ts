import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { withDbUser } from "@/lib/db";
import { uploadToS3, s3KeyFromReceiptImage } from "@/lib/s3";
import { callClaudeJson, callClaudeVisionJson, callClaudeVisionText } from "@/lib/anthropic";

type UploadedFile = {
  arrayBuffer: () => Promise<ArrayBuffer>;
  type: string;
  name?: string;
};

function isUploadedFile(v: unknown): v is UploadedFile {
  if (typeof v !== "object" || v === null) return false;
  const obj = v as { arrayBuffer?: unknown; type?: unknown; name?: unknown };
  return typeof obj.arrayBuffer === "function" && typeof obj.type === "string";
}

type ParsedReceiptItem = {
  name: string;
  quantity: number;
  unit: string;
  category: string;
  brand?: string | null;
};

function deriveInventoryStatus(quantity: number | null | undefined): "in_stock" | "low" | "finished" {
  if (quantity === null || quantity === undefined || quantity <= 0) return "finished";
  if (quantity <= 1) return "low";
  return "in_stock";
}

function normalizeParsedReceiptItems(parsed: unknown): ParsedReceiptItem[] {
  const source =
    Array.isArray(parsed)
      ? parsed
      : typeof parsed === "object" && parsed !== null
        ? ((Array.isArray((parsed as { items?: unknown }).items)
            ? (parsed as { items: unknown[] }).items
            : Array.isArray((parsed as { line_items?: unknown }).line_items)
              ? (parsed as { line_items: unknown[] }).line_items
              : Array.isArray((parsed as { products?: unknown }).products)
                ? (parsed as { products: unknown[] }).products
                : []) ?? [])
        : [];

  const out: ParsedReceiptItem[] = [];
  for (const raw of source) {
    if (typeof raw !== "object" || raw === null) continue;
    const obj = raw as Record<string, unknown>;
    const name = typeof obj.name === "string" ? obj.name.trim() : "";
    if (!name) continue;
    const quantityRaw = obj.quantity;
    const quantity =
      typeof quantityRaw === "number"
        ? quantityRaw
        : typeof quantityRaw === "string"
          ? Number(quantityRaw.replace(/[^\d.]/g, ""))
          : 1;
    const unit = typeof obj.unit === "string" && obj.unit.trim() ? obj.unit.trim() : "units";
    const category = typeof obj.category === "string" && obj.category.trim() ? obj.category.trim() : "other";
    const brand = typeof obj.brand === "string" && obj.brand.trim() ? obj.brand.trim() : null;
    if (!Number.isFinite(quantity) || quantity <= 0) continue;
    out.push({ name, quantity, unit, category, brand });
  }
  return out;
}

const receiptParsingSystemPrompt = `You are parsing a grocery receipt OCR result into structured inventory items.
Extract each line item. For each item return:
- name: clean product name (remove size/weight from name, put in unit field)
- quantity: numeric amount purchased
- unit: litres, kg, g, units, pack, bottle, can, box
- category: one of: dairy, produce, meat, bakery, pantry, frozen, baby, cleaning, personal_care, other
- brand: if identifiable
Return a JSON array only. No explanation.`;

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  const form = await req.formData();

  const imageField = form.get("image");
  if (!isUploadedFile(imageField)) {
    return NextResponse.json({ error: "Missing `image` file in multipart form." }, { status: 400 });
  }

  const receiptId = crypto.randomUUID();

  // Resolve household id (RLS-backed) quickly, then process outside DB transactions.
  const householdId = await withDbUser(auth.userId, async (client) => {
    const hh = await client.query<{ id: string }>(
      "SELECT id FROM public.households WHERE owner_id = $1 LIMIT 1",
      [auth.userId],
    );
    if (hh.rowCount !== 1) {
      throw new Error("Household not found. Complete onboarding first.");
    }
    return hh.rows[0].id;
  });

  const key = s3KeyFromReceiptImage(householdId, receiptId);
  const arrayBuffer = await imageField.arrayBuffer();
  const body = Buffer.from(arrayBuffer);
  console.info("[receipts] upload:start", {
    receiptId,
    householdId,
    userId: auth.userId,
    bytes: body.length,
    mime: imageField.type || "image/jpeg",
    fileName: imageField.name ?? "unknown",
  });
  if (body.length > 5 * 1024 * 1024) {
    console.warn("[receipts] upload:too_large", { receiptId, bytes: body.length });
    return NextResponse.json(
      { error: "Receipt image is too large for AI vision. Please upload an image below 5MB." },
      { status: 400 },
    );
  }

  await uploadToS3({
    key,
    contentType: imageField.type || "image/jpeg",
    body,
  });

  // Insert receipt record.
  await withDbUser(auth.userId, async (client) => {
    await client.query(
      `INSERT INTO public.receipts
        (id, household_id, image_url, processing_status, store_name, currency, created_at)
       VALUES ($1, $2, $3, 'processing', NULL, 'AED', NOW())`,
      [receiptId, householdId, key],
    );
  });

  // Parse receipt into structured inventory items with Claude Vision.
  const imageBase64 = body.toString("base64");
  let parsedItems: ParsedReceiptItem[] = [];
  try {
    try {
      const { parsed } = await callClaudeVisionJson<unknown>({
        model: "claude-sonnet-4-6",
        system: receiptParsingSystemPrompt,
        userText: "Parse this grocery receipt image and return the line items JSON array.",
        imageBase64,
        imageMediaType: imageField.type || "image/jpeg",
        temperature: 0.2,
        maxTokens: 2800,
      });
      parsedItems = normalizeParsedReceiptItems(parsed);
      console.info("[receipts] parse:stage1", { receiptId, parsedCount: parsedItems.length });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      console.warn("[receipts] parse:stage1_failed", { receiptId, message });
    }
    if (parsedItems.length === 0) {
      try {
        const retry = await callClaudeVisionJson<unknown>({
          model: "claude-sonnet-4-6",
          system: `Extract all grocery line items from this receipt image.
Return JSON only with one key:
{"items":[{"name":"...", "quantity": number, "unit":"g|kg|ml|l|units|pack|bottle|can|box", "category":"dairy|produce|meat|bakery|pantry|frozen|baby|cleaning|personal_care|other", "brand":string|null}]}`,
          userText: "Return all purchased item lines as JSON. Do not include totals or taxes.",
          imageBase64,
          imageMediaType: imageField.type || "image/jpeg",
          temperature: 0.1,
          maxTokens: 3200,
        });
        parsedItems = normalizeParsedReceiptItems(retry.parsed);
        console.info("[receipts] parse:stage2", { receiptId, parsedCount: parsedItems.length });
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown";
        console.warn("[receipts] parse:stage2_failed", { receiptId, message });
      }
    }
    if (parsedItems.length === 0) {
      try {
        const ocrText = await callClaudeVisionText({
          model: "claude-sonnet-4-6",
          system: "Read this receipt image and output only plain text lines exactly as they appear.",
          userText: "Extract readable line-item text from the receipt.",
          imageBase64,
          imageMediaType: imageField.type || "image/jpeg",
          temperature: 0,
          maxTokens: 2200,
        });
        console.info("[receipts] parse:stage3_ocr_text", { receiptId, textLength: ocrText.length });
        const normalized = await callClaudeJson<unknown>({
          model: "claude-sonnet-4-6",
          system: `Convert receipt OCR text into JSON.
Return JSON only:
{"items":[{"name":"...", "quantity": number, "unit":"g|kg|ml|l|units|pack|bottle|can|box", "category":"dairy|produce|meat|bakery|pantry|frozen|baby|cleaning|personal_care|other", "brand":string|null}]}`,
          userText: `OCR text:\n${ocrText}`,
          temperature: 0.1,
          maxTokens: 2000,
        });
        parsedItems = normalizeParsedReceiptItems(normalized.parsed);
        console.info("[receipts] parse:stage3", { receiptId, parsedCount: parsedItems.length });
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown";
        console.warn("[receipts] parse:stage3_failed", { receiptId, message });
      }
    }
  } catch {
    parsedItems = [];
  }

  // Persist OCR parsed items and update receipt status.
  await withDbUser(auth.userId, async (client) => {
    if (parsedItems.length === 0) {
      await client.query("UPDATE public.receipts SET processing_status = 'failed' WHERE id = $1", [receiptId]);
      console.warn("[receipts] persist:failed_no_items", { receiptId });
      return;
    }

    for (const item of parsedItems) {
      const qty = typeof item.quantity === "number" ? item.quantity : Number(item.quantity);
      const status = deriveInventoryStatus(qty);
      await client.query(
        `INSERT INTO public.inventory_items
          (household_id, name, category, quantity, unit, brand, added_via, receipt_id, location, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'receipt', $7, NULL, $8)`,
        [householdId, item.name, item.category, qty, item.unit, item.brand ?? null, receiptId, status],
      );
    }

    await client.query(
      `UPDATE public.receipts
         SET processing_status = 'done',
             ocr_parsed = $1::jsonb
       WHERE id = $2`,
      [JSON.stringify(parsedItems), receiptId],
    );
    console.info("[receipts] persist:done", { receiptId, itemsAdded: parsedItems.length });
  });

  return NextResponse.json({
    ok: true,
    receiptId,
    itemsAdded: parsedItems.length,
    processingStatus: parsedItems.length > 0 ? "done" : "failed",
  });
}

