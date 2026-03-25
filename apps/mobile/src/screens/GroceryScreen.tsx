import React, { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useAuthStore } from "../store/authStore";
import { getGrocery, purchaseGroceryItem, removeGroceryItem, type GroceryGrouped, type GroceryItem } from "../api/grocery";
import { AppScreen, BottomNav, Chip, EmptyState, InlineMessage, ScreenHeader, SecondaryButton, SectionCard, SectionTitle } from "../ui/components";
import { colors } from "../ui/theme";

type RootStackParamList = {
  Home: undefined;
  Inventory: undefined;
  Grocery: undefined;
  SettingsHousehold: undefined;
};

type Props = NativeStackScreenProps<RootStackParamList, "Grocery">;

export default function GroceryScreen({ navigation }: Props) {
  const token = useAuthStore((s) => s.token);
  const [loading, setLoading] = useState(true);
  const [grouped, setGrouped] = useState<GroceryGrouped | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      setGrouped(await getGrocery(token));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load grocery list.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [token]);

  async function onPurchase(id: string) {
    if (!token) return;
    try {
      await purchaseGroceryItem({ token, id });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to mark purchased.");
    }
  }

  async function onRemove(id: string) {
    if (!token) return;
    try {
      await removeGroceryItem({ token, id, addBackToInventory: false });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove item.");
    }
  }

  function renderGroup(title: string, items: GroceryItem[], tone: "danger" | "warning" | "success") {
    return (
      <SectionCard>
        <SectionTitle title={title} subtitle={`${items.length} item${items.length === 1 ? "" : "s"}`} action={<Chip label={title.split(" ")[0]} tone={tone} />} />
        {items.length === 0 ? <EmptyState title="Nothing here" subtitle="This bucket is currently clear." /> : null}
        {items.map((i) => (
          <View key={i.id} style={styles.itemCard}>
            <View style={styles.itemText}>
              <Text style={styles.itemName}>{i.name}</Text>
              <Text style={styles.itemMeta}>
                {i.quantity ?? ""} {i.unit ?? ""}
              </Text>
            </View>
            <View style={styles.itemActions}>
              <SecondaryButton title="Bought" onPress={() => void onPurchase(i.id)} />
              <SecondaryButton title="Remove" onPress={() => void onRemove(i.id)} tone="danger" />
            </View>
          </View>
        ))}
      </SectionCard>
    );
  }

  return (
    <AppScreen>
      <ScreenHeader title="Grocery List" subtitle="The assistant can add items by chat. This page keeps the list tidy." />
      {error ? <InlineMessage text={error} tone="danger" /> : null}
      {loading ? <ActivityIndicator color={colors.primary} /> : null}
      {grouped ? (
        <>
          {renderGroup("Urgent restock", grouped.urgent, "danger")}
          {renderGroup("This week", grouped.normal, "warning")}
          {renderGroup("When convenient", grouped.whenAvailable, "success")}
        </>
      ) : null}
      <BottomNav
        active="grocery"
        onPress={(tab) => {
          if (tab === "assistant") navigation.navigate("Home");
          if (tab === "inventory") navigation.navigate("Inventory");
          if (tab === "household") navigation.navigate("SettingsHousehold");
        }}
      />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  itemCard: {
    borderRadius: 18,
    backgroundColor: colors.backgroundAlt,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    gap: 10,
  },
  itemText: { gap: 4 },
  itemName: { fontSize: 16, fontWeight: "800", color: colors.text },
  itemMeta: { color: colors.textMuted },
  itemActions: { gap: 8 },
});
