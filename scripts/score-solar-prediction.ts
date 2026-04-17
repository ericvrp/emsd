import {
  buildPredictedSolarGenerationSeries,
  buildSolarPredictionAccuracySummary,
  getDatabasePath,
  type SolarEnergyProviderSampleRecord,
  type SolarForecastSampleRecord,
  type SolarPredictionAlgorithmVersion,
} from "../packages/core/src/index";
import {
  openDaemonDatabase,
  readSites,
  readSolarEnergyProviderSamples,
  readSolarForecastSamples,
} from "../apps/daemon/src/database";

const DEFAULT_DAY_COUNT = 7;
const ALGORITHM_VERSIONS: SolarPredictionAlgorithmVersion[] = ["v0", "v1", "v2"];

interface ScriptOptions {
  days: number;
  siteId: string | null;
}

interface DayScoreRow {
  date: string;
  energyAccuracyPercentage: number | null;
  energyDeltaWh: number;
  scoringPercentage: number | null;
  timingAccuracyPercentage: number | null;
  totalAbsoluteErrorWh: number;
  totalGeneratedWh: number;
  totalPredictedWh: number;
  usedSamples: number;
}

function parseArgs(args: string[]): ScriptOptions {
  let days = DEFAULT_DAY_COUNT;
  let siteId: string | null = null;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--days") {
      const value = Number(args[index + 1]);
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error("--days must be a positive integer.");
      }
      days = value;
      index += 1;
      continue;
    }

    if (arg === "--site") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("--site requires a site id.");
      }
      siteId = value;
      index += 1;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { days, siteId };
}

function printHelp(): void {
  console.log([
    "Score solar prediction quality for v0, v1, and v2.",
    "",
    "Usage:",
    "  bun run solar:score",
    "  bun run solar:score -- --days 7",
    "  bun run solar:score -- --site <site-id>",
  ].join("\n"));
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
  const forecastDays = new Set(input.forecastSamples.map((sample) => getDayKey(sample.periodStart)));
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

function scoreAlgorithmByDay(input: {
  algorithmVersion: SolarPredictionAlgorithmVersion;
  candidateDays: string[];
  forecastSamples: SolarForecastSampleRecord[];
  generatedSeries: Array<{ periodStart: string; value: number | null }>;
  solarEnergyProviderSamples: SolarEnergyProviderSampleRecord[];
}): DayScoreRow[] {
  const actualByPeriodStart = new Map(
    input.generatedSeries.map((sample) => [sample.periodStart, sample.value]),
  );

  return input.candidateDays.map((day) => {
    const targetForecastSamples = input.forecastSamples.filter(
      (sample) => getDayKey(sample.periodStart) === day,
    );
    const predictedSeries = buildPredictedSolarGenerationSeries({
      algorithmVersion: input.algorithmVersion,
      forecastSamples: input.forecastSamples,
      solarEnergyProviderSamples: input.solarEnergyProviderSamples,
      targetForecastSamples,
    });
    const generatedSeries = targetForecastSamples.map((sample) => ({
      periodStart: sample.periodStart,
      value: actualByPeriodStart.get(sample.periodStart) ?? null,
    }));
    const summary = buildSolarPredictionAccuracySummary({
      generatedSeries,
      predictedSeries,
    });

    return {
      date: day,
      energyAccuracyPercentage: summary.energyAccuracyPercentage,
      energyDeltaWh: summary.energyDeltaWh,
      scoringPercentage: summary.scoringPercentage,
      timingAccuracyPercentage: summary.timingAccuracyPercentage,
      totalAbsoluteErrorWh: summary.totalAbsoluteErrorWh,
      totalGeneratedWh: summary.totalGeneratedWh,
      totalPredictedWh: summary.totalPredictedWh,
      usedSamples: summary.usedSamples,
    };
  });
}

function averageScore(rows: DayScoreRow[]): number | null {
  const values = rows
    .map((row) => row.energyAccuracyPercentage)
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

function averageTimingScore(rows: DayScoreRow[]): number | null {
  const values = rows
    .map((row) => row.timingAccuracyPercentage)
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

function sumBy(rows: DayScoreRow[], selector: (row: DayScoreRow) => number): number {
  return Number(rows.reduce((total, row) => total + selector(row), 0).toFixed(2));
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const db = openDaemonDatabase(getDatabasePath());

  try {
    const sites = readSites(db);
    const site = options.siteId
      ? sites.find((candidate) => candidate.id === options.siteId) ?? null
      : (sites[0] ?? null);

    if (site === null) {
      throw new Error("No sites found in the daemon database.");
    }

    const forecastSamples = readSolarForecastSamples(db, site.id);
    const solarEnergyProviderSamples = readSolarEnergyProviderSamples(db, site.id);

    if (forecastSamples.length === 0 || solarEnergyProviderSamples.length === 0) {
      throw new Error(
        `Site ${site.id} does not have enough forecast and solar history to score predictions.`,
      );
    }

    const generatedSeries = aggregateGenerationByPeriodStart(solarEnergyProviderSamples);
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
    console.log(`Days scored: ${candidateDays.join(", ")}`);

    const scoresByAlgorithm = Object.fromEntries(
      ALGORITHM_VERSIONS.map((algorithmVersion) => [
        algorithmVersion,
        scoreAlgorithmByDay({
          algorithmVersion,
          candidateDays,
          forecastSamples,
          generatedSeries,
          solarEnergyProviderSamples,
        }),
      ]),
    ) as Record<SolarPredictionAlgorithmVersion, DayScoreRow[]>;

    console.log("\nAverage scores:");
    console.table(
      ALGORITHM_VERSIONS.map((algorithmVersion) => {
        const rows = scoresByAlgorithm[algorithmVersion];
        return {
          algorithm: algorithmVersion,
          averageEnergyAccuracy: averageScore(rows),
          averageTimingAccuracy: averageTimingScore(rows),
          totalEnergyDeltaWh: sumBy(rows, (row) => row.energyDeltaWh),
          totalAbsoluteErrorWh: sumBy(rows, (row) => row.totalAbsoluteErrorWh),
          totalGeneratedWh: sumBy(rows, (row) => row.totalGeneratedWh),
          totalPredictedWh: sumBy(rows, (row) => row.totalPredictedWh),
          totalUsedSamples: sumBy(rows, (row) => row.usedSamples),
        };
      }),
    );

    console.log("\nPer-day scores:");
    console.table(
      candidateDays.map((day) => ({
        date: day,
        v0Energy:
          scoresByAlgorithm.v0.find((row) => row.date === day)
            ?.energyAccuracyPercentage ?? null,
        v1Energy:
          scoresByAlgorithm.v1.find((row) => row.date === day)
            ?.energyAccuracyPercentage ?? null,
        v2Energy:
          scoresByAlgorithm.v2.find((row) => row.date === day)
            ?.energyAccuracyPercentage ?? null,
        v0Timing:
          scoresByAlgorithm.v0.find((row) => row.date === day)
            ?.timingAccuracyPercentage ?? null,
        v1Timing:
          scoresByAlgorithm.v1.find((row) => row.date === day)
            ?.timingAccuracyPercentage ?? null,
        v2Timing:
          scoresByAlgorithm.v2.find((row) => row.date === day)
            ?.timingAccuracyPercentage ?? null,
      })),
    );
  } finally {
    db.close();
  }
}

await main();
