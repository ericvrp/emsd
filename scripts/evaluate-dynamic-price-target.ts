import {
  openDaemonDatabase,
  readBatteries,
  readBatteryPowerSamples,
  readDynamicPriceSamples,
  readDynamicPriceSources,
  readManagedDeviceTelemetry,
  readP1MeterSamples,
  readSites,
  readSolarEnergyProviderSamples,
  readSolarForecastSamples,
} from "../apps/daemon/src/database";
import {
  type CurrentExpectedSolarSurplus,
  type DynamicPriceTargetEstimate,
  estimateDynamicPriceTarget,
  estimateImportShortageDynamicTarget,
  resolveCurrentExpectedSolarSurplus,
} from "../apps/daemon/src/dynamic-price-target";
import { getStrategyTriggerAt } from "../apps/daemon/src/strategy-scheduler";
import type {
  BatteryManualState,
  BatteryStrategyPlanItem,
} from "../packages/core/src/index";
import {
  BatteryStrategyTriggerKind,
  DEFAULT_DYNAMIC_PRICE_TARGET_EVALUATION_DAYS,
  DEFAULT_MANUAL_STRATEGY_POWER_W,
  DYNAMIC_PRICE_TARGET_BACKUP_RESERVE_MARGIN_PERCENT,
  DYNAMIC_PRICE_TARGET_BUFFER_PERCENT_PER_HOUR,
  DYNAMIC_PRICE_TARGET_MIN_SOLAR_SURPLUS_W,
  PRICE_SELECTION_WINDOW_MS,
  findPriceSelections,
  getDatabasePath,
  isFlagArg,
  parseIntegerArg,
  parseNumberArg,
  parseStringArg,
} from "../packages/core/src/index";

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
  date: string;
  markerPercentage: number | null;
  days: number;
  minimumSolarSurplusWOverride: number;
  powerW: number;
  profile: boolean;
  strategyTriggerKinds: StrategyTriggerKind[];
  siteId: string | null;
  targetBufferPercentPerHourOverride: number;
  time: string;
  verboseBlocks: Set<VerboseBlock>;
}

interface EvaluationOptions extends ScriptOptions {
  action: Extract<BatteryManualState, "charging" | "discharging">;
  strategyTriggerKind: StrategyTriggerKind;
}

type StrategyTriggerKind =
  | BatteryStrategyTriggerKind.ExportSurplus
  | BatteryStrategyTriggerKind.DelayedChargePrep
  | BatteryStrategyTriggerKind.DelayedCharging
  | BatteryStrategyTriggerKind.ImportShortage;

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
  dynamicPriceSamples?: ReturnType<typeof readDynamicPriceSamples>;
  currentExpectedSolarSurplus?: CurrentExpectedSolarSurplus | null;
  minimumSolarSurplusWOverride: number;
  normalizedImportExportSpread?: number | null;
  reserveTargetPercent: number;
  referenceTime: Date;
  selectedMarkerTime?: Date | null;
  strategyTriggerKind: StrategyTriggerKind;
  siteId: string;
  siteName: string;
  verboseBlocks: Set<VerboseBlock>;
}

interface ProfileRow {
  count: number | null;
  label: string;
  ms: number;
}

export function parseArgs(args: string[]): ScriptOptions {
  let date = getCurrentLocalDate();
  let markerPercentage: number | null = null;
  let days = DEFAULT_DAYS;
  let backupReserveMargin = DEFAULT_BACKUP_RESERVE_MARGIN;
  let minimumSolarSurplusWOverride = DEFAULT_MINIMUM_SOLAR_SURPLUS_W;
  let powerW = DEFAULT_POWER_W;
  let profile = false;
  let strategyTriggerKinds: StrategyTriggerKind[] = [
    BatteryStrategyTriggerKind.ExportSurplus,
    BatteryStrategyTriggerKind.DelayedCharging,
    BatteryStrategyTriggerKind.ImportShortage,
  ];
  let siteId: string | null = null;
  let targetBufferPercentPerHourOverride =
    DEFAULT_TARGET_BUFFER_PERCENT_PER_HOUR;
  let time = getCurrentLocalClockTime();
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

    const dateArg = parseStringArg(args, index, "--date");

    if (dateArg) {
      if (!isIsoDate(dateArg.value)) {
        throw new Error("--date must use YYYY-MM-DD format.");
      }

      date = dateArg.value;
      index = dateArg.newIndex;
      continue;
    }

    const markerPercentageArg = parseNumberArg(
      args,
      index,
      "--marker-percentage",
      (value) =>
        value < 0 || value > 100
          ? "--marker-percentage must be between 0 and 100."
          : null,
    );

    if (markerPercentageArg) {
      markerPercentage = markerPercentageArg.value;
      index = markerPercentageArg.newIndex;
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

    const timeArg = parseStringArg(args, index, "--time");

    if (timeArg) {
      if (!isClockTime(timeArg.value)) {
        throw new Error("--time must use HH:MM or HH:MM:SS format.");
      }

      time = timeArg.value;
      index = timeArg.newIndex;
      continue;
    }

    const strategyArg = parseStringArg(args, index, "--strategy");

    if (strategyArg) {
      strategyTriggerKinds = parseStrategyTriggerKinds(strategyArg.value);
      index = strategyArg.newIndex;
      continue;
    }

    if (isFlagArg(arg, "--help", "-h")) {
      printHelp();
      process.exit(0);
    }

    if (arg === "--profile") {
      profile = true;
      continue;
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

    throw new Error(`Unknown argument: ${arg}`);
  }

  return {
    date,
    markerPercentage,
    days,
    backupReserveMargin,
    powerW,
    profile,
    strategyTriggerKinds,
    siteId,
    minimumSolarSurplusWOverride,
    targetBufferPercentPerHourOverride,
    time,
    verboseBlocks,
  };
}

function printHelp(): void {
  console.log(
    [
      "Evaluate the dynamic price target method against recent history.",
      "",
      "Defaults:",
      "  strategy: export-surplus,delayed-charging,import-shortage",
      `  backup reserve margin: ${DEFAULT_BACKUP_RESERVE_MARGIN}%`,
      `  minimum solar surplus: ${DEFAULT_MINIMUM_SOLAR_SURPLUS_W}W`,
      `  backup reserve margin per hour: ${DEFAULT_TARGET_BUFFER_PERCENT_PER_HOUR}%`,
      `  power: ${DEFAULT_POWER_W}W`,
      "  date/time: current local time unless --date or --time is set; strategy markers are resolved from that moment",
      "  marker percentage: current battery SoC unless --marker-percentage is set",
      `  days: ${DEFAULT_DAYS}`,
      `  --verbose enables: ${DEFAULT_VERBOSE_BLOCKS.join(", ")}`,
      "",
      "Usage:",
      "  bun run dynamic-price-target:evaluate",
      "  bun run dynamic-price-target:evaluate -- --strategy=delayed-charge-prep",
      "  bun run dynamic-price-target:evaluate -- --strategy=delayed-charging",
      "  bun run dynamic-price-target:evaluate -- --strategy=import-shortage",
      "  bun run dynamic-price-target:evaluate -- --strategy=export-surplus,delayed-charging,import-shortage",
      "  bun run dynamic-price-target:evaluate -- --date=2026-04-19",
      "  bun run dynamic-price-target:evaluate -- --marker-percentage=55",
      "  bun run dynamic-price-target:evaluate -- --backup-reserve-margin=2",
      "  bun run dynamic-price-target:evaluate -- --minimum-solar-surplus=75",
      "  bun run dynamic-price-target:evaluate -- --backup-reserve-margin-per-hour=0.5",
      "  bun run dynamic-price-target:evaluate -- --power=1800",
      "  bun run dynamic-price-target:evaluate -- --time=17:30",
      "  bun run dynamic-price-target:evaluate -- --time=17:30:20",
      "  bun run dynamic-price-target:evaluate -- --site=<site-id>",
      "  bun run dynamic-price-target:evaluate -- --verbose",
      "  bun run dynamic-price-target:evaluate -- --verbose=meta,why,history",
      "  bun run dynamic-price-target:evaluate -- --verbose=energy-buckets",
      "  bun run dynamic-price-target:evaluate -- --profile",
      `  verbose blocks: ${ALL_VERBOSE_BLOCKS.join(", ")}`,
    ].join("\n"),
  );
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const profileRows: ProfileRow[] = [];
  const totalStartedAt = performance.now();
  const db = measureProfile(profileRows, "open database + schema", () =>
    openDaemonDatabase(getDatabasePath()),
  );

  try {
    const sites = measureProfile(profileRows, "read sites", () =>
      readSites(db).filter((site) =>
        options.siteId === null ? true : site.id === options.siteId,
      ),
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
      for (const strategyTriggerKind of options.strategyTriggerKinds) {
        const evaluationOptions = createEvaluationOptions(
          options,
          strategyTriggerKind,
        );

        if (evaluationOptions.verboseBlocks.has("meta")) {
          console.log(
            `Estimating synthetic ${formatActionLabel(evaluationOptions.action)} target for ${formatStrategyTriggerKindLabel(evaluationOptions.strategyTriggerKind)} at ${evaluationOptions.powerW}W as of ${evaluationOptions.date} ${evaluationOptions.time}.`,
          );
        }

        measureProfile(
          profileRows,
          `evaluate site ${site.id} ${strategyTriggerKind}`,
          () => evaluateSite(site.id, evaluationOptions, db, profileRows),
        );
      }
    }
  } finally {
    db.close();
    profileRows.push({
      count: null,
      label: "total process work",
      ms: performance.now() - totalStartedAt,
    });

    if (options.profile) {
      printProfileRows(profileRows);
    }
  }
}

function createEvaluationOptions(
  options: ScriptOptions,
  strategyTriggerKind: StrategyTriggerKind,
): EvaluationOptions {
  return {
    ...options,
    action:
      strategyTriggerKind === BatteryStrategyTriggerKind.DelayedChargePrep ||
      strategyTriggerKind === BatteryStrategyTriggerKind.DelayedCharging ||
      strategyTriggerKind === BatteryStrategyTriggerKind.ImportShortage
        ? "charging"
        : "discharging",
    strategyTriggerKind,
  };
}

function evaluateSite(
  siteId: string,
  options: EvaluationOptions,
  db: ReturnType<typeof openDaemonDatabase>,
  profileRows: ProfileRow[],
): void {
  const batteries = measureProfile(
    profileRows,
    `read batteries ${siteId}`,
    () => readBatteries(db, siteId),
  );
  const telemetry = measureProfile(profileRows, "read telemetry", () =>
    readManagedDeviceTelemetry(db),
  );
  const batteryPowerSamples = measureProfile(
    profileRows,
    `read battery power samples ${siteId}`,
    () => readBatteryPowerSamples(db, siteId),
  );
  const dynamicPriceSamples = measureProfile(
    profileRows,
    `read dynamic price samples ${siteId}`,
    () => readDynamicPriceSamples(db, siteId),
  );
  const dynamicPriceSources = measureProfile(
    profileRows,
    "read dynamic price sources",
    () => readDynamicPriceSources(db),
  );
  const p1MeterSamples = measureProfile(
    profileRows,
    `read p1 meter samples ${siteId}`,
    () => readP1MeterSamples(db, siteId),
  );
  const solarEnergyProviderSamples = measureProfile(
    profileRows,
    `read solar energy samples ${siteId}`,
    () => readSolarEnergyProviderSamples(db, siteId),
  );
  const solarForecastSamples = measureProfile(
    profileRows,
    `read solar forecast samples ${siteId}`,
    () => readSolarForecastSamples(db, siteId),
  );
  const site = measureProfile(
    profileRows,
    "read site lookup",
    () => readSites(db).find((entry) => entry.id === siteId) ?? null,
  );
  const normalizedImportExportSpread = resolveNormalizedImportExportSpread(
    dynamicPriceSources,
    siteId,
  );

  if (batteries.length === 0) {
    console.log(`\nSite ${siteId}: no batteries found.`);
    return;
  }

  const syntheticItem = createSyntheticPlanItem({
    action: options.action,
    battery: batteries[0],
    powerW: options.powerW,
    strategyTriggerKind: options.strategyTriggerKind,
  });
  const referenceTime = measureProfile(
    profileRows,
    "resolve reference time",
    () =>
      resolveEvaluationReferenceTime({
        date: options.date,
        time: options.time,
      }),
  );
  const selectedMarkerTime = measureProfile(
    profileRows,
    "resolve strategy marker",
    () =>
      resolveEvaluationStrategyMarker({
        dynamicPriceSamples,
        item: syntheticItem,
        referenceTime,
      }),
  );
  const candidateDays = measureProfile(profileRows, "get candidate days", () =>
    getCandidateDaysFromBatterySamples(
      batteryPowerSamples,
      referenceTime.toISOString().slice(0, 10),
      options.days,
    ),
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
      strategyTriggerKind: options.strategyTriggerKind,
    });
    const sample = {
      capacityWh: batteryTelemetry.capacityWh,
      currentW: null,
      manualChargeTargetSoc: battery.manualChargeTargetSoc,
      manualDischargeTargetSoc: battery.manualDischargeTargetSoc,
      manualPowerW: options.powerW,
      manualState: options.action,
      manualTargetSoc: battery.manualTargetSoc,
      model: battery.model,
      name: battery.name,
      socPercent:
        options.markerPercentage ??
        getBatterySocAt(batteryPowerSamples, battery.id, referenceTime),
      status: battery.status,
      strategyMode: "manual",
    };
    dynamicPriceTargetEstimate = measureProfile(
      profileRows,
      `estimate ${options.strategyTriggerKind} ${battery.id}`,
      () =>
        options.strategyTriggerKind ===
        BatteryStrategyTriggerKind.ImportShortage
          ? estimateImportShortageDynamicTarget({
              battery,
              batteryPowerSamples,
              lowPriceMarkerTime: selectedMarkerTime ?? referenceTime,
              now: referenceTime,
              p1MeterSamples,
              sample,
              solarEnergyProviderSamples,
              solarForecastSamples,
            })
          : estimateDynamicPriceTarget({
              battery,
              batteryPowerSamples,
              backupReserveMarginOverride: options.backupReserveMargin,
              dynamicPriceSamples,
              item: batterySyntheticItem,
              items: [
                battery.strategyPlan[0] ?? batterySyntheticItem,
                batterySyntheticItem,
              ],
              now: referenceTime,
              normalizedImportExportSpread,
              p1MeterSamples,
              sample,
              minimumSolarSurplusWOverride:
                options.minimumSolarSurplusWOverride,
              solarEnergyProviderSamples,
              solarForecastSamples,
              targetBufferPercentPerHourOverride:
                options.targetBufferPercentPerHourOverride,
            }),
    );
    const reserveTargetPercent = getReserveTargetPercent(
      battery.minimumDischargePercent,
      options.backupReserveMargin,
    );
    const currentExpectedSolarSurplus =
      options.strategyTriggerKind ===
      BatteryStrategyTriggerKind.DelayedChargePrep
        ? resolveCurrentExpectedSolarSurplus({
            batteryPowerSamples,
            minimumSolarSurplusWOverride: options.minimumSolarSurplusWOverride,
            now: referenceTime,
            p1MeterSamples,
            solarEnergyProviderSamples,
            solarForecastSamples,
          })
        : null;

    measureProfile(profileRows, `print summary ${battery.id}`, () =>
      printCurrentEstimateSummary({
        action: options.action,
        battery,
        batteryId: battery.id,
        capacityWh: batteryTelemetry.capacityWh,
        candidateDays,
        dynamicPriceTargetEstimate,
        dynamicPriceSamples,
        currentExpectedSolarSurplus,
        minimumSolarSurplusWOverride: options.minimumSolarSurplusWOverride,
        normalizedImportExportSpread,
        strategyTriggerKind: options.strategyTriggerKind,
        reserveTargetPercent,
        referenceTime,
        selectedMarkerTime,
        siteId,
        siteName: site?.name ?? siteId,
        verboseBlocks: options.verboseBlocks,
      }),
    );
  }
}

function measureProfile<T>(rows: ProfileRow[], label: string, fn: () => T): T {
  const startedAt = performance.now();
  let result: T | undefined;

  try {
    result = fn();
    return result;
  } finally {
    rows.push({
      count: getProfileCount(result),
      label,
      ms: performance.now() - startedAt,
    });
  }
}

function getProfileCount(result: unknown): number | null {
  if (Array.isArray(result)) {
    return result.length;
  }

  return null;
}

function printProfileRows(rows: ProfileRow[]): void {
  console.log("Profile:");
  console.table(
    rows.map((row) => ({
      count: row.count ?? "",
      label: row.label,
      ms: Number(row.ms.toFixed(2)),
    })),
  );
}

function createSyntheticPlanItem(input: {
  action: EvaluationOptions["action"];
  battery: ReturnType<typeof readBatteries>[number];
  powerW: number;
  strategyTriggerKind: StrategyTriggerKind;
}): BatteryStrategyPlanItem {
  const isDelayedChargePrep =
    input.strategyTriggerKind === BatteryStrategyTriggerKind.DelayedChargePrep;

  return {
    enabled: true,
    id: "synthetic-auto-target",
    kind: "daily",
    manualChargeTargetSoc: input.action === "charging" ? 100 : null,
    manualDischargeTargetSoc:
      input.action === "discharging"
        ? input.battery.minimumDischargePercent
        : null,
    manualPowerW: isDelayedChargePrep ? null : input.powerW,
    manualState: isDelayedChargePrep ? "idle" : input.action,
    manualTargetSoc:
      input.action === "charging" ? 100 : input.battery.minimumDischargePercent,
    startTime: null,
    strategyMode: "manual",
    targetDurationMinutes: null,
    targetEndTime: null,
    targetMethod: "auto",
    triggerKind: input.strategyTriggerKind,
  };
}

export function createReplayTime(day: string, time: string): Date {
  const [yearPart, monthPart, dayPart] = day.split("-");
  const [hoursPart, minutesPart, secondsPart] = time.split(":");
  const replayTime = new Date();

  replayTime.setFullYear(
    Number(yearPart),
    Number(monthPart) - 1,
    Number(dayPart),
  );
  replayTime.setHours(
    Number(hoursPart),
    Number(minutesPart),
    secondsPart === undefined ? 0 : Number(secondsPart),
    0,
  );

  return replayTime;
}

export function resolveEvaluationReferenceTime(input: {
  date: string;
  time: string;
}): Date {
  return createReplayTime(input.date, input.time);
}

export function resolveEvaluationStrategyMarker(input: {
  dynamicPriceSamples: ReturnType<typeof readDynamicPriceSamples>;
  item: BatteryStrategyPlanItem;
  referenceTime: Date;
}): Date | null {
  return getStrategyTriggerAt({
    item: input.item,
    now: input.referenceTime,
    dynamicPriceSamples: input.dynamicPriceSamples,
  });
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

function resolveHighPriceMarkerExportPrice(
  input: EvaluationContext,
  markerAt: Date,
): number | null {
  if (
    input.normalizedImportExportSpread === null ||
    input.normalizedImportExportSpread === undefined
  ) {
    return null;
  }

  const normalizedImportExportSpread = input.normalizedImportExportSpread;
  const markerMs = markerAt.getTime();

  for (const sample of input.dynamicPriceSamples ?? []) {
    const sampleMs = new Date(sample.periodStart).getTime();

    if (Number.isNaN(sampleMs) || sampleMs !== markerMs) {
      continue;
    }

    return Number(
      (sample.importPrice - normalizedImportExportSpread).toFixed(5),
    );
  }

  return null;
}

function resolveNextHighPriceMarkerAfter(
  input: EvaluationContext,
): Date | null {
  const selections = findPriceSelections(
    (input.dynamicPriceSamples ?? []).map((sample) => ({
      periodStart: sample.periodStart,
      value: sample.importPrice,
    })),
    PRICE_SELECTION_WINDOW_MS,
  );
  const referenceMs = input.referenceTime.getTime();

  return (
    selections.highest
      .map((point) => new Date(point.periodStart))
      .filter(
        (markerAt) =>
          !Number.isNaN(markerAt.getTime()) && markerAt.getTime() > referenceMs,
      )
      .sort((left, right) => left.getTime() - right.getTime())[0] ?? null
  );
}

function formatHighPriceMarker(
  input: EvaluationContext,
  markerAt: Date,
): string {
  return `${formatTargetTime(markerAt.toISOString())} at ${formatPrice(
    resolveHighPriceMarkerExportPrice(input, markerAt),
  )} export`;
}

function resolveNormalizedImportExportSpread(
  sources: ReturnType<typeof readDynamicPriceSources>,
  siteId: string,
): number | null {
  const source = sources.find((entry) => entry.siteId === siteId) ?? null;

  return source?.exportDeduction ?? null;
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
          solarPowerW + gridPowerW + batteryPowerW,
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
  const summaryRows = buildEstimateSummaryRows(input);

  console.log(
    `\n${formatStrategyTriggerKindLabel(input.strategyTriggerKind)} | ${input.siteName} (${input.siteId}) | ${input.battery.name} (${input.batteryId})`,
  );
  printLabelValueRows(summaryRows);

  if (input.verboseBlocks.has("current")) {
    console.log("Current estimate:");
    console.table(
      formatKeyValueRows(
        buildCurrentEstimateRows({
          dynamicPriceTargetEstimate: input.dynamicPriceTargetEstimate,
          minimumSolarSurplusWOverride: input.minimumSolarSurplusWOverride,
          strategyTriggerKind: input.strategyTriggerKind,
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
    console.table(formatKeyValueRows(buildWhyRows(input)));
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

  console.log(formatVerboseHint(input));
}

export function buildEstimateSummaryRows(
  input: EvaluationContext,
): Array<{ label: string; value: string }> {
  const currentTargetPercent = getDisplayedTargetPercentForEstimate(input);
  const reserveAtTargetPercent = getDisplayedReserveAtTargetPercent(input);
  const actionLabel = formatResolvedActionLabel(
    input.dynamicPriceTargetEstimate,
  );
  const delayedChargingDetails =
    input.dynamicPriceTargetEstimate.delayedChargingDetails;
  const contextRows = buildEvaluationContextRows(input);
  const nextHighPriceMarker = resolveNextHighPriceMarkerAfter(input);
  const highPriceMarkerRows =
    input.strategyTriggerKind === BatteryStrategyTriggerKind.ExportSurplus
      ? [
          {
            label: "High Price Marker",
            value: formatHighPriceMarker(
              input,
              input.selectedMarkerTime ?? input.referenceTime,
            ),
          },
          {
            label: "Next High Price Marker",
            value:
              nextHighPriceMarker === null
                ? "not available yet"
                : formatHighPriceMarker(input, nextHighPriceMarker),
          },
        ]
      : [];
  const delayedChargePrepRows =
    input.strategyTriggerKind === BatteryStrategyTriggerKind.DelayedChargePrep
      ? buildDelayedChargePrepRows(input)
      : [];
  const delayedChargePrepSurplusRows =
    input.strategyTriggerKind === BatteryStrategyTriggerKind.DelayedChargePrep
      ? buildDelayedChargePrepCurrentSurplusRows(input)
      : [];

  if (input.dynamicPriceTargetEstimate.skipReason) {
    if (
      input.strategyTriggerKind === BatteryStrategyTriggerKind.ImportShortage &&
      input.dynamicPriceTargetEstimate.importShortageDetails
    ) {
      return [
        ...contextRows,
        ...buildImportShortageDecisionRows(
          input.dynamicPriceTargetEstimate.importShortageDetails,
          input.dynamicPriceTargetEstimate,
          input.referenceTime,
        ),
        { label: "Status", value: "skipped" },
        { label: "Reason", value: input.dynamicPriceTargetEstimate.skipReason },
      ];
    }

    return [
      ...contextRows,
      { label: "Action", value: actionLabel },
      { label: "Status", value: "skipped" },
      { label: "Reason", value: input.dynamicPriceTargetEstimate.skipReason },
    ];
  }

  if (
    input.strategyTriggerKind === BatteryStrategyTriggerKind.DelayedCharging &&
    delayedChargingDetails !== null
  ) {
    return [
      ...contextRows,
      {
        label: "Low Price Marker",
        value: `${formatTargetTime(delayedChargingDetails.lowPriceMarkerTime)} at ${formatPrice(delayedChargingDetails.lowestPrice)}`,
      },
      {
        label: "Activation Mode",
        value:
          delayedChargingDetails.activationMode === "charging"
            ? "full charge"
            : "self-consumption",
      },
      {
        label: "Time to full",
        value: `${formatDurationMinutes(delayedChargingDetails.timeToFullMinutes)} from ${formatNumber(delayedChargingDetails.currentSocBasisPercent)}% to ${delayedChargingDetails.targetChargePercent}% (${formatWh(delayedChargingDetails.energyToFullWh)} at ${formatW(delayedChargingDetails.effectiveFillPowerW)})`,
      },
      {
        label: "Trigger lead time",
        value: `${formatDurationMinutes(delayedChargingDetails.triggerLeadTimeMinutes)} = ${formatDurationMinutes(delayedChargingDetails.timeToFullMinutes)} * 0.5 * ${formatNumber(delayedChargingDetails.triggerMarginFactor)}`,
      },
      {
        label: "Start",
        value: formatDisplayedStartTime(
          input.dynamicPriceTargetEstimate,
          input.referenceTime,
        ),
      },
    ];
  }

  if (
    input.strategyTriggerKind === BatteryStrategyTriggerKind.ImportShortage &&
    input.dynamicPriceTargetEstimate.importShortageDetails
  ) {
    const details = input.dynamicPriceTargetEstimate.importShortageDetails;

    return [
      ...contextRows,
      ...buildImportShortageDecisionRows(
        details,
        input.dynamicPriceTargetEstimate,
        input.referenceTime,
      ),
    ];
  }

  const recoveryLabel =
    input.strategyTriggerKind === BatteryStrategyTriggerKind.DelayedChargePrep
      ? "Recovery "
      : "";

  return [
    ...contextRows,
    ...delayedChargePrepRows,
    ...delayedChargePrepSurplusRows,
    { label: "Action", value: actionLabel },
    ...highPriceMarkerRows,
    {
      label: "Recovery Target Time",
      value: formatTargetTime(input.dynamicPriceTargetEstimate.targetTime),
    },
    {
      label: `${recoveryLabel}Predicted Solar`,
      value: formatW(
        input.dynamicPriceTargetEstimate.targetTimeSignal?.predictedSolarW ??
          null,
      ),
    },
    {
      label: `${recoveryLabel}Expected Load`,
      value: formatW(
        input.dynamicPriceTargetEstimate.targetTimeSignal?.expectedHouseLoadW ??
          null,
      ),
    },
    {
      label: `${recoveryLabel}Solar Surplus`,
      value: formatSignedW(
        getSolarSurplusW(
          input.dynamicPriceTargetEstimate.targetTimeSignal?.predictedSolarW ??
            null,
          input.dynamicPriceTargetEstimate.targetTimeSignal
            ?.expectedHouseLoadW ?? null,
        ),
      ),
    },
    {
      label: "Target",
      value: `${actionLabel} to ${currentTargetPercent}%`,
    },
    {
      label: "Reserve At Target",
      value: `${reserveAtTargetPercent}%`,
    },
  ];
}

function buildDelayedChargePrepCurrentSurplusRows(
  input: EvaluationContext,
): Array<{ label: string; value: string }> {
  const currentSurplus = input.currentExpectedSolarSurplus;

  if (!currentSurplus) {
    return [];
  }

  return [
    {
      label: "Current Predicted Solar",
      value: formatW(currentSurplus.predictedSolarW),
    },
    {
      label: "Current Expected Load",
      value: formatW(currentSurplus.expectedHouseLoadW),
    },
    {
      label: "Current Solar Surplus",
      value: formatSignedW(currentSurplus.surplusW),
    },
    {
      label: "Prep Gate",
      value: `${formatW(currentSurplus.predictedSolarW)} > ${formatW(currentSurplus.expectedHouseLoadW)} + ${formatW(currentSurplus.minimumSolarSurplusW)}`,
    },
    ...(currentSurplus.skipReason === null
      ? [{ label: "Prep Status", value: "allowed" }]
      : [
          { label: "Prep Status", value: "blocked" },
          { label: "Prep Block Reason", value: currentSurplus.skipReason },
        ]),
  ];
}

function buildEvaluationContextRows(
  input: EvaluationContext,
): Array<{ label: string; value: string }> {
  const selectedMarkerLabel =
    input.strategyTriggerKind === BatteryStrategyTriggerKind.DelayedChargePrep
      ? "Prep Trigger"
      : "Selected Marker";

  return [
    {
      label: "Evaluated At",
      value: formatReferenceMoment(input.referenceTime),
    },
    {
      label: selectedMarkerLabel,
      value:
        input.selectedMarkerTime === null ||
        input.selectedMarkerTime === undefined
          ? "not available"
          : formatTargetTime(input.selectedMarkerTime.toISOString()),
    },
  ];
}

function buildDelayedChargePrepRows(
  input: EvaluationContext,
): Array<{ label: string; value: string }> {
  const markers = resolveDelayedChargePrepMarkerDetails(input);

  if (markers === null) {
    return [
      {
        label: "Paired Low Price Marker",
        value: "not available",
      },
      {
        label: "Prep Basis",
        value:
          "no earlier high-price marker was available for the next low-price marker",
      },
    ];
  }

  return [
    {
      label: "Paired Low Price Marker",
      value: `${formatTargetTime(markers.lowPriceMarkerAt.toISOString())} at ${formatPrice(markers.lowImportPrice)}`,
    },
    {
      label: "Prior High Price Marker",
      value: `${formatTargetTime(markers.priorHighPriceMarkerAt.toISOString())} at ${formatPrice(markers.highImportPrice)} import, ${formatPrice(markers.highExportPrice)} export`,
    },
    {
      label: "Prep Basis",
      value:
        "prep starts 1 hour after the prior high-price marker, before the paired low-price marker",
    },
  ];
}

function resolveDelayedChargePrepMarkerDetails(input: EvaluationContext): {
  highExportPrice: number | null;
  highImportPrice: number | null;
  lowImportPrice: number | null;
  lowPriceMarkerAt: Date;
  priorHighPriceMarkerAt: Date;
} | null {
  const selections = findPriceSelections(
    (input.dynamicPriceSamples ?? []).map((sample) => ({
      periodStart: sample.periodStart,
      value: sample.importPrice,
    })),
    PRICE_SELECTION_WINDOW_MS,
  );
  const referenceMs = input.referenceTime.getTime();
  const lowPriceMarkerAt =
    selections.lowest
      .map((point) => new Date(point.periodStart))
      .filter(
        (markerAt) =>
          !Number.isNaN(markerAt.getTime()) &&
          markerAt.getTime() >= referenceMs,
      )
      .sort((left, right) => left.getTime() - right.getTime())[0] ?? null;

  if (lowPriceMarkerAt === null) {
    return null;
  }

  const priorHighPriceMarkerAt =
    selections.highest
      .map((point) => new Date(point.periodStart))
      .filter(
        (markerAt) =>
          !Number.isNaN(markerAt.getTime()) &&
          markerAt.getTime() < lowPriceMarkerAt.getTime(),
      )
      .sort((left, right) => right.getTime() - left.getTime())[0] ?? null;

  if (priorHighPriceMarkerAt === null) {
    return null;
  }

  return {
    highExportPrice: resolveHighPriceMarkerExportPrice(
      input,
      priorHighPriceMarkerAt,
    ),
    highImportPrice: resolveImportPriceAt(input, priorHighPriceMarkerAt),
    lowImportPrice: resolveImportPriceAt(input, lowPriceMarkerAt),
    lowPriceMarkerAt,
    priorHighPriceMarkerAt,
  };
}

function resolveImportPriceAt(
  input: EvaluationContext,
  markerAt: Date,
): number | null {
  const markerMs = markerAt.getTime();

  for (const sample of input.dynamicPriceSamples ?? []) {
    const sampleMs = new Date(sample.periodStart).getTime();

    if (Number.isNaN(sampleMs) || sampleMs !== markerMs) {
      continue;
    }

    return sample.importPrice;
  }

  return null;
}

function buildImportShortageDecisionRows(
  details: NonNullable<DynamicPriceTargetEstimate["importShortageDetails"]>,
  estimate: DynamicPriceTargetEstimate,
  referenceTime: Date,
): Array<{ label: string; value: string }> {
  return [
    {
      label: "Import Price Marker",
      value: `${formatTargetTime(details.lowPriceMarkerTime)} low import-price marker used to schedule any cheap grid top-up`,
    },
    {
      label: "Solar Surplus Window",
      value: `${formatTargetTime(details.solarSurplusStartTime)} -> ${formatTargetTime(details.solarSurplusEndTime)}`,
    },
    {
      label: "Projection",
      value: `${formatNumber(details.currentSocPercent)}% now -> ${formatNumber(details.projectedSurplusStartSocPercent)}% by solar surplus start after ${formatWh(details.expectedNetDemandBeforeSurplusWh)} (${formatNumber(details.expectedNetDemandBeforeSurplusPercent)}%) house-load gap; then +${formatNumber(details.expectedNetSolarRecoveryPercent)}% solar recovery to ${formatNumber(details.projectedEndSocWithoutImportPercent)}% by surplus end`,
    },
    {
      label: "Decision",
      value:
        details.energyToImportWh <= 0
          ? `shortageToFull=${formatNumber(details.shortageToFullPercent)}%, so no grid import is needed`
          : `need ${formatNumber(details.shortageToFullPercent)}% more; target = ${formatNumber(details.currentSocPercent)}% current + ${formatNumber(details.shortageToFullPercent)}% shortage + ${formatNumber(details.bufferPercent)}% buffer = ${formatNumber(details.targetSocPercent)}%`,
    },
    {
      label: "Energy To Import",
      value: `${formatWh(details.energyToImportWh)} at ${formatW(details.effectiveChargePowerW)}`,
    },
    {
      label: "Start",
      value:
        details.energyToImportWh <= 0
          ? "not needed"
          : `${formatDisplayedStartTime(estimate, referenceTime)} (${formatDurationMinutes(details.triggerLeadTimeMinutes)} before marker)`,
    },
  ];
}

function printLabelValueRows(
  rows: Array<{ label: string; value: string }>,
): void {
  for (const row of rows) {
    console.log(`  ${row.label}: ${row.value}`);
  }
}

export function buildEstimateSummaryLine(input: EvaluationContext): string {
  const currentTargetPercent = getDisplayedTargetPercentForEstimate(input);
  const reserveAtTargetPercent = getDisplayedReserveAtTargetPercent(input);
  const actionLabel = formatResolvedActionLabel(
    input.dynamicPriceTargetEstimate,
  );
  const delayedChargingDetails =
    input.dynamicPriceTargetEstimate.delayedChargingDetails;
  const delayedChargingStartExplanation = formatDelayedChargingStartExplanation(
    {
      dynamicPriceTargetEstimate: input.dynamicPriceTargetEstimate,
      displayedTargetPercent: currentTargetPercent,
      strategyTriggerKind: input.strategyTriggerKind,
    },
  );

  if (input.dynamicPriceTargetEstimate.skipReason) {
    return `${input.siteName} (${input.siteId}) | ${input.battery.name} (${input.batteryId}) | ${formatStrategyTriggerKindLabel(input.strategyTriggerKind)} ${actionLabel} skipped | ${input.dynamicPriceTargetEstimate.skipReason}`;
  }

  if (
    input.strategyTriggerKind === BatteryStrategyTriggerKind.DelayedCharging &&
    delayedChargingDetails !== null
  ) {
    return `${input.siteName} (${input.siteId}) | ${input.battery.name} (${input.batteryId}) | delayed-charging ${actionLabel} at ${formatTargetTime(delayedChargingDetails.lowPriceMarkerTime)} (${formatPrice(delayedChargingDetails.lowestPrice)}) | start ${formatDisplayedStartTime(input.dynamicPriceTargetEstimate, input.referenceTime)} | lead ${formatDurationMinutes(delayedChargingDetails.triggerLeadTimeMinutes)}`;
  }

  if (
    input.strategyTriggerKind === BatteryStrategyTriggerKind.ImportShortage &&
    input.dynamicPriceTargetEstimate.importShortageDetails
  ) {
    const details = input.dynamicPriceTargetEstimate.importShortageDetails;

    return `${input.siteName} (${input.siteId}) | ${input.battery.name} (${input.batteryId}) | import-shortage charge to ${formatNumber(details.targetSocPercent)}% from projected end SoC ${formatNumber(details.projectedEndSocWithoutImportPercent)}% + ${formatNumber(details.bufferPercent)}% buffer | marker ${formatTargetTime(details.lowPriceMarkerTime)} | solar surplus ${formatTargetTime(details.solarSurplusStartTime)} -> ${formatTargetTime(details.solarSurplusEndTime)} | start ${formatDisplayedStartTime(input.dynamicPriceTargetEstimate, input.referenceTime)}`;
  }

  return `${input.siteName} (${input.siteId}) | ${input.battery.name} (${input.batteryId}) | target percentage ${reserveAtTargetPercent}% at ${formatTargetTime(input.dynamicPriceTargetEstimate.targetTime)} | ${formatStrategyTriggerKindLabel(input.strategyTriggerKind)} ${actionLabel} target ${currentTargetPercent}% start time ${formatDisplayedStartTime(input.dynamicPriceTargetEstimate, input.referenceTime)}${delayedChargingStartExplanation === null ? "" : ` | ${delayedChargingStartExplanation}`}`;
}

export function buildCurrentEstimateRows(input: {
  dynamicPriceTargetEstimate: DynamicPriceTargetEstimate;
  minimumSolarSurplusWOverride: number;
  strategyTriggerKind: StrategyTriggerKind;
  referenceTime: Date;
  reserveTargetPercent: number;
}): Record<string, string> {
  const isCharging =
    input.dynamicPriceTargetEstimate.resolvedManualState === "charging";
  return {
    Action: formatResolvedActionLabel(input.dynamicPriceTargetEstimate),
    Strategy: formatStrategyTriggerKindLabel(input.strategyTriggerKind),
    "Start time": formatDisplayedStartTime(
      input.dynamicPriceTargetEstimate,
      input.referenceTime,
    ),
    "Minimum solar surplus": formatW(input.minimumSolarSurplusWOverride),
    "Reserve at target": `${getDisplayedReserveAtTargetPercent(input)}%`,
    [isCharging ? "Charge target" : "Discharge target"]:
      `${getDisplayedTargetPercentForEstimate(input)}%`,
    "Target time": formatTargetTime(
      input.dynamicPriceTargetEstimate.targetTime,
    ),
    "Start to target duration": formatDurationUntilTarget(
      getDisplayedStartTimeDate(
        input.dynamicPriceTargetEstimate,
        input.referenceTime,
      ),
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
  const delayedChargingDetails =
    input.dynamicPriceTargetEstimate.delayedChargingDetails;
  const currentTargetPercent = getDisplayedTargetPercentForEstimate(input);
  const reserveAtTargetPercent = getDisplayedReserveAtTargetPercent(input);
  const energyTargetPercent = Math.max(
    0,
    currentTargetPercent - reserveAtTargetPercent,
  );

  if (delayedChargingDetails !== null) {
    return {
      "Marker price": formatPrice(delayedChargingDetails.lowestPrice),
      "Expected house load at marker": formatW(
        delayedChargingDetails.expectedHouseLoadAtMarkerW,
      ),
      "Predicted solar at marker": formatW(
        delayedChargingDetails.predictedSolarAtMarkerW,
      ),
      "Expected net solar fill power": formatSignedW(
        delayedChargingDetails.expectedNetSolarFillPowerW,
      ),
      "Battery capacity basis": formatWh(input.capacityWh),
      "Energy to full": formatWh(delayedChargingDetails.energyToFullWh),
      "Time-to-full formula": `${formatDurationMinutes(delayedChargingDetails.timeToFullMinutes)} = ${formatWh(delayedChargingDetails.energyToFullWh)} / ${formatW(delayedChargingDetails.effectiveFillPowerW)}`,
      "Trigger lead-time formula": `${formatDurationMinutes(delayedChargingDetails.triggerLeadTimeMinutes)} = ${formatDurationMinutes(delayedChargingDetails.timeToFullMinutes)} * 0.5 * ${formatNumber(delayedChargingDetails.triggerMarginFactor)}`,
    };
  }

  if (input.dynamicPriceTargetEstimate.importShortageDetails) {
    const details = input.dynamicPriceTargetEstimate.importShortageDetails;

    return {
      "Low-price marker": formatTargetTime(details.lowPriceMarkerTime),
      "Solar surplus starts": formatTargetTime(details.solarSurplusStartTime),
      "Solar surplus ends": formatTargetTime(details.solarSurplusEndTime),
      "Current SoC": `${formatNumber(details.currentSocPercent)}%`,
      "Pre-surplus load": formatWh(details.expectedHouseLoadBeforeSurplusWh),
      "Pre-surplus solar": formatWh(
        details.expectedSolarGenerationBeforeSurplusWh,
      ),
      "Pre-surplus net demand": formatWh(
        details.expectedNetDemandBeforeSurplusWh,
      ),
      "Solar recovery generation": formatWh(
        details.expectedSolarGenerationDuringSurplusWh,
      ),
      "Solar recovery load": formatWh(details.expectedHouseLoadDuringSurplusWh),
      "Solar recovery net": formatWh(details.expectedNetSolarRecoveryWh),
      "Solar recovery fill": `${formatNumber(details.expectedNetSolarRecoveryPercent)}%`,
      "Expected solar until surplus end": formatWh(
        details.expectedSolarGenerationUntilSurplusEndWh,
      ),
      "Expected load until surplus end": formatWh(
        details.expectedHouseLoadUntilSurplusEndWh,
      ),
      "Expected net until surplus end": formatWh(
        details.expectedNetSolarSurplusWh,
      ),
      "Expected net fill until surplus end": `${formatNumber(details.expectedNetSolarSurplusPercent)}%`,
      "Projected end SoC without import": `${formatNumber(details.projectedEndSocWithoutImportPercent)}%`,
      "Shortage to full": `${formatNumber(details.shortageToFullPercent)}%`,
      "Base charge target before buffer": `${formatNumber(details.baseTargetSocPercent)}%`,
      "Time buffer": `${formatNumber(details.bufferPercent)}%`,
      "Battery capacity basis": formatWh(input.capacityWh),
      "Energy to import": formatWh(details.energyToImportWh),
      "Required charge-time formula": `${formatDurationMinutes(details.requiredChargeMinutes)} = ${formatWh(details.energyToImportWh)} / ${formatW(details.effectiveChargePowerW)}`,
      "Trigger lead-time formula": `${formatDurationMinutes(details.triggerLeadTimeMinutes)} = ${formatDurationMinutes(details.requiredChargeMinutes)} * 1 * ${formatNumber(details.triggerMarginFactor)}`,
    };
  }

  return {
    "Integration interval": formatInterval(
      getDisplayedStartTimeDate(
        input.dynamicPriceTargetEstimate,
        input.referenceTime,
      ),
      input.dynamicPriceTargetEstimate.targetTime,
    ),
    "Expected house load before target time": formatWh(
      input.dynamicPriceTargetEstimate.expectedHouseLoadWh,
    ),
    "Predicted solar before target time": formatWh(
      input.dynamicPriceTargetEstimate.predictedSolarGenerationWh,
    ),
    "Net battery energy needed before target time": `${formatWh(input.dynamicPriceTargetEstimate.estimatedRemainingEnergyWh)} = max(0, ${formatWh(input.dynamicPriceTargetEstimate.expectedHouseLoadWh)} - ${formatWh(input.dynamicPriceTargetEstimate.predictedSolarGenerationWh)})`,
    "Battery capacity basis": formatWh(input.capacityWh),
    "Energy converted to target": `${energyTargetPercent}% = ceil(${formatWh(input.dynamicPriceTargetEstimate.estimatedRemainingEnergyWh)} / ${formatWh(input.capacityWh)} * 100)`,
    "Final target formula": `${getDisplayedTargetPercentForEstimate(input)}% = ${reserveAtTargetPercent}% reserve at target + ${energyTargetPercent}% interval energy`,
  };
}

function buildWhyRows(input: EvaluationContext): Record<string, string> {
  const rows: Record<string, string> = {
    "Expected load at target": formatW(
      input.dynamicPriceTargetEstimate.targetTimeSignal?.expectedHouseLoadW ??
        null,
    ),
    "Predicted solar at target": formatW(
      input.dynamicPriceTargetEstimate.targetTimeSignal?.predictedSolarW ??
        null,
    ),
    "Minimum solar surplus": formatW(input.minimumSolarSurplusWOverride),
    "Solar surplus at target": formatSignedW(
      getSolarSurplusW(
        input.dynamicPriceTargetEstimate.targetTimeSignal?.predictedSolarW ??
          null,
        input.dynamicPriceTargetEstimate.targetTimeSignal?.expectedHouseLoadW ??
          null,
      ),
    ),
    "Break-even rule": formatBreakEvenRule(
      input.dynamicPriceTargetEstimate,
      input.minimumSolarSurplusWOverride,
    ),
    "Computed start time": formatDisplayedStartTime(
      input.dynamicPriceTargetEstimate,
      input.referenceTime,
    ),
    "Start SoC basis": formatNullablePercent(
      input.dynamicPriceTargetEstimate.startTimeBasisSocPercent,
    ),
    "Effective discharge power": formatW(
      input.dynamicPriceTargetEstimate.effectiveDischargePowerW,
    ),
    "Required discharge time": formatDurationMinutesOrUnknown(
      input.dynamicPriceTargetEstimate.requiredDischargeMinutes,
    ),
    Reasoning: input.dynamicPriceTargetEstimate.reasoning || "n/a",
  };
  const delayedChargingDetails =
    input.dynamicPriceTargetEstimate.delayedChargingDetails;

  if (delayedChargingDetails !== null) {
    return {
      "Low-price marker": formatTargetTime(
        delayedChargingDetails.lowPriceMarkerTime,
      ),
      "Activation mode":
        delayedChargingDetails.activationMode === "charging"
          ? "full charge"
          : "self-consumption",
      "Lowest price": formatPrice(delayedChargingDetails.lowestPrice),
      "Expected house load at marker": formatW(
        delayedChargingDetails.expectedHouseLoadAtMarkerW,
      ),
      "Predicted solar at marker": formatW(
        delayedChargingDetails.predictedSolarAtMarkerW,
      ),
      "Expected net solar fill power": formatSignedW(
        delayedChargingDetails.expectedNetSolarFillPowerW,
      ),
      "Time to full": formatDurationMinutes(
        delayedChargingDetails.timeToFullMinutes,
      ),
      "Trigger lead time": formatDurationMinutes(
        delayedChargingDetails.triggerLeadTimeMinutes,
      ),
      ...rows,
    };
  }

  if (input.dynamicPriceTargetEstimate.importShortageDetails) {
    const details = input.dynamicPriceTargetEstimate.importShortageDetails;

    return {
      "Low-price marker": formatTargetTime(details.lowPriceMarkerTime),
      "Solar surplus starts": formatTargetTime(details.solarSurplusStartTime),
      "Solar surplus ends": formatTargetTime(details.solarSurplusEndTime),
      "Current SoC": `${formatNumber(details.currentSocPercent)}%`,
      "Pre-surplus net demand": formatWh(
        details.expectedNetDemandBeforeSurplusWh,
      ),
      "Solar recovery net": formatWh(details.expectedNetSolarRecoveryWh),
      "Solar recovery fill": `${formatNumber(details.expectedNetSolarRecoveryPercent)}%`,
      "Expected solar until surplus end": formatWh(
        details.expectedSolarGenerationUntilSurplusEndWh,
      ),
      "Expected load until surplus end": formatWh(
        details.expectedHouseLoadUntilSurplusEndWh,
      ),
      "Expected net until surplus end": formatWh(
        details.expectedNetSolarSurplusWh,
      ),
      "Expected net fill until surplus end": `${formatNumber(details.expectedNetSolarSurplusPercent)}%`,
      "Projected end SoC without import": `${formatNumber(details.projectedEndSocWithoutImportPercent)}%`,
      "Shortage to full": `${formatNumber(details.shortageToFullPercent)}%`,
      "Base charge target before buffer": `${formatNumber(details.baseTargetSocPercent)}%`,
      "Time buffer": `${formatNumber(details.bufferPercent)}%`,
      "Charge target": `${formatNumber(details.targetSocPercent)}%`,
      "Energy to import": formatWh(details.energyToImportWh),
      "Effective charge power": formatW(details.effectiveChargePowerW),
      "Required charge time": formatDurationMinutes(
        details.requiredChargeMinutes,
      ),
      "Trigger lead time": formatDurationMinutes(
        details.triggerLeadTimeMinutes,
      ),
      Reasoning: input.dynamicPriceTargetEstimate.reasoning || "n/a",
    };
  }

  return rows;
}

export function buildEnergyBucketRows(
  energyBuckets: DynamicPriceTargetEstimate["energyBuckets"],
): Array<Record<string, string>> {
  return energyBuckets.map((row) => ({
    time: formatClockTime(row.time),
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

function formatPrice(value: number | null): string {
  return value === null ? "n/a" : `${value.toFixed(3)} EUR/kWh`;
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
  if (estimate.delayedChargingDetails?.activationMode === "self-consumption") {
    return "self-consumption";
  }

  if (estimate.resolvedManualState === "charging") {
    return "charge";
  }

  return estimate.resolvedManualState === "idle" ? "hold" : "discharge";
}

function formatStrategyTriggerKindLabel(
  strategyTriggerKind: StrategyTriggerKind,
): string {
  return strategyTriggerKind;
}

function formatVerboseHint(
  input: Pick<EvaluationContext, "referenceTime" | "strategyTriggerKind">,
): string {
  const verboseBlocks =
    input.strategyTriggerKind === BatteryStrategyTriggerKind.DelayedCharging
      ? "why,energy,energy-buckets,history"
      : input.strategyTriggerKind === BatteryStrategyTriggerKind.ImportShortage
        ? "why,energy,history"
        : "why,energy,break-even,history";
  const date = formatLocalDate(input.referenceTime);
  const time = formatClockTimeWithOptionalSeconds(input.referenceTime);

  return `More details: bun run dynamic-price-target:evaluate -- --date=${date} --time=${time} --strategy=${input.strategyTriggerKind} --verbose=${verboseBlocks}`;
}

function getDisplayedTargetPercent(
  estimatedTargetPercent: number,
  reserveTargetPercent: number,
): number {
  return Math.max(reserveTargetPercent, estimatedTargetPercent);
}

function parseStrategyTriggerKinds(
  value: string | undefined,
): StrategyTriggerKind[] {
  if (!value) {
    throw new Error(
      "--strategy requires a comma-separated list of 'export-surplus', 'delayed-charge-prep' (or 'delayed-charging-prep'), 'delayed-charging', and/or 'import-shortage'.",
    );
  }

  const entries = value
    .split(",")
    .map((entry) => entry.trim())
    .map((entry) =>
      entry === "delayed-charging-prep"
        ? BatteryStrategyTriggerKind.DelayedChargePrep
        : entry,
    )
    .filter((entry) => entry.length > 0);

  const invalidEntries = entries.filter(
    (entry) =>
      entry !== BatteryStrategyTriggerKind.ExportSurplus &&
      entry !== BatteryStrategyTriggerKind.DelayedChargePrep &&
      entry !== BatteryStrategyTriggerKind.DelayedCharging &&
      entry !== BatteryStrategyTriggerKind.ImportShortage,
  );

  if (invalidEntries.length > 0) {
    throw new Error(
      `--strategy only accepts 'export-surplus', 'delayed-charge-prep' (or 'delayed-charging-prep'), 'delayed-charging', and 'import-shortage'; received: ${invalidEntries.join(", ")}.`,
    );
  }

  const strategyTriggerKinds = entries as StrategyTriggerKind[];

  if (strategyTriggerKinds.length === 0) {
    throw new Error(
      "--strategy must contain one or more of: export-surplus, delayed-charge-prep, delayed-charging, import-shortage.",
    );
  }

  return [...new Set(strategyTriggerKinds)];
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
  return (
    typeof value === "string" &&
    /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value)
  );
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

  return formatLocalDateTime(date);
}

function formatDisplayedStartTime(
  estimate: DynamicPriceTargetEstimate,
  referenceTime: Date,
): string {
  return formatReferenceMoment(
    getDisplayedStartTimeDate(estimate, referenceTime),
  );
}

function formatDelayedChargingStartExplanation(input: {
  dynamicPriceTargetEstimate: DynamicPriceTargetEstimate;
  displayedTargetPercent: number;
  strategyTriggerKind: StrategyTriggerKind;
}): string | null {
  if (
    input.strategyTriggerKind !== BatteryStrategyTriggerKind.DelayedCharging
  ) {
    return null;
  }

  const delayedChargingDetails =
    input.dynamicPriceTargetEstimate.delayedChargingDetails;

  if (
    delayedChargingDetails === null ||
    input.dynamicPriceTargetEstimate.startTimeBasisSocPercent === null
  ) {
    return null;
  }

  return `start computed from ${formatNullablePercent(input.dynamicPriceTargetEstimate.startTimeBasisSocPercent)} to ${input.displayedTargetPercent}% at ${formatW(delayedChargingDetails.effectiveFillPowerW)} over ${formatDurationMinutes(delayedChargingDetails.timeToFullMinutes)} * 0.5 * ${formatNumber(delayedChargingDetails.triggerMarginFactor)}`;
}

function getDisplayedStartTimeDate(
  estimate: DynamicPriceTargetEstimate,
  referenceTime: Date,
): Date {
  const startTime = estimate.startTime ? new Date(estimate.startTime) : null;

  return startTime !== null && !Number.isNaN(startTime.getTime())
    ? startTime
    : referenceTime;
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

function formatDurationMinutesOrUnknown(minutes: number | null): string {
  return minutes === null ? "unknown" : formatDurationMinutes(minutes);
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
  return formatLocalDateTime(value, value.getSeconds() !== 0);
}

function formatLocalDateTime(value: Date, includeSeconds = false): string {
  const minutePrecision = `${value.getFullYear()}-${formatDateTimePart(value.getMonth() + 1)}-${formatDateTimePart(value.getDate())} ${formatDateTimePart(value.getHours())}:${formatDateTimePart(value.getMinutes())}`;

  return includeSeconds
    ? `${minutePrecision}:${formatDateTimePart(value.getSeconds())}`
    : minutePrecision;
}

function formatLocalDate(value: Date): string {
  return `${value.getFullYear()}-${formatDateTimePart(value.getMonth() + 1)}-${formatDateTimePart(value.getDate())}`;
}

function formatClockTimeWithOptionalSeconds(value: Date): string {
  const minutePrecision = `${formatDateTimePart(value.getHours())}:${formatDateTimePart(value.getMinutes())}`;

  return value.getSeconds() === 0
    ? minutePrecision
    : `${minutePrecision}:${formatDateTimePart(value.getSeconds())}`;
}

function formatDateTimePart(value: number): string {
  return String(value).padStart(2, "0");
}

function formatNullablePercent(value: number | null): string {
  return value === null ? "n/a" : `${formatNumber(value)}%`;
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
    const message = error instanceof Error ? error.message : "Unknown error.";
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}
