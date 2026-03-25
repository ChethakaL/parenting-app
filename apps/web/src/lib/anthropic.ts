const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!ANTHROPIC_API_KEY) {
  throw new Error("Missing ANTHROPIC_API_KEY in environment.");
}

type ClaudeModel = "claude-sonnet-4-6" | "claude-opus-4-6";

type ClaudeJsonResult<T> = {
  model: ClaudeModel;
  rawText: string;
  parsed: T;
};

function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }
  // Prefer object extraction, but receipts sometimes return JSON arrays.
  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  const firstBracket = raw.indexOf("[");
  const lastBracket = raw.lastIndexOf("]");
  if (firstBracket >= 0 && lastBracket > firstBracket && (firstBrace === -1 || firstBracket < firstBrace)) {
    return raw.slice(firstBracket, lastBracket + 1);
  }
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return raw.slice(firstBrace, lastBrace + 1);
  }
  if (firstBracket >= 0 && lastBracket > firstBracket) {
    return raw.slice(firstBracket, lastBracket + 1);
  }
  return raw;
}

const anthropicHeaders: HeadersInit = {
  "x-api-key": ANTHROPIC_API_KEY ?? "",
  "anthropic-version": "2023-06-01",
  "content-type": "application/json",
};

/** Anthropic returns 429 (rate limit), 503 (unavailable), 529 (overloaded) — retry with backoff. */
function isTransientAnthropicHttpStatus(status: number): boolean {
  return status === 429 || status === 503 || status === 529;
}

async function postAnthropicMessagesJson(body: string, maxAttempts = 6): Promise<Response> {
  let lastRes: Response | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let res: Response;
    try {
      res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: anthropicHeaders,
        body,
      });
    } catch (err) {
      if (attempt === maxAttempts) {
        throw err instanceof Error ? err : new Error("Anthropic request failed.");
      }
      const delayMs = Math.min(8000, 400 * 2 ** (attempt - 1)) + Math.random() * 400;
      await new Promise((r) => setTimeout(r, delayMs));
      continue;
    }

    lastRes = res;
    if (res.ok) return res;

    if (!isTransientAnthropicHttpStatus(res.status) || attempt === maxAttempts) {
      return res;
    }

    const retryAfter = res.headers.get("retry-after");
    let delayMs: number;
    if (retryAfter) {
      const sec = Number.parseFloat(retryAfter);
      delayMs = Number.isFinite(sec) ? Math.min(20000, Math.max(500, sec * 1000)) : 2000;
    } else {
      delayMs = Math.min(12000, 600 * 2 ** (attempt - 1)) + Math.random() * 500;
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }

  return lastRes as Response;
}

export async function callClaudeJson<T>(args: {
  model: ClaudeModel;
  system: string;
  userText: string;
  temperature?: number;
  maxTokens?: number;
}): Promise<ClaudeJsonResult<T>> {
  const { model, system, userText, temperature = 0.2, maxTokens = 3500 } = args;

  const body = JSON.stringify({
    model,
    system,
    temperature,
    max_tokens: maxTokens,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: userText,
          },
        ],
      },
    ],
  });

  const res = await postAnthropicMessagesJson(body);

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Claude API error (${res.status}): ${text || "no body"}`);
  }

  const json = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
    error?: { message?: string };
  };

  if (json.error?.message) {
    throw new Error(`Claude API error: ${json.error.message}`);
  }

  const rawText = (json.content ?? [])
    .map((c) => (c.type === "text" && typeof c.text === "string" ? c.text : ""))
    .join("\n")
    .trim();

  const jsonText = extractJson(rawText);
  let parsed: T;
  try {
    parsed = JSON.parse(jsonText) as T;
  } catch {
    throw new Error(`Failed to parse Claude JSON. Raw: ${rawText.slice(0, 500)}`);
  }

  return { model, rawText, parsed };
}

export async function callClaudeText(args: {
  model: ClaudeModel;
  system: string;
  userText: string;
  temperature?: number;
  maxTokens?: number;
}): Promise<string> {
  const { model, system, userText, temperature = 0.4, maxTokens = 1200 } = args;

  const body = JSON.stringify({
    model,
    system,
    temperature,
    max_tokens: maxTokens,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: userText,
          },
        ],
      },
    ],
  });

  const res = await postAnthropicMessagesJson(body);

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Claude API error (${res.status}): ${text || "no body"}`);
  }

  const json = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
    error?: { message?: string };
  };

  if (json.error?.message) {
    throw new Error(`Claude API error: ${json.error.message}`);
  }

  const rawText = (json.content ?? [])
    .map((c) => (c.type === "text" && typeof c.text === "string" ? c.text : ""))
    .join("\n")
    .trim();

  return rawText;
}

export async function callClaudeVisionJson<T>(args: {
  model: ClaudeModel;
  system: string;
  userText: string;
  imageBase64: string;
  imageMediaType: string; // e.g. image/jpeg
  temperature?: number;
  maxTokens?: number;
}): Promise<ClaudeJsonResult<T>> {
  const { model, system, userText, imageBase64, imageMediaType, temperature = 0.2, maxTokens = 3500 } =
    args;

  const body = JSON.stringify({
    model,
    system,
    temperature,
    max_tokens: maxTokens,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: imageMediaType,
              data: imageBase64,
            },
          },
          { type: "text", text: userText },
        ],
      },
    ],
  });

  const res = await postAnthropicMessagesJson(body);

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Claude Vision API error (${res.status}): ${text || "no body"}`);
  }

  const json = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
    error?: { message?: string };
  };

  if (json.error?.message) {
    throw new Error(`Claude Vision API error: ${json.error.message}`);
  }

  const rawText = (json.content ?? [])
    .map((c) => (c.type === "text" && typeof c.text === "string" ? c.text : ""))
    .join("\n")
    .trim();

  const jsonText = extractJson(rawText);
  let parsed: T;
  try {
    parsed = JSON.parse(jsonText) as T;
  } catch {
    throw new Error(`Failed to parse Claude Vision JSON. Raw: ${rawText.slice(0, 500)}`);
  }

  return { model, rawText, parsed };
}

export async function callClaudeVisionText(args: {
  model: ClaudeModel;
  system: string;
  userText: string;
  imageBase64: string;
  imageMediaType: string;
  temperature?: number;
  maxTokens?: number;
}): Promise<string> {
  const { model, system, userText, imageBase64, imageMediaType, temperature = 0.2, maxTokens = 2000 } =
    args;

  const body = JSON.stringify({
    model,
    system,
    temperature,
    max_tokens: maxTokens,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: imageMediaType,
              data: imageBase64,
            },
          },
          { type: "text", text: userText },
        ],
      },
    ],
  });

  const res = await postAnthropicMessagesJson(body);

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Claude Vision API error (${res.status}): ${text || "no body"}`);
  }
  const json = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
    error?: { message?: string };
  };
  if (json.error?.message) {
    throw new Error(`Claude Vision API error: ${json.error.message}`);
  }
  return (json.content ?? [])
    .map((c) => (c.type === "text" && typeof c.text === "string" ? c.text : ""))
    .join("\n")
    .trim();
}
