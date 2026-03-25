import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withDbLoginEmail } from "@/lib/db";
import { issueBearerToken, verifyPassword } from "@/lib/security";

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export async function POST(req: NextRequest) {
  const json = await req.json().catch(() => null);
  const parsed = LoginSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid email/password payload." }, { status: 400 });
  }

  const { email, password } = parsed.data;

  try {
    const result = await withDbLoginEmail(email, async (client) => {
      const userRes = await client.query<{
        id: string;
        password_hash: string;
      }>("SELECT id, password_hash FROM public.users WHERE email = $1", [email]);

      if (userRes.rowCount !== 1) {
        return { ok: false as const };
      }

      const user = userRes.rows[0];
      const matches = await verifyPassword(password, user.password_hash);
      if (!matches) {
        return { ok: false as const };
      }

      await client.query("SELECT set_config('app.user_id', $1, true)", [user.id]);

      const profileRes = await client.query<{
        onboarded: boolean;
      }>("SELECT onboarded FROM public.profiles WHERE id = $1", [user.id]);

      const onboarded = profileRes.rows[0]?.onboarded ?? false;
      const token = await issueBearerToken(user.id);

      return { ok: true as const, token, onboarded };
    });

    if (!result.ok) {
      return NextResponse.json({ error: "Invalid credentials." }, { status: 401 });
    }

    return NextResponse.json({ token: result.token, onboarded: result.onboarded });
  } catch (cause) {
    console.error("Login failed", cause);
    return NextResponse.json({ error: "Login failed." }, { status: 500 });
  }
}
