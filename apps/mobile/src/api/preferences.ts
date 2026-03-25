import { apiFetch } from "./client";

export type MemberPreference = {
  id: string;
  type: "allergy" | "dislike" | "like" | "diet";
  value: string;
  severity: "critical" | "strong" | "mild" | null;
  source: "manual" | "ai_learned" | "imported";
  ai_confidence: number | null;
  notes: string | null;
  created_at: string | Date;
  updated_at: string | Date;
};

export async function getMemberPreferences(token: string, memberId: string) {
  return apiFetch<{ preferences: MemberPreference[] }>({
    path: `/members/${memberId}/preferences`,
    method: "GET",
    token,
  });
}

export async function addMemberPreference(args: {
  token: string;
  memberId: string;
  type: "allergy" | "dislike" | "like" | "diet";
  value: string;
  severity?: "critical" | "strong" | "mild";
  notes?: string | null;
}) {
  return apiFetch<{ preference: MemberPreference }>({
    path: `/members/${args.memberId}/preferences`,
    method: "POST",
    token: args.token,
    body: {
      type: args.type,
      value: args.value,
      severity: args.severity ?? undefined,
      source: "manual",
      notes: args.notes ?? null,
    },
  });
}

export async function deleteMemberPreference(args: {
  token: string;
  memberId: string;
  prefId: string;
}) {
  return apiFetch<{ ok: true }>({
    path: `/members/${args.memberId}/preferences/${args.prefId}`,
    method: "DELETE",
    token: args.token,
  });
}

