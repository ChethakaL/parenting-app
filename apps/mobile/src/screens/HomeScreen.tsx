import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Audio } from "expo-av";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useAuthStore } from "../store/authStore";
import { getHouseholdMe } from "../api/households";
import { getGrocery } from "../api/grocery";
import { getMealPlanForCurrentOrNextWeek } from "../api/mealPlans";
import { streamAssistantChat, type AssistantCardEvent, type AssistantDoneEvent } from "../api/assistant";
import { API_BASE_URL, API_PREFIX } from "../api/config";
import { AppScreen, BottomNav, Chip, InlineMessage, ScreenHeader, SectionCard } from "../ui/components";
import { colors, radius, shadow } from "../ui/theme";

type RootStackParamList = {
  Home: undefined;
  SettingsHousehold: undefined;
  Inventory: undefined;
  Grocery: undefined;
  MealPlan: undefined;
  MealLog: undefined;
  SavedRecipes: undefined;
  AssistantChat: undefined;
};

type Props = NativeStackScreenProps<RootStackParamList, "Home">;

type ChatCard = { card_type: string; data: unknown };
type ChatMessage = { id: string; role: "user" | "assistant"; text: string; cards?: ChatCard[] };

const quickPrompts = [
  "I bought 200g of potatoes today",
  "Add milk, eggs, and yogurt to the grocery list",
  "What can I cook tonight with what we have?",
];

export default function HomeScreen({ navigation }: Props) {
  const token = useAuthStore((s) => s.token);
  const [loading, setLoading] = useState(true);
  const [memberCount, setMemberCount] = useState(0);
  const [urgentGroceryCount, setUrgentGroceryCount] = useState(0);
  const [mealPlanStatus, setMealPlanStatus] = useState("No plan");
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [chatFocused, setChatFocused] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      text: "Tell me what happened at home. I can update inventory, add groceries, and help you decide meals from one message.",
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView | null>(null);

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!token) return;
      setLoading(true);
      try {
        const [hh, grocery, mealPlan] = await Promise.all([
          getHouseholdMe(token),
          getGrocery(token),
          getMealPlanForCurrentOrNextWeek(token),
        ]);
        if (cancelled) return;
        setMemberCount(hh.members.length);
        setUrgentGroceryCount((grocery.urgent ?? []).length);
        setMealPlanStatus(mealPlan.mealPlan?.status ?? "No plan");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function sendMessage(textOverride?: string) {
    if (!token) return;
    const text = (textOverride ?? input).trim();
    if (!text) return;

    setChatFocused(true);
    setError(null);
    setBusy(true);
    const userMsg = { id: crypto.randomUUID(), role: "user" as const, text };
    const assistantId = crypto.randomUUID();
    setMessages((prev) => [...prev, userMsg, { id: assistantId, role: "assistant", text: "", cards: [] }]);
    if (!textOverride) setInput("");

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

  async function transcribeFromMic() {
    if (!token || busy || voiceBusy) return;
    setChatFocused(true);
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
      if (!uri) throw new Error("Recording failed.");
      const blob = await (await fetch(uri)).blob();
      const fd = new FormData();
      fd.append("audio", blob, "voice.m4a");
      const res = await fetch(`${API_BASE_URL}${API_PREFIX}/assistant/voice/transcribe`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: fd,
      });
      if (!res.ok) throw new Error("Voice transcription failed.");
      const data = (await res.json()) as { transcript: string };
      setInput((prev) => (prev.trim() ? `${prev} ${data.transcript}` : data.transcript));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Voice transcription failed.");
    } finally {
      setVoiceBusy(false);
    }
  }

  function goTab(tab: "assistant" | "inventory" | "grocery" | "household") {
    if (tab === "assistant") return navigation.navigate("Home");
    if (tab === "inventory") return navigation.navigate("Inventory");
    if (tab === "grocery") return navigation.navigate("Grocery");
    navigation.navigate("SettingsHousehold");
  }

  return (
    <AppScreen scroll={false}>
      <ScreenHeader
        title="Parent AI"
        subtitle="Assistant-first meal, inventory, and grocery management."
        right={
          <View style={styles.headerBadge}>
            <Ionicons name="sparkles" size={16} color={colors.primaryDark} />
          </View>
        }
      />

      {!chatFocused ? (
        <View style={styles.hero}>
          <View style={styles.heroGlowBlue} />
          <View style={styles.heroGlowPink} />
          <Text style={styles.heroEyebrow}>{greeting}</Text>
          <Text style={styles.heroTitle}>Chat naturally. Parent AI updates the household for you.</Text>
          <Text style={styles.heroText}>Inventory, groceries, and meal planning should start from a message, not a form.</Text>
          <View style={styles.metricsRow}>
            <MetricCard icon="account-group-outline" label="Family" value={String(memberCount)} />
            <MetricCard icon="cart-outline" label="Urgent" value={String(urgentGroceryCount)} />
            <MetricCard icon="silverware-fork-knife" label="Plan" value={mealPlanStatus} compact />
          </View>
        </View>
      ) : null}

      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
        ref={(ref) => {
          scrollRef.current = ref;
        }}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
        showsVerticalScrollIndicator={false}
      >
        {!chatFocused ? (
          <SectionCard style={styles.promptCard}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>Quick prompts</Text>
              <Ionicons name="flash-outline" size={16} color={colors.primaryDark} />
            </View>
            <View style={styles.promptRow}>
              {quickPrompts.map((prompt) => (
                <Chip key={prompt} label={prompt} onPress={() => void sendMessage(prompt)} />
              ))}
            </View>
          </SectionCard>
        ) : null}

        <View style={styles.chatPanel}>
          <View style={styles.chatHeader}>
            <View>
              <Text style={styles.chatTitle}>Assistant chat</Text>
              <Text style={styles.chatSubtitle}>This is the main home experience.</Text>
            </View>
            {loading ? <ActivityIndicator color={colors.primary} /> : null}
          </View>

          {messages.map((message) => (
            <View key={message.id} style={[styles.messageBubble, message.role === "user" ? styles.userBubble : styles.assistantBubble]}>
              <View style={styles.messageTop}>
                <Text style={[styles.messageRole, message.role === "user" ? styles.userRole : null]}>
                  {message.role === "user" ? "You" : "Parent AI"}
                </Text>
                <Ionicons
                  name={message.role === "user" ? "person-circle-outline" : "sparkles-outline"}
                  size={16}
                  color={message.role === "user" ? "#F9F4FF" : colors.primaryDark}
                />
              </View>
              <Text style={[styles.messageBody, message.role === "user" ? styles.userBody : null]}>
                {message.text || (busy && message.role === "assistant" ? "Thinking..." : "")}
              </Text>
              {message.cards?.map((card, idx) => (
                <View key={`${message.id}-${idx}`} style={styles.responseCard}>
                  <Text style={styles.responseCardTitle}>{card.card_type}</Text>
                  <Text style={styles.responseCardBody}>{JSON.stringify(card.data, null, 2).slice(0, 260)}</Text>
                </View>
              ))}
            </View>
          ))}

          {error ? <InlineMessage text={error} tone="danger" /> : null}
        </View>
      </ScrollView>

      <View style={styles.composerShell}>
        <View style={styles.composer}>
          <Pressable onPress={() => void transcribeFromMic()} style={[styles.iconAction, voiceBusy ? styles.iconActionActive : null]}>
            <Ionicons name="mic-outline" size={20} color={voiceBusy ? "#fff" : colors.primaryDark} />
          </Pressable>
          <TextInput
            value={input}
            onChangeText={(text) => {
              setInput(text);
              if (text.length > 0) setChatFocused(true);
            }}
            onFocus={() => setChatFocused(true)}
            placeholder="Message Parent AI..."
            placeholderTextColor={colors.textMuted}
            multiline
            style={styles.composerInput}
          />
          <Pressable onPress={() => void sendMessage()} disabled={!input.trim() || busy} style={[styles.sendAction, (!input.trim() || busy) ? styles.sendActionDisabled : null]}>
            <Ionicons name="arrow-up" size={20} color="#fff" />
          </Pressable>
        </View>
      </View>

      <BottomNav active="assistant" onPress={goTab} />
    </AppScreen>
  );
}

function MetricCard({
  icon,
  label,
  value,
  compact = false,
}: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  label: string;
  value: string;
  compact?: boolean;
}) {
  return (
    <View style={[styles.metricCard, compact ? styles.metricCardCompact : null]}>
      <MaterialCommunityIcons name={icon} size={18} color={colors.primaryDark} />
      <Text style={styles.metricValue} numberOfLines={1}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  headerBadge: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  hero: {
    borderRadius: 30,
    padding: 18,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
    ...shadow,
  },
  heroGlowBlue: {
    position: "absolute",
    width: 220,
    height: 220,
    borderRadius: 120,
    backgroundColor: "rgba(141,214,255,0.55)",
    top: -110,
    right: -60,
  },
  heroGlowPink: {
    position: "absolute",
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: "rgba(242,117,180,0.18)",
    bottom: -100,
    left: -70,
  },
  heroEyebrow: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  heroTitle: {
    marginTop: 6,
    color: colors.text,
    fontSize: 24,
    lineHeight: 29,
    fontWeight: "800",
    letterSpacing: -0.6,
  },
  heroText: {
    marginTop: 6,
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
  },
  metricsRow: {
    marginTop: 12,
    flexDirection: "row",
    gap: 10,
  },
  metricCard: {
    flex: 1,
    borderRadius: 22,
    padding: 12,
    backgroundColor: "rgba(255,255,255,0.78)",
    borderWidth: 1,
    borderColor: "#F6E7F1",
    gap: 6,
  },
  metricCardCompact: {
    flex: 1.2,
  },
  metricValue: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "800",
  },
  metricLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
  },
  content: {
    flex: 1,
    marginTop: 10,
  },
  contentContainer: {
    gap: 10,
    paddingBottom: 10,
  },
  promptCard: {
    paddingTop: 14,
    paddingBottom: 12,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "800",
  },
  promptRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chatPanel: {
    borderRadius: 28,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 12,
    ...shadow,
  },
  chatHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  chatTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "800",
  },
  chatSubtitle: {
    color: colors.textMuted,
    fontSize: 13,
    marginTop: 2,
  },
  messageBubble: {
    borderRadius: 24,
    padding: 16,
    gap: 10,
    maxWidth: "92%",
  },
  assistantBubble: {
    alignSelf: "flex-start",
    backgroundColor: colors.backgroundAlt,
    borderWidth: 1,
    borderColor: "#D9EEFB",
  },
  userBubble: {
    alignSelf: "flex-end",
    backgroundColor: colors.primaryDark,
  },
  messageTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  messageRole: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  userRole: {
    color: "#FBE8F4",
  },
  messageBody: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 22,
  },
  userBody: {
    color: "#FFFFFF",
  },
  responseCard: {
    borderRadius: 18,
    padding: 12,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: colors.border,
    gap: 4,
  },
  responseCardTitle: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  responseCardBody: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 18,
  },
  composerShell: {
    paddingTop: 8,
    paddingBottom: 8,
  },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
    borderRadius: radius.lg,
    padding: 10,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow,
  },
  iconAction: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  iconActionActive: {
    backgroundColor: colors.primary,
  },
  composerInput: {
    flex: 1,
    maxHeight: 120,
    color: colors.text,
    fontSize: 15,
    paddingVertical: 10,
  },
  sendAction: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  sendActionDisabled: {
    opacity: 0.45,
  },
});
