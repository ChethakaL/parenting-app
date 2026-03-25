"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest, formatPrettyDate } from "./api";
import { FamilyIcon, FileIcon, MicIcon, PlusIcon, SendIcon, SparklesIcon } from "./icons";
import { ChatMessage } from "./types";
import { WorkspaceShell } from "./workspace-shell";

const quickPrompts = [
  "I bought 200g of potatoes today",
  "Add milk, eggs, and yogurt to the grocery list",
  "What can I cook tonight with what we have?",
];

const mealPlanLiveStatuses = [
  "Checking household allergies and dietary rules...",
  "Reviewing likes, dislikes, and child-friendly meals...",
  "Looking through fridge, freezer, and pantry inventory...",
  "Checking recent meal logs to avoid repeats...",
  "Matching saved recipes and weekly goals...",
  "Balancing breakfast, lunch, dinner, and snacks for the week...",
];

const assistantMealPlanPrompt =
  "Plan meals for this week using our household members, allergies, likes, inventory, saved recipes, weekly goal, and recent meal logs. Show a draft I can review.";

function isMealPlanningPrompt(text: string) {
  return /meal plan|plan meals|plan this week|plan next week|weekly plan|meals for this week/i.test(text);
}

function createWelcomeMessage(): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role: "assistant",
    text: "Tell me what happened at home today. I can update inventory, add groceries, build meal plans, and help you decide what to cook.",
  };
}

function renderInlineMarkdown(text: string) {
  const parts: Array<{ type: "text" | "bold" | "italic"; value: string }> = [];
  let i = 0;

  while (i < text.length) {
    if (text.startsWith("**", i)) {
      const end = text.indexOf("**", i + 2);
      if (end > i + 2) {
        parts.push({ type: "bold", value: text.slice(i + 2, end) });
        i = end + 2;
        continue;
      }
      // Unmatched '**' marker: drop it so we never display raw markdown.
      i += 2;
      continue;
    }
    if (text[i] === "*") {
      const end = text.indexOf("*", i + 1);
      if (end > i + 1) {
        parts.push({ type: "italic", value: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
      // Unmatched '*' marker: drop it.
      i += 1;
      continue;
    }

    const nextBold = text.indexOf("**", i);
    const nextItalic = text.indexOf("*", i);
    const next =
      nextBold === -1
        ? nextItalic
        : nextItalic === -1
          ? nextBold
          : Math.min(nextBold, nextItalic);
    const end = next === -1 ? text.length : next;
    parts.push({ type: "text", value: text.slice(i, end) });
    i = end;
  }

  return parts.map((part, idx) => {
    if (part.type === "bold") return <strong key={idx}>{part.value}</strong>;
    if (part.type === "italic") return <em key={idx}>{part.value}</em>;
    return <span key={idx}>{part.value}</span>;
  });
}

function MarkdownMessage({ text }: { text: string }) {
  const lines = text.split("\n").filter((line, index, arr) => line.trim() !== "" || (index > 0 && arr[index - 1].trim() !== ""));
  if (lines.length === 0) return null;

  return (
    <div className="wai-markdown-message">
      {lines.map((line, idx) => {
        const trimmed = line.trim();
        if (trimmed.startsWith("###")) return <h4 key={idx}>{renderInlineMarkdown(trimmed.replace(/^###\\s*/, ""))}</h4>;
        if (trimmed.startsWith("##")) return <h3 key={idx}>{renderInlineMarkdown(trimmed.replace(/^##\\s*/, ""))}</h3>;
        if (trimmed.startsWith("#")) return <h2 key={idx}>{renderInlineMarkdown(trimmed.replace(/^#\\s*/, ""))}</h2>;
        if (trimmed.startsWith("- ")) return <p key={idx}>• {renderInlineMarkdown(trimmed.slice(2))}</p>;
        return <p key={idx}>{renderInlineMarkdown(line)}</p>;
      })}
    </div>
  );
}

type AssistantMealPlanCard = {
  mealPlan?: {
    id: string;
    weekStart: string;
    status: string;
    weeklyGoal?: string | null;
    approvedAt?: string | null;
    slots: Array<{
      id: string;
      dayOfWeek: number;
      mealType: string;
      recipeName: string | null;
      approved?: boolean;
      inventoryStatus?: "in_stock" | "partial" | "missing";
      missingIngredients?: string[];
      annotations?: string[];
    }>;
  } | null;
};

function mealStatusLabel(status?: "in_stock" | "partial" | "missing") {
  if (status === "in_stock") return "In stock";
  if (status === "partial") return "Partially stocked";
  return "Needs grocery support";
}

function slotDayLabel(dayOfWeek: number) {
  return ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][dayOfWeek - 1] ?? "Day";
}

function LoadingSpinner({ label }: { label: string }) {
  return (
    <div className="wai-assistant-loading">
      <span className="wai-assistant-spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

function MealPlanCard({
  data,
  onQuickEdit,
}: {
  data: unknown;
  onQuickEdit: (prompt: string) => void;
}) {
  const card = data as AssistantMealPlanCard;
  const mealPlan = card?.mealPlan;
  if (!mealPlan) return null;

  const days = [
    { day: 1, label: "Monday" },
    { day: 2, label: "Tuesday" },
    { day: 3, label: "Wednesday" },
    { day: 4, label: "Thursday" },
    { day: 5, label: "Friday" },
    { day: 6, label: "Saturday" },
    { day: 7, label: "Sunday" },
  ];

  return (
    <div className="wai-stage-card-feature" style={{ marginTop: 12, minHeight: 0 }}>
      <div className="wai-stage-card-head">
        <strong>Week of {formatPrettyDate(mealPlan.weekStart)}</strong>
        <span className="wai-status-chip">{mealPlan.status}</span>
      </div>
      {mealPlan.weeklyGoal ? <p style={{ margin: 0 }}>Goal: {mealPlan.weeklyGoal}</p> : null}
      <div style={{ display: "grid", gap: 10 }}>
        {days.map(({ day, label }) => {
          const slots = mealPlan.slots.filter((slot) => slot.dayOfWeek === day);
          return (
            <div key={day} className="wai-empty" style={{ display: "grid", gap: 8 }}>
              <strong style={{ color: "var(--wai-text)" }}>{label}</strong>
              {slots.map((slot) => (
                <div key={slot.id} className="wai-assistant-meal-slot-card">
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
                    <span style={{ fontWeight: 700, textTransform: "capitalize", color: "var(--wai-text-soft)" }}>{slot.mealType}</span>
                    <span style={{ fontSize: "0.84rem", color: "var(--wai-text-soft)" }}>{mealStatusLabel(slot.inventoryStatus)}</span>
                  </div>
                  <div style={{ fontWeight: 700, color: "var(--wai-text)" }}>{slot.recipeName?.trim() || "Meal to plan"}</div>
                  {slot.annotations?.length ? (
                    <div className="wai-assistant-meal-notes">
                      {slot.annotations.map((annotation) => {
                        const isMemberNote = /allergy|like|dislike|diet|for yusuf|for chethaka|for /i.test(annotation);
                        return (
                          <div
                            key={`${slot.id}-${annotation}`}
                            className={isMemberNote ? "wai-assistant-member-note" : undefined}
                          >
                            {annotation}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                  {slot.missingIngredients?.length ? (
                    <div style={{ fontSize: "0.84rem", color: "var(--wai-text-soft)" }}>
                      Need: {slot.missingIngredients.join(", ")}
                    </div>
                  ) : null}
                  <div className="wai-inline-actions" style={{ paddingTop: 4 }}>
                    <button
                      type="button"
                      className="wai-chip"
                      onClick={() => onQuickEdit(`Change ${slotDayLabel(slot.dayOfWeek)} ${slot.mealType} from ${slot.recipeName ?? "this meal"} to `)}
                    >
                      Edit in chat
                    </button>
                    <Link className="wai-chip" href={`/meal-plans?slot=${encodeURIComponent(slot.id)}`}>
                      Open full details
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ChatCardView({
  card,
  onApproveMealPlan,
  onRegenerateMealPlan,
  onQuickEdit,
}: {
  card: { card_type: string; data: unknown };
  onApproveMealPlan: (mealPlanId: string) => Promise<void>;
  onRegenerateMealPlan: () => Promise<void>;
  onQuickEdit: (prompt: string) => void;
}) {
  if (card.card_type === "meal_plan") {
    const mealPlanId =
      typeof card.data === "object" && card.data !== null && typeof (card.data as AssistantMealPlanCard).mealPlan?.id === "string"
        ? (card.data as AssistantMealPlanCard).mealPlan!.id
        : null;
    return (
      <div style={{ display: "grid", gap: 12 }}>
        <MealPlanCard data={card.data} onQuickEdit={onQuickEdit} />
        <div className="wai-inline-actions" style={{ paddingTop: 2 }}>
          <button
            type="button"
            className="wai-secondary-button"
            onClick={() => void onRegenerateMealPlan()}
          >
            Regenerate
          </button>
          <Link className="wai-secondary-button" href="/meal-plans">
            Edit day by day
          </Link>
          <button
            type="button"
            className="wai-primary-button"
            onClick={() => {
              if (mealPlanId) void onApproveMealPlan(mealPlanId);
            }}
            disabled={!mealPlanId}
          >
            Approve plan
          </button>
        </div>
      </div>
    );
  }
  return null;
}

export function AssistantWorkspace() {
  return (
    <WorkspaceShell activeTab="assistant">
      {({ token, loadingSummary, refreshSummary, setError }) => (
        <AssistantWorkspaceContent
          token={token}
          loadingSummary={loadingSummary}
          onAfterMessage={refreshSummary}
          onError={setError}
        />
      )}
    </WorkspaceShell>
  );
}

function AssistantWorkspaceContent({
  token,
  loadingSummary,
  onAfterMessage,
  onError,
}: {
  token: string;
  loadingSummary: boolean;
  onAfterMessage: () => Promise<void>;
  onError: (value: string | null | ((prev: string | null) => string | null)) => void;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [messages, setMessages] = useState<ChatMessage[]>([createWelcomeMessage()]);
  const [input, setInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [assistantNotice, setAssistantNotice] = useState<string | null>(null);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceRecording, setVoiceRecording] = useState(false);
  const [pendingImage, setPendingImage] = useState<File | null>(null);
  const [composerFocused, setComposerFocused] = useState(false);
  const [busyIntent, setBusyIntent] = useState<"general" | "meal-plan">("general");
  const [liveStatusIndex, setLiveStatusIndex] = useState(0);
  const [pendingPromptText, setPendingPromptText] = useState<string | null>(null);
  const chatRef = useRef<HTMLDivElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const autoPromptHandledRef = useRef<string | null>(null);
  const sessionActive = messages.length > 1 || composerFocused || input.trim().length > 0 || voiceRecording || voiceBusy;
  const emptyState = messages.length <= 1 && !sessionActive;

  useEffect(() => {
    if (!chatBusy || busyIntent !== "meal-plan") return;
    const timer = window.setInterval(() => {
      setLiveStatusIndex((current) => (current + 1) % mealPlanLiveStatuses.length);
    }, 2200);
    return () => window.clearInterval(timer);
  }, [busyIntent, chatBusy]);

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  function startNewChat() {
    setConversationId(undefined);
    setMessages([createWelcomeMessage()]);
    setInput("");
    setAssistantNotice(null);
    setBusyIntent("general");
    setLiveStatusIndex(0);
    setPendingPromptText(null);
    onError(null);
  }

  async function transcribeAudio(blob: Blob) {
    const form = new FormData();
    form.append("audio", blob, "assistant-note.webm");

    const res = await fetch("/api/v1/assistant/voice/transcribe", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
      },
      body: form,
    });

    const payload = await res.json().catch(() => null) as { transcript?: string; error?: string } | null;
    if (!res.ok) {
      throw new Error(payload?.error || "Voice transcription failed.");
    }

    return (payload?.transcript ?? "").trim();
  }

  async function handleVoiceToggle() {
    if (voiceBusy) return;

    if (voiceRecording) {
      mediaRecorderRef.current?.stop();
      return;
    }

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setAssistantNotice("Voice recording is not supported in this browser.");
      return;
    }

    try {
      setAssistantNotice(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      mediaRecorderRef.current = recorder;

      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      });

      recorder.addEventListener("stop", async () => {
        stream.getTracks().forEach((track) => track.stop());
        setVoiceRecording(false);
        setVoiceBusy(true);

        try {
          const audioBlob = new Blob(audioChunksRef.current, { type: recorder.mimeType || "audio/webm" });
          const transcript = await transcribeAudio(audioBlob);
          if (!transcript) {
            setAssistantNotice("I couldn’t hear anything clearly. Please try again.");
            return;
          }
          setInput(transcript);
          setAssistantNotice("Voice note transcribed. You can edit it or send it now.");
        } catch (error) {
          setAssistantNotice(error instanceof Error ? error.message : "Voice transcription failed.");
        } finally {
          setVoiceBusy(false);
          mediaRecorderRef.current = null;
          audioChunksRef.current = [];
        }
      });

      recorder.start();
      setVoiceRecording(true);
    } catch (error) {
      setAssistantNotice(error instanceof Error ? error.message : "Could not start voice recording.");
    }
  }

  const compressImageIfNeeded = useCallback(async (file: File): Promise<File> => {
    const maxBytes = 4.8 * 1024 * 1024;
    if (file.size <= maxBytes) return file;
    const objectUrl = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error("Could not read image."));
        el.src = objectUrl;
      });
      const canvas = document.createElement("canvas");
      const ratio = Math.min(1, 1800 / Math.max(img.width, img.height));
      canvas.width = Math.max(1, Math.round(img.width * ratio));
      canvas.height = Math.max(1, Math.round(img.height * ratio));
      const ctx = canvas.getContext("2d");
      if (!ctx) return file;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      let quality = 0.88;
      let blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      while (blob && blob.size > maxBytes && quality > 0.35) {
        quality -= 0.1;
        blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      }
      if (!blob) return file;
      return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }, []);

  const processPendingImage = useCallback(async (instruction: string): Promise<string> => {
    if (!pendingImage) return "";
    const prepared = await compressImageIfNeeded(pendingImage);
    const form = new FormData();
    form.append("image", prepared);

    const lower = instruction.toLowerCase();
    let path = "/api/v1/recipes/photo";
    if (/grocery|shopping list|add to grocery/.test(lower)) {
      path = "/api/v1/grocery/from-image";
    } else if (/receipt|inventory|stock/.test(lower)) {
      path = "/api/v1/receipts";
    } else {
      form.append("notes", instruction || "Uploaded from assistant workspace");
    }

    const res = await fetch(path, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: form,
    });
    const payload = (await res.json().catch(() => null)) as
      | { ok?: boolean; error?: string; itemsAdded?: number; recipeId?: string }
      | null;
    if (!res.ok) {
      throw new Error(payload?.error || "Image processing failed.");
    }

    if (path === "/api/v1/grocery/from-image") {
      return `Image processed. Added ${payload?.itemsAdded ?? 0} grocery items.`;
    }
    if (path === "/api/v1/receipts") {
      return `Receipt processed. Added ${payload?.itemsAdded ?? 0} inventory items.`;
    }
    return payload?.ok ? "Recipe image processed and saved." : "Image processed.";
  }, [compressImageIfNeeded, pendingImage, token]);

  const handleSendMessage = useCallback(async (textOverride?: string) => {
    const text = (textOverride ?? input).trim();
    if (!text) return;

    setChatBusy(true);
    setBusyIntent(isMealPlanningPrompt(text) ? "meal-plan" : "general");
    setLiveStatusIndex(0);
    setPendingPromptText(isMealPlanningPrompt(text) ? "Building your weekly draft..." : null);
    onError(null);
    setAssistantNotice(null);

    const userMessage: ChatMessage = { id: crypto.randomUUID(), role: "user", text };
    const assistantId = crypto.randomUUID();
    setMessages((current) => [...current, userMessage, { id: assistantId, role: "assistant", text: "", cards: [] }]);
    if (!textOverride) setInput("");

    try {
      if (pendingImage) {
        const imageResult = await processPendingImage(text);
        setPendingImage(null);
        setAssistantNotice(imageResult);
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantId
              ? {
                  ...message,
                  text: imageResult,
                }
              : message,
          ),
        );
        await onAfterMessage();
        window.dispatchEvent(new CustomEvent("parentai:workspace-updated"));
        setChatBusy(false);
        return;
      }
      const res = await fetch("/api/v1/assistant/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          message: text,
          conversation_id: conversationId,
          input_mode: "text",
        }),
      });

      if (!res.ok || !res.body) {
        const body = await res.text().catch(() => "");
        throw new Error(body || "Assistant request failed.");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        while (true) {
          const frameEnd = buffer.indexOf("\n\n");
          if (frameEnd === -1) break;
          const frame = buffer.slice(0, frameEnd);
          buffer = buffer.slice(frameEnd + 2);

          for (const line of frame.split("\n")) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const payload = trimmed.slice("data:".length).trim();
            if (!payload) continue;

            const event = JSON.parse(payload) as
              | { type: "text"; content: string }
              | { type: "card"; card_type: string; data: unknown }
              | { type: "done"; conversation_id: string };

            if (event.type === "text") {
              setPendingPromptText(null);
              setMessages((current) =>
                current.map((message) =>
                  message.id === assistantId
                    ? { ...message, text: message.text + event.content }
                    : message,
                ),
              );
            } else if (event.type === "card") {
              setPendingPromptText(null);
              setMessages((current) =>
                current.map((message) =>
                  message.id === assistantId
                    ? { ...message, cards: [...(message.cards ?? []), { card_type: event.card_type, data: event.data }] }
                    : message,
                ),
              );
            } else if (event.type === "done") {
              setConversationId(event.conversation_id);
            }
          }
        }
      }

      await onAfterMessage();

      // Let other tabs/pages (e.g. Grocery) know workspace data changed,
      // so they can refetch without requiring a manual refresh.
      window.dispatchEvent(new CustomEvent("parentai:workspace-updated"));
    } catch (cause) {
      const fallbackMessage = cause instanceof Error ? cause.message : "Assistant request failed.";
      setAssistantNotice(fallbackMessage);
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantId
            ? {
                ...message,
                text: fallbackMessage,
              }
            : message,
        ),
      );
      onError(null);
    } finally {
      setChatBusy(false);
      setBusyIntent("general");
      setLiveStatusIndex(0);
      setPendingPromptText(null);
    }
  }, [conversationId, input, onAfterMessage, onError, pendingImage, processPendingImage, token]);

  const liveAssistantStatus =
    busyIntent === "meal-plan" ? mealPlanLiveStatuses[liveStatusIndex] : "Updating your household workspace...";

  useEffect(() => {
    const prompt = searchParams.get("prompt")?.trim();
    if (!prompt || chatBusy || autoPromptHandledRef.current === prompt) return;
    autoPromptHandledRef.current = prompt;
    router.replace("/");
    void handleSendMessage(prompt);
  }, [chatBusy, handleSendMessage, router, searchParams]);

  const handleApproveMealPlan = useCallback(async (mealPlanId: string) => {
    onError(null);
    setAssistantNotice(null);
    try {
      const response = await apiRequest<{ groceryAdded: number }>({
        path: `/meal-plans/${mealPlanId}/approve`,
        method: "POST",
        token,
      });
      setAssistantNotice(`Meal plan approved. ${response.groceryAdded} missing ingredients were added to grocery.`);
      await onAfterMessage();
      window.dispatchEvent(new CustomEvent("parentai:workspace-updated"));
    } catch (cause) {
      setAssistantNotice(cause instanceof Error ? cause.message : "Failed to approve meal plan.");
    }
  }, [onAfterMessage, onError, token]);

  const handleRegenerateMealPlan = useCallback(async () => {
    await handleSendMessage(assistantMealPlanPrompt);
  }, [handleSendMessage]);

  const handleQuickEdit = useCallback((prompt: string) => {
    setInput(prompt);
  }, []);

  return (
    <div className="wai-view wai-dashboard-view wai-assistant-page">
      <header className="wai-assistant-page-head">
        <div className="wai-assistant-page-copy">
          <p className="wai-dashboard-kicker">Assistant workspace</p>
          <h1 className="wai-assistant-page-title">Talk to Parent AI.</h1>
        </div>
        <div className="wai-assistant-page-actions">
          <span className="wai-status-chip">{loadingSummary ? "Syncing..." : "Live"}</span>
          <button type="button" className="wai-secondary-button" onClick={startNewChat}>
            <span className="wai-ghost-action-icon"><PlusIcon /></span>
            New chat
          </button>
        </div>
      </header>

      <section className="wai-panel wai-chat-panel wai-chat-panel-main wai-chat-panel-dashboard wai-chat-panel-priority">
        {assistantNotice ? <div className="wai-notice">{assistantNotice}</div> : null}
        <div className="wai-panel-head wai-chat-shell-head">
          <div className="wai-chat-shell-copy">
            <span className="wai-inline-badge">
              <SparklesIcon />
              Parent AI assistant
            </span>
            <p>Describe what changed. Keep it natural and Parent AI will translate it into household updates.</p>
          </div>
        </div>

        <div className="wai-chat-shell-grid">
          <div className="wai-chat-window" ref={chatRef}>
            {emptyState ? (
              <div className="wai-chat-empty-state">
                <p className="wai-chat-empty-kicker">Start with a simple update</p>
                <div className="wai-prompt-row wai-chat-empty-prompts">
                  {quickPrompts.map((prompt) => (
                    <button key={prompt} type="button" className="wai-prompt-chip" onClick={() => void handleSendMessage(prompt)}>
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {messages.map((message) => (
              <article key={message.id} className={message.role === "assistant" ? "wai-bubble assistant" : "wai-bubble user"}>
                <div className="wai-bubble-meta">
                  {message.role === "assistant" ? <SparklesIcon /> : <FamilyIcon />}
                  <span>{message.role === "assistant" ? "Parent AI" : "You"}</span>
                </div>
                <MarkdownMessage text={message.text || (chatBusy && message.role === "assistant" ? liveAssistantStatus : "")} />
                {chatBusy && message.role === "assistant" && message.id === messages[messages.length - 1]?.id ? (
                  <LoadingSpinner label={pendingPromptText ?? liveAssistantStatus} />
                ) : null}
                {message.cards?.map((card, index) => (
                  <ChatCardView
                    key={`${message.id}-card-${index}`}
                    card={card}
                    onApproveMealPlan={handleApproveMealPlan}
                    onRegenerateMealPlan={handleRegenerateMealPlan}
                    onQuickEdit={handleQuickEdit}
                  />
                ))}
              </article>
            ))}
          </div>

          {pendingImage ? (
            <div
              style={{
                marginBottom: 8,
                padding: "6px 10px",
                borderRadius: 12,
                background: "rgba(255,255,255,0.95)",
                border: "1px solid rgba(120, 180, 220, 0.35)",
                display: "flex",
                gap: 8,
                alignItems: "center",
                fontSize: 12,
              }}
            >
              <span style={{ width: 14, height: 14, display: "inline-flex" }}><FileIcon /></span>
              <span style={{ maxWidth: 320, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontWeight: 600 }}>
                {pendingImage.name}
              </span>
              <span style={{ color: "var(--wai-text-soft)" }}>Attached</span>
              <button
                type="button"
                className="wai-chip"
                onClick={() => setPendingImage(null)}
                style={{ marginLeft: "auto", padding: "4px 8px" }}
              >
                Remove
              </button>
            </div>
          ) : null}

          <form
            className="wai-composer wai-composer-dashboard"
            onSubmit={(event) => {
              event.preventDefault();
              void handleSendMessage();
            }}
          >
            <button
              type="button"
              className="wai-icon-button"
              aria-label="Upload recipe image"
              onClick={() => fileInputRef.current?.click()}
              disabled={chatBusy || voiceBusy}
            >
              <FileIcon />
            </button>
            <button
              type="button"
              className={voiceRecording ? "wai-icon-button wai-voice-button is-recording" : "wai-icon-button wai-voice-button"}
              aria-label={voiceRecording ? "Stop recording" : "Start voice recording"}
              onClick={() => void handleVoiceToggle()}
              disabled={voiceBusy || chatBusy}
            >
              <MicIcon />
            </button>
            <input
              className="wai-composer-input"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onFocus={() => setComposerFocused(true)}
              onBlur={() => setComposerFocused(false)}
              placeholder={voiceBusy ? "Transcribing voice note..." : voiceRecording ? "Recording..." : "Message Parent AI..."}
            />
            <button type="submit" className="wai-send-button" disabled={!input.trim() || chatBusy}>
              <SendIcon />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  setPendingImage(file);
                  setAssistantNotice(`Attached ${file.name}. Now type what to do (e.g. add to grocery, scan receipt, or save recipe).`);
                }
                event.currentTarget.value = "";
              }}
            />
          </form>
        </div>
      </section>
    </div>
  );
}
