import {
  PRICE_SELECTION_WINDOW_MS,
  findPriceSelections,
  type HistoryArchive,
} from "@emsd/core";

export function buildPriceMarkerPeriodStarts(archive: HistoryArchive): {
  lowestMarkerPeriodStarts: string[];
  highestMarkerPeriodStarts: string[];
} {
  const selections = findPriceSelections(
    archive.dynamicPriceSamples.map((sample) => ({
      periodStart: sample.periodStart,
      value: sample.importPrice,
    })),
    PRICE_SELECTION_WINDOW_MS,
  );

  return {
    lowestMarkerPeriodStarts: selections.lowest.map(
      (point) => point.periodStart,
    ),
    highestMarkerPeriodStarts: selections.highest.map(
      (point) => point.periodStart,
    ),
  };
}
