import type { FixedImportPriceConfig, PricePointRecord } from "@emsd/core";
import type { PricePlugin, PriceRequest } from "./index";
import { createDynamicPriceSnapshot } from "./index";

const PERIOD_MINUTES = 15;

export const fixedImportPricePlugin: PricePlugin = {
  id: "fixed-import-price",
  name: "Fixed import price",
  async fetchPrices(input: PriceRequest) {
    const config = parseFixedImportPriceConfig(input.source.config);
    const points = createFixedPricePoints(config, new Date());

    return createDynamicPriceSnapshot(input, {
      currency: config.currency,
      points,
      providerLabel: this.name,
    });
  },
};

export function createFixedImportPriceConfig(
  importPrice: number,
): FixedImportPriceConfig {
  if (!Number.isFinite(importPrice) || importPrice < 0) {
    throw new Error("Fixed import price must be a finite non-negative number.");
  }

  return {
    currency: "EUR",
    slots: [
      {
        importPrice,
        startTime: null,
        endTime: null,
        isoWeekdays: null,
      },
    ],
  };
}

function parseFixedImportPriceConfig(config: unknown): FixedImportPriceConfig {
  if (!config || typeof config !== "object") {
    throw new Error("Fixed import price provider requires config_json.");
  }

  const candidate = config as FixedImportPriceConfig;

  if (candidate.currency !== "EUR") {
    throw new Error("Fixed import price provider only supports EUR currency.");
  }

  if (!Array.isArray(candidate.slots) || candidate.slots.length === 0) {
    throw new Error("Fixed import price provider requires at least one slot.");
  }

  for (const slot of candidate.slots) {
    if (!Number.isFinite(slot.importPrice) || slot.importPrice < 0) {
      throw new Error("Fixed import price slot price must be non-negative.");
    }

    validateTime(slot.startTime, "startTime");
    validateTime(slot.endTime, "endTime");

    if (
      slot.isoWeekdays !== null &&
      (!Array.isArray(slot.isoWeekdays) ||
        slot.isoWeekdays.some(
          (weekday) => !Number.isInteger(weekday) || weekday < 1 || weekday > 7,
        ))
    ) {
      throw new Error("Fixed import price weekdays must be ISO weekdays 1-7.");
    }
  }

  return candidate;
}

function validateTime(value: string | null, field: string): void {
  if (value === null) {
    return;
  }

  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new Error(`Fixed import price ${field} must use HH:mm.`);
  }
}

function createFixedPricePoints(
  config: FixedImportPriceConfig,
  now: Date,
): PricePointRecord[] {
  const start = startOfLocalDay(now);
  const points: PricePointRecord[] = [];

  for (let index = 0; index < (24 * 60 * 2) / PERIOD_MINUTES; index += 1) {
    const startsAt = new Date(
      start.getTime() + index * PERIOD_MINUTES * 60_000,
    );
    const slot = config.slots.find((entry) => matchesSlot(entry, startsAt));

    if (!slot) {
      throw new Error(
        `No fixed import price slot matches ${startsAt.toISOString()}.`,
      );
    }

    points.push({
      currency: config.currency,
      importPrice: slot.importPrice,
      startsAt: startsAt.toISOString(),
    });
  }

  return points;
}

function startOfLocalDay(value: Date): Date {
  return new Date(
    value.getFullYear(),
    value.getMonth(),
    value.getDate(),
    0,
    0,
    0,
    0,
  );
}

function matchesSlot(
  slot: FixedImportPriceConfig["slots"][number],
  value: Date,
): boolean {
  if (slot.isoWeekdays) {
    const weekday = value.getDay() === 0 ? 7 : value.getDay();

    if (!slot.isoWeekdays.includes(weekday)) {
      return false;
    }
  }

  if (slot.startTime === null && slot.endTime === null) {
    return true;
  }

  const minutes = value.getHours() * 60 + value.getMinutes();
  const start = slot.startTime ? parseTimeMinutes(slot.startTime) : 0;
  const end = slot.endTime ? parseTimeMinutes(slot.endTime) : 24 * 60;

  return minutes >= start && minutes < end;
}

function parseTimeMinutes(value: string): number {
  const [hours = 0, minutes = 0] = value.split(":").map(Number);
  return hours * 60 + minutes;
}
