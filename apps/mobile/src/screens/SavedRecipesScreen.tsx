import React, { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useAuthStore } from "../store/authStore";
import { getRecipes, saveRecipeFromText, saveRecipeFromUrl, type Recipe } from "../api/recipes";
import { AppScreen, EmptyState, Field, InlineMessage, PrimaryButton, SectionCard, SectionTitle } from "../ui/components";
import { colors } from "../ui/theme";

export default function SavedRecipesScreen() {
  const token = useAuthStore((s) => s.token);
  const [loading, setLoading] = useState(true);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");

  async function refresh() {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await getRecipes(token, search || undefined, 50);
      setRecipes(res.recipes);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load recipes.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [token]);

  async function onSaveUrl() {
    if (!token) return;
    if (!url.trim()) {
      setError("URL is required.");
      return;
    }
    try {
      await saveRecipeFromUrl({ token, url: url.trim() });
      setUrl("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save recipe from URL.");
    }
  }

  async function onSaveText() {
    if (!token) return;
    if (text.trim().length < 10) {
      setError("Description must be at least 10 characters.");
      return;
    }
    try {
      await saveRecipeFromText({ token, description: text.trim() });
      setText("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save recipe from text.");
    }
  }

  return (
    <AppScreen>
      {error ? <InlineMessage text={error} tone="danger" /> : null}
      {loading ? <ActivityIndicator color={colors.primary} /> : null}

      <SectionCard>
        <SectionTitle title="Search recipes" subtitle="Look through meals you’ve already saved." />
        <Field placeholder="Chicken soup, toddler dinner, halal..." value={search} onChangeText={setSearch} />
        <PrimaryButton title="Search" onPress={() => void refresh()} />
      </SectionCard>

      <SectionCard>
        <SectionTitle title="Save from a link" subtitle="Paste any recipe URL." />
        <Field placeholder="https://example.com/recipe" value={url} onChangeText={setUrl} autoCapitalize="none" />
        <PrimaryButton title="Save from URL" onPress={() => void onSaveUrl()} />
      </SectionCard>

      <SectionCard>
        <SectionTitle title="Save from a description" subtitle="Useful when you only remember the idea." />
        <Field multiline placeholder="One-pan salmon with couscous and roasted vegetables..." value={text} onChangeText={setText} />
        <PrimaryButton title="Save from text" onPress={() => void onSaveText()} />
      </SectionCard>

      <SectionCard>
        <SectionTitle title="Your recipe library" subtitle={`${recipes.length} saved`} />
        {!loading && recipes.length === 0 ? <EmptyState title="No recipes saved yet" subtitle="Save from a URL or describe a meal idea to build your family’s library." /> : null}
        {recipes.map((r) => (
          <View key={r.id} style={styles.recipeCard}>
            <Text style={styles.recipeName}>{r.name}</Text>
            <Text style={styles.recipeMeta}>{r.sourceUrl ? `Source: ${r.sourceUrl}` : "Source not available"}</Text>
          </View>
        ))}
      </SectionCard>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  recipeCard: {
    borderRadius: 18,
    backgroundColor: colors.backgroundAlt,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    gap: 6,
  },
  recipeName: { fontSize: 16, fontWeight: "800", color: colors.text },
  recipeMeta: { color: colors.textMuted, lineHeight: 20 },
});
