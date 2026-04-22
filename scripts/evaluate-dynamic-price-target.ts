import type {
  BatteryManualState,
  BatteryStrategyPlanItem,
  DynamicPriceTargetEstimate,
} from "../packages/core/src/index";
import {
  DEFAULT_DYNAMIC_PRICE_TARGET_EVALUATION_DAYS,
  DEFAULT_MANUAL_STRATEGY_POWER_W,
  DYNAMIC_PRICE_TARGET_BACKUP_RESERVE_MARGIN_PERCENT,
  DYNAMIC_PRICE_TARGET_BUFFER_PERCENT_PER_HOUR,
  DYNAMIC_PRICE_TARGET_MIN_SOLAR_SURPLUS_W,
  getDatabasePath,
  isFlagArg,
  parseIntegerArg,
  parseNumberArg,
  parseStringArg,
} from "../packages/core/src/index";
import {
  openDaemonDatabase,
  readBatteries,
  readBatteryPowerSamples,
  readDynamicPriceSamples,
  readManagedDeviceTelemetry,
  readP1MeterSamples,
  readSites,
  readSolarEnergyProviderSamples,
  readSolarForecastSamples,
} from "../apps/daemon/src/database";
import { estimateDynamicPriceTarget } from "../apps/daemon/src/dynamic-price-target";
import {
  getLowPriceAutoTriggerAtForMarker,
  getNextStrategyTriggerAt,
} from "../apps/daemon/src/strategy-scheduler";

// Script defaults sourced from shared algorithm constants
const DEFAULT_DAYS = DEFAULT_DYNAMIC_PRICE_TARGET_EVALUATION_DAYS;
const DEFAULT_BACKUP_RESERVE_MARGIN =
  DYNAMIC_PRICE_TARGET_BACKUP_RESERVE_MARGIN_PERCENT;
const DEFAULT_MINIMUM_SOLAR_SURPLUS_W =
  DYNAMIC_PRICE_TARGET_MIN_SOLAR_SURPLUS_W;
const DEFAULT_POWER_W = DEFAULT_MANUAL_STRATEGY_POWER_W;
const DEFAULT_TARGET_BUFFER_PERCENT_PER_HOUR =
  DYNAMIC_PRICE_TARGET_BUFFER_PERCENT_PER_HOUR;

interface ScriptOptions {
  backupReserveMargin: number;
  markerDate: string;
  days: number;
  hasExplicitMarkerTime: boolean;
  minimumSolarSurplusWOverride: number;
  powerW: number;
  priceSignals: PriceSignal[];
  siteId: string | null;
  targetBufferPercentPerHourOverride: number;
  markerTime: string;
  verboseBlocks: Set<VerboseBlock>;
}

interface EvaluationOptions extends ScriptOptions {
  action: Extract<BatteryManualState, "charging" | "discharging">;
  priceSignal: PriceSignal;
}

type PriceSignal = "high" | "low";

type VerboseBlock =
  | "meta"
  | "current"
  | "energy"
  | "energy-buckets"
  | "why"
  | "break-even"
  | "history";

const DEFAULT_VERBOSE_BLOCKS: VerboseBlock[] = [
  "meta",
  "current",
  "energy",
  "break-even",
];

const ALL_VERBOSE_BLOCKS: VerboseBlock[] = [
  "meta",
  "current",
  "energy",
  "energy-buckets",
  "why",
  "break-even",
  "history",
];

interface EvaluationContext {
  action: EvaluationOptions["action"];
  battery: ReturnType<typeof readBatteries>[number];
  batteryId: string;
  capacityWh: number;
  candidateDays: string[];
  dynamicPriceTargetEstimate: DynamicPriceTargetEstimate;
  minimumSolarSurplusWOverride: number;
  reserveTargetPercent: number;
  referenceTime: Date;
  priceSignal: PriceSignal;
  siteId: string;
  siteName: string;
  verboseBlocks: Set<VerboseBlock>;
}

function parseArgs(args: string[]): ScriptOptions {
  let markerDate = getCurrentLocalDate();
  let days = DEFAULT_DAYS;
  let backupReserveMargin = DEFAULT_BACKUP_RESERVE_MARGIN;
  let hasExplicitMarkerTime = false;
  let minimumSolarSurplusWOverride = DEFAULT_MINIMUM_SOLAR_SURPLUS_W;
  let powerW = DEFAULT_POWER_W;
  let priceSignals: PriceSignal[] = ["high", "low"];
  let siteId: string | null = null;
  let targetBufferPercentPerHourOverride =
    DEFAULT_TARGET_BUFFER_PERCENT_PER_HOUR;
  let markerTime = getCurrentLocalClockTime();
  const verboseBlocks = new Set<VerboseBlock>();

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

    const dateArg = parseStringArg(args, index, "--marker-date");

    if (dateArg) {
      if (!isIsoDate(dateArg.value)) {
        throw new Error("--marker-date must use YYYY-MM-DD format.");
      }

      markerDate = dateArg.value;
      hasExplicitMarkerTime = true;
      index = dateArg.newIndex;
      continue;
    }

    const siteArg = parseStringArg(args, index, "--site");

    if (siteArg) {
      siteId = siteArg.value;
      index = siteArg.newIndex;
      continue;
    }

    const marginArg = parseStringArg(args, index, "--backup-reserve-margin");

    if (marginArg) {
      backupReserveMargin = parseBackupReserveMargin(marginArg.value);
      index = marginArg.newIndex;
      continue;
    }

    const powerArg = parseIntegerArg(args, index, "--power", (v) =>
      v <= 0 ? "--power must be a positive integer." : null,
    );

    if (powerArg) {
      powerW = powerArg.value;
      index = powerArg.newIndex;
      continue;
    }

    const minimumSolarSurplusArg = parseNumberArg(
      args,
      index,
      "--minimum-solar-surplus",
      (value) =>
        value < 0
          ? "--minimum-solar-surplus must be a non-negative number."
          : null,
    );

    if (minimumSolarSurplusArg) {
      minimumSolarSurplusWOverride = minimumSolarSurplusArg.value;
      index = minimumSolarSurplusArg.newIndex;
      continue;
    }

    const backupReserveMarginPerHourArg = parseNumberArg(
      args,
      index,
      "--backup-reserve-margin-per-hour",
      (value) =>
        value < 0
          ? "--backup-reserve-margin-per-hour must be a non-negative number."
          : null,
    );

    if (backupReserveMarginPerHourArg) {
      targetBufferPercentPerHourOverride = backupReserveMarginPerHourArg.value;
      index = backupReserveMarginPerHourArg.newIndex;
      continue;
    }

    const timeArg = parseStringArg(args, index, "--marker-time");

    if (timeArg) {
      if (!isClockTime(timeArg.value)) {
        throw new Error("--marker-time must use HH:MM format.");
      }

      markerTime = timeArg.value;
      hasExplicitMarkerTime = true;
      index = timeArg.newIndex;
      continue;
    }

    const priceArg = parseStringArg(args, index, "--price");

    if (priceArg) {
      priceSignals = parsePriceSignals(priceArg.value);
      index = priceArg.newIndex;
      continue;
    }

    if (isFlagArg(arg, "--help", "-h")) {
      printHelp();
      process.exit(0);
    }

    if (arg === "--verbose") {
      for (const block of DEFAULT_VERBOSE_BLOCKS) {
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

    if (arg === "--date" || arg.startsWith("--date=")) {
      throw new Error("--date was renamed to --marker-date.");
    }

    if (arg === "--time" || arg.startsWith("--time=")) {
      throw new Error("--time was renamed to --marker-time.");
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return {
    markerDate,
    days,
    backupReserveMargin,
    hasExplicitMarkerTime,
    powerW,
    priceSignals,
    siteId,
    minimumSolarSurplusWOverride,
    targetBufferPercentPerHourOverride,
    markerTime,
    verboseBlocks,
  };
}

function printHelp(): void {
  console.log(
    [
      "Evaluate the dynamic price target method against recent history.",
      "",
      "Defaults:",
      "  price: high,low",
      `  backup reserve margin: ${DEFAULT_BACKUP_RESERVE_MARGIN}%`,
      `  minimum solar surplus: ${DEFAULT_MINIMUM_SOLAR_SURPLUS_W}W`,
      `  backup reserve margin per hour: ${DEFAULT_TARGET_BUFFER_PERCENT_PER_HOUR}%`,
      `  power: ${DEFAULT_POWER_W}W`,
      "  marker date/time: next relevant price marker unless --marker-date or --marker-time is set",
      `  days: ${DEFAULT_DAYS}`,
      `  --verbose enables: ${DEFAULT_VERBOSE_BLOCKS.join(", ")}`,
      "",
      "Usage:",
      "  bun run dynamic-price-target:evaluate",
      "  bun run dynamic-price-target:evaluate -- --price=low",
      "  bun run dynamic-price-target:evaluate -- --price=high,low",
      "  bun run dynamic-price-target:evaluate -- --marker-date=2026-04-19",
      "  bun run dynamic-price-target:evaluate -- --backup-reserve-margin=2",
      "  bun run dynamic-price-target:evaluate -- --minimum-solar-surplus=75",
      "  bun run dynamic-price-target:evaluate -- --backup-reserve-margin-per-hour=0.5",
      "  bun run dynamic-price-target:evaluate -- --power=1800",
      "  bun run dynamic-price-target:evaluate -- --marker-time=17:30",
      "  bun run dynamic-price-target:evaluate -- --site=<site-id>",
      "  bun run dynamic-price-target:evaluate -- --verbose",
      "  bun run dynamic-price-target:evaluate -- --verbose=meta,why,history",
      "  bun run dynamic-price-target:evaluate -- --verbose=energy-buckets",
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

    for (const site of sites) {
      for (const priceSignal of options.priceSignals) {
        const evaluationOptions = createEvaluationOptions(options, priceSignal);

        if (evaluationOptions.verboseBlocks.has("meta")) {
          console.log(
            evaluationOptions.hasExplicitMarkerTime
              ? `Estimating synthetic ${formatActionLabel(evaluationOptions.action)} target for ${evaluationOptions.priceSignal} price at ${evaluationOptions.powerW}W for marker ${evaluationOptions.markerDate} ${evaluationOptions.markerTime}.`
              : `Estimating synthetic ${formatActionLabel(evaluationOptions.action)} target for the next ${evaluationOptions.priceSignal} price marker at ${evaluationOptions.powerW}W.`,
          );
        }

        evaluateSite(site.id, evaluationOptions, db);
      }
    }
  } finally {
    db.close();
  }
}

function createEvaluationOptions(
  options: ScriptOptions,
  priceSignal: PriceSignal,
): EvaluationOptions {
  return {
    ...options,
    action: priceSignal === "low" ? "charging" : "discharging",
    priceSignal,
  };
}

function evaluateSite(
  siteId: string,
  options: EvaluationOptions,
  db: ReturnType<typeof openDaemonDatabase>,
): void {
  const batteries = readBatteries(db, siteId);
  const telemetry = readManagedDeviceTelemetry(db);
  const batteryPowerSamples = readBatteryPowerSamples(db, siteId);
  const dynamicPriceSamples = readDynamicPriceSamples(db, siteId);
  const p1MeterSamples = readP1MeterSamples(db, siteId);
  const solarEnergyProviderSamples = readSolarEnergyProviderSamples(db, siteId);
  const solarForecastSamples = readSolarForecastSamples(db, siteId);
  const site = readSites(db).find((entry) => entry.id === siteId) ?? null;

  if (batteries.length === 0) {
    console.log(`\nSite ${siteId}: no batteries found.`);
    return;
  }

  const syntheticItem = createSyntheticPlanItem({
    action: options.action,
    battery: batteries[0],
    powerW: options.powerW,
  });
  const estimateAt = resolveEvaluationReferenceTime({
    markerDate: options.markerDate,
    dynamicPriceSamples,
    hasExplicitMarkerTime: options.hasExplicitMarkerTime,
    item: syntheticItem,
    markerTime: options.markerTime,
  });
  const candidateDays = getCandidateDaysFromBatterySamples(
    batteryPowerSamples,
    estimateAt.toISOString().slice(0, 10),
    options.days,
  );

  if (candidateDays.length === 0) {
    console.log(
      `\nSite ${siteId}: no recent battery history found to evaluate.`,
    );
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

    let dynamicPriceTargetEstimate: DynamicPriceTargetEstimate | null = null;
    const batterySyntheticItem = createSyntheticPlanItem({
      action: options.action,
      battery,
      powerW: options.powerW,
    });
    dynamicPriceTargetEstimate = estimateDynamicPriceTarget({
      battery,
      batteryPowerSamples,
      backupReserveMarginOverride: options.backupReserveMargin,
      dynamicPriceSamples,
      item: batterySyntheticItem,
      items: [battery.strategyPlan[0] ?? batterySyntheticItem, batterySyntheticItem],
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
      minimumSolarSurplusWOverride: options.minimumSolarSurplusWOverride,
      solarEnergyProviderSamples,
      solarForecastSamples,
      targetBufferPercentPerHourOverride:
        options.targetBufferPercentPerHourOverride,
    });
    const reserveTargetPercent = getReserveTargetPercent(
      battery.minimumDischargePercent,
      options.backupReserveMargin,
    );

    printCurrentEstimateSummary({
      action: options.action,
      battery,
      batteryId: battery.id,
      capacityWh: batteryTelemetry.capacityWh,
      candidateDays,
      dynamicPriceTargetEstimate,
      minimumSolarSurplusWOverride: options.minimumSolarSurplusWOverride,
      priceSignal: options.priceSignal,
      reserveTargetPercent,
      referenceTime: estimateAt,
      siteId,
      siteName: site?.name ?? siteId,
      verboseBlocks: options.verboseBlocks,
    });
  }
}

function createSyntheticPlanItem(input: {
  action: EvaluationOptions["action"];
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
      input.action === "charging" ? 100 : input.battery.minimumDischargePercent,
    startTime: null,
    strategyMode: "manual",
    targetDurationMinutes: null,
    targetEndTime: null,
    targetMethod: "auto",
    triggerKind: input.action === "charging" ? "low-price" : "high-price",
  };
}

export function createReplayTime(day: string, time: string): Date {
  const [yearPart, monthPart, dayPart] = day.split("-");
  const [hoursPart, minutesPart] = time.split(":");
  const replayTime = new Date();

  replayTime.setFullYear(
    Number(yearPart),
    Number(monthPart) - 1,
    Number(dayPart),
  );
  replayTime.setHours(Number(hoursPart), Number(minutesPart), 0, 0);

  return replayTime;
}

export function resolveEvaluationReferenceTime(input: {
  markerDate: string;
  dynamicPriceSamples: ReturnType<typeof readDynamicPriceSamples>;
  hasExplicitMarkerTime: boolean;
  item: BatteryStrategyPlanItem;
  markerTime: string;
}): Date {
  const fallbackTime = createReplayTime(input.markerDate, input.markerTime);

  if (input.hasExplicitMarkerTime) {
    if (input.item.triggerKind !== "low-price" || input.item.manualState !== "charging") {
      return fallbackTime;
    }

    return (
      getLowPriceAutoTriggerAtForMarker({
        dynamicPriceSamples: input.dynamicPriceSamples,
        markerAt: fallbackTime,
      }) ?? fallbackTime
    );
  }

  return (
    getNextStrategyTriggerAt({
      item: input.item,
      now: fallbackTime,
      dynamicPriceSamples: input.dynamicPriceSamples,
    }) ?? fallbackTime
  );
}

function getCandidateDaysFromBatterySamples(
  batteryPowerSamples: ReturnType<typeof readBatteryPowerSamples>,
  anchorDate: string,
  days: number,
): string[] {
  const cutoffDay = new Date(`${anchorDate}T00:00:00`);
  cutoffDay.setDate(cutoffDay.getDate() - days);

  return [
    ...new Set(
      batteryPowerSamples.map((sample) => getDayKey(sample.periodStart)),
    ),
  ]
    .filter(
      (day) => day >= cutoffDay.toISOString().slice(0, 10) && day < anchorDate,
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
        const houseLoadW = Math.max(
          0,
          solarPowerW + gridPowerW - batteryPowerW,
        );
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

function printCurrentEstimateSummary(input: EvaluationContext): void {
  const isCharging =
    input.dynamicPriceTargetEstimate.resolvedManualState === "charging";
  const currentTargetPercent = getDisplayedTargetPercentForEstimate(input);
  const reserveAtTargetPercent = getDisplayedReserveAtTargetPercent(input);
  const actionLabel = formatResolvedActionLabel(input.dynamicPriceTargetEstimate);
  const summary = input.dynamicPriceTargetEstimate.skipReason
    ? `${input.siteName} (${input.siteId}) | ${input.battery.name} (${input.batteryId}) | ${formatPriceSignalLabel(input.priceSignal)} ${actionLabel} skipped | ${input.dynamicPriceTargetEstimate.skipReason}`
    : `${input.siteName} (${input.siteId}) | ${input.battery.name} (${input.batteryId}) | target percentage ${reserveAtTargetPercent}% at ${formatTargetTime(input.dynamicPriceTargetEstimate.targetTime)} | ${formatPriceSignalLabel(input.priceSignal)} ${actionLabel} target ${currentTargetPercent}% start time ${formatReferenceMoment(input.referenceTime)}`;

  if (input.verboseBlocks.has("current")) {
    console.log("Current estimate:");
    console.table(
      formatKeyValueRows(
        buildCurrentEstimateRows({
          dynamicPriceTargetEstimate: input.dynamicPriceTargetEstimate,
          minimumSolarSurplusWOverride: input.minimumSolarSurplusWOverride,
          priceSignal: input.priceSignal,
          referenceTime: input.referenceTime,
          reserveTargetPercent: input.reserveTargetPercent,
        }),
      ),
    );
  }

  if (input.verboseBlocks.has("energy")) {
    console.log("Energy estimate:");
    console.table(formatKeyValueRows(buildEnergyEstimateRows(input)));
    if (!input.verboseBlocks.has("energy-buckets")) {
      console.log("  (add energy-buckets to --verbose for per-bucket details)");
    }
  }

  if (input.verboseBlocks.has("energy-buckets")) {
    console.log("Energy buckets:");
    console.table(
      buildEnergyBucketRows(input.dynamicPriceTargetEstimate.energyBuckets),
    );
  }

  if (input.verboseBlocks.has("why")) {
    console.log("Why this target time:");
    console.table(
      formatKeyValueRows({
        "Expected load at target": formatW(
          input.dynamicPriceTargetEstimate.targetTimeSignal
            ?.expectedHouseLoadW ?? null,
        ),
        "Predicted solar at target": formatW(
          input.dynamicPriceTargetEstimate.targetTimeSignal?.predictedSolarW ??
            null,
        ),
        "Minimum solar surplus": formatW(input.minimumSolarSurplusWOverride),
        "Solar surplus at target": formatSignedW(
          getSolarSurplusW(
            input.dynamicPriceTargetEstimate.targetTimeSignal
              ?.predictedSolarW ?? null,
            input.dynamicPriceTargetEstimate.targetTimeSignal
              ?.expectedHouseLoadW ?? null,
          ),
        ),
        "Break-even rule": formatBreakEvenRule(
          input.dynamicPriceTargetEstimate,
          input.minimumSolarSurplusWOverride,
        ),
        Reasoning: input.dynamicPriceTargetEstimate.reasoning || "n/a",
      }),
    );
  }

  if (
    input.verboseBlocks.has("break-even") &&
    !isCharging &&
    input.dynamicPriceTargetEstimate.breakEvenTrace.length > 0
  ) {
    console.log("Break-even buckets:");
    console.table(
      input.dynamicPriceTargetEstimate.breakEvenTrace.slice(-3).map((row) => ({
        breakEven: row.meetsBreakEven ? "yes" : "no",
        expectedHouseLoadW: formatW(row.expectedHouseLoadW),
        predictedSolarW: formatW(row.predictedSolarW),
        solarSurplusW: formatSignedW(
          getSolarSurplusW(row.predictedSolarW, row.expectedHouseLoadW),
        ),
        time: formatClockTime(row.time),
      })),
    );
  }

  if (input.verboseBlocks.has("history")) {
    console.log("History used:");
    console.table(
      formatKeyValueRows({
        "Historical periods used": String(
          input.dynamicPriceTargetEstimate.historyStats.historicalPeriodsUsed,
        ),
        "Same-weekday periods used": String(
          input.dynamicPriceTargetEstimate.historyStats.sameWeekdayPeriodsUsed,
        ),
        "Time slots modelled": String(
          input.dynamicPriceTargetEstimate.historyStats.slotCount,
        ),
        "Replay reference days": input.candidateDays.join(", "),
      }),
    );
  }

  console.log(summary);
}

export function buildCurrentEstimateRows(input: {
  dynamicPriceTargetEstimate: DynamicPriceTargetEstimate;
  minimumSolarSurplusWOverride: number;
  priceSignal: PriceSignal;
  referenceTime: Date;
  reserveTargetPercent: number;
}): Record<string, string> {
  const isCharging =
    input.dynamicPriceTargetEstimate.resolvedManualState === "charging";
  return {
    Action: formatResolvedActionLabel(input.dynamicPriceTargetEstimate),
    Price: formatPriceSignalLabel(input.priceSignal),
    "Start time": formatReferenceMoment(input.referenceTime),
    "Minimum solar surplus": formatW(input.minimumSolarSurplusWOverride),
    "Reserve at target": `${getDisplayedReserveAtTargetPercent(input)}%`,
    [isCharging ? "Charge target" : "Discharge target"]:
      `${getDisplayedTargetPercentForEstimate(input)}%`,
    "Target time": formatTargetTime(input.dynamicPriceTargetEstimate.targetTime),
    "Start to target duration": formatDurationUntilTarget(
      input.referenceTime,
      input.dynamicPriceTargetEstimate.targetTime,
    ),
    Skip: input.dynamicPriceTargetEstimate.skipReason ?? "no",
  };
}

export function buildEnergyEstimateRows(input: {
  capacityWh: number;
  dynamicPriceTargetEstimate: DynamicPriceTargetEstimate;
  referenceTime: Date;
  reserveTargetPercent: number;
}): Record<string, string> {
  const currentTargetPercent = getDisplayedTargetPercentForEstimate(input);
  const reserveAtTargetPercent = getDisplayedReserveAtTargetPercent(input);
  const energyTargetPercent = Math.max(
    0,
    currentTargetPercent - reserveAtTargetPercent,
  );

  return {
    "Integration interval": formatInterval(
      input.referenceTime,
      input.dynamicPriceTargetEstimate.targetTime,
    ),
    "Expected house load before target bucket": formatWh(
      input.dynamicPriceTargetEstimate.expectedHouseLoadWh,
    ),
    "Predicted solar before target bucket": formatWh(
      input.dynamicPriceTargetEstimate.predictedSolarGenerationWh,
    ),
    "Net battery energy needed before target bucket": `${formatWh(input.dynamicPriceTargetEstimate.estimatedRemainingEnergyWh)} = max(0, ${formatWh(input.dynamicPriceTargetEstimate.expectedHouseLoadWh)} - ${formatWh(input.dynamicPriceTargetEstimate.predictedSolarGenerationWh)})`,
    "Battery capacity basis": formatWh(input.capacityWh),
    "Energy converted to target": `${energyTargetPercent}% = ceil(${formatWh(input.dynamicPriceTargetEstimate.estimatedRemainingEnergyWh)} / ${formatWh(input.capacityWh)} * 100)`,
    "Final target formula": `${getDisplayedTargetPercentForEstimate(input)}% = ${reserveAtTargetPercent}% reserve at target + ${energyTargetPercent}% interval energy`,
  };
}

export function buildEnergyBucketRows(
  energyBuckets: DynamicPriceTargetEstimate["energyBuckets"],
): Array<Record<string, string>> {
  return energyBuckets.map((row) => ({
    time: formatClockTime(row.time),
    duration: formatDurationMinutes(row.durationMinutes),
    expectedHouseLoadWh: formatWh(row.expectedHouseLoadWh),
    cumulativeExpectedHouseLoadWh: formatWh(row.cumulativeExpectedHouseLoadWh),
    predictedSolarWh: formatWh(row.predictedSolarWh),
    cumulativePredictedSolarWh: formatWh(row.cumulativePredictedSolarWh),
    cumulativeNetBatteryEnergyNeededWh: formatWh(
      row.cumulativeNetBatteryEnergyNeededWh,
    ),
  }));
}

function formatKeyValueRows(
  values: Record<string, string>,
): Array<{ key: string; value: string }> {
  return Object.entries(values).map(([key, value]) => ({ key, value }));
}

function getDisplayedTargetPercentForEstimate(input: {
  dynamicPriceTargetEstimate: DynamicPriceTargetEstimate;
  reserveTargetPercent: number;
}): number {
  return input.dynamicPriceTargetEstimate.resolvedManualState === "charging"
    ? input.dynamicPriceTargetEstimate.estimatedTargetPercent
    : getDisplayedTargetPercent(
        input.dynamicPriceTargetEstimate.estimatedTargetPercent,
        input.reserveTargetPercent,
      );
}

function getDisplayedReserveAtTargetPercent(input: {
  dynamicPriceTargetEstimate: DynamicPriceTargetEstimate;
  reserveTargetPercent: number;
}): number {
  return input.dynamicPriceTargetEstimate.resolvedManualState === "charging"
    ? input.reserveTargetPercent
    : getDisplayedTargetPercent(
        input.dynamicPriceTargetEstimate.estimatedReservePercentAtTargetTime,
        input.reserveTargetPercent,
      );
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

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function formatWh(value: number | null): string {
  return value === null ? "n/a" : `${formatNumber(value)} Wh`;
}

function getSolarSurplusW(
  predictedSolarW: number | null,
  expectedHouseLoadW: number | null,
): number | null {
  if (predictedSolarW === null || expectedHouseLoadW === null) {
    return null;
  }

  return Number((predictedSolarW - expectedHouseLoadW).toFixed(2));
}

function formatW(value: number | null): string {
  return value === null ? "n/a" : `${formatNumber(value)} W`;
}

function formatSignedW(value: number | null): string {
  if (value === null) {
    return "n/a";
  }

  const prefix = value > 0 ? "+" : "";
  return `${prefix}${formatNumber(value)} W`;
}

function formatActionLabel(action: EvaluationOptions["action"]): string {
  return action === "charging" ? "charge" : "discharge";
}

function formatResolvedActionLabel(
  estimate: DynamicPriceTargetEstimate,
): string {
  return estimate.resolvedManualState === "charging" ? "charge" : "discharge";
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

function parsePriceSignals(value: string | undefined): PriceSignal[] {
  if (!value) {
    throw new Error(
      "--price requires a comma-separated list of 'high' and/or 'low'.",
    );
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

function formatInterval(start: Date, end: string | null): string {
  return `${formatReferenceMoment(start)} -> ${formatTargetTime(end)} (${formatDurationUntilTarget(start, end)})`;
}

function formatDurationMinutes(minutes: number): string {
  if (minutes >= 60) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m === 0 ? `${h}h` : `${h}h ${m}m`;
  }
  return `${minutes}m`;
}

function formatDurationUntilTarget(
  referenceTime: Date,
  value: string | null,
): string {
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
  dynamicPriceTargetEstimate: DynamicPriceTargetEstimate,
  minimumSolarSurplusW: number,
): string {
  const expectedLoadAtTargetW =
    dynamicPriceTargetEstimate.targetTimeSignal?.expectedHouseLoadW ?? null;
  const predictedSolarAtTargetW =
    dynamicPriceTargetEstimate.targetTimeSignal?.predictedSolarW ?? null;

  if (predictedSolarAtTargetW === null || expectedLoadAtTargetW === null) {
    return "n/a";
  }

  return `${formatW(predictedSolarAtTargetW)} > ${formatW(expectedLoadAtTargetW)} + ${formatW(minimumSolarSurplusW)}`;
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

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error.";
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}
