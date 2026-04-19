import type {
  BatteryManualState,
  BatteryStrategyPlanItem,
} from "../packages/core/src/index";
import { getDatabasePath } from "../packages/core/src/index";
import {
  openDaemonDatabase,
  readBatteries,
  readBatteryPowerSamples,
  readManagedDeviceTelemetry,
  readP1MeterSamples,
  readSites,
  readSolarEnergyProviderSamples,
  readSolarForecastSamples,
} from "../apps/daemon/src/database";
import { estimateStrategyTarget } from "../apps/daemon/src/strategy-estimate";

const DEFAULT_DAYS = 14;
const DEFAULT_POWER_W = 2400;

interface ScriptOptions {
  action: Extract<BatteryManualState, "charging" | "discharging">;
  date: string;
  days: number;
  powerW: number;
  siteId: string | null;
  targets: number[] | null;
  time: string;
  verboseBlocks: Set<VerboseBlock>;
}

type VerboseBlock =
  | "meta"
  | "current"
  | "energy"
  | "why"
  | "break-even"
  | "history"
  | "replay";

const ALL_VERBOSE_BLOCKS: VerboseBlock[] = [
  "meta",
  "current",
  "energy",
  "why",
  "break-even",
  "history",
  "replay",
];

interface ReserveTargetScoreRow {
  averageReplayStopPercentNow: number;
  currentStopPercentNow: number;
  reserveTargetPercent: number;
  samples: number;
  typicalTargetTime: string | null;
}

interface EstimateContext {
  action: ScriptOptions["action"];
  battery: ReturnType<typeof readBatteries>[number];
  batteryId: string;
  candidateDays: string[];
  estimate: ReturnType<typeof estimateStrategyTarget>;
  referenceTime: Date;
  siteId: string;
  siteName: string;
  verboseBlocks: Set<VerboseBlock>;
}

function parseArgs(args: string[]): ScriptOptions {
  let action: ScriptOptions["action"] = "discharging";
  let date = getCurrentLocalDate();
  let days = DEFAULT_DAYS;
  let powerW = DEFAULT_POWER_W;
  let siteId: string | null = null;
  let targets: number[] | null = null;
  let time = getCurrentLocalClockTime();
  const verboseBlocks = new Set<VerboseBlock>();

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

    if (arg === "--date") {
      const value = args[index + 1];

      if (!isIsoDate(value)) {
        throw new Error("--date must use YYYY-MM-DD format.");
      }

      date = value;
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

    if (arg === "--targets") {
      const value = args[index + 1];

      if (!value) {
        throw new Error("--targets requires a comma-separated list.");
      }

      targets = value
        .split(",")
        .map((entry) => Number(entry.trim()))
        .filter((entry) => Number.isFinite(entry) && entry >= 0 && entry <= 100);

      if (targets.length === 0) {
        throw new Error("--targets did not contain any valid percentages.");
      }

      index += 1;
      continue;
    }

    if (arg === "--power") {
      const value = Number(args[index + 1]);

      if (!Number.isFinite(value) || value <= 0) {
        throw new Error("--power must be a positive number.");
      }

      powerW = Math.round(value);
      index += 1;
      continue;
    }

    if (arg === "--time") {
      const value = args[index + 1];

      if (!isClockTime(value)) {
        throw new Error("--time must use HH:MM format.");
      }

      time = value;
      index += 1;
      continue;
    }

    if (arg === "--action") {
      const value = args[index + 1];

      if (value !== "charge" && value !== "discharge") {
        throw new Error("--action must be 'charge' or 'discharge'.");
      }

      action = value === "charge" ? "charging" : "discharging";
      index += 1;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }

    if (arg === "--verbose") {
      for (const block of ALL_VERBOSE_BLOCKS) {
        verboseBlocks.add(block);
      }
      continue;
    }

    if (arg.startsWith("--verbose=")) {
      const value = arg.slice("--verbose=".length);

      for (const block of parseVerboseBlocks(value)) {
        verboseBlocks.add(block);
      }

      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { action, date, days, powerW, siteId, targets, time, verboseBlocks };
}

function printHelp(): void {
  console.log(
    [
      "Replay a synthetic dynamic target action across recent history.",
      "",
      "Defaults:",
      `  action: discharge`,
      `  power: ${DEFAULT_POWER_W}W`,
      "  date: today",
      "  time: current local clock time",
      `  days: ${DEFAULT_DAYS}`,
      "",
      "Usage:",
      "  bun run estimate:score",
      "  bun run estimate:score -- --action charge",
      "  bun run estimate:score -- --date 2026-04-19",
      "  bun run estimate:score -- --power 1800",
      "  bun run estimate:score -- --time 17:30",
      "  bun run estimate:score -- --site <site-id>",
      "  bun run estimate:score -- --targets 10,11,12,13,14,15",
      "  bun run estimate:score -- --verbose",
      "  bun run estimate:score -- --verbose=meta,why,replay",
      `  verbose blocks: ${ALL_VERBOSE_BLOCKS.join(", ")}`,
    ].join("\n"),
  );
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const db = openDaemonDatabase(getDatabasePath());

  try {
    const sites = readSites(db).filter((site) =>
      options.siteId === null ? true : site.id === options.siteId,
    );

    if (sites.length === 0) {
      console.log(
        options.siteId === null
          ? "No sites found."
          : `Site not found: ${options.siteId}`,
      );
      return;
    }

    if (options.verboseBlocks.has("meta")) {
      console.log(
        `Estimating synthetic ${formatActionLabel(options.action)} target at ${options.powerW}W for ${options.date} ${options.time}.`,
      );
      console.log(`Database: ${getDatabasePath()}`);
    }

    for (const site of sites) {
      scoreSite(site.id, options, db);
    }
  } finally {
    db.close();
  }
}

function scoreSite(
  siteId: string,
  options: ScriptOptions,
  db: ReturnType<typeof openDaemonDatabase>,
): void {
  const batteries = readBatteries(db, siteId);
  const telemetry = readManagedDeviceTelemetry(db);
  const batteryPowerSamples = readBatteryPowerSamples(db, siteId);
  const p1MeterSamples = readP1MeterSamples(db, siteId);
  const solarEnergyProviderSamples = readSolarEnergyProviderSamples(db, siteId);
  const solarForecastSamples = readSolarForecastSamples(db, siteId);
  const candidateDays = getCandidateDaysFromBatterySamples(
    batteryPowerSamples,
    options.date,
    options.days,
  );
  const site = readSites(db).find((entry) => entry.id === siteId) ?? null;

  if (batteries.length === 0) {
    console.log(`\nSite ${siteId}: no batteries found.`);
    return;
  }

  if (candidateDays.length === 0) {
    console.log(`\nSite ${siteId}: no recent battery history found to score.`);
    return;
  }

  for (const battery of batteries) {
    const batteryTelemetry = telemetry.find(
      (entry) => entry.kind === "battery" && entry.deviceId === battery.id,
    );

    if (
      batteryTelemetry?.capacityWh === null ||
      batteryTelemetry?.capacityWh === undefined
    ) {
      console.log(
        `${site?.name ?? siteId} (${siteId}) | ${battery.name} (${battery.id}) | capacity unavailable`,
      );
      continue;
    }

    const estimateAt = createReplayTime(options.date, options.time);

    let currentEstimate: ReturnType<typeof estimateStrategyTarget> | null = null;
    const syntheticItem = createSyntheticPlanItem({
      action: options.action,
      battery,
      powerW: options.powerW,
    });
    currentEstimate = estimateStrategyTarget({
      battery,
      batteryPowerSamples,
      dynamicPriceSamples: [],
      item: syntheticItem,
      items: [battery.strategyPlan[0] ?? syntheticItem, syntheticItem],
      now: estimateAt,
      p1MeterSamples,
      sample: {
        capacityWh: batteryTelemetry.capacityWh,
        currentW: null,
        manualChargeTargetSoc: battery.manualChargeTargetSoc,
        manualDischargeTargetSoc: battery.manualDischargeTargetSoc,
        manualPowerW: options.powerW,
        manualState: options.action,
        manualTargetSoc: battery.manualTargetSoc,
        model: battery.model,
        name: battery.name,
        socPercent: null,
        status: battery.status,
        strategyMode: "manual",
      },
      solarEnergyProviderSamples,
      solarForecastSamples,
    });

    printCurrentEstimateSummary({
      action: options.action,
      battery,
      batteryId: battery.id,
      candidateDays,
      estimate: currentEstimate,
      referenceTime: estimateAt,
      siteId,
      siteName: site?.name ?? siteId,
      verboseBlocks: options.verboseBlocks,
    });

    const reserveTargets =
      options.targets ?? buildDefaultReserveTargets(battery.minimumDischargePercent);
    const rows: ReserveTargetScoreRow[] = [];

    for (const reserveTargetPercent of reserveTargets) {
      rows.push(
        scoreReserveTarget({
          action: options.action,
          battery,
          batteryPowerSamples,
          candidateDays,
          capacityWh: batteryTelemetry.capacityWh,
          currentEstimatedRemainingEnergyWh:
            currentEstimate?.estimatedRemainingEnergyWh ?? null,
          p1MeterSamples,
          powerW: options.powerW,
          reserveTargetPercent,
          solarEnergyProviderSamples,
          solarForecastSamples,
          time: options.time,
        }),
      );
    }

    if (options.verboseBlocks.has("replay")) {
      console.log(
        `Reserve examples across ${candidateDays.length} replay day(s): ${candidateDays.join(", ")}`,
      );
      printScoreRows(rows);
    }
  }
}

function scoreReserveTarget(input: {
  action: ScriptOptions["action"];
  battery: ReturnType<typeof readBatteries>[number];
  batteryPowerSamples: ReturnType<typeof readBatteryPowerSamples>;
  candidateDays: string[];
  capacityWh: number;
  currentEstimatedRemainingEnergyWh: number | null;
  p1MeterSamples: ReturnType<typeof readP1MeterSamples>;
  powerW: number;
  reserveTargetPercent: number;
  solarEnergyProviderSamples: ReturnType<typeof readSolarEnergyProviderSamples>;
  solarForecastSamples: ReturnType<typeof readSolarForecastSamples>;
  time: string;
}): ReserveTargetScoreRow {
  let averageReplayStopPercentNow = 0;
  let samples = 0;
  const targetTimes: string[] = [];

  for (const day of input.candidateDays) {
    const markerAt = createReplayTime(day, input.time);
      const syntheticItem = createSyntheticPlanItem({
        action: input.action,
        battery: input.battery,
      powerW: input.powerW,
    });
    const estimate = estimateStrategyTarget({
      battery: input.battery,
      batteryPowerSamples: input.batteryPowerSamples,
      dynamicPriceSamples: [],
      item: syntheticItem,
      items: [input.battery.strategyPlan[0] ?? syntheticItem, syntheticItem],
      now: markerAt,
      p1MeterSamples: input.p1MeterSamples,
      sample: {
        capacityWh: input.capacityWh,
        currentW: null,
        manualChargeTargetSoc: input.battery.manualChargeTargetSoc,
        manualDischargeTargetSoc: input.battery.manualDischargeTargetSoc,
        manualPowerW: input.powerW,
        manualState: input.action,
        manualTargetSoc: input.battery.manualTargetSoc,
        model: input.battery.model,
        name: input.battery.name,
        socPercent: null,
        status: input.battery.status,
        strategyMode: "manual",
      },
      solarEnergyProviderSamples: input.solarEnergyProviderSamples,
      solarForecastSamples: input.solarForecastSamples,
    });
    const targetTime = estimate.targetTime ? new Date(estimate.targetTime) : null;

    if (targetTime === null || Number.isNaN(targetTime.getTime())) {
      continue;
    }

    const candidateTargetPercent = clampPercent(
      input.reserveTargetPercent +
        Math.ceil(
          estimate.estimatedRemainingEnergyWh / Math.max(1, input.capacityWh) * 100,
        ),
      input.battery.minimumDischargePercent,
    );

    samples += 1;
    averageReplayStopPercentNow += candidateTargetPercent;
    if (estimate.targetTime) {
      targetTimes.push(estimate.targetTime);
    }
  }

  return {
    averageReplayStopPercentNow:
      samples === 0 ? 0 : Number((averageReplayStopPercentNow / samples).toFixed(2)),
    currentStopPercentNow:
      input.currentEstimatedRemainingEnergyWh === null
        ? input.reserveTargetPercent
        : clampPercent(
            input.reserveTargetPercent +
              Math.ceil(
                input.currentEstimatedRemainingEnergyWh /
                  Math.max(1, input.capacityWh) *
                  100,
              ),
            input.battery.minimumDischargePercent,
          ),
    reserveTargetPercent: input.reserveTargetPercent,
    samples,
    typicalTargetTime: pickTypicalTargetTime(targetTimes),
  };
}

function createSyntheticPlanItem(input: {
  action: ScriptOptions["action"];
  battery: ReturnType<typeof readBatteries>[number];
  powerW: number;
}): BatteryStrategyPlanItem {
  return {
    enabled: true,
    id: "synthetic-auto-target",
    kind: "daily",
    manualChargeTargetSoc: input.action === "charging" ? 100 : null,
    manualDischargeTargetSoc:
      input.action === "discharging"
        ? input.battery.minimumDischargePercent
        : null,
    manualPowerW: input.powerW,
    manualState: input.action,
    manualTargetSoc:
      input.action === "charging"
        ? 100
        : input.battery.minimumDischargePercent,
    startTime: null,
    strategyMode: "manual",
    targetDurationMinutes: null,
    targetEndTime: null,
    targetMethod: "auto",
    triggerKind: input.action === "charging" ? "low-price" : "high-price",
  };
}

function createReplayTime(day: string, time: string): Date {
  const [yearPart, monthPart, dayPart] = day.split("-");
  const [hoursPart, minutesPart] = time.split(":");
  const replayTime = new Date();

  replayTime.setFullYear(Number(yearPart), Number(monthPart) - 1, Number(dayPart));
  replayTime.setHours(Number(hoursPart), Number(minutesPart), 0, 0);

  return replayTime;
}

function getCandidateDaysFromBatterySamples(
  batteryPowerSamples: ReturnType<typeof readBatteryPowerSamples>,
  anchorDate: string,
  days: number,
): string[] {
  const cutoffDay = new Date(`${anchorDate}T00:00:00`);
  cutoffDay.setDate(cutoffDay.getDate() - days);

  return [
    ...new Set(batteryPowerSamples.map((sample) => getDayKey(sample.periodStart))),
  ]
    .filter(
      (day) =>
        day >= cutoffDay.toISOString().slice(0, 10) && day < anchorDate,
    )
    .sort();
}

function getDayKey(timestamp: string): string {
  return timestamp.slice(0, 10);
}

function getBatterySocAt(
  samples: ReturnType<typeof readBatteryPowerSamples>,
  batteryId: string,
  markerAt: Date,
): number | null {
  const markerMs = markerAt.getTime();

  for (let index = samples.length - 1; index >= 0; index -= 1) {
    const sample = samples[index];

    if (!sample || sample.batteryId !== batteryId) {
      continue;
    }

    const sampleMs = new Date(sample.periodStart).getTime();

    if (Number.isNaN(sampleMs) || sampleMs > markerMs) {
      continue;
    }

    return sample.socPercent;
  }

  return null;
}

function getActualNetLoadWh(input: {
  batteryPowerSamples: ReturnType<typeof readBatteryPowerSamples>;
  end: Date;
  p1MeterSamples: ReturnType<typeof readP1MeterSamples>;
  solarEnergyProviderSamples: ReturnType<typeof readSolarEnergyProviderSamples>;
  start: Date;
}): number {
  const batteryByPeriod = aggregateByPeriod(input.batteryPowerSamples);
  const gridByPeriod = aggregateByPeriod(input.p1MeterSamples);
  const solarByPeriod = aggregateByPeriod(input.solarEnergyProviderSamples);
  const periodStarts = [
    ...new Set([
      ...batteryByPeriod.keys(),
      ...gridByPeriod.keys(),
      ...solarByPeriod.keys(),
    ]),
  ]
    .map((periodStart) => new Date(periodStart))
    .filter(
      (periodStart) =>
        !Number.isNaN(periodStart.getTime()) &&
        periodStart.getTime() >= input.start.getTime() &&
        periodStart.getTime() < input.end.getTime(),
    )
    .sort((left, right) => left.getTime() - right.getTime());

  return Number(
    periodStarts
      .reduce((total, periodStart) => {
        const key = periodStart.toISOString();
        const batteryPowerW = batteryByPeriod.get(key) ?? 0;
        const gridPowerW = gridByPeriod.get(key) ?? 0;
        const solarPowerW = solarByPeriod.get(key) ?? 0;
        const houseLoadW = Math.max(0, solarPowerW + gridPowerW - batteryPowerW);
        return total + houseLoadW * 0.25;
      }, 0)
      .toFixed(2),
  );
}

function aggregateByPeriod(
  samples: Array<{ periodStart: string; powerW: number | null }>,
): Map<string, number> {
  const byPeriod = new Map<string, number>();

  for (const sample of samples) {
    if (typeof sample.powerW !== "number") {
      continue;
    }

    byPeriod.set(
      sample.periodStart,
      (byPeriod.get(sample.periodStart) ?? 0) + sample.powerW,
    );
  }

  return byPeriod;
}

function printScoreRows(rows: ReserveTargetScoreRow[]): void {
  const rowsWithSamples = rows.filter((row) => row.samples > 0);

  if (rowsWithSamples.length === 0) {
    console.log("No replay windows had enough history to score.");
    return;
  }

  console.table(
    [...rowsWithSamples]
      .sort((left, right) => left.reserveTargetPercent - right.reserveTargetPercent)
      .map((row) => ({
        averageReplayStopNow: `${formatNumber(row.averageReplayStopPercentNow)}%`,
        currentStopNow: `${formatNumber(row.currentStopPercentNow)}%`,
        reserveAtTarget: `${row.reserveTargetPercent}%`,
        samples: row.samples,
        typicalTargetTime: row.typicalTargetTime ?? "unknown",
      })),
  );
}

function printCurrentEstimateSummary(input: EstimateContext): void {
  console.log(
    `${input.siteName} (${input.siteId}) | ${input.battery.name} (${input.batteryId}) | target time ${formatTargetTime(input.estimate.targetTime)} | ${formatActionLabel(input.action)} target ${input.estimate.estimatedTargetPercent}% for ${formatReferenceMoment(input.referenceTime)}`,
  );

  if (input.verboseBlocks.has("current")) {
    console.log("Current estimate:");
    console.table(
      formatKeyValueRows({
        Action: formatActionLabel(input.action),
        "Battery minimum discharge": `${input.battery.minimumDischargePercent}%`,
        "Reserve at target": `${input.estimate.estimatedReservePercentAtTargetTime}%`,
        "Target percentage": `${input.estimate.estimatedTargetPercent}%`,
        "Target time": formatTargetTime(input.estimate.targetTime),
        "Time until target": formatDurationUntilTarget(
          input.referenceTime,
          input.estimate.targetTime,
        ),
      }),
    );
  }

  if (input.verboseBlocks.has("energy")) {
    console.log("Energy estimate:");
    console.table(
      formatKeyValueRows({
        "Expected house load until target": formatWh(input.estimate.expectedHouseLoadWh),
        "Predicted solar until target": formatWh(input.estimate.predictedSolarGenerationWh),
        "Net battery energy needed": formatWh(input.estimate.estimatedRemainingEnergyWh),
      }),
    );
  }

  if (input.verboseBlocks.has("why")) {
    console.log("Why this target time:");
    console.table(
      formatKeyValueRows({
        "Expected load at target": formatW(
          input.estimate.targetTimeSignal?.expectedHouseLoadW ?? null,
        ),
        "Predicted solar at target": formatW(
          input.estimate.targetTimeSignal?.predictedSolarW ?? null,
        ),
        "Recovery threshold": formatW(
          input.estimate.targetTimeSignal?.recoveryThresholdW ?? null,
        ),
        "Break-even rule": formatBreakEvenRule(input.estimate),
        Reasoning: input.estimate.reasoning || "n/a",
      }),
    );
  }

  if (input.verboseBlocks.has("break-even")) {
    console.log("Break-even buckets:");
    console.table(
      input.estimate.breakEvenTrace.map((row) => ({
        breakEven: row.meetsBreakEven ? "yes" : "no",
        expectedHouseLoadW: formatW(row.expectedHouseLoadW),
        predictedSolarW: formatW(row.predictedSolarW),
        recoveryThresholdW: formatW(row.recoveryThresholdW),
        time: formatClockTime(row.time),
      })),
    );
  }

  if (input.verboseBlocks.has("history")) {
    console.log("History used:");
    console.table(
      formatKeyValueRows({
        "Historical periods used": String(input.estimate.historyStats.historicalPeriodsUsed),
        "Same-weekday periods used": String(input.estimate.historyStats.sameWeekdayPeriodsUsed),
        "Time slots modelled": String(input.estimate.historyStats.slotCount),
        "Replay reference days": input.candidateDays.join(", "),
      }),
    );
  }
}

function formatKeyValueRows(values: Record<string, string>): Array<{ key: string; value: string }> {
  return Object.entries(values).map(([key, value]) => ({ key, value }));
}

function buildDefaultReserveTargets(minimumDischargePercent: number): number[] {
  const targets: number[] = [];

  for (
    let target = minimumDischargePercent;
    target <= Math.min(100, minimumDischargePercent + 10);
    target += 1
  ) {
    targets.push(target);
  }

  return targets;
}

function pickTypicalTargetTime(targetTimes: string[]): string | null {
  if (targetTimes.length === 0) {
    return null;
  }

  const sorted = [...targetTimes].sort();
  return formatClockTime(sorted[Math.floor(sorted.length / 2)] ?? null);
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function formatWh(value: number | null): string {
  return value === null ? "n/a" : `${formatNumber(value)} Wh`;
}

function formatW(value: number | null): string {
  return value === null ? "n/a" : `${formatNumber(value)} W`;
}

function formatActionLabel(action: ScriptOptions["action"]): string {
  return action === "charging" ? "charge" : "discharge";
}

function getCurrentLocalClockTime(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

function getCurrentLocalDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function isClockTime(value: string | undefined): value is string {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function isIsoDate(value: string | undefined): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function formatTargetTime(value: string | null): string {
  if (value === null) {
    return "unknown time";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return `${date.toISOString().slice(0, 10)} ${date.toTimeString().slice(0, 5)}`;
}

function formatDurationUntilTarget(referenceTime: Date, value: string | null): string {
  if (value === null) {
    return "unknown";
  }

  const targetTime = new Date(value);

  if (Number.isNaN(targetTime.getTime())) {
    return "unknown";
  }

  const minutes = Math.max(
    0,
    Math.round((targetTime.getTime() - referenceTime.getTime()) / 60000),
  );
  const hoursPart = Math.floor(minutes / 60);
  const minutesPart = minutes % 60;
  return `${hoursPart}h ${minutesPart}m`;
}

function formatReferenceMoment(value: Date): string {
  return `${value.toISOString().slice(0, 10)} ${value.toTimeString().slice(0, 5)}`;
}

function formatBreakEvenRule(
  estimate: ReturnType<typeof estimateStrategyTarget>,
): string {
  const expectedLoadAtTargetW = estimate.targetTimeSignal?.expectedHouseLoadW ?? null;
  const predictedSolarAtTargetW = estimate.targetTimeSignal?.predictedSolarW ?? null;
  const recoveryThresholdW = estimate.targetTimeSignal?.recoveryThresholdW ?? null;

  if (predictedSolarAtTargetW === null || recoveryThresholdW === null) {
    return "n/a";
  }

  return `${formatW(predictedSolarAtTargetW)} > max(${formatW(expectedLoadAtTargetW)}, ${formatW(recoveryThresholdW)})`;
}

function parseVerboseBlocks(value: string): VerboseBlock[] {
  const blocks = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry): entry is VerboseBlock =>
      ALL_VERBOSE_BLOCKS.includes(entry as VerboseBlock),
    );

  if (blocks.length === 0) {
    throw new Error(
      `--verbose must contain one or more of: ${ALL_VERBOSE_BLOCKS.join(", ")}`,
    );
  }

  return blocks;
}

function formatClockTime(value: string | null): string {
  if (value === null) {
    return "unknown";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toTimeString().slice(0, 5);
}

function clampPercent(value: number, minimum: number): number {
  return Math.max(minimum, Math.min(100, Math.round(value)));
}

main();
