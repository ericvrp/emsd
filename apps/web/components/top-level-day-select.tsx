"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DateSelect } from "./date-select";
import {
  getAvailableLocalDays,
  getCurrentPeriodStart,
  getTodayLocalDayKey,
} from "./history-page";

export function useTopLevelDaySelection({
  archive,
  requestedDay,
}: {
  archive: Parameters<typeof getAvailableLocalDays>[0];
  requestedDay: string | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const availableDays = getAvailableLocalDays(archive);
  const todayKey = getTodayLocalDayKey();
  const selectedDay =
    requestedDay && availableDays.includes(requestedDay)
      ? requestedDay
      : todayKey;
  const selectedDayIndex = availableDays.indexOf(selectedDay);
  const firstDay = availableDays[0] ?? selectedDay;
  const lastDay = availableDays.at(-1) ?? selectedDay;
  const canGoBackward = selectedDayIndex > 0;
  const canGoForward =
    selectedDayIndex >= 0 && selectedDayIndex < availableDays.length - 1;
  const nowMarkerPeriodStart =
    selectedDay === todayKey ? getCurrentPeriodStart() : null;

  function navigate(day: string | null) {
    const params = new URLSearchParams(searchParams.toString());

    if (day) {
      params.set("day", day);
    } else {
      params.delete("day");
    }

    const nextUrl = params.toString()
      ? `${pathname}?${params.toString()}`
      : pathname;
    router.push(nextUrl, { scroll: false });
  }

  return {
    availableDays,
    canGoBackward,
    canGoForward,
    firstDay,
    lastDay,
    nowMarkerPeriodStart,
    selectedDay,
    selectedDayIndex,
    selectDay: navigate,
    selectFirstDay: () => navigate(firstDay),
    selectLastDay: () => navigate(lastDay),
    selectNextDay: () =>
      navigate(
        canGoForward ? (availableDays[selectedDayIndex + 1] ?? null) : null,
      ),
    selectPreviousDay: () =>
      navigate(
        canGoBackward ? (availableDays[selectedDayIndex - 1] ?? null) : null,
      ),
  };
}

export function TopLevelDaySelect({
  daySelection,
}: {
  daySelection: ReturnType<typeof useTopLevelDaySelection>;
}) {
  return (
    <DateSelect
      availableDays={daySelection.availableDays}
      canGoBackward={daySelection.canGoBackward}
      canGoForward={daySelection.canGoForward}
      centered={false}
      firstDay={daySelection.firstDay}
      lastDay={daySelection.lastDay}
      onSelectDay={daySelection.selectDay}
      onSelectFirstDay={daySelection.selectFirstDay}
      onSelectLastDay={daySelection.selectLastDay}
      onSelectNextDay={daySelection.selectNextDay}
      onSelectPreviousDay={daySelection.selectPreviousDay}
      selectedDay={daySelection.selectedDay}
    />
  );
}
