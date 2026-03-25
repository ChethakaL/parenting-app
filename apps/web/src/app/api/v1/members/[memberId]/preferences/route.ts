import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withDbUser } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

const TypeSchema = z.enum(["allergy", "dislike", "like", "diet"]);
const SeveritySchema = z.enum(["critical", "strong", "mild"]);

const PreferenceCreateSchema = z.object({
  type: TypeSchema,
  value: z.string().min(1).max(80),
  severity: SeveritySchema.optional(),
  source: z.enum(["manual", "ai_learned", "imported"]).optional().default("manual"),
  aiConfidence: z.number().min(0).max(1).optional(),
  notes: z.string().max(2000).optional().nullable(),
});

export async function GET(req: NextRequest, { params }: { params: Promise<{ memberId: string }> }) {
  const auth = await requireAuth(req);
  const { memberId } = await params;

  return withDbUser(auth.userId, async (client) => {
    const res = await client.query<{
      id: string;
      type: string;
      value: string;
      severity: string | null;
      source: string;
      ai_confidence: number | null;
      notes: string | null;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT
        id,
        type,
        value,
        severity,
        source,
        ai_confidence,
        notes,
        created_at,
        updated_at
       FROM public.member_preferences
       WHERE member_id = $1
       ORDER BY created_at ASC`,
      [memberId],
    );

    return NextResponse.json({ preferences: res.rows });
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ memberId: string }> }) {
  const auth = await requireAuth(req);
  const { memberId } = await params;
  const json = await req.json().catch(() => null);
  const parsed = PreferenceCreateSchema.safeParse(json);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid preference payload." }, { status: 400 });
  }

  const { type, value, severity, source, aiConfidence, notes } = parsed.data;

  if ((type === "allergy" || type === "dislike") && !severity) {
    return NextResponse.json({ error: "severity is required for allergy/dislike." }, { status: 400 });
  }

  if ((type === "allergy" || type === "dislike") && severity === "critical") {
    return NextResponse.json({ error: "severity=critical is not allowed." }, { status: 400 });
  }

  return withDbUser(auth.userId, async (client) => {
    const prefRes = await client.query<{
      id: string;
      type: string;
      value: string;
      severity: string | null;
      source: string;
      ai_confidence: number | null;
      notes: string | null;
      created_at: Date;
      updated_at: Date;
    }>(
      `INSERT INTO public.member_preferences
        (member_id, type, value, severity, source, ai_confidence, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, type, value, severity, source, ai_confidence, notes, created_at, updated_at`,
      [memberId, type, value, severity ?? null, source, aiConfidence ?? null, notes ?? null],
    );

    return NextResponse.json({ preference: prefRes.rows[0] });
  });
}
