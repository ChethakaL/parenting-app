export type MemberRole = "adult" | "child" | "infant";

export function computeRole(dateOfBirth: string): MemberRole {
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) {
    throw new Error("Invalid date_of_birth.");
  }

  const now = new Date();
  const ageYears = (now.getTime() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000);

  if (ageYears < 1) return "infant";
  if (ageYears < 18) return "child";
  return "adult";
}

export function computeAge(dateOfBirth: string): { ageYears: number; ageMonths: number } {
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) {
    return { ageYears: 0, ageMonths: 0 };
  }

  const now = new Date();
  const ageMonths = (now.getTime() - dob.getTime()) / (30.4375 * 24 * 60 * 60 * 1000);
  const ageYears = ageMonths / 12;

  return { ageYears, ageMonths };
}

