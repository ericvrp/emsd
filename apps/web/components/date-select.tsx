"use client";

import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import type { ComponentType } from "react";
import { cn } from "../lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

type DateSelectProps = {
  availableDays: string[];
  canGoBackward: boolean;
  canGoForward: boolean;
  firstDay: string | null;
  lastDay: string | null;
  onSelectDay: (day: string) => void;
  onSelectFirstDay: () => void;
  onSelectLastDay: () => void;
  onSelectNextDay: () => void;
  onSelectPreviousDay: () => void;
  selectedDay: string | null;
};

export function DateSelect({
  availableDays,
  canGoBackward,
  canGoForward,
  firstDay,
  lastDay,
  onSelectDay,
  onSelectFirstDay,
  onSelectLastDay,
  onSelectNextDay,
  onSelectPreviousDay,
  selectedDay,
}: DateSelectProps) {
  return (
    <div className="flex justify-center">
      <div className="flex flex-wrap items-center justify-center gap-2 rounded-2xl border border-white/10 bg-slate-950/55 p-2">
        <TapeDeckButton
          disabled={!firstDay || selectedDay === firstDay}
          icon={ChevronsLeft}
          label="First day"
          onClick={onSelectFirstDay}
        />
        <TapeDeckButton
          disabled={!canGoBackward}
          icon={ChevronLeft}
          label="Previous day"
          onClick={onSelectPreviousDay}
        />
        <Select
          disabled={selectedDay === null}
          onValueChange={onSelectDay}
          {...(selectedDay ? { value: selectedDay } : {})}
        >
          <SelectTrigger className="h-10 w-auto min-w-0 justify-center border-white/8 bg-white/5 px-3 text-center text-sm [&>span]:text-center [&_svg]:hidden">
            <SelectValue placeholder="Choose day" />
          </SelectTrigger>
          <SelectContent>
            {availableDays.map((day) => (
              <SelectItem key={day} value={day}>
                {formatDatePickerLabel(day)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <TapeDeckButton
          disabled={!canGoForward}
          icon={ChevronRight}
          label="Next day"
          onClick={onSelectNextDay}
        />
        <TapeDeckButton
          disabled={!lastDay || selectedDay === lastDay}
          icon={ChevronsRight}
          label="Current day"
          onClick={onSelectLastDay}
        />
      </div>
    </div>
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
        "inline-flex h-10 w-10 items-center justify-center rounded-lg border text-sm font-medium transition",
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

function formatDatePickerLabel(dayKey: string): string {
  return new Intl.DateTimeFormat(undefined, {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(`${dayKey}T00:00:00.000Z`));
}
