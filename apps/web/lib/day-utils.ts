const RELATIVE_DAY_LABELS = {
  today: "Today",
  tomorrow: "Tomorrow",
  yesterday: "Yesterday",
} as const;

export type RelativeDayParam = keyof typeof RELATIVE_DAY_LABELS;

export function formatLocalDayKey(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

export function resolveRelativeDayParam(day: string | null): string | null {
  if (day === null) {
    return null;
  }

  const today = new Date();

  if (day === "today") {
    return formatLocalDayKey(today);
  }

  if (day === "yesterday") {
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    return formatLocalDayKey(yesterday);
  }

  if (day === "tomorrow") {
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return formatLocalDayKey(tomorrow);
  }

  return day;
}

export function getRelativeDayParam(dayKey: string): RelativeDayParam | null {
  const today = new Date();
  const todayKey = formatLocalDayKey(today);

  if (dayKey === todayKey) {
    return "today";
  }

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (dayKey === formatLocalDayKey(yesterday)) {
    return "yesterday";
  }

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (dayKey === formatLocalDayKey(tomorrow)) {
    return "tomorrow";
  }

  return null;
}

export function getRelativeDayLabel(dayKey: string): string | null {
  const relativeDay = getRelativeDayParam(dayKey);

  return relativeDay ? RELATIVE_DAY_LABELS[relativeDay] : null;
}

export function toDayQueryParam(dayKey: string | null): string | null {
  if (dayKey === null) {
    return null;
  }

  return getRelativeDayParam(dayKey) ?? dayKey;
}
