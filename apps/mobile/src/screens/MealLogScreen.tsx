import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useAuthStore } from "../store/authStore";
import { getHouseholdMe, type Member } from "../api/households";
import { getMealPlanForCurrentOrNextWeek, type MealPlanSlot } from "../api/mealPlans";
import { logMeal } from "../api/mealLogs";
import { AppScreen, Chip, EmptyState, InlineMessage, PrimaryButton, SectionCard, SectionTitle } from "../ui/components";
import { colors } from "../ui/theme";

function getClientDayOfWeek(d: Date) {
  const jsDay = d.getDay();
  return ((jsDay + 6) % 7) + 1;
}

export default function MealLogScreen() {
  const token = useAuthStore((s) => s.token);
  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState<Member[]>([]);
  const [mealPlanSlots, setMealPlanSlots] = useState<MealPlanSlot[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const todayDayOfWeek = useMemo(() => getClientDayOfWeek(new Date()), []);

  async function refresh() {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const [hh, mealPlanRes] = await Promise.all([getHouseholdMe(token), getMealPlanForCurrentOrNextWeek(token)]);
      setMembers(hh.members);
      setMealPlanSlots(mealPlanRes.mealPlan ? mealPlanRes.mealPlan.slots.filter((s) => s.dayOfWeek === todayDayOfWeek) : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load meal logging screen.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [token]);

  async function onLog(slot: MealPlanSlot) {
    if (!token) return;
    try {
      await logMeal({
        token,
        mealType: slot.mealType as "breakfast" | "lunch" | "dinner" | "snack",
        memberId: selectedMemberId,
        recipeId: slot.recipeId,
        description: slot.recipeName,
        quantityEaten: null,
        notes: null,
        loggedVia: "manual",
      });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to log meal.");
    }
  }

  return (
    <AppScreen>
      {error ? <InlineMessage text={error} tone="danger" /> : null}
      {loading ? <ActivityIndicator color={colors.primary} /> : null}

      <SectionCard>
        <SectionTitle title="Who ate?" subtitle="Choose a person or log for the whole household." />
        <View style={styles.memberRow}>
          <Chip label="Whole household" active={selectedMemberId === null} onPress={() => setSelectedMemberId(null)} />
          {members.map((m) => (
            <Chip key={m.id} label={m.name} active={selectedMemberId === m.id} onPress={() => setSelectedMemberId(m.id)} />
          ))}
        </View>
      </SectionCard>

      <SectionCard>
        <SectionTitle title="Today’s meals" subtitle={`Day ${todayDayOfWeek}`} />
        {!loading && mealPlanSlots.length === 0 ? <EmptyState title="Nothing to log yet" subtitle="Create a meal plan first, then log what was actually eaten." /> : null}
        {mealPlanSlots.map((slot) => (
          <View key={slot.id} style={styles.slotCard}>
            <Text style={styles.slotTitle}>{slot.mealType}</Text>
            <Text style={styles.slotMeta}>{slot.recipeName ?? "No recipe selected"}</Text>
            <PrimaryButton title="Log this meal" onPress={() => void onLog(slot)} />
          </View>
        ))}
      </SectionCard>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  memberRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  slotCard: {
    borderRadius: 18,
    backgroundColor: colors.backgroundAlt,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    gap: 8,
  },
  slotTitle: { fontSize: 16, fontWeight: "800", color: colors.text, textTransform: "capitalize" },
  slotMeta: { color: colors.textMuted },
});
