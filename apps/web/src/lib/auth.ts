import type { NextRequest } from "next/server";
import { verifyBearerToken } from "./security";

class AuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function requireAuth(req: NextRequest): Promise<{ userId: string }> {
  const header = req.headers.get("authorization") ?? "";
  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token) {
    throw new AuthError("Missing or invalid Authorization header.", 401);
  }

  return await verifyBearerToken(token);
}

