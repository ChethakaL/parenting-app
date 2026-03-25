import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { withDbUser } from "@/lib/db";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req);
  const { id } = await params;

  return withDbUser(auth.userId, async (client) => {
    const receiptRes = await client.query<{
      id: string;
      processing_status: string;
      created_at: Date;
      image_url: string;
      ocr_parsed: unknown;
    }>(
      `SELECT id, processing_status, created_at, image_url, ocr_parsed
       FROM public.receipts
       WHERE id = $1`,
      [id],
    );

    if (receiptRes.rowCount !== 1) {
      return NextResponse.json({ receipt: null }, { status: 404 });
    }

    const itemsRes = await client.query<{
      id: string;
      name: string;
      category: string | null;
      quantity: number | null;
      unit: string | null;
      brand: string | null;
      location: string | null;
      status: string;
    }>(
      `SELECT id, name, category, quantity, unit, brand, location, status
       FROM public.inventory_items
       WHERE receipt_id = $1
       ORDER BY created_at ASC`,
      [id],
    );

    const receipt = receiptRes.rows[0];
    return NextResponse.json({
      receipt: {
        id: receipt.id,
        processingStatus: receipt.processing_status,
        createdAt: receipt.created_at,
        imageUrl: receipt.image_url,
        ocrParsed: receipt.ocr_parsed,
      },
      items: itemsRes.rows,
    });
  });
}
