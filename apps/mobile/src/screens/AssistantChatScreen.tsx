import React, { useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Audio } from "expo-av";
import { useAuthStore } from "../store/authStore";
import { streamAssistantChat, type AssistantCardEvent, type AssistantDoneEvent } from "../api/assistant";
import { API_BASE_URL, API_PREFIX } from "../api/config";
import { AppScreen, Field, InlineMessage, PrimaryButton, SectionCard } from "../ui/components";
import { colors } from "../ui/theme";

type ChatCard = { card_type: string; data: unknown };
type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  cards?: ChatCard[];
};

export default function AssistantChatScreen() {
  const token = useAuthStore((s) => s.token);
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: "welcome", role: "assistant", text: "Assalamu alaikum. Ask about meals, grocery planning, inventory, or household food preferences." },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView | null>(null);

  const canSend = useMemo(() => input.trim().length > 0 && !!token && !busy, [input, token, busy]);

  async function onSend() {
    if (!token) return;
    const text = input.trim();
    if (!text) return;

    setError(null);
    setBusy(true);

    const userMsg = { id: crypto.randomUUID(), role: "user" as const, text };
    const assistantId = crypto.randomUUID();
    const assistantMsg: ChatMessage = { id: assistantId, role: "assistant", text: "", cards: [] };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput("");

    try {
      await streamAssistantChat({
        token,
        message: text,
        conversationId,
        onEvent: (evt) => {
          if (evt.type === "text") {
            setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, text: m.text + evt.content } : m)));
            return;
          }
          if (evt.type === "card") {
            const cardEvt = evt as AssistantCardEvent;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, cards: [...(m.cards ?? []), { card_type: cardEvt.card_type, data: cardEvt.data }] }
                  : m,
              ),
            );
            return;
          }
          if (evt.type === "done") {
            setConversationId((evt as AssistantDoneEvent).conversation_id);
          }
        },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Assistant failed.");
    } finally {
      setBusy(false);
    }
  }

  async function onTranscribeFromMic() {
    if (!token || busy || voiceBusy) return;
    setError(null);
    setVoiceBusy(true);

    try {
      const perm = await Audio.requestPermissionsAsync();
      if (perm.status !== "granted") {
        setError("Microphone permission is required.");
        return;
      }

      const recording = new Audio.Recording();
      await recording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      await recording.startAsync();
      await new Promise((r) => setTimeout(r, 5000));
      await recording.stopAndUnloadAsync();

      const uri = recording.getURI();
      if (!uri) throw new Error("Recording failed: no URI returned.");

      const blob = await (await fetch(uri)).blob();
      const fd = new FormData();
      fd.append("audio", blob, "voice.m4a");

      const res = await fetch(`${API_BASE_URL}${API_PREFIX}/assistant/voice/transcribe`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: fd,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Transcription failed (${res.status}): ${text || "no body"}`);
      }

      const data = (await res.json()) as { transcript: string };
      setInput((prev) => {
        const base = prev.trim();
        return base ? `${base} ${data.transcript}` : data.transcript;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Voice transcription failed.");
    } finally {
      setVoiceBusy(false);
    }
  }

  return (
    <AppScreen scroll={false}>
      <View style={styles.header}>
        <Text style={styles.title}>Talk to ParentAI</Text>
        <Text style={styles.subtitle}>Use natural language. The UI is here for overview, but the assistant is the main interface.</Text>
      </View>

      <ScrollView
        style={styles.chatArea}
        ref={(r) => {
          scrollRef.current = r;
        }}
        contentContainerStyle={styles.chatContent}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
        showsVerticalScrollIndicator={false}
      >
        {messages.map((m) => (
          <View key={m.id} style={[styles.bubble, m.role === "user" ? styles.userBubble : styles.assistantBubble]}>
            <Text style={[styles.roleLabel, m.role === "user" ? styles.userRoleLabel : null]}>
              {m.role === "user" ? "You" : "ParentAI"}
            </Text>
            <Text style={[styles.messageText, m.role === "user" ? styles.userMessageText : null]}>{m.text || (busy && m.role === "assistant" ? "Thinking..." : "")}</Text>
            {m.cards?.map((c, idx) => (
              <SectionCard key={`${m.id}-${idx}`} style={styles.cardBlock}>
                <Text style={styles.cardTitle}>{c.card_type}</Text>
                <Text style={styles.cardText}>{JSON.stringify(c.data, null, 2).slice(0, 500)}</Text>
              </SectionCard>
            ))}
          </View>
        ))}
        {busy ? <ActivityIndicator color={colors.primary} style={styles.loader} /> : null}
      </ScrollView>

      {error ? <InlineMessage text={error} tone="danger" /> : null}
      <View style={styles.composer}>
        <Field
          style={styles.inputWrap}
          placeholder="Ask for dinner ideas, substitutions, grocery planning..."
          value={input}
          onChangeText={setInput}
          editable={!busy}
          multiline
        />
        <View style={styles.composerActions}>
          <Pressable
            onPress={() => void onTranscribeFromMic()}
            disabled={busy || voiceBusy}
            style={({ pressed }) => [
              styles.micButton,
              voiceBusy ? styles.micButtonActive : null,
              pressed ? styles.micButtonPressed : null,
              busy ? styles.micButtonDisabled : null,
            ]}
          >
            <Text style={[styles.micIcon, voiceBusy ? styles.micIconActive : null]}>🎤</Text>
          </Pressable>
        </View>
        <PrimaryButton title="Send" onPress={() => void onSend()} disabled={!canSend} />
      </View>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  header: { gap: 4 },
  title: { fontSize: 24, fontWeight: "800", color: colors.text },
  subtitle: { fontSize: 14, lineHeight: 20, color: colors.textMuted },
  chatArea: { flex: 1 },
  chatContent: { paddingVertical: 16, gap: 12 },
  bubble: { maxWidth: "92%", borderRadius: 24, padding: 16, gap: 8 },
  userBubble: { alignSelf: "flex-end", backgroundColor: colors.primary },
  assistantBubble: { alignSelf: "flex-start", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  roleLabel: { fontSize: 12, fontWeight: "800", color: colors.primaryDark, textTransform: "uppercase", letterSpacing: 0.8 },
  userRoleLabel: { color: "#CFE9E2" },
  messageText: { color: colors.text, fontSize: 15, lineHeight: 22 },
  userMessageText: { color: "#fff" },
  cardBlock: { marginTop: 6, backgroundColor: colors.backgroundAlt },
  cardTitle: { fontSize: 13, fontWeight: "800", color: colors.text },
  cardText: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
  loader: { marginTop: 6 },
  composer: { gap: 10, paddingTop: 10 },
  inputWrap: { flex: 0 },
  composerActions: { alignItems: "flex-end" },
  micButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.backgroundAlt,
    alignItems: "center",
    justifyContent: "center",
  },
  micButtonActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  micButtonPressed: { opacity: 0.8 },
  micButtonDisabled: { opacity: 0.5 },
  micIcon: { fontSize: 20 },
  micIconActive: { color: "#fff" },
});
