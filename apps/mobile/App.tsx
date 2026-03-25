import "react-native-gesture-handler";
import React, { useEffect } from "react";
import { StatusBar } from "expo-status-bar";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { NavigationContainer, DefaultTheme } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useAuthStore } from "./src/store/authStore";

import LoginScreen from "./src/screens/LoginScreen";
import OnboardingHouseholdScreen from "./src/screens/OnboardingHouseholdScreen";
import HomeScreen from "./src/screens/HomeScreen";
import SettingsHouseholdScreen from "./src/screens/SettingsHouseholdScreen";
import InventoryScreen from "./src/screens/InventoryScreen";
import GroceryScreen from "./src/screens/GroceryScreen";
import MealPlanScreen from "./src/screens/MealPlanScreen";
import MealLogScreen from "./src/screens/MealLogScreen";
import SavedRecipesScreen from "./src/screens/SavedRecipesScreen";
import AssistantChatScreen from "./src/screens/AssistantChatScreen";
import { colors } from "./src/ui/theme";

export type RootStackParamList = {
  Login: undefined;
  Onboarding: undefined;
  Home: undefined;
  SettingsHousehold: undefined;
  Inventory: undefined;
  Grocery: undefined;
  MealPlan: undefined;
  MealLog: undefined;
  SavedRecipes: undefined;
  AssistantChat: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

const navTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: colors.background,
    card: colors.background,
    text: colors.text,
    border: colors.border,
    primary: colors.primary,
  },
};

export default function App() {
  const loading = useAuthStore((s) => s.loading);
  const token = useAuthStore((s) => s.token);
  const onboarded = useAuthStore((s) => s.onboarded);
  const loadFromStorage = useAuthStore((s) => s.loadFromStorage);

  useEffect(() => {
    void loadFromStorage();
  }, [loadFromStorage]);

  if (loading) {
    return (
      <View style={styles.loadingScreen}>
        <View style={styles.loadingBadge}>
          <Text style={styles.loadingBadgeText}>ParentAI</Text>
        </View>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <NavigationContainer theme={navTheme}>
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: colors.background },
          headerShadowVisible: false,
          headerTintColor: colors.text,
          headerTitleStyle: { fontWeight: "700" },
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        {!token ? (
          <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
        ) : onboarded ? (
          <>
            <Stack.Screen name="Home" component={HomeScreen} options={{ headerShown: false }} />
            <Stack.Screen name="SettingsHousehold" component={SettingsHouseholdScreen} options={{ headerShown: false }} />
            <Stack.Screen name="Inventory" component={InventoryScreen} options={{ headerShown: false }} />
            <Stack.Screen name="Grocery" component={GroceryScreen} options={{ headerShown: false }} />
            <Stack.Screen name="MealPlan" component={MealPlanScreen} options={{ headerShown: false }} />
            <Stack.Screen name="MealLog" component={MealLogScreen} options={{ headerShown: false }} />
            <Stack.Screen name="SavedRecipes" component={SavedRecipesScreen} options={{ headerShown: false }} />
            <Stack.Screen name="AssistantChat" component={AssistantChatScreen} options={{ headerShown: false }} />
          </>
        ) : (
          <Stack.Screen name="Onboarding" component={OnboardingHouseholdScreen} options={{ headerShown: false }} />
        )}
      </Stack.Navigator>
      <StatusBar style="dark" />
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  loadingScreen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 18,
    backgroundColor: colors.background,
  },
  loadingBadge: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: colors.primaryDark,
  },
  loadingBadgeText: {
    color: "#fff",
    fontWeight: "800",
    fontSize: 16,
  },
});
