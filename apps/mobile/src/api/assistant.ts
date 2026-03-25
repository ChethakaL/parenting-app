import { API_BASE_URL, API_PREFIX } from "./config";
import type { AuthToken } from "./client";

export type AssistantCardEvent = {
  type: "card";
  card_type: string;
  data: unknown;
};

export type AssistantTextEvent = {
  type: "text";
  content: string;
};

export type AssistantToolCallEvent = {
  type: "tool_call";
  tool: string;
  result: unknown;
};

export type AssistantDoneEvent = {
  type: "done";
  conversation_id: string;
};

export type AssistantSseEvent =
  | AssistantTextEvent
  | AssistantToolCallEvent
  | AssistantCardEvent
  | AssistantDoneEvent;

type ChatRequest = {
  message: string;
  conversation_id?: string;
  input_mode: "text" | "voice";
};

export async function streamAssistantChat(args: {
  token: AuthToken;
  message: string;
  conversationId?: string;
  onEvent: (event: AssistantSseEvent) => void;
}) {
  const url = `${API_BASE_URL}${API_PREFIX}/assistant/chat`;

  const body: ChatRequest = {
    message: args.message,
    conversation_id: args.conversationId,
    input_mode: "text",
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${args.token}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Assistant chat failed (${res.status}): ${text || "no body"}`);
  }

  const reader = res.body?.getReader();
  if (!reader) {
    throw new Error("Streaming not supported in this environment.");
  }

  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  // Our SSE server emits frames as: "data: <json>\n\n"
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    while (true) {
      const frameEnd = buffer.indexOf("\n\n");
      if (frameEnd === -1) break;
      const frame = buffer.slice(0, frameEnd);
      buffer = buffer.slice(frameEnd + 2);

      const lines = frame.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const dataJson = trimmed.slice("data:".length).trim();
        if (!dataJson) continue;

        try {
          const evt = JSON.parse(dataJson) as AssistantSseEvent;
          args.onEvent(evt);
        } catch {
          // ignore malformed frames
        }
      }
    }
  }
}

