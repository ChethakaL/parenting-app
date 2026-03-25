import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useAuthStore } from "../store/authStore";
import { getMealPlanForCurrentOrNextWeek, generateMealPlan, approveMealPlan, updateMealPlanSlot, type MealPlan } from "../api/mealPlans";
import { AppScreen, EmptyState, Field, InlineMessage, PrimaryButton, SectionCard, SectionTitle } from "../ui/components";
import { colors } from "../ui/theme";

function getClientDayOfWeek(d: Date) {
  const jsDay = d.getDay();
  return ((jsDay + 6) % 7) + 1;
}

export default function MealPlanScreen() {
  const token = useAuthStore((s) => s.token);
  const [loading, setLoading] = useState(true);
  const [mealPlan, setMealPlan] = useState<MealPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [todayEdits, setTodayEdits] = useState<Record<string, string>>({});
  const todayDayOfWeek = useMemo(() => getClientDayOfWeek(new Date()), []);

  async function refresh() {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await getMealPlanForCurrentOrNextWeek(token);
      setMealPlan(res.mealPlan);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load meal plan.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [token]);

  async function onGenerate() {
    if (!token) return;
    try {
      await generateMealPlan({ token });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate meal plan.");
    }
  }

  async function onApprove() {
    if (!token || !mealPlan) return;
    try {
      await approveMealPlan({ token, mealPlanId: mealPlan.id });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to approve meal plan.");
    }
  }

  async function onUpdateSlot(slotId: string) {
    if (!token || !mealPlan) return;
    const next = todayEdits[slotId];
    if (!next?.trim()) return;
    try {
      await updateMealPlanSlot({ token, mealPlanId: mealPlan.id, slotId, patch: { recipeName: next.trim() } });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update slot.");
    }
  }

  const todaySlots = useMemo(() => (mealPlan ? mealPlan.slots.filter((s) => s.dayOfWeek === todayDayOfWeek) : []), [mealPlan, todayDayOfWeek]);

  return (
    <AppScreen>
      {error ? <InlineMessage text={error} tone="danger" /> : null}

      <SectionCard>
        <SectionTitle title={mealPlan ? `Week of ${mealPlan.weekStart}` : "Meal planning"} subtitle={`Status: ${mealPlan?.status ?? "No plan yet"}`} />
        <PrimaryButton title="Generate plan" onPress={() => void onGenerate()} />
        <PrimaryButton title="Approve plan" onPress={() => void onApprove()} disabled={!mealPlan} />
        {loading ? <ActivityIndicator color={colors.primary} /> : null}
      </SectionCard>

      <SectionCard>
        <SectionTitle title="Today’s meals" subtitle={`Day ${todayDayOfWeek}`} />
        {!loading && todaySlots.length === 0 ? <EmptyState title="No meals planned yet" subtitle="Generate a weekly plan or edit today manually." /> : null}
        {todaySlots.map((slot) => (
          <View key={slot.id} style={styles.slotCard}>
            <Text style={styles.slotTitle}>{slot.mealType}</Text>
            <Field
              placeholder="Recipe name"
              value={todayEdits[slot.id] ?? slot.recipeName ?? ""}
              onChangeText={(t) => setTodayEdits((prev) => ({ ...prev, [slot.id]: t }))}
            />
            <PrimaryButton title="Save slot" onPress={() => void onUpdateSlot(slot.id)} />
          </View>
        ))}
      </SectionCard>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  slotCard: {
    borderRadius: 18,
    backgroundColor: colors.backgroundAlt,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    gap: 10,
  },
  slotTitle: { fontSize: 16, fontWeight: "800", color: colors.text, textTransform: "capitalize" },
});
