import { API_BASE_URL, API_PREFIX } from "./config";

export type AuthToken = string;

export async function apiFetch<T>(args: {
  path: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  token?: AuthToken | null;
}): Promise<T> {
  const url = `${API_BASE_URL}${API_PREFIX}${args.path}`;

  const res = await fetch(url, {
    method: args.method,
    headers: {
      "content-type": "application/json",
      ...(args.token ? { authorization: `Bearer ${args.token}` } : {}),
    },
    body: args.body === undefined ? undefined : JSON.stringify(args.body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${args.method} ${args.path} failed (${res.status}): ${text || "no body"}`);
  }

  return (await res.json()) as T;
}

