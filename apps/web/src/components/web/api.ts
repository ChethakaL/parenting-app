const API_PREFIX = "/api/v1";

export async function apiRequest<T>(args: {
  path: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  token?: string | null;
  body?: unknown;
  isFormData?: boolean;
}): Promise<T> {
  const headers: Record<string, string> = {};
  if (!args.isFormData) headers["content-type"] = "application/json";
  if (args.token) headers.authorization = `Bearer ${args.token}`;

  const res = await fetch(`${API_PREFIX}${args.path}`, {
    method: args.method,
    headers,
    body:
      args.body === undefined
        ? undefined
        : args.isFormData
          ? (args.body as FormData)
          : JSON.stringify(args.body),
  });

  if (!res.ok) {
    const contentType = res.headers.get("content-type") ?? "";

    if (contentType.includes("application/json")) {
      const payload = await res.json().catch(() => null) as { error?: string } | null;
      throw new Error(payload?.error || `${args.method} ${args.path} failed (${res.status})`);
    }

    const text = await res.text().catch(() => "");

    try {
      const payload = JSON.parse(text) as { error?: string };
      throw new Error(payload?.error || `${args.method} ${args.path} failed (${res.status})`);
    } catch {
      throw new Error(text || `${args.method} ${args.path} failed (${res.status})`);
    }
  }

  return (await res.json()) as T;
}

function extractDatePart(value: string | null) {
  if (!value) return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? match[0] : null;
}

function formatDate(value: string | null, options: Intl.DateTimeFormatOptions) {
  if (!value) return null;
  const dateOnly = extractDatePart(value);
  const date = dateOnly ? new Date(`${dateOnly}T00:00:00Z`) : new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en", {
    ...options,
    timeZone: dateOnly ? "UTC" : options.timeZone,
  }).format(date);
}

export function normalizeDateValue(value: string | null) {
  return extractDatePart(value) ?? "";
}

export function formatDob(value: string | null) {
  return formatDate(value, { year: "numeric", month: "short", day: "numeric" }) ?? "DOB not set";
}

export function formatPrettyDate(value: string | null) {
  return formatDate(value, { year: "numeric", month: "short", day: "numeric" }) ?? "Not set";
}

export function formatDateTime(value: string | null) {
  return formatDate(value, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }) ?? "Not set";
}
