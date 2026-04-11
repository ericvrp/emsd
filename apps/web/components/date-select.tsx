"use client";

import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import type { ComponentType } from "react";
import { getRelativeDayLabel } from "../lib/day-utils";
import { cn } from "../lib/utils";
import { useAppLocale } from "./locale-provider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

const DATE_SELECT_TRIGGER_CLASSNAME =
  "h-9 w-[8rem] justify-center whitespace-nowrap border-white/8 bg-white/5 px-3 text-center text-sm [&>span]:block [&>span]:truncate [&>span]:whitespace-nowrap [&>span]:text-center [&_svg]:hidden";

type DateSelectProps = {
  availableDays: string[];
  canGoBackward: boolean;
  canGoForward: boolean;
  className?: string;
  disabled?: boolean;
  firstDay: string | null;
  lastDay: string | null;
  onSelectDay: (day: string) => void;
  onSelectFirstDay: () => void;
  onSelectLastDay: () => void;
  onSelectNextDay: () => void;
  onSelectPreviousDay: () => void;
  selectedDay: string | null;
  centered?: boolean;
};

export function DateSelect({
  availableDays,
  canGoBackward,
  canGoForward,
  className,
  disabled = false,
  firstDay,
  lastDay,
  onSelectDay,
  onSelectFirstDay,
  onSelectLastDay,
  onSelectNextDay,
  onSelectPreviousDay,
  selectedDay,
  centered = true,
}: DateSelectProps) {
  const locale = useAppLocale();

  return (
    <div className={cn(centered ? "flex justify-center" : "", className)}>
      <div className="flex flex-wrap items-center justify-center gap-1.5">
        <TapeDeckButton
          disabled={disabled || !firstDay || selectedDay === firstDay}
          icon={ChevronsLeft}
          label="First day"
          onClick={onSelectFirstDay}
        />
        <TapeDeckButton
          disabled={disabled || !canGoBackward}
          icon={ChevronLeft}
          label="Previous day"
          onClick={onSelectPreviousDay}
        />
        <Select
          disabled={disabled || selectedDay === null}
          onValueChange={onSelectDay}
          {...(selectedDay ? { value: selectedDay } : {})}
        >
          <SelectTrigger className={DATE_SELECT_TRIGGER_CLASSNAME}>
            <SelectValue placeholder="Choose day" />
          </SelectTrigger>
          <SelectContent>
            {availableDays.map((day) => (
              <SelectItem key={day} value={day}>
                {formatDatePickerLabel(day, locale)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <TapeDeckButton
          disabled={disabled || !canGoForward}
          icon={ChevronRight}
          label="Next day"
          onClick={onSelectNextDay}
        />
        <TapeDeckButton
          disabled={disabled || !lastDay || selectedDay === lastDay}
          icon={ChevronsRight}
          label="Current day"
          onClick={onSelectLastDay}
        />
      </div>
    </div>
  );
}

export function DisabledDateSelect({
  className,
  day,
}: {
  className?: string;
  day: string;
}) {
  return (
    <DateSelect
      availableDays={[day]}
      canGoBackward={false}
      canGoForward={false}
      centered={false}
      disabled
      firstDay={day}
      lastDay={day}
      onSelectDay={() => {}}
      onSelectFirstDay={() => {}}
      onSelectLastDay={() => {}}
      onSelectNextDay={() => {}}
      onSelectPreviousDay={() => {}}
      selectedDay={day}
      {...(className ? { className } : {})}
    />
  );
}

function TapeDeckButton({
  disabled,
  icon: Icon,
  label,
  onClick,
}: {
  disabled: boolean;
  icon: ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      className={cn(
        "inline-flex h-9 w-9 items-center justify-center rounded-lg border text-sm font-medium transition",
        disabled
          ? "cursor-not-allowed border-white/6 bg-white/4 text-slate-500"
          : "border-white/10 bg-white/5 text-slate-100 hover:border-cyan-300/30 hover:bg-cyan-400/10 hover:text-white",
      )}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

function formatDatePickerLabel(dayKey: string, locale: string): string {
  const relativeLabel = getRelativeDayLabel(dayKey);

  if (relativeLabel) {
    return relativeLabel;
  }

  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(`${dayKey}T00:00:00.000Z`));
}
