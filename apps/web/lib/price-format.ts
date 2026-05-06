export function computeExportPrice(
  importPrice: number,
  exportDeduction: number | undefined,
): number {
  return importPrice - (exportDeduction ?? 0.13);
}

export function getActivePricePointAtOrBefore<
  T extends { periodStart: string } | { startsAt: string },
>(points: T[], timestamp: number | string): T | null {
  const targetTime =
    typeof timestamp === "number" ? timestamp : new Date(timestamp).getTime();
  let activePoint: T | null = null;

  for (const point of points) {
    const pointTime = new Date(
      "periodStart" in point ? point.periodStart : point.startsAt,
    ).getTime();

    if (pointTime <= targetTime) {
      activePoint = point;
      continue;
    }

    break;
  }

  return activePoint;
}

export function formatPricePerKwh(value: number, currency: string): string {
  return `${value.toFixed(3)} ${currency}/kWh`;
}

export function formatCurrencyAmount(value: number, currency: string): string {
  return `${value.toFixed(2)} ${currency}`;
}
