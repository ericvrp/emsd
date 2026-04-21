import {
  DYNAMIC_PRICE_TARGET_BACKUP_RESERVE_MARGIN_PERCENT,
  DYNAMIC_PRICE_TARGET_BUFFER_PERCENT_PER_HOUR,
} from "./dynamic-price-target-defaults";

export interface DynamicReserveFloorPercentResult {
  reserveFloorPercent: number;
  warning: string | null;
}

export function calculateDynamicReserveFloorPercent(input: {
  backupReserveMarginPercent: number | undefined;
  batteryId: string;
  itemId: string;
  minimumDischargePercent: number;
  now: Date;
  reserveUntil: Date | null;
  targetBufferPercentPerHour: number | undefined;
}): DynamicReserveFloorPercentResult {
  const fixedReservePercent =
    input.backupReserveMarginPercent ??
    DYNAMIC_PRICE_TARGET_BACKUP_RESERVE_MARGIN_PERCENT;
  const targetBufferPercentPerHour =
    input.targetBufferPercentPerHour ??
    DYNAMIC_PRICE_TARGET_BUFFER_PERCENT_PER_HOUR;
  const baseReserveFloorPercent = clampPercent(
    input.minimumDischargePercent + fixedReservePercent,
    input.minimumDischargePercent,
  );

  if (input.reserveUntil === null) {
    return {
      reserveFloorPercent: baseReserveFloorPercent,
      warning: `invalid strategy target horizon for ${input.batteryId} (item ${input.itemId}): targetTime is null; using ${baseReserveFloorPercent}% reserve floor`,
    };
  }

  const hoursUntilTarget =
    (input.reserveUntil.getTime() - input.now.getTime()) / (60 * 60 * 1000);

  if (hoursUntilTarget <= 0) {
    return {
      reserveFloorPercent: baseReserveFloorPercent,
      warning: `invalid strategy target horizon for ${input.batteryId} (item ${input.itemId}): targetTime ${input.reserveUntil.toISOString()} is not after now ${input.now.toISOString()}; using ${baseReserveFloorPercent}% reserve floor`,
    };
  }

  return {
    reserveFloorPercent: clampPercent(
      baseReserveFloorPercent +
        Math.round(hoursUntilTarget * targetBufferPercentPerHour),
      input.minimumDischargePercent,
    ),
    warning: null,
  };
}

function clampPercent(value: number, minimum: number): number {
  return Math.max(minimum, Math.min(100, value));
}
