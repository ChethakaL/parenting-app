import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "crypto";
import { withDbLoginEmail, withDbUser } from "@/lib/db";
import { hashPassword, issueBearerToken, verifyPassword } from "@/lib/security";

const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  displayName: z.string().min(1).max(80).optional(),
});

export async function POST(req: NextRequest) {
  const json = await req.json().catch(() => null);
  const parsed = RegisterSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid register payload." }, { status: 400 });
  }

  const { email, password, displayName } = parsed.data;

  try {
    // If this email already exists, treat register as "idempotent sign-in".
    const existing = await withDbLoginEmail(email, async (client) => {
      const res = await client.query<{ id: string; password_hash: string }>(
        "SELECT id, password_hash FROM public.users WHERE email = $1 LIMIT 1",
        [email],
      );
      return res.rowCount === 1 ? res.rows[0] : null;
    });

    if (existing) {
      const matches = await verifyPassword(password, existing.password_hash);
      if (!matches) {
        return NextResponse.json({ error: "Register failed (email already exists)." }, { status: 401 });
      }

      const onboarded = await withDbUser(existing.id, async (client) => {
        const profileRes = await client.query<{ onboarded: boolean }>(
          "SELECT onboarded FROM public.profiles WHERE id = $1",
          [existing.id],
        );
        return profileRes.rows[0]?.onboarded ?? false;
      });

      const token = await issueBearerToken(existing.id);
      return NextResponse.json({ token, onboarded });
    }

    const userId = randomUUID();
    const passwordHash = await hashPassword(password);

    await withDbUser(userId, async (client) => {
      await client.query(
        "INSERT INTO public.users (id, email, password_hash) VALUES ($1, $2, $3)",
        [userId, email, passwordHash],
      );

      await client.query(
        "INSERT INTO public.profiles (id, display_name, onboarded) VALUES ($1, $2, FALSE)",
        [userId, displayName ?? null],
      );
    });

    const token = await issueBearerToken(userId);
    return NextResponse.json({ token, onboarded: false });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `Register failed: ${message}` }, { status: 500 });
  }
}

