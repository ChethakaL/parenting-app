import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { login, register } from "../api/auth";
import { useAuthStore } from "../store/authStore";
import { AppScreen, Field, HeroCard, InlineMessage, PrimaryButton, SecondaryButton, SectionCard } from "../ui/components";
import { colors } from "../ui/theme";

export default function LoginScreen() {
  const setToken = useAuthStore((s) => s.setToken);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"login" | "register">("login");

  async function onSubmit() {
    setError(null);
    setBusy(true);
    try {
      const res =
        mode === "register"
          ? await register({ email, password, displayName: displayName || undefined })
          : await login({ email, password });

      await setToken(res.token, res.onboarded);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Login failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppScreen contentContainerStyle={styles.container}>
      <HeroCard
        eyebrow="Family food life"
        title="A calmer way to run meals, groceries, and routines."
        description="ParentAI keeps household preferences, meal plans, and shopping decisions in one place."
      />

      <SectionCard>
        <Text style={styles.formTitle}>{mode === "register" ? "Create your account" : "Welcome back"}</Text>
        <Text style={styles.formSubtitle}>
          {mode === "register"
            ? "Set up your household assistant in a few minutes."
            : "Pick up where your family left off."}
        </Text>

        {mode === "register" ? (
          <Field label="Display name" placeholder="Amina" value={displayName} onChangeText={setDisplayName} autoCapitalize="words" />
        ) : null}
        <Field label="Email" placeholder="parent@example.com" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
        <Field label="Password" placeholder="Enter password" value={password} onChangeText={setPassword} secureTextEntry />

        {error ? <InlineMessage text={error} tone="danger" /> : null}

        <PrimaryButton title={mode === "register" ? "Create account" : "Log in"} onPress={() => void onSubmit()} loading={busy} />
        <SecondaryButton
          title={mode === "register" ? "Already have an account?" : "New here? Create account"}
          onPress={() => setMode(mode === "register" ? "login" : "register")}
        />
      </SectionCard>

      <View style={styles.footer}>
        <Text style={styles.footerText}>Made for busy parents balancing meals, preferences, and everyday decisions.</Text>
      </View>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  container: { justifyContent: "center", paddingVertical: 28 },
  formTitle: { fontSize: 24, fontWeight: "800", color: colors.text },
  formSubtitle: { fontSize: 14, lineHeight: 20, color: colors.textMuted, marginBottom: 8 },
  footer: { paddingHorizontal: 8 },
  footerText: { color: colors.textMuted, textAlign: "center", lineHeight: 20 },
});
