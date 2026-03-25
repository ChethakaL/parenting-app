import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";

const jwtSecret = process.env.NEXTAUTH_SECRET;

if (!jwtSecret) {
  throw new Error("Missing NEXTAUTH_SECRET in environment.");
}

const encoder = new TextEncoder();

export async function hashPassword(password: string): Promise<string> {
  // bcryptjs uses a pure JS implementation; good enough for app auth.
  const saltRounds = 12;
  return bcrypt.hash(password, saltRounds);
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  return bcrypt.compare(password, passwordHash);
}

export async function issueBearerToken(userId: string): Promise<string> {
  // HS256 with NEXTAUTH_SECRET keeps everything server-only and works for Authorization: Bearer.
  return await new SignJWT({})
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(encoder.encode(jwtSecret));
}

export async function verifyBearerToken(token: string): Promise<{ userId: string }> {
  const { payload } = await jwtVerify(token, encoder.encode(jwtSecret), {
    algorithms: ["HS256"],
  });

  if (!payload.sub) {
    throw new Error("Invalid token: missing subject.");
  }

  return { userId: payload.sub };
}

