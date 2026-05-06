import {
  openDaemonDatabase,
  readSites,
  readSolarEnergyProviderSamples,
  readSolarForecastSamples,
} from "../apps/daemon/src/database";
import {
  DEFAULT_SOLAR_PREDICTION_SMOOTHING_MODE,
  SOLAR_PREDICTION_SMOOTHING_MODES,
  type SolarEnergyProviderSampleRecord,
  type SolarForecastSampleRecord,
  type SolarPredictionSmoothingMode,
  applySolarSeriesSmoothing,
  buildPredictedSolarGenerationSeries,
  buildSolarPredictionAccuracySummary,
  formatSolarPredictionSmoothingMode,
  getDatabasePath,
  isFlagArg,
  parseIntegerArg,
  parseStringArg,
} from "../packages/core/src/index";

const DEFAULT_DAY_COUNT = 7;
const DEFAULT_TOP_COMBINATIONS = 10;

interface ScriptOptions {
  days: number;
  siteId: string | null;
  top: number;
}

interface DayEvaluationRow {
  date: string;
  energyAccuracyPercentage: number | null;
  energyDeltaWh: number;
  overallAccuracyPercentage: number | null;
  timingAccuracyPercentage: number | null;
  totalAbsoluteErrorWh: number;
  totalGeneratedWh: number;
  totalPredictedWh: number;
  usedSamples: number;
}

interface EvaluationCombination {
  generatedSmoothingMode: SolarPredictionSmoothingMode;
  predictedSmoothingMode: SolarPredictionSmoothingMode;
}

interface CombinationEvaluationSummary extends EvaluationCombination {
  averageEnergyAccuracy: number | null;
  averageOverallAccuracy: number | null;
  averageTimingAccuracy: number | null;
  isCurrentServerDefault: boolean;
  totalAbsoluteErrorWh: number;
  totalEnergyDeltaWh: number;
  totalGeneratedWh: number;
  totalPredictedWh: number;
  totalUsedSamples: number;
}

const CURRENT_SERVER_DEFAULT: EvaluationCombination = {
  generatedSmoothingMode: DEFAULT_SOLAR_PREDICTION_SMOOTHING_MODE,
  predictedSmoothingMode: DEFAULT_SOLAR_PREDICTION_SMOOTHING_MODE,
};

function parseArgs(args: string[]): ScriptOptions {
  let days = DEFAULT_DAY_COUNT;
  let siteId: string | null = null;
  let top = DEFAULT_TOP_COMBINATIONS;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    const daysArg = parseIntegerArg(args, index, "--days", (v) =>
      v <= 0 ? "--days must be a positive integer." : null,
    );

    if (daysArg) {
      days = daysArg.value;
      index = daysArg.newIndex;
      continue;
    }

    const siteArg = parseStringArg(args, index, "--site");

    if (siteArg) {
      siteId = siteArg.value;
      index = siteArg.newIndex;
      continue;
    }

    const topArg = parseIntegerArg(args, index, "--top", (v) =>
      v <= 0 ? "--top must be a positive integer." : null,
    );

    if (topArg) {
      top = topArg.value;
      index = topArg.newIndex;
      continue;
    }

    if (isFlagArg(arg, "--help", "-h")) {
      printHelp();
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { days, siteId, top };
}

function printHelp(): void {
  console.log(
    [
      "Evaluate the daemon and UI solar prediction algorithm against local history.",
      "",
      "Usage:",
      "  bun run solar-prediction:evaluate",
      "  bun run solar-prediction:evaluate -- --days=7",
      "  bun run solar-prediction:evaluate -- --site=<site-id>",
      "  bun run solar-prediction:evaluate -- --top=15",
    ].join("\n"),
  );
}

function getDayKey(timestamp: string): string {
  return timestamp.slice(0, 10);
}

function aggregateGenerationByPeriodStart(
  samples: SolarEnergyProviderSampleRecord[],
): Array<{ periodStart: string; value: number | null }> {
  const aggregated = new Map<string, { hasValue: boolean; total: number }>();

  for (const sample of samples) {
    const current = aggregated.get(sample.periodStart) ?? {
      hasValue: false,
      total: 0,
    };

    if (typeof sample.powerW === "number") {
      current.hasValue = true;
      current.total += sample.powerW;
    }

    aggregated.set(sample.periodStart, current);
  }

  return [...aggregated.entries()]
    .map(([periodStart, entry]) => ({
      periodStart,
      value: entry.hasValue ? entry.total : null,
    }))
    .sort(
      (left, right) =>
        new Date(left.periodStart).getTime() -
        new Date(right.periodStart).getTime(),
    );
}

function collectCandidateDays(input: {
  days: number;
  forecastSamples: SolarForecastSampleRecord[];
  generatedSeries: Array<{ periodStart: string; value: number | null }>;
}): string[] {
  const forecastDays = new Set(
    input.forecastSamples.map((sample) => getDayKey(sample.periodStart)),
  );
  const generatedDays = new Set(
    input.generatedSeries
      .filter((sample) => typeof sample.value === "number")
      .map((sample) => getDayKey(sample.periodStart)),
  );
  const todayKey = new Date().toISOString().slice(0, 10);

  return [...forecastDays]
    .filter((day) => day < todayKey && generatedDays.has(day))
    .sort((left, right) => right.localeCompare(left))
    .slice(0, input.days)
    .sort((left, right) => left.localeCompare(right));
}

function evaluateCombinationByDay(input: {
  candidateDays: string[];
  combination: EvaluationCombination;
  forecastSamples: SolarForecastSampleRecord[];
  generatedSeries: Array<{ periodStart: string; value: number | null }>;
  solarEnergyProviderSamples: SolarEnergyProviderSampleRecord[];
}): DayEvaluationRow[] {
  const actualByPeriodStart = new Map(
    input.generatedSeries.map((sample) => [sample.periodStart, sample.value]),
  );

  return input.candidateDays.map((day) => {
    const targetForecastSamples = input.forecastSamples.filter(
      (sample) => getDayKey(sample.periodStart) === day,
    );
    const predictedSeries = applySolarSeriesSmoothing(
      buildPredictedSolarGenerationSeries({
        forecastSamples: input.forecastSamples,
        solarEnergyProviderSamples: input.solarEnergyProviderSamples,
        targetForecastSamples,
      }),
      input.combination.predictedSmoothingMode,
    );
    const generatedSeries = applySolarSeriesSmoothing(
      targetForecastSamples.map((sample) => ({
        periodStart: sample.periodStart,
        value: actualByPeriodStart.get(sample.periodStart) ?? null,
      })),
      input.combination.generatedSmoothingMode,
    );
    const summary = buildSolarPredictionAccuracySummary({
      generatedSeries,
      predictedSeries,
    });

    return {
      date: day,
      energyAccuracyPercentage: summary.energyAccuracyPercentage,
      energyDeltaWh: summary.energyDeltaWh,
      overallAccuracyPercentage: summary.overallAccuracyPercentage,
      timingAccuracyPercentage: summary.timingAccuracyPercentage,
      totalAbsoluteErrorWh: summary.totalAbsoluteErrorWh,
      totalGeneratedWh: summary.totalGeneratedWh,
      totalPredictedWh: summary.totalPredictedWh,
      usedSamples: summary.usedSamples,
    };
  });
}

function averageValue(
  rows: DayEvaluationRow[],
  selector: (row: DayEvaluationRow) => number | null,
) {
  const values = rows
    .map(selector)
    .filter((value): value is number => typeof value === "number");

  if (values.length === 0) {
    return null;
  }

  return Number(
    (values.reduce((total, value) => total + value, 0) / values.length).toFixed(
      2,
    ),
  );
}

function sumBy(
  rows: DayEvaluationRow[],
  selector: (row: DayEvaluationRow) => number,
): number {
  return Number(
    rows.reduce((total, row) => total + selector(row), 0).toFixed(2),
  );
}

function buildEvaluationCombinations(): EvaluationCombination[] {
  return SOLAR_PREDICTION_SMOOTHING_MODES.flatMap((generatedSmoothingMode) =>
    SOLAR_PREDICTION_SMOOTHING_MODES.map((predictedSmoothingMode) => ({
      generatedSmoothingMode,
      predictedSmoothingMode,
    })),
  );
}

function compareNullableDescending(
  left: number | null,
  right: number | null,
): number {
  if (left === null && right === null) {
    return 0;
  }

  if (left === null) {
    return 1;
  }

  if (right === null) {
    return -1;
  }

  return right - left;
}

function isSameCombination(
  left: EvaluationCombination,
  right: EvaluationCombination,
): boolean {
  return (
    left.generatedSmoothingMode === right.generatedSmoothingMode &&
    left.predictedSmoothingMode === right.predictedSmoothingMode
  );
}

function buildCombinationSummary(
  combination: EvaluationCombination,
  rows: DayEvaluationRow[],
): CombinationEvaluationSummary {
  return {
    ...combination,
    averageEnergyAccuracy: averageValue(
      rows,
      (row) => row.energyAccuracyPercentage,
    ),
    averageOverallAccuracy: averageValue(
      rows,
      (row) => row.overallAccuracyPercentage,
    ),
    averageTimingAccuracy: averageValue(
      rows,
      (row) => row.timingAccuracyPercentage,
    ),
    isCurrentServerDefault: isSameCombination(
      combination,
      CURRENT_SERVER_DEFAULT,
    ),
    totalAbsoluteErrorWh: sumBy(rows, (row) => row.totalAbsoluteErrorWh),
    totalEnergyDeltaWh: sumBy(rows, (row) => row.energyDeltaWh),
    totalGeneratedWh: sumBy(rows, (row) => row.totalGeneratedWh),
    totalPredictedWh: sumBy(rows, (row) => row.totalPredictedWh),
    totalUsedSamples: sumBy(rows, (row) => row.usedSamples),
  };
}

function formatSummaryRow(summary: CombinationEvaluationSummary) {
  return {
    generated: formatSolarPredictionSmoothingMode(
      summary.generatedSmoothingMode,
    ),
    predicted: formatSolarPredictionSmoothingMode(
      summary.predictedSmoothingMode,
    ),
    averageOverallAccuracy: summary.averageOverallAccuracy,
    averageEnergyAccuracy: summary.averageEnergyAccuracy,
    averageTimingAccuracy: summary.averageTimingAccuracy,
    totalEnergyDeltaWh: summary.totalEnergyDeltaWh,
    totalAbsoluteErrorWh: summary.totalAbsoluteErrorWh,
    totalGeneratedWh: summary.totalGeneratedWh,
    totalPredictedWh: summary.totalPredictedWh,
    totalUsedSamples: summary.totalUsedSamples,
    currentServerDefault: summary.isCurrentServerDefault ? "yes" : "",
  };
}

function formatCombinationLabel(combination: EvaluationCombination): string {
  return [
    `generated ${formatSolarPredictionSmoothingMode(combination.generatedSmoothingMode)}`,
    `predicted ${formatSolarPredictionSmoothingMode(combination.predictedSmoothingMode)}`,
  ].join(" | ");
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const db = openDaemonDatabase(getDatabasePath());

  try {
    const sites = readSites(db);
    const site = options.siteId
      ? (sites.find((candidate) => candidate.id === options.siteId) ?? null)
      : (sites[0] ?? null);

    if (site === null) {
      throw new Error("No sites found in the daemon database.");
    }

    const forecastSamples = readSolarForecastSamples(db, site.id);
    const solarEnergyProviderSamples = readSolarEnergyProviderSamples(
      db,
      site.id,
    );

    if (
      forecastSamples.length === 0 ||
      solarEnergyProviderSamples.length === 0
    ) {
      throw new Error(
        `Site ${site.id} does not have enough forecast and solar history to evaluate the solar prediction algorithm.`,
      );
    }

    const generatedSeries = aggregateGenerationByPeriodStart(
      solarEnergyProviderSamples,
    );
    const candidateDays = collectCandidateDays({
      days: options.days,
      forecastSamples,
      generatedSeries,
    });

    if (candidateDays.length === 0) {
      throw new Error(
        `Site ${site.id} does not have ${options.days} complete days with both forecast and solar data.`,
      );
    }

    console.log(`Database: ${getDatabasePath()}`);
    console.log(`Site: ${site.name} (${site.id})`);
    console.log(`Days evaluated: ${candidateDays.join(", ")}`);
    console.log(
      `Current server default: ${formatCombinationLabel(CURRENT_SERVER_DEFAULT)}`,
    );

    const evaluatedCombinations = buildEvaluationCombinations().map(
      (combination) => {
        const rows = evaluateCombinationByDay({
          candidateDays,
          combination,
          forecastSamples,
          generatedSeries,
          solarEnergyProviderSamples,
        });

        return {
          combination,
          rows,
          summary: buildCombinationSummary(combination, rows),
        };
      },
    );

    const rankedSummaries = evaluatedCombinations
      .map((entry) => entry.summary)
      .sort((left, right) => {
        const overallOrder = compareNullableDescending(
          left.averageOverallAccuracy,
          right.averageOverallAccuracy,
        );

        if (overallOrder !== 0) {
          return overallOrder;
        }

        const energyOrder = compareNullableDescending(
          left.averageEnergyAccuracy,
          right.averageEnergyAccuracy,
        );

        if (energyOrder !== 0) {
          return energyOrder;
        }

        return left.totalAbsoluteErrorWh - right.totalAbsoluteErrorWh;
      });

    const currentServerDefaultSummary = rankedSummaries.find(
      (summary) => summary.isCurrentServerDefault,
    );
    const bestSummary = rankedSummaries[0] ?? null;

    console.log("\nCurrent server default:");
    console.table(
      currentServerDefaultSummary
        ? [formatSummaryRow(currentServerDefaultSummary)]
        : [],
    );

    console.log("\nBest combination:");
    console.table(bestSummary ? [formatSummaryRow(bestSummary)] : []);

    console.log(
      `\nTop ${Math.min(options.top, rankedSummaries.length)} combinations:`,
    );
    console.table(
      rankedSummaries
        .slice(0, options.top)
        .map((summary) => formatSummaryRow(summary)),
    );

    if (bestSummary !== null) {
      const bestRows = evaluatedCombinations.find((entry) =>
        isSameCombination(entry.combination, bestSummary),
      )?.rows;
      const currentRows = currentServerDefaultSummary
        ? evaluatedCombinations.find((entry) =>
            isSameCombination(entry.combination, currentServerDefaultSummary),
          )?.rows
        : undefined;

      if (bestRows) {
        console.log("\nPer-day default vs best overall:");
        console.table(
          candidateDays.map((day) => ({
            date: day,
            currentDefaultOverall:
              currentRows?.find((row) => row.date === day)
                ?.overallAccuracyPercentage ?? null,
            bestOverall:
              bestRows.find((row) => row.date === day)
                ?.overallAccuracyPercentage ?? null,
            currentDefaultEnergy:
              currentRows?.find((row) => row.date === day)
                ?.energyAccuracyPercentage ?? null,
            bestEnergy:
              bestRows.find((row) => row.date === day)
                ?.energyAccuracyPercentage ?? null,
            currentDefaultTiming:
              currentRows?.find((row) => row.date === day)
                ?.timingAccuracyPercentage ?? null,
            bestTiming:
              bestRows.find((row) => row.date === day)
                ?.timingAccuracyPercentage ?? null,
          })),
        );
        console.log(
          `Best combination label: ${formatCombinationLabel(bestSummary)}`,
        );
      }
    }
  } finally {
    db.close();
  }
}

await main();
