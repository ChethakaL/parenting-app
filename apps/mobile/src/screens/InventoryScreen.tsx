import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useAuthStore } from "../store/authStore";
import { deleteInventoryItem, finishInventoryItem, getInventory, addInventoryItems, updateInventoryItem, type InventoryItem } from "../api/inventory";
import { uploadReceipt } from "../api/receipts";
import {
  AppScreen,
  BottomNav,
  Chip,
  EmptyState,
  Field,
  InlineMessage,
  PrimaryButton,
  SecondaryButton,
  ScreenHeader,
  SectionCard,
  SectionTitle,
} from "../ui/components";
import { colors } from "../ui/theme";

type Filter = "All" | "Fridge" | "Freezer" | "Pantry";

const filters: Filter[] = ["All", "Fridge", "Freezer", "Pantry"];

type RootStackParamList = {
  Home: undefined;
  Inventory: undefined;
  Grocery: undefined;
  SettingsHousehold: undefined;
};

type Props = NativeStackScreenProps<RootStackParamList, "Inventory">;

export default function InventoryScreen({ navigation }: Props) {
  const token = useAuthStore((s) => s.token);
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("All");
  const [search, setSearch] = useState("");
  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("");
  const [category, setCategory] = useState("");
  const [location, setLocation] = useState<"fridge" | "freezer" | "pantry">("fridge");
  const [receiptUploading, setReceiptUploading] = useState(false);
  const [receiptMessage, setReceiptMessage] = useState<string | null>(null);

  async function refresh() {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await getInventory(token);
      setItems(res.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load inventory.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [token]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items
      .filter((i) => (filter === "All" ? true : String(i.location ?? "").toLowerCase() === filter.toLowerCase()))
      .filter((i) => (q ? i.name.toLowerCase().includes(q) : true));
  }, [items, filter, search]);

  async function onAdd() {
    if (!token) return;
    setError(null);
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    try {
      await addInventoryItems({
        token,
        items: [
          {
            name: name.trim(),
            category: category.trim() || null,
            quantity: quantity.trim() ? Number(quantity) : null,
            unit: unit.trim() || null,
            location,
          },
        ],
      });
      setName("");
      setQuantity("");
      setUnit("");
      setCategory("");
      setLocation("fridge");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add inventory item.");
    }
  }

  async function onFinish(id: string) {
    if (!token) return;
    try {
      await finishInventoryItem({ token, id });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to finish item.");
    }
  }

  async function onDelete(id: string) {
    if (!token) return;
    try {
      await deleteInventoryItem({ token, id });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete item.");
    }
  }

  async function onReduce(id: string) {
    if (!token) return;
    const current = items.find((i) => i.id === id);
    if (!current || current.quantity === null) return;
    try {
      const nextQty = Math.max(0, current.quantity - 1);
      await updateInventoryItem({
        token,
        id,
        patch: { quantity: nextQty, status: (nextQty === 0 ? "finished" : current.status) as "in_stock" | "low" | "finished" },
      });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to reduce item.");
    }
  }

  async function onUploadReceipt() {
    if (!token) return;
    setReceiptMessage(null);
    setError(null);
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        setError("Media library permission is required to upload receipts.");
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 0.8,
      });
      if (result.canceled) return;

      const asset = result.assets[0];
      if (!asset?.uri) {
        setError("No image selected.");
        return;
      }

      setReceiptUploading(true);
      const uploadRes = await uploadReceipt({ token, imageUri: asset.uri, mimeType: asset.mimeType });
      setReceiptMessage(`Receipt processed. ${uploadRes.itemsAdded} items added.`);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Receipt upload failed.");
    } finally {
      setReceiptUploading(false);
    }
  }

  return (
    <AppScreen>
      <ScreenHeader title="Inventory" subtitle="Receipt-first for bulk updates, quick add for edge cases." />
      <SectionCard>
        <SectionTitle title="House inventory" subtitle="Track what is already at home before planning more." />
        <Field placeholder="Search inventory" value={search} onChangeText={setSearch} />
        <View style={styles.filterRow}>
          {filters.map((value) => (
            <Chip key={value} label={value} active={filter === value} onPress={() => setFilter(value)} />
          ))}
        </View>
      </SectionCard>

      {error ? <InlineMessage text={error} tone="danger" /> : null}
      {receiptMessage ? <InlineMessage text={receiptMessage} tone="success" /> : null}

      <SectionCard>
        <SectionTitle title="Current items" subtitle={`${filtered.length} shown`} />
        {loading ? <ActivityIndicator color={colors.primary} /> : null}
        {!loading && filtered.length === 0 ? <EmptyState title="No items found" subtitle="Add pantry staples manually or upload a receipt to populate inventory." /> : null}
        {filtered.map((i) => (
          <View key={i.id} style={styles.itemCard}>
            <View style={styles.itemTopRow}>
              <Text style={styles.itemName}>{i.name}</Text>
              <Chip
                label={i.status === "low" ? "Low" : i.status === "finished" ? "Finished" : "In stock"}
                tone={i.status === "low" ? "warning" : i.status === "finished" ? "danger" : "success"}
              />
            </View>
            <Text style={styles.itemMeta}>
              {i.quantity ?? "—"} {i.unit ?? ""} {i.category ? `• ${i.category}` : ""}
            </Text>
            <Text style={styles.itemMeta}>Stored in {i.location ?? "unknown location"}</Text>
            <View style={styles.actions}>
              <SecondaryButton title="Used one" onPress={() => void onReduce(i.id)} />
              <SecondaryButton title="Finished" onPress={() => void onFinish(i.id)} />
              <SecondaryButton title="Delete" onPress={() => void onDelete(i.id)} tone="danger" />
            </View>
          </View>
        ))}
      </SectionCard>

      <SectionCard>
        <SectionTitle title="Add item" subtitle="Quick entry for manual updates." />
        <Field label="Name" placeholder="Greek yogurt" value={name} onChangeText={setName} />
        <View style={styles.twoCol}>
          <Field style={styles.flex} label="Quantity" placeholder="2" value={quantity} onChangeText={setQuantity} keyboardType="numeric" />
          <Field style={styles.flex} label="Unit" placeholder="tubs" value={unit} onChangeText={setUnit} />
        </View>
        <Field label="Category" placeholder="Dairy" value={category} onChangeText={setCategory} />
        <Text style={styles.label}>Location</Text>
        <View style={styles.filterRow}>
          {(["fridge", "freezer", "pantry"] as const).map((value) => (
            <Chip key={value} label={value[0].toUpperCase() + value.slice(1)} active={location === value} onPress={() => setLocation(value)} />
          ))}
        </View>
        <PrimaryButton title="Add to inventory" onPress={() => void onAdd()} />
      </SectionCard>

      <SectionCard>
        <SectionTitle title="Receipt upload" subtitle="Turn a grocery photo into inventory items." />
        <PrimaryButton title="Choose receipt image" onPress={() => void onUploadReceipt()} loading={receiptUploading} />
      </SectionCard>
      <BottomNav
        active="inventory"
        onPress={(tab) => {
          if (tab === "assistant") navigation.navigate("Home");
          if (tab === "grocery") navigation.navigate("Grocery");
          if (tab === "household") navigation.navigate("SettingsHousehold");
        }}
      />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  filterRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  itemCard: {
    borderRadius: 18,
    backgroundColor: colors.backgroundAlt,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    gap: 8,
  },
  itemTopRow: { flexDirection: "row", justifyContent: "space-between", gap: 10, alignItems: "flex-start" },
  itemName: { color: colors.text, fontSize: 17, fontWeight: "800", flex: 1 },
  itemMeta: { color: colors.textMuted, lineHeight: 20 },
  actions: { gap: 8 },
  twoCol: { flexDirection: "row", gap: 10 },
  flex: { flex: 1 },
  label: { fontSize: 13, color: colors.text, fontWeight: "700" },
});
