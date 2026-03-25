import React, { ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, radius, shadow, spacing } from "./theme";

export function AppScreen({
  children,
  scroll = true,
  contentContainerStyle,
  style,
}: {
  children: ReactNode;
  scroll?: boolean;
  contentContainerStyle?: StyleProp<ViewStyle>;
  style?: StyleProp<ViewStyle>;
}) {
  const body = scroll ? (
    <ScrollView
      style={styles.fill}
      contentContainerStyle={[styles.scrollContent, contentContainerStyle]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.scrollContent, styles.fill, contentContainerStyle]}>{children}</View>
  );

  return <SafeAreaView style={[styles.safeArea, style]}>{body}</SafeAreaView>;
}

export function ScreenHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
}) {
  return (
    <View style={styles.screenHeader}>
      <View style={styles.fill}>
        <Text style={styles.screenTitle}>{title}</Text>
        {subtitle ? <Text style={styles.screenSubtitle}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

export function BottomNav({
  active,
  onPress,
}: {
  active: "assistant" | "inventory" | "grocery" | "household";
  onPress: (tab: "assistant" | "inventory" | "grocery" | "household") => void;
}) {
  const tabs: Array<{ key: "assistant" | "inventory" | "grocery" | "household"; label: string; icon: keyof typeof Ionicons.glyphMap | keyof typeof MaterialCommunityIcons.glyphMap; family: "ion" | "mci" }> = [
    { key: "assistant", label: "Assistant", icon: "sparkles-outline", family: "ion" },
    { key: "inventory", label: "Inventory", icon: "fridge-outline", family: "mci" },
    { key: "grocery", label: "Grocery", icon: "cart-outline", family: "ion" },
    { key: "household", label: "Family", icon: "account-group-outline", family: "mci" },
  ];

  return (
    <View style={styles.bottomNav}>
      {tabs.map((tab) => {
        const isActive = tab.key === active;
        return (
          <Pressable key={tab.key} onPress={() => onPress(tab.key)} style={[styles.bottomNavItem, isActive ? styles.bottomNavItemActive : null]}>
            {tab.family === "ion" ? (
              <Ionicons name={tab.icon as keyof typeof Ionicons.glyphMap} size={20} style={[styles.bottomNavIcon, isActive ? styles.bottomNavIconActive : null]} />
            ) : (
              <MaterialCommunityIcons name={tab.icon as keyof typeof MaterialCommunityIcons.glyphMap} size={21} style={[styles.bottomNavIcon, isActive ? styles.bottomNavIconActive : null]} />
            )}
            <Text style={[styles.bottomNavLabel, isActive ? styles.bottomNavLabelActive : null]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function HeroCard({
  eyebrow,
  title,
  description,
  trailing,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  trailing?: ReactNode;
}) {
  return (
    <View style={styles.heroCard}>
      <View style={styles.heroGlow} />
      <View style={styles.heroContent}>
        {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
        <Text style={styles.heroTitle}>{title}</Text>
        {description ? <Text style={styles.heroDescription}>{description}</Text> : null}
        {trailing ? <View style={styles.heroTrailing}>{trailing}</View> : null}
      </View>
    </View>
  );
}

export function SectionCard({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionTitle({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <View style={styles.sectionTitleRow}>
      <View style={styles.fill}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}
      </View>
      {action}
    </View>
  );
}

export function PrimaryButton({
  title,
  onPress,
  disabled,
  loading,
  style,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.primaryButton,
        pressed && !disabled ? styles.buttonPressed : null,
        disabled ? styles.buttonDisabled : null,
        style,
      ]}
    >
      {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>{title}</Text>}
    </Pressable>
  );
}

export function SecondaryButton({
  title,
  onPress,
  tone = "default",
}: {
  title: string;
  onPress: () => void;
  tone?: "default" | "danger" | "soft";
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.secondaryButton,
        tone === "danger" ? styles.secondaryDanger : null,
        tone === "soft" ? styles.secondarySoft : null,
        pressed ? styles.buttonPressed : null,
      ]}
    >
      <Text style={[styles.secondaryButtonText, tone === "danger" ? styles.secondaryDangerText : null]}>{title}</Text>
    </Pressable>
  );
}

export function Chip({
  label,
  active,
  onPress,
  tone = "default",
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
  tone?: "default" | "danger" | "warning" | "success";
}) {
  const toneStyle =
    tone === "danger"
      ? styles.chipDanger
      : tone === "warning"
        ? styles.chipWarning
        : tone === "success"
          ? styles.chipSuccess
          : null;

  const toneTextStyle =
    tone === "danger"
      ? styles.chipDangerText
      : tone === "warning"
        ? styles.chipWarningText
        : tone === "success"
          ? styles.chipSuccessText
          : null;

  const content = (
    <View style={[styles.chip, active ? styles.chipActive : null, toneStyle]}>
      <Text style={[styles.chipText, active ? styles.chipTextActive : null, toneTextStyle]}>{label}</Text>
    </View>
  );

  if (!onPress) return content;

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [pressed ? styles.buttonPressed : null]}>
      {content}
    </Pressable>
  );
}

export function StatPill({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.statPill}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export function Field({
  label,
  multiline,
  style,
  ...props
}: TextInputProps & { label?: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={style}>
      {label ? <Text style={styles.fieldLabel}>{label}</Text> : null}
      <TextInput
        placeholderTextColor={colors.textMuted}
        multiline={multiline}
        style={[styles.field, multiline ? styles.fieldMultiline : null]}
        {...props}
      />
    </View>
  );
}

export function InlineMessage({
  text,
  tone = "default",
}: {
  text: string;
  tone?: "default" | "danger" | "success";
}) {
  return (
    <View
      style={[
        styles.message,
        tone === "danger" ? styles.messageDanger : null,
        tone === "success" ? styles.messageSuccess : null,
      ]}
    >
      <Text
        style={[
          styles.messageText,
          tone === "danger" ? styles.messageDangerText : null,
          tone === "success" ? styles.messageSuccessText : null,
        ]}
      >
        {text}
      </Text>
    </View>
  );
}

export function EmptyState({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={styles.emptyState}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {subtitle ? <Text style={styles.emptySubtitle}>{subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  safeArea: { flex: 1, backgroundColor: colors.background },
  scrollContent: { paddingHorizontal: spacing.lg, paddingTop: 2, paddingBottom: spacing.lg, gap: spacing.md, flexGrow: 1 },
  screenHeader: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md, paddingTop: 2 },
  screenTitle: { color: colors.text, fontSize: 30, fontWeight: "800", letterSpacing: -0.5 },
  screenSubtitle: { color: colors.textMuted, fontSize: 14, lineHeight: 20, marginTop: 4 },
  heroCard: {
    backgroundColor: "#FFD3EA",
    borderRadius: radius.lg,
    overflow: "hidden",
    ...shadow,
  },
  heroGlow: {
    position: "absolute",
    width: 220,
    height: 220,
    borderRadius: 999,
    backgroundColor: "rgba(141,214,255,0.65)",
    right: -60,
    top: -80,
  },
  heroContent: { padding: spacing.xl, gap: spacing.sm },
  eyebrow: { color: "#A63F76", fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1 },
  heroTitle: { color: "#4E2140", fontSize: 30, lineHeight: 36, fontWeight: "800" },
  heroDescription: { color: "#735B79", fontSize: 15, lineHeight: 22 },
  heroTrailing: { marginTop: spacing.sm },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
    ...shadow,
  },
  sectionTitleRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  sectionTitle: { color: colors.text, fontSize: 18, fontWeight: "800" },
  sectionSubtitle: { color: colors.textMuted, fontSize: 14, lineHeight: 20, marginTop: 2 },
  primaryButton: {
    minHeight: 52,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  primaryButtonText: { color: "#fff", fontSize: 15, fontWeight: "800" },
  secondaryButton: {
    minHeight: 44,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
  },
  secondaryButtonText: { color: colors.text, fontWeight: "700", fontSize: 14 },
  secondarySoft: { backgroundColor: colors.backgroundAlt },
  secondaryDanger: { backgroundColor: colors.dangerSoft, borderColor: "#F0C9C0" },
  secondaryDangerText: { color: colors.danger },
  buttonPressed: { opacity: 0.8 },
  buttonDisabled: { opacity: 0.5 },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.textMuted, fontWeight: "700" },
  chipTextActive: { color: "#fff" },
  chipDanger: { backgroundColor: colors.dangerSoft, borderColor: "#F0C9C0" },
  chipWarning: { backgroundColor: colors.warningSoft, borderColor: "#ECD9A1" },
  chipSuccess: { backgroundColor: colors.successSoft, borderColor: "#BFE4CF" },
  chipDangerText: { color: colors.danger },
  chipWarningText: { color: colors.warning },
  chipSuccessText: { color: colors.success },
  statPill: {
    minWidth: 92,
    backgroundColor: "rgba(255,255,255,0.7)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.95)",
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    borderRadius: radius.md,
    gap: 2,
  },
  statValue: { color: colors.text, fontSize: 20, fontWeight: "800" },
  statLabel: { color: colors.textMuted, fontSize: 12, fontWeight: "600" },
  fieldLabel: { color: colors.text, fontSize: 13, fontWeight: "700", marginBottom: 8 },
  field: {
    minHeight: 50,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.backgroundAlt,
    paddingHorizontal: spacing.md,
    color: colors.text,
    fontSize: 15,
  },
  fieldMultiline: { minHeight: 110, textAlignVertical: "top", paddingTop: 14 },
  message: {
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    backgroundColor: colors.surfaceMuted,
  },
  messageDanger: { backgroundColor: colors.dangerSoft },
  messageSuccess: { backgroundColor: colors.successSoft },
  messageText: { color: colors.text, fontWeight: "600" },
  messageDangerText: { color: colors.danger },
  messageSuccessText: { color: colors.success },
  emptyState: {
    borderRadius: radius.md,
    padding: spacing.xl,
    backgroundColor: colors.surfaceMuted,
    alignItems: "center",
    gap: spacing.xs,
  },
  emptyTitle: { color: colors.text, fontSize: 17, fontWeight: "800", textAlign: "center" },
  emptySubtitle: { color: colors.textMuted, fontSize: 14, lineHeight: 20, textAlign: "center" },
  bottomNav: {
    flexDirection: "row",
    backgroundColor: "rgba(255,255,255,0.98)",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: 8,
    gap: 8,
    ...shadow,
  },
  bottomNavItem: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    borderRadius: radius.md,
    gap: 3,
  },
  bottomNavItemActive: { backgroundColor: colors.accentSoft },
  bottomNavIcon: { color: colors.textMuted },
  bottomNavIconActive: { color: colors.primaryDark },
  bottomNavLabel: { color: colors.textMuted, fontSize: 11, fontWeight: "800" },
  bottomNavLabelActive: { color: colors.primaryDark },
});
