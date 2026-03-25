import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { completeHouseholdOnboarding } from "../api/auth";
import { useAuthStore } from "../store/authStore";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { AppScreen, Chip, Field, HeroCard, InlineMessage, PrimaryButton, SectionCard, SectionTitle } from "../ui/components";
import { colors } from "../ui/theme";

type RootStackParamList = {
  Home: undefined;
  Onboarding: undefined;
  SettingsHousehold: undefined;
};

type Props = NativeStackScreenProps<RootStackParamList, "Onboarding">;

export default function OnboardingHouseholdScreen({ navigation }: Props) {
  const token = useAuthStore((s) => s.token);
  const setToken = useAuthStore((s) => s.setToken);

  const [householdName, setHouseholdName] = useState("");
  const [memberName, setMemberName] = useState("");
  const [gender, setGender] = useState<"male" | "female" | "other">("female");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [allergiesCsv, setAllergiesCsv] = useState("");
  const [allergySeverity, setAllergySeverity] = useState<"critical" | "strong" | "mild">("strong");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit() {
    if (!token) return;
    setError(null);
    setBusy(true);

    const allergies = allergiesCsv
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 20)
      .map((value) => ({ value, severity: allergySeverity }));

    try {
      const res = await completeHouseholdOnboarding({
        token,
        householdName,
        userMember: { name: memberName, gender, dateOfBirth },
        allergies,
        dislikes: [],
        likes: [],
        dietary: [],
      });

      await setToken(token, res.onboarded);
      navigation.replace("Home");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Onboarding failed.");
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <AppScreen scroll={false} contentContainerStyle={styles.centered}>
        <Text>Please log in again.</Text>
      </AppScreen>
    );
  }

  return (
    <AppScreen contentContainerStyle={styles.container}>
      <HeroCard
        eyebrow="Set up once"
        title="Teach ParentAI how your home works."
        description="We’ll use this to guide meal ideas, grocery decisions, and safe recommendations for everyone in the household."
      />

      <SectionCard>
        <SectionTitle title="Household" subtitle="Start with the basics." />
        <Field label="Household name" placeholder="The Rahman Family" value={householdName} onChangeText={setHouseholdName} />
      </SectionCard>

      <SectionCard>
        <SectionTitle title="Primary caregiver" subtitle="This helps personalize the assistant." />
        <Field label="Your name" placeholder="Amina" value={memberName} onChangeText={setMemberName} autoCapitalize="words" />
        <Field label="Date of birth" placeholder="YYYY-MM-DD" value={dateOfBirth} onChangeText={setDateOfBirth} />

        <Text style={styles.label}>Gender</Text>
        <View style={styles.chipRow}>
          {(["female", "male", "other"] as const).map((value) => (
            <Chip key={value} label={value[0].toUpperCase() + value.slice(1)} active={gender === value} onPress={() => setGender(value)} />
          ))}
        </View>
      </SectionCard>

      <SectionCard>
        <SectionTitle title="Critical food notes" subtitle="Add allergies now. Preferences can expand later." />
        <Field label="Allergies" placeholder="peanuts, dairy, shellfish" value={allergiesCsv} onChangeText={setAllergiesCsv} />

        <Text style={styles.label}>Severity</Text>
        <View style={styles.chipRow}>
          {(["critical", "strong", "mild"] as const).map((value) => (
            <Chip
              key={value}
              label={value[0].toUpperCase() + value.slice(1)}
              active={allergySeverity === value}
              tone={value === "critical" ? "danger" : value === "strong" ? "warning" : "success"}
              onPress={() => setAllergySeverity(value)}
            />
          ))}
        </View>
      </SectionCard>

      {error ? <InlineMessage text={error} tone="danger" /> : null}
      <PrimaryButton title="Finish setup" onPress={() => void onSubmit()} loading={busy} />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  container: { paddingBottom: 32 },
  centered: { justifyContent: "center" },
  label: { fontSize: 13, color: colors.text, fontWeight: "700" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
});
