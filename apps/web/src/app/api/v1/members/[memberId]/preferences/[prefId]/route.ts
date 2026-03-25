import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withDbUser } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

const TypeSchema = z.enum(["allergy", "dislike", "like", "diet"]);
const SeveritySchema = z.enum(["critical", "strong", "mild"]);

const PreferenceUpdateSchema = z.object({
  type: TypeSchema,
  value: z.string().min(1).max(80),
  severity: SeveritySchema.optional(),
  source: z.enum(["manual", "ai_learned", "imported"]).optional().default("manual"),
  aiConfidence: z.number().min(0).max(1).optional(),
  notes: z.string().max(2000).optional().nullable(),
});

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ memberId: string; prefId: string }> },
) {
  const auth = await requireAuth(req);
  const { memberId, prefId } = await params;
  const json = await req.json().catch(() => null);
  const parsed = PreferenceUpdateSchema.safeParse(json);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid preference update payload." }, { status: 400 });
  }

  const { type, value, severity, source, aiConfidence, notes } = parsed.data;

  if ((type === "allergy" || type === "dislike") && !severity) {
    return NextResponse.json({ error: "severity is required for allergy/dislike." }, { status: 400 });
  }

  if ((type === "allergy" || type === "dislike") && severity === "critical") {
    return NextResponse.json({ error: "severity=critical is not allowed." }, { status: 400 });
  }

  return withDbUser(auth.userId, async (client) => {
    const updateRes = await client.query<{
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
      `UPDATE public.member_preferences
         SET type = $1,
             value = $2,
             severity = $3,
             source = $4,
             ai_confidence = $5,
             notes = $6
       WHERE id = $7
         AND member_id = $8
       RETURNING id, type, value, severity, source, ai_confidence, notes, created_at, updated_at`,
      [type, value, severity ?? null, source, aiConfidence ?? null, notes ?? null, prefId, memberId],
    );

    if (updateRes.rowCount !== 1) {
      return NextResponse.json({ error: "Preference not found." }, { status: 404 });
    }

    return NextResponse.json({ preference: updateRes.rows[0] });
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ memberId: string; prefId: string }> },
) {
  const auth = await requireAuth(req);
  const { memberId, prefId } = await params;

  return withDbUser(auth.userId, async (client) => {
    const res = await client.query(
      "DELETE FROM public.member_preferences WHERE id = $1 AND member_id = $2",
      [prefId, memberId],
    );

    if (res.rowCount !== 1) {
      return NextResponse.json({ error: "Preference not found." }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  });
}
