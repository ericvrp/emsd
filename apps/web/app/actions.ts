"use server";

import {
  type BatteryStrategyPlanRecord,
  normalizeBatteryStrategyPlan,
} from "@emsd/core";
import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { redirect } from "next/navigation";
import { authOptions } from "../auth";
import {
  addAllFromDiscovery,
  createBatteryFromDiscovery,
  createDynamicPriceSource,
  createMeterFromDiscovery,
  createSite,
  createWeatherForecastSource,
  deleteBattery,
  deleteDynamicPriceSource,
  deleteMeter,
  deleteSite,
  deleteWeatherForecastSource,
  getDashboardSnapshot,
  refreshWeatherForecast,
  setBatteryEnabled,
  setBatteryMinimumDischargePercent,
  setBatteryStrategy,
  setBatteryStrategyPlan,
  setMeterEnabled,
  updateDynamicPriceSource,
  updateSite,
  updateWeatherForecastSource,
} from "../lib/ems-bridge";

async function requireSession(): Promise<void> {
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect("/login");
  }
}

async function ensureDefaultWeatherForecastSource(siteId: string): Promise<boolean> {
  const snapshot = await getDashboardSnapshot();
  const site = snapshot.sites.find((entry) => entry.id === siteId);

  if (!site || site.weatherSources.length > 0) {
    return false;
  }

  await createWeatherForecastSource({
    id: `forecast-${siteId}`,
    name: "Primary solar forecast",
    provider: "open-meteo",
    siteId,
    surface: "open-meteo-shortwave-radiation",
  });
  return true;
}

function stringValue(formData: FormData, key: string): string {
  const value = formData.get(key);

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Missing required field: ${key}`);
  }

  return value.trim();
}

function optionalStringValue(formData: FormData, key: string): string | null {
  const value = formData.get(key);

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildSiteId(name: string, existingSiteIds: string[]): string {
  const baseId =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "site";

  if (!existingSiteIds.includes(baseId)) {
    return baseId;
  }

  let suffix = 2;

  while (existingSiteIds.includes(`${baseId}-${suffix}`)) {
    suffix += 1;
  }

  return `${baseId}-${suffix}`;
}

function redirectWithNotice(options: {
  notice: string;
  path?: string;
  tone: "success" | "error";
}): never {
  const params = new URLSearchParams();

  params.set("notice", options.notice);
  params.set("tone", options.tone);
  redirect(`${options.path ?? "/"}?${params.toString()}`);
}

async function runAction(
  runner: () => Promise<{ notice: string; path?: string; tab?: string | null }>,
  fallbackTab: string | null,
  fallbackPath = "/",
): Promise<void> {
  await requireSession();

  try {
    const result = await runner();
    revalidatePath("/");
    revalidatePath("/status");
    const path = result.path;

    void fallbackTab;
    redirectWithNotice({
      notice: result.notice,
      ...(path ? { path } : {}),
      tone: "success",
    });
  } catch (error) {
    if (isRedirectError(error)) {
      throw error;
    }

    revalidatePath("/");
    revalidatePath("/status");
    redirectWithNotice({
      notice: error instanceof Error ? error.message : String(error),
      path: fallbackPath,
      tone: "error",
    });
  }
}

export async function createSiteAction(formData: FormData): Promise<void> {
  return runAction(async () => {
    const name = stringValue(formData, "name");
    const snapshot = await getDashboardSnapshot();

    if (snapshot.sites.length > 0) {
      throw new Error("A default site is already configured.");
    }

    const siteId = buildSiteId(
      name,
      snapshot.sites.map((site) => site.id),
    );

    await createSite({
      id: siteId,
      location: stringValue(formData, "location"),
      name,
    });
    await ensureDefaultWeatherForecastSource(siteId);
    await refreshWeatherForecast({ siteId });
    return { notice: `Created site ${name}.`, tab: "discover" };
  }, "site");
}

export async function updateSiteAction(formData: FormData): Promise<void> {
  const siteId = stringValue(formData, "siteId");

  return runAction(async () => {
    const name = stringValue(formData, "name");
    await updateSite({
      id: siteId,
      location: stringValue(formData, "location"),
      name,
    });
    const createdDefaultForecastSource = await ensureDefaultWeatherForecastSource(siteId);

    if (createdDefaultForecastSource) {
      await refreshWeatherForecast({ siteId });
    }
    return { notice: `Updated site ${name}.`, tab: "site" };
  }, "site");
}

export async function deleteSiteAction(formData: FormData): Promise<void> {
  const siteId = stringValue(formData, "siteId");

  return runAction(async () => {
    const siteName = stringValue(formData, "siteName");
    await deleteSite({ id: siteId });
    return { notice: `Deleted site ${siteName}.`, tab: "site" };
  }, "site");
}

export async function createBatteryFromDiscoveryAction(
  formData: FormData,
): Promise<void> {
  const siteId = stringValue(formData, "siteId");

  return runAction(async () => {
    const discoveryId = stringValue(formData, "discoveryId");
    await createBatteryFromDiscovery({
      discoveryId,
      siteId,
      host: optionalStringValue(formData, "host"),
    });
    return { notice: `Added battery ${discoveryId}.`, tab: "discover" };
  }, "discover");
}

export async function createAllFromDiscoveryAction(
  formData: FormData,
): Promise<void> {
  return runAction(async () => {
    const rawDiscoveryIds = stringValue(formData, "discoveryIds");
    const discoveryIds = JSON.parse(rawDiscoveryIds) as unknown;

    if (
      !Array.isArray(discoveryIds) ||
      discoveryIds.some((value) => typeof value !== "string")
    ) {
      throw new Error("Discovery selection payload is invalid.");
    }

    const result = await addAllFromDiscovery({
      discoveryIds,
      host: optionalStringValue(formData, "host"),
      siteId: stringValue(formData, "siteId"),
    });

    const summary =
      result.addedBatteries === 0 && result.addedMeters === 0
        ? "No new devices were added."
        : `Added ${result.addedBatteries} batterie(s) and ${result.addedMeters} meter(s).${result.skippedDevices > 0 ? ` Skipped ${result.skippedDevices}.` : ""}`;

    return { notice: summary, tab: "discover" };
  }, "discover");
}

export async function setBatteryEnabledAction(
  formData: FormData,
): Promise<void> {
  const siteId = stringValue(formData, "siteId");

  return runAction(async () => {
    const batteryId = stringValue(formData, "batteryId");
    const enabled = stringValue(formData, "enabled") === "true";
    await setBatteryEnabled({ id: batteryId, enabled, siteId });
    return {
      notice: `${enabled ? "Enabled" : "Disabled"} battery ${batteryId}.`,
      tab: "devices",
    };
  }, "devices");
}

export async function deleteBatteryAction(formData: FormData): Promise<void> {
  const siteId = stringValue(formData, "siteId");

  return runAction(async () => {
    const batteryId = stringValue(formData, "batteryId");
    await deleteBattery({ id: batteryId, siteId });
    return { notice: `Deleted battery ${batteryId}.`, tab: "devices" };
  }, "devices");
}

export async function setBatteryMinimumDischargePercentAction(
  formData: FormData,
): Promise<void> {
  const siteId = stringValue(formData, "siteId");

  return runAction(async () => {
    const batteryId = stringValue(formData, "batteryId");
    const minimumDischargePercent = Number(
      stringValue(formData, "minimumDischargePercent"),
    );
    await setBatteryMinimumDischargePercent({
      id: batteryId,
      minimumDischargePercent,
      siteId,
    });
    return {
      notice: `Updated minimum discharge for battery ${batteryId}.`,
      tab: "devices",
    };
  }, "devices");
}

export async function setBatteryStrategyAction(
  formData: FormData,
): Promise<void> {
  const siteId = stringValue(formData, "siteId");

  return runAction(
    async () => {
      const batteryId = stringValue(formData, "batteryId");
      const returnPath = optionalStringValue(formData, "returnPath") ?? "/";
      const strategyMode = stringValue(formData, "strategyMode");
      const manualState = optionalStringValue(formData, "manualState");
      const manualPowerRaw = optionalStringValue(formData, "manualPowerW");
      const manualChargeTargetSocRaw = optionalStringValue(
        formData,
        "manualChargeTargetSoc",
      );
      const manualDischargeTargetSocRaw = optionalStringValue(
        formData,
        "manualDischargeTargetSoc",
      );
      const nowModeActiveRaw = optionalStringValue(formData, "nowModeActive");
      const manualTargetSocRaw = optionalStringValue(
        formData,
        "manualTargetSoc",
      );
      await setBatteryStrategy({
        id: batteryId,
        manualChargeTargetSoc:
          manualChargeTargetSocRaw === null ||
          manualChargeTargetSocRaw.length === 0
            ? null
            : Number(manualChargeTargetSocRaw),
        manualDischargeTargetSoc:
          manualDischargeTargetSocRaw === null ||
          manualDischargeTargetSocRaw.length === 0
            ? null
            : Number(manualDischargeTargetSocRaw),
        manualPowerW:
          manualPowerRaw === null || manualPowerRaw.length === 0
            ? null
            : Number(manualPowerRaw),
        manualState:
          manualState === "idle" ||
          manualState === "charging" ||
          manualState === "discharging"
            ? manualState
            : null,
        manualTargetSoc:
          manualTargetSocRaw === null || manualTargetSocRaw.length === 0
            ? null
            : Number(manualTargetSocRaw),
        nowModeActive: nowModeActiveRaw === "true",
        siteId,
        strategyMode:
          strategyMode === "manual" ||
          strategyMode === "self-consumption" ||
          strategyMode === "auto"
            ? strategyMode
            : "auto",
      });
      return {
        notice: `Updated strategy for battery ${batteryId}.`,
        path: returnPath,
        tab: null,
      };
    },
    null,
    optionalStringValue(formData, "returnPath") ?? "/",
  );
}

export async function setBatteryStrategyPlanAction(
  formData: FormData,
): Promise<void> {
  const siteId = stringValue(formData, "siteId");

  return runAction(
    async () => {
      const batteryId = stringValue(formData, "batteryId");
      const returnPath = optionalStringValue(formData, "returnPath") ?? "/";
      const minimumDischargePercent = Number(
        stringValue(formData, "minimumDischargePercent"),
      );
      const strategyPlanJson = stringValue(formData, "strategyPlanJson");
      const strategyPlan = normalizeBatteryStrategyPlan({
        minimumDischargePercent,
        strategy: {
          strategyMode: "self-consumption",
          manualState: null,
          manualPowerW: null,
          manualChargeTargetSoc: 100,
          manualDischargeTargetSoc: minimumDischargePercent,
          manualTargetSoc: 100,
        },
        value: JSON.parse(strategyPlanJson) as BatteryStrategyPlanRecord,
      });

      await setBatteryStrategyPlan({
        id: batteryId,
        siteId,
        strategyPlan,
      });

      return {
        notice: `Updated strategy schedule for battery ${batteryId}.`,
        path: returnPath,
        tab: null,
      };
    },
    null,
    optionalStringValue(formData, "returnPath") ?? "/",
  );
}

export async function createMeterFromDiscoveryAction(
  formData: FormData,
): Promise<void> {
  const siteId = stringValue(formData, "siteId");

  return runAction(async () => {
    const discoveryId = stringValue(formData, "discoveryId");
    await createMeterFromDiscovery({
      discoveryId,
      siteId,
      host: optionalStringValue(formData, "host"),
    });
    return { notice: `Added meter ${discoveryId}.`, tab: "discover" };
  }, "discover");
}

export async function setMeterEnabledAction(formData: FormData): Promise<void> {
  const siteId = stringValue(formData, "siteId");

  return runAction(async () => {
    const meterId = stringValue(formData, "meterId");
    const enabled = stringValue(formData, "enabled") === "true";
    await setMeterEnabled({ id: meterId, enabled, siteId });
    return {
      notice: `${enabled ? "Enabled" : "Disabled"} meter ${meterId}.`,
      tab: "devices",
    };
  }, "devices");
}

export async function deleteMeterAction(formData: FormData): Promise<void> {
  const siteId = stringValue(formData, "siteId");

  return runAction(async () => {
    const meterId = stringValue(formData, "meterId");
    await deleteMeter({ id: meterId, siteId });
    return { notice: `Deleted meter ${meterId}.`, tab: "devices" };
  }, "devices");
}

export async function createWeatherForecastSourceAction(
  formData: FormData,
): Promise<void> {
  const siteId = stringValue(formData, "siteId");

  return runAction(async () => {
    const sourceId = stringValue(formData, "sourceId");
    await createWeatherForecastSource({
      id: sourceId,
      name: stringValue(formData, "name"),
      siteId,
      provider: "open-meteo",
      surface: "open-meteo-shortwave-radiation",
    });
    await refreshWeatherForecast({ siteId });
    return { notice: `Added solar forecast source ${sourceId}.`, tab: "forecast" };
  }, "forecast");
}

export async function updateWeatherForecastSourceAction(
  formData: FormData,
): Promise<void> {
  const siteId = stringValue(formData, "siteId");

  return runAction(async () => {
    const sourceId = stringValue(formData, "sourceId");
    await updateWeatherForecastSource({
      id: sourceId,
      name: stringValue(formData, "name"),
      siteId,
      provider: "open-meteo",
      surface: "open-meteo-shortwave-radiation",
    });
    await refreshWeatherForecast({ siteId });
    return { notice: `Updated solar forecast source ${sourceId}.`, tab: "forecast" };
  }, "forecast");
}

export async function deleteWeatherForecastSourceAction(
  formData: FormData,
): Promise<void> {
  const siteId = stringValue(formData, "siteId");

  return runAction(async () => {
    const sourceId = stringValue(formData, "sourceId");
    await deleteWeatherForecastSource({ id: sourceId, siteId });
    return { notice: `Deleted solar forecast source ${sourceId}.`, tab: "forecast" };
  }, "forecast");
}

export async function createDynamicPriceSourceAction(
  formData: FormData,
): Promise<void> {
  const siteId = stringValue(formData, "siteId");

  return runAction(async () => {
    const sourceId = stringValue(formData, "sourceId");
    await createDynamicPriceSource({
      id: sourceId,
      name: stringValue(formData, "name"),
      siteId,
    });
    return { notice: `Added price source ${sourceId}.`, tab: "devices" };
  }, "devices");
}

export async function updateDynamicPriceSourceAction(
  formData: FormData,
): Promise<void> {
  const siteId = stringValue(formData, "siteId");

  return runAction(async () => {
    const sourceId = stringValue(formData, "sourceId");
    await updateDynamicPriceSource({
      id: sourceId,
      name: stringValue(formData, "name"),
      siteId,
    });
    return { notice: `Updated price source ${sourceId}.`, tab: "devices" };
  }, "devices");
}

export async function deleteDynamicPriceSourceAction(
  formData: FormData,
): Promise<void> {
  const siteId = stringValue(formData, "siteId");

  return runAction(async () => {
    const sourceId = stringValue(formData, "sourceId");
    await deleteDynamicPriceSource({ id: sourceId, siteId });
    return { notice: `Deleted price source ${sourceId}.`, tab: "devices" };
  }, "devices");
}
