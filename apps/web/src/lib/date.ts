export function startOfWeekMonday(input: Date): Date {
  // JS: Sunday=0 ... Saturday=6
  const day = input.getDay();
  const diffToMonday = (day + 6) % 7; // Monday =>0, Sunday =>6
  const d = new Date(input);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - diffToMonday);
  return d;
}

export function formatISODate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

