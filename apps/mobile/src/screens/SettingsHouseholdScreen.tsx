import React, { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useAuthStore } from "../store/authStore";
import { addHouseholdMember, deleteHouseholdMember, getHouseholdMe, type Member } from "../api/households";
import { addMemberPreference, deleteMemberPreference, getMemberPreferences, type MemberPreference } from "../api/preferences";
import { AppScreen, BottomNav, Chip, EmptyState, Field, InlineMessage, PrimaryButton, ScreenHeader, SecondaryButton, SectionCard } from "../ui/components";
import { colors } from "../ui/theme";

type RootStackParamList = {
  Home: undefined;
  Inventory: undefined;
  Grocery: undefined;
  SettingsHousehold: undefined;
};

type Props = NativeStackScreenProps<RootStackParamList, "SettingsHousehold">;

function formatDob(value?: string | null) {
  if (!value) return "DOB not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return new Intl.DateTimeFormat("en", { year: "numeric", month: "short", day: "numeric" }).format(date);
}

export default function SettingsHouseholdScreen({ navigation }: Props) {
  const token = useAuthStore((s) => s.token);
  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState<Member[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newGender, setNewGender] = useState<"male" | "female" | "other">("male");
  const [newDob, setNewDob] = useState("");
  const [activeMemberId, setActiveMemberId] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<MemberPreference[]>([]);
  const [prefType, setPrefType] = useState<"allergy" | "dislike">("allergy");
  const [prefValue, setPrefValue] = useState("");
  const [prefSeverity, setPrefSeverity] = useState<"critical" | "strong" | "mild">("strong");

  async function refresh() {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const hh = await getHouseholdMe(token);
      setMembers(hh.members);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load household.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [token]);

  async function refreshPreferences(memberId: string) {
    if (!token) return;
    const res = await getMemberPreferences(token, memberId);
    setPreferences(res.preferences);
  }

  async function onAddMember() {
    if (!token) return;
    try {
      await addHouseholdMember({ token, name: newName, gender: newGender, dateOfBirth: newDob });
      setNewName("");
      setNewDob("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add member.");
    }
  }

  async function onDeleteMember(memberId: string) {
    if (!token) return;
    try {
      await deleteHouseholdMember({ token, memberId });
      if (activeMemberId === memberId) {
        setActiveMemberId(null);
        setPreferences([]);
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete member.");
    }
  }

  async function onAddPreference() {
    if (!token || !activeMemberId || !prefValue.trim()) return;
    try {
      await addMemberPreference({ token, memberId: activeMemberId, type: prefType, value: prefValue.trim(), severity: prefSeverity });
      setPrefValue("");
      await refreshPreferences(activeMemberId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save preference.");
    }
  }

  const activeMember = members.find((m) => m.id === activeMemberId) ?? null;

  return (
    <AppScreen>
      <ScreenHeader title="Household" subtitle="Family setup and member management all in one place." />
      {error ? <InlineMessage text={error} tone="danger" /> : null}
      {loading ? <ActivityIndicator color={colors.primary} /> : null}

      <SectionCard>
        <Text style={styles.sectionTitle}>Family members</Text>
        <Text style={styles.sectionSubtitle}>Everything for setup and ongoing household edits is together on this page.</Text>
        {!loading && members.length === 0 ? <EmptyState title="No members yet" subtitle="Add everyone Parent AI should consider when handling meals and groceries." /> : null}
        {members.map((m) => (
          <View key={m.id} style={styles.memberCard}>
            <View style={styles.memberHeader}>
              <View style={styles.memberTextWrap}>
                <Text style={styles.memberName}>{m.name}</Text>
                <Text style={styles.memberMeta}>
                  {m.role} • {m.gender} • {formatDob(m.dateOfBirth)} • {Math.round(m.ageYears)}y
                </Text>
              </View>
              <Chip label={activeMemberId === m.id ? "Selected" : "Open"} active={activeMemberId === m.id} onPress={() => {
                setActiveMemberId(m.id);
                void refreshPreferences(m.id);
              }} />
            </View>
            <SecondaryButton title="Delete member" tone="danger" onPress={() => void onDeleteMember(m.id)} />
          </View>
        ))}

        <View style={styles.divider} />

        <Text style={styles.formTitle}>Add family member</Text>
        <Field label="Name" placeholder="Yusuf" value={newName} onChangeText={setNewName} />
        <Field label="Date of birth" placeholder="YYYY-MM-DD" value={newDob} onChangeText={setNewDob} />
        <View style={styles.chipRow}>
          {(["male", "female", "other"] as const).map((value) => (
            <Chip key={value} label={value[0].toUpperCase() + value.slice(1)} active={newGender === value} onPress={() => setNewGender(value)} />
          ))}
        </View>
        <PrimaryButton title="Add member" onPress={() => void onAddMember()} />
      </SectionCard>

      <SectionCard>
        <Text style={styles.sectionTitle}>Food preferences</Text>
        <Text style={styles.sectionSubtitle}>
          {activeMember ? `Managing preferences for ${activeMember.name}.` : "Choose a family member above to add allergies or dislikes."}
        </Text>
        {!activeMember ? <EmptyState title="No member selected" subtitle="Tap Open on a family member to manage their preferences here." /> : null}
        {activeMember ? (
          <>
            <View style={styles.chipRow}>
              <Chip label="Allergy" tone="danger" active={prefType === "allergy"} onPress={() => setPrefType("allergy")} />
              <Chip label="Dislike" tone="warning" active={prefType === "dislike"} onPress={() => setPrefType("dislike")} />
            </View>
            <Field label="Preference" placeholder="Peanuts" value={prefValue} onChangeText={setPrefValue} />
            <View style={styles.chipRow}>
              {(["critical", "strong", "mild"] as const).map((value) => (
                <Chip key={value} label={value[0].toUpperCase() + value.slice(1)} tone={value === "critical" ? "danger" : value === "strong" ? "warning" : "success"} active={prefSeverity === value} onPress={() => setPrefSeverity(value)} />
              ))}
            </View>
            <PrimaryButton title="Save preference" onPress={() => void onAddPreference()} />
            {preferences.length === 0 ? <EmptyState title="No saved preferences yet" subtitle="Add allergies and strong dislikes so the assistant can plan safely." /> : null}
            {preferences.map((p) => (
              <View key={p.id} style={styles.prefCard}>
                <View style={styles.memberTextWrap}>
                  <Text style={styles.prefTitle}>{p.type} • {p.value}</Text>
                  <Text style={styles.prefMeta}>Severity: {p.severity ?? "not set"}</Text>
                </View>
                <SecondaryButton title="Delete" tone="danger" onPress={() => void deleteMemberPreference({ token: token!, memberId: activeMember.id, prefId: p.id }).then(() => refreshPreferences(activeMember.id))} />
              </View>
            ))}
          </>
        ) : null}
      </SectionCard>

      <BottomNav
        active="household"
        onPress={(tab) => {
          if (tab === "assistant") navigation.navigate("Home");
          if (tab === "inventory") navigation.navigate("Inventory");
          if (tab === "grocery") navigation.navigate("Grocery");
        }}
      />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  sectionTitle: { color: colors.text, fontSize: 20, fontWeight: "800" },
  sectionSubtitle: { color: colors.textMuted, fontSize: 14, lineHeight: 20 },
  memberCard: { borderRadius: 20, backgroundColor: colors.backgroundAlt, borderWidth: 1, borderColor: colors.border, padding: 14, gap: 10 },
  memberHeader: { flexDirection: "row", gap: 10, justifyContent: "space-between", alignItems: "flex-start" },
  memberTextWrap: { flex: 1, gap: 4 },
  memberName: { color: colors.text, fontSize: 18, fontWeight: "800" },
  memberMeta: { color: colors.textMuted, lineHeight: 20 },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 6 },
  formTitle: { color: colors.text, fontSize: 18, fontWeight: "800" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  prefCard: { borderRadius: 18, backgroundColor: colors.backgroundAlt, borderWidth: 1, borderColor: colors.border, padding: 14, gap: 10 },
  prefTitle: { color: colors.text, fontWeight: "800" },
  prefMeta: { color: colors.textMuted },
});
