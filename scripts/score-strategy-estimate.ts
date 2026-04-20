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
const DEFAULT_BACKUP_RESERVE_MARGIN = 2;
const DEFAULT_POWER_W = 2400;

interface ScriptOptions {
  backupReserveMargin: number;
  date: string;
  days: number;
  powerW: number;
  priceSignals: PriceSignal[];
  siteId: string | null;
  time: string;
  verboseBlocks: Set<VerboseBlock>;
}

interface ScoreOptions extends ScriptOptions {
  action: Extract<BatteryManualState, "charging" | "discharging">;
  priceSignal: PriceSignal;
}

type PriceSignal = "high" | "low";

interface ChargeWindow {
  durationMinutes: number;
  endTime: Date;
  startTime: Date;
  targetPercent: number;
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
  chargeDurationMinutes: number | null;
  currentStopPercentNow: number;
  reserveTargetPercent: number;
  samples: number;
  typicalStartTime: string | null;
  typicalTargetTime: string | null;
}

interface EstimateContext {
  action: ScoreOptions["action"];
  battery: ReturnType<typeof readBatteries>[number];
  batteryId: string;
  candidateDays: string[];
  chargeWindow: ChargeWindow | null;
  estimate: ReturnType<typeof estimateStrategyTarget>;
  reserveTargetPercent: number;
  referenceTime: Date;
  priceSignal: PriceSignal;
  siteId: string;
  siteName: string;
  verboseBlocks: Set<VerboseBlock>;
}

function parseArgs(args: string[]): ScriptOptions {
  let date = getCurrentLocalDate();
  let days = DEFAULT_DAYS;
  let backupReserveMargin = DEFAULT_BACKUP_RESERVE_MARGIN;
  let powerW = DEFAULT_POWER_W;
  let priceSignals: PriceSignal[] = ["high", "low"];
  let siteId: string | null = null;
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

    if (arg === "--backup-reserve-margin") {
      backupReserveMargin = parseBackupReserveMargin(args[index + 1]);
      index += 1;
      continue;
    }

    if (arg.startsWith("--backup-reserve-margin=")) {
      backupReserveMargin = parseBackupReserveMargin(
        arg.slice("--backup-reserve-margin=".length),
      );
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

    if (arg === "--price") {
      priceSignals = parsePriceSignals(args[index + 1]);
      index += 1;
      continue;
    }

    if (arg.startsWith("--price=")) {
      priceSignals = parsePriceSignals(arg.slice("--price=".length));
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

  return {
    date,
    days,
    backupReserveMargin,
    powerW,
    priceSignals,
    siteId,
    time,
    verboseBlocks,
  };
}

function printHelp(): void {
  console.log(
    [
      "Replay a synthetic dynamic target action across recent history.",
      "",
      "Defaults:",
      "  price: high,low",
      `  backup reserve margin: ${DEFAULT_BACKUP_RESERVE_MARGIN}%`,
      `  power: ${DEFAULT_POWER_W}W`,
      "  date: today",
      "  time: current local clock time",
      `  days: ${DEFAULT_DAYS}`,
      "",
      "Usage:",
      "  bun run estimate:score",
      "  bun run estimate:score -- --price low",
      "  bun run estimate:score -- --price=high,low",
      "  bun run estimate:score -- --date 2026-04-19",
      "  bun run estimate:score -- --backup-reserve-margin 2",
      "  bun run estimate:score -- --power 1800",
      "  bun run estimate:score -- --time 17:30",
      "  bun run estimate:score -- --site <site-id>",
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
      console.log(`Database: ${getDatabasePath()}`);
    }

    for (const site of sites) {
      for (const priceSignal of options.priceSignals) {
        const scoreOptions = createScoreOptions(options, priceSignal);

        if (scoreOptions.verboseBlocks.has("meta")) {
          console.log(
            `Estimating synthetic ${formatActionLabel(scoreOptions.action)} target for ${scoreOptions.priceSignal} price at ${scoreOptions.powerW}W for ${scoreOptions.date} ${scoreOptions.time}.`,
          );
        }

        scoreSite(site.id, scoreOptions, db);
      }
    }
  } finally {
    db.close();
  }
}

function createScoreOptions(
  options: ScriptOptions,
  priceSignal: PriceSignal,
): ScoreOptions {
  return {
    ...options,
    action: priceSignal === "low" ? "charging" : "discharging",
    priceSignal,
  };
}

function scoreSite(
  siteId: string,
  options: ScoreOptions,
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
    const reserveTargetPercent = getReserveTargetPercent(
      battery.minimumDischargePercent,
      options.backupReserveMargin,
    );
    const chargeWindow =
      options.action === "charging"
        ? buildChargeWindow({
            capacityWh: batteryTelemetry.capacityWh,
            powerW: options.powerW,
            priceMoment: estimateAt,
            reserveTargetPercent,
          })
        : null;

    printCurrentEstimateSummary({
      action: options.action,
      battery,
      batteryId: battery.id,
      candidateDays,
      chargeWindow,
      estimate: currentEstimate,
      priceSignal: options.priceSignal,
      reserveTargetPercent,
      referenceTime: estimateAt,
      siteId,
      siteName: site?.name ?? siteId,
      verboseBlocks: options.verboseBlocks,
    });

    const row = scoreReserveTarget({
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
    });

    if (options.verboseBlocks.has("replay")) {
      console.log(
        `Replay result across ${candidateDays.length} day(s) with ${reserveTargetPercent}% reserve target: ${candidateDays.join(", ")}`,
      );
      printScoreRow(row);
    }
  }
}

function scoreReserveTarget(input: {
  action: ScoreOptions["action"];
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
  let chargeDurationMinutes: number | null = null;
  let samples = 0;
  const startTimes: string[] = [];
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

    if (input.action === "charging") {
      const chargeWindow = buildChargeWindow({
        capacityWh: input.capacityWh,
        powerW: input.powerW,
        priceMoment: markerAt,
        reserveTargetPercent: input.reserveTargetPercent,
      });

      samples += 1;
      averageReplayStopPercentNow += chargeWindow.targetPercent;
      chargeDurationMinutes = chargeWindow.durationMinutes;
      startTimes.push(chargeWindow.startTime.toISOString());
      targetTimes.push(chargeWindow.endTime.toISOString());
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
    chargeDurationMinutes,
    currentStopPercentNow:
      input.action === "charging"
        ? 100
        : input.currentEstimatedRemainingEnergyWh === null
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
    typicalStartTime: pickTypicalTargetTime(startTimes),
    typicalTargetTime: pickTypicalTargetTime(targetTimes),
  };
}

function createSyntheticPlanItem(input: {
  action: ScoreOptions["action"];
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

function printScoreRow(row: ReserveTargetScoreRow): void {
  if (row.samples === 0) {
    console.log("No replay windows had enough history to score.");
    return;
  }

  if (row.chargeDurationMinutes !== null) {
    console.table([
      {
        chargeDuration: formatDurationMinutes(row.chargeDurationMinutes),
        reserveFloor: `${row.reserveTargetPercent}%`,
        samples: row.samples,
        targetPercent: `${formatNumber(row.currentStopPercentNow)}%`,
        typicalEndTime: row.typicalTargetTime ?? "unknown",
        typicalStartTime: row.typicalStartTime ?? "unknown",
      },
    ]);
    return;
  }

  console.table([
    {
      averageReplayStopNow: `${formatNumber(row.averageReplayStopPercentNow)}%`,
      currentStopNow: `${formatNumber(row.currentStopPercentNow)}%`,
      reserveAtTarget: `${row.reserveTargetPercent}%`,
      samples: row.samples,
      typicalTargetTime: row.typicalTargetTime ?? "unknown",
    },
  ]);
}

function printCurrentEstimateSummary(input: EstimateContext): void {
  const isCharging = input.action === "charging";
  const currentTargetPercent = isCharging
    ? 100
    : getDisplayedTargetPercent(
        input.estimate.estimatedTargetPercent,
        input.reserveTargetPercent,
      );
  const reserveAtTargetPercent = isCharging
    ? input.reserveTargetPercent
    : getDisplayedTargetPercent(
        input.estimate.estimatedReservePercentAtTargetTime,
        input.reserveTargetPercent,
      );

  console.log(
    isCharging
      ? `${input.siteName} (${input.siteId}) | ${input.battery.name} (${input.batteryId}) | ${formatPriceSignalLabel(input.priceSignal)} ${formatActionLabel(input.action)} target ${currentTargetPercent}% | start time ${formatDateTime(input.chargeWindow?.startTime ?? null)} | centered on low price at ${formatReferenceMoment(input.referenceTime)}`
      : `${input.siteName} (${input.siteId}) | ${input.battery.name} (${input.batteryId}) | ${formatPriceSignalLabel(input.priceSignal)} ${formatActionLabel(input.action)} target ${currentTargetPercent}% | target time ${formatTargetTime(input.estimate.targetTime)} | for ${formatReferenceMoment(input.referenceTime)}`,
  );

  if (input.verboseBlocks.has("current")) {
    console.log("Current estimate:");
    console.table(
      formatKeyValueRows(
        isCharging
          ? {
              Action: formatActionLabel(input.action),
              Price: formatPriceSignalLabel(input.priceSignal),
              "Reserve floor": `${input.reserveTargetPercent}%`,
              "Battery minimum discharge": `${input.battery.minimumDischargePercent}%`,
              "Target percentage": `${currentTargetPercent}%`,
              "Charge duration": formatDurationMinutes(
                input.chargeWindow?.durationMinutes ?? 0,
              ),
              "Estimated start time": formatDateTime(
                input.chargeWindow?.startTime ?? null,
              ),
              "Estimated end time": formatDateTime(
                input.chargeWindow?.endTime ?? null,
              ),
              "Low-price center": formatReferenceMoment(input.referenceTime),
            }
          : {
              Action: formatActionLabel(input.action),
              Price: formatPriceSignalLabel(input.priceSignal),
              "Reserve floor": `${input.reserveTargetPercent}%`,
              "Battery minimum discharge": `${input.battery.minimumDischargePercent}%`,
              "Reserve at target": `${reserveAtTargetPercent}%`,
              "Target percentage": `${currentTargetPercent}%`,
              "Target time": formatTargetTime(input.estimate.targetTime),
              "Time until target": formatDurationUntilTarget(
                input.referenceTime,
                input.estimate.targetTime,
              ),
            },
      ),
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

function getReserveTargetPercent(
  minimumDischargePercent: number,
  backupReserveMargin: number,
): number {
  return clampPercent(
    minimumDischargePercent + backupReserveMargin,
    minimumDischargePercent,
  );
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

function formatActionLabel(action: ScoreOptions["action"]): string {
  return action === "charging" ? "charge" : "discharge";
}

function formatPriceSignalLabel(priceSignal: PriceSignal): string {
  return priceSignal === "high" ? "high-price" : "low-price";
}

function getDisplayedTargetPercent(
  estimatedTargetPercent: number,
  reserveTargetPercent: number,
): number {
  return Math.max(reserveTargetPercent, estimatedTargetPercent);
}

function buildChargeWindow(input: {
  capacityWh: number;
  powerW: number;
  priceMoment: Date;
  reserveTargetPercent: number;
}): ChargeWindow {
  const energyWh =
    ((100 - input.reserveTargetPercent) / 100) * Math.max(0, input.capacityWh);
  const durationMinutes = Math.max(
    1,
    Math.ceil((energyWh / Math.max(1, input.powerW)) * 60),
  );
  const startOffsetMinutes = Math.floor(durationMinutes / 2);
  const endOffsetMinutes = durationMinutes - startOffsetMinutes;
  const startTime = new Date(
    input.priceMoment.getTime() - startOffsetMinutes * 60_000,
  );
  const endTime = new Date(
    input.priceMoment.getTime() + endOffsetMinutes * 60_000,
  );

  return {
    durationMinutes,
    endTime,
    startTime,
    targetPercent: 100,
  };
}

function formatDateTime(value: Date | null): string {
  if (value === null || Number.isNaN(value.getTime())) {
    return "unknown time";
  }

  return `${value.toISOString().slice(0, 10)} ${value.toTimeString().slice(0, 5)}`;
}

function formatDurationMinutes(value: number): string {
  const hoursPart = Math.floor(value / 60);
  const minutesPart = value % 60;
  return `${hoursPart}h ${minutesPart}m`;
}

function parsePriceSignals(value: string | undefined): PriceSignal[] {
  if (!value) {
    throw new Error("--price requires a comma-separated list of 'high' and/or 'low'.");
  }

  const entries = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  const invalidEntries = entries.filter(
    (entry) => entry !== "high" && entry !== "low",
  );

  if (invalidEntries.length > 0) {
    throw new Error(
      `--price only accepts 'high' and 'low'; received: ${invalidEntries.join(", ")}.`,
    );
  }

  const signals = entries as PriceSignal[];

  if (signals.length === 0) {
    throw new Error("--price must contain one or both of: high, low.");
  }

  return [...new Set(signals)];
}

function parseBackupReserveMargin(value: string | undefined): number {
  const margin = Number(value);

  if (!Number.isFinite(margin) || margin < 0) {
    throw new Error("--backup-reserve-margin must be a non-negative number.");
  }

  return Math.round(margin);
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
