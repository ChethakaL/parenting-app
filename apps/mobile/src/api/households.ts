import { apiFetch } from "./client";

export type Member = {
  id: string;
  name: string;
  gender: string;
  dateOfBirth: string | null;
  role: string;
  avatarUrl: string | null;
  ageYears: number;
  ageMonths: number;
};

export type GetHouseholdMeResponse = {
  household: { id: string; name: string | null };
  members: Member[];
  onboarded: boolean;
};

export async function getHouseholdMe(token: string) {
  return apiFetch<GetHouseholdMeResponse>({
    path: "/households/me",
    method: "GET",
    token,
  });
}

export async function addHouseholdMember(args: {
  token: string;
  name: string;
  gender: "male" | "female" | "other";
  dateOfBirth: string; // YYYY-MM-DD
  avatarUrl?: string | null;
}) {
  return apiFetch<{ member: Member }>({
    path: "/households/me/members",
    method: "POST",
    token: args.token,
    body: {
      name: args.name,
      gender: args.gender,
      dateOfBirth: args.dateOfBirth,
      avatarUrl: args.avatarUrl ?? null,
    },
  });
}

export async function updateHouseholdMember(args: {
  token: string;
  memberId: string;
  name?: string;
  gender?: "male" | "female" | "other";
  dateOfBirth?: string;
  avatarUrl?: string | null;
}) {
  return apiFetch<{ ok: true }>({
    path: `/households/me/members/${args.memberId}`,
    method: "PUT",
    token: args.token,
    body: {
      name: args.name,
      gender: args.gender,
      dateOfBirth: args.dateOfBirth,
      avatarUrl: args.avatarUrl ?? null,
    },
  });
}

export async function deleteHouseholdMember(args: { token: string; memberId: string }) {
  return apiFetch<{ ok: true }>({
    path: `/households/me/members/${args.memberId}`,
    method: "DELETE",
    token: args.token,
  });
}

