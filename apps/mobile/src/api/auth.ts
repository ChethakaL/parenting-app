import { apiFetch, AuthToken } from "./client";

export type LoginResponse = { token: string; onboarded: boolean };

export async function register(args: {
  email: string;
  password: string;
  displayName?: string;
}): Promise<LoginResponse> {
  // Register returns a bearer token too, same as backend.
  return await apiFetch<LoginResponse>({
    path: "/auth/register",
    method: "POST",
    body: args,
  });
}

export async function login(args: {
  email: string;
  password: string;
}): Promise<LoginResponse> {
  return await apiFetch<LoginResponse>({
    path: "/auth/login",
    method: "POST",
    body: args,
  });
}

export async function completeHouseholdOnboarding(args: {
  token: AuthToken;
  householdName: string;
  userMember: {
    name: string;
    gender: "male" | "female" | "other";
    dateOfBirth: string; // YYYY-MM-DD
  };
  allergies?: Array<{ value: string; severity?: "critical" | "strong" | "mild" }>;
  dislikes?: Array<{ value: string; severity?: "critical" | "strong" | "mild" }>;
  likes?: string[];
  dietary?: string[];
}) {
  return await apiFetch<{ onboarded: boolean; householdId: string; memberId: string }>({
    path: "/auth/onboarding/household",
    method: "POST",
    token: args.token,
    body: {
      householdName: args.householdName,
      userMember: args.userMember,
      allergies: args.allergies ?? [],
      dislikes: args.dislikes ?? [],
      likes: args.likes ?? [],
      dietary: args.dietary ?? [],
    },
  });
}

