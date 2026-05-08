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
  isSignedDiscoveredDevice,
  verifySignedDiscoveredDevice,
} from "../lib/discovery-proof";
import {
  addAllFromDiscovery,
  createBatteryFromDiscovery,
  createDynamicPriceSource,
  createMeterFromDiscovery,
  createSite,
  createSolarEnergyProviderFromDiscovery,
  createWeatherForecastSource,
  deleteBattery,
  deleteDynamicPriceSource,
  deleteMeter,
  deleteSite,
  deleteSolarEnergyProvider,
  deleteWeatherForecastSource,
  getDashboardSnapshot,
  requestDynamicPriceSnapshotRefresh,
  requestWeatherForecastRefresh,
  setBatteryEnabled,
  setBatteryMinimumDischargePercent,
  setBatteryPowerLimits,
  setHouseStrategy,
  setHouseStrategyPlan,
  setMeterEnabled,
  setSolarEnergyProviderProductionEnabled,
  updateDynamicPriceSource,
  updateDynamicPriceSourceExportDeduction,
  updateSite,
  updateWeatherForecastSource,
} from "../lib/ems-bridge";
import {
  generateLocalApiToken,
  hasConfiguredToken,
  isEnvConfiguredToken,
  revokeLocalApiToken,
} from "../lib/local-api-auth";

export type ActionResult = {
  notice: string;
  ok: boolean;
  tone: "error" | "success";
};

async function requireSession(): Promise<void> {
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect("/login");
  }
}

async function ensureDefaultWeatherForecastSource(
  siteId: string,
): Promise<boolean> {
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

async function ensureDefaultDynamicPriceSource(
  siteId: string,
): Promise<boolean> {
  const snapshot = await getDashboardSnapshot();
  const site = snapshot.sites.find((entry) => entry.id === siteId);

  if (!site || site.dynamicPriceSources.length > 0) {
    return false;
  }

  await createDynamicPriceSource({
    id: `price-${siteId}`,
    name: "Tibber dynamic price",
    provider: "tibber",
    siteId,
  });
  return true;
}

async function requestBackgroundSiteRefresh(siteId: string): Promise<void> {
  await Promise.allSettled([
    requestWeatherForecastRefresh({ siteId }),
    requestDynamicPriceSnapshotRefresh({ siteId }),
  ]);
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

function readDiscoveredDevice(
  formData: FormData,
  key: string,
): ReturnType<typeof verifySignedDiscoveredDevice> {
  const rawValue = stringValue(formData, key);
  const parsed = JSON.parse(rawValue) as unknown;

  if (!isSignedDiscoveredDevice(parsed)) {
    throw new Error(`Invalid discovered device payload: ${key}`);
  }

  return verifySignedDiscoveredDevice(parsed);
}

function readDiscoveredDeviceList(
  formData: FormData,
  key: string,
): Array<ReturnType<typeof verifySignedDiscoveredDevice>> {
  const rawValue = stringValue(formData, key);
  const parsed = JSON.parse(rawValue) as unknown;

  if (
    !Array.isArray(parsed) ||
    parsed.some((value) => !isSignedDiscoveredDevice(value))
  ) {
    throw new Error(`Invalid discovered device list payload: ${key}`);
  }

  return parsed.map((value) => verifySignedDiscoveredDevice(value));
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

async function runAction(
  runner: () => Promise<{
    notice: string;
    path?: string;
    tab?: string | null;
  }>,
  _fallbackTab: string | null,
  _fallbackPath = "/",
): Promise<ActionResult> {
  await requireSession();

  try {
    const result = await runner();
    revalidatePath("/");
    revalidatePath("/status");
    return {
      notice: result.notice,
      ok: true,
      tone: "success",
    };
  } catch (error) {
    if (isRedirectError(error)) {
      throw error;
    }

    revalidatePath("/");
    revalidatePath("/status");
    return {
      notice: error instanceof Error ? error.message : String(error),
      ok: false,
      tone: "error",
    };
  }
}

export async function createSiteAction(
  formData: FormData,
): Promise<ActionResult> {
  const returnPath = optionalStringValue(formData, "returnPath") ?? "/";

  return runAction(
    async () => {
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
      await ensureDefaultDynamicPriceSource(siteId);
      await requestBackgroundSiteRefresh(siteId);
      return {
        notice: `Created site ${name}. Forecast and price data will refresh shortly.`,
        path: returnPath,
        tab: "discover",
      };
    },
    "site",
    returnPath,
  );
}

export async function updateSiteAction(
  formData: FormData,
): Promise<ActionResult> {
  const siteId = stringValue(formData, "siteId");
  const returnPath = optionalStringValue(formData, "returnPath") ?? "/";

  return runAction(
    async () => {
      const name = stringValue(formData, "name");
      await updateSite({
        id: siteId,
        location: stringValue(formData, "location"),
        name,
      });
      await ensureDefaultWeatherForecastSource(siteId);
      await ensureDefaultDynamicPriceSource(siteId);
      await requestBackgroundSiteRefresh(siteId);
      return {
        notice: `Updated site ${name}. Forecast and price data will refresh shortly.`,
        path: returnPath,
        tab: "site",
      };
    },
    "site",
    returnPath,
  );
}

export async function deleteSiteAction(
  formData: FormData,
): Promise<ActionResult> {
  const siteId = stringValue(formData, "siteId");
  const returnPath = optionalStringValue(formData, "returnPath") ?? "/";

  return runAction(
    async () => {
      const siteName = stringValue(formData, "siteName");
      await deleteSite({ id: siteId });
      return {
        notice: `Deleted site ${siteName}.`,
        path: returnPath,
        tab: "site",
      };
    },
    "site",
    returnPath,
  );
}

export async function createBatteryFromDiscoveryAction(
  formData: FormData,
): Promise<ActionResult> {
  const siteId = stringValue(formData, "siteId");

  return runAction(async () => {
    const device = readDiscoveredDevice(formData, "discoveryDevice");
    await createBatteryFromDiscovery({
      device,
      siteId,
    });
    return { notice: `Added battery ${device.discoveryId}.`, tab: "discover" };
  }, "discover");
}

export async function createAllFromDiscoveryAction(
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    const devices = readDiscoveredDeviceList(formData, "discoveryDevices");

    const result = await addAllFromDiscovery({
      devices,
      siteId: stringValue(formData, "siteId"),
    });

    const summary =
      result.addedBatteries === 0 &&
      result.addedMeters === 0 &&
      result.addedSolarEnergyProviders === 0
        ? "No new devices were added."
        : `Added ${result.addedBatteries} batterie(s), ${result.addedMeters} meter(s), and ${result.addedSolarEnergyProviders} solar provider(s).${result.skippedDevices > 0 ? ` Skipped ${result.skippedDevices}.` : ""}`;

    return { notice: summary, tab: "discover" };
  }, "discover");
}

export async function setBatteryEnabledAction(
  formData: FormData,
): Promise<ActionResult> {
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

export async function deleteBatteryAction(
  formData: FormData,
): Promise<ActionResult> {
  const siteId = stringValue(formData, "siteId");
  const returnPath = optionalStringValue(formData, "returnPath") ?? "/";

  return runAction(
    async () => {
      const batteryId = stringValue(formData, "batteryId");
      await deleteBattery({ id: batteryId, siteId });
      return {
        notice: `Deleted battery ${batteryId}.`,
        path: returnPath,
        tab: "devices",
      };
    },
    "devices",
    returnPath,
  );
}

export async function setBatteryMinimumDischargePercentAction(
  formData: FormData,
): Promise<ActionResult> {
  const siteId = stringValue(formData, "siteId");

  return runAction(async () => {
    const batteryId = stringValue(formData, "batteryId");
    const batteryName =
      optionalStringValue(formData, "batteryName") ?? batteryId;
    const minimumDischargePercent = Number(
      stringValue(formData, "minimumDischargePercent"),
    );
    await setBatteryMinimumDischargePercent({
      id: batteryId,
      minimumDischargePercent,
      siteId,
    });
    return {
      notice: `Updated minimum discharge for ${batteryName}.`,
      tab: "devices",
    };
  }, "devices");
}

export async function setBatteryPowerLimitsAction(
  formData: FormData,
): Promise<ActionResult> {
  const siteId = stringValue(formData, "siteId");

  return runAction(async () => {
    const batteryId = stringValue(formData, "batteryId");
    const batteryName =
      optionalStringValue(formData, "batteryName") ?? batteryId;
    const maximumChargePowerW = Number(
      stringValue(formData, "maximumChargePowerW"),
    );
    const maximumDischargePowerW = Number(
      stringValue(formData, "maximumDischargePowerW"),
    );
    await setBatteryPowerLimits({
      id: batteryId,
      maximumChargePowerW,
      maximumDischargePowerW,
      siteId,
    });
    return {
      notice: `Updated power limits for ${batteryName}.`,
      tab: "devices",
    };
  }, "devices");
}

export async function updateBatterySettingsAction(
  formData: FormData,
): Promise<ActionResult> {
  const siteId = stringValue(formData, "siteId");
  const returnPath = optionalStringValue(formData, "returnPath") ?? "/";

  return runAction(
    async () => {
      const batteryId = stringValue(formData, "batteryId");
      const batteryName =
        optionalStringValue(formData, "batteryName") ?? batteryId;
      const minimumDischargePercent = Number(
        stringValue(formData, "minimumDischargePercent"),
      );
      const maximumChargePowerW = Number(
        stringValue(formData, "maximumChargePowerW"),
      );
      const maximumDischargePowerW = Number(
        stringValue(formData, "maximumDischargePowerW"),
      );

      await setBatteryPowerLimits({
        id: batteryId,
        maximumChargePowerW,
        maximumDischargePowerW,
        siteId,
      });
      await setBatteryMinimumDischargePercent({
        id: batteryId,
        minimumDischargePercent,
        siteId,
      });

      return {
        notice: `Updated settings for ${batteryName}.`,
        path: returnPath,
        tab: "devices",
      };
    },
    "devices",
    returnPath,
  );
}

export async function createMeterFromDiscoveryAction(
  formData: FormData,
): Promise<ActionResult> {
  const siteId = stringValue(formData, "siteId");

  return runAction(async () => {
    const device = readDiscoveredDevice(formData, "discoveryDevice");
    await createMeterFromDiscovery({
      device,
      siteId,
    });
    return { notice: `Added meter ${device.discoveryId}.`, tab: "discover" };
  }, "discover");
}

export async function createSolarEnergyProviderFromDiscoveryAction(
  formData: FormData,
): Promise<ActionResult> {
  const siteId = stringValue(formData, "siteId");

  return runAction(async () => {
    const device = readDiscoveredDevice(formData, "discoveryDevice");
    await createSolarEnergyProviderFromDiscovery({
      device,
      siteId,
    });
    return {
      notice: `Added solar energy provider ${device.discoveryId}.`,
      tab: "discover",
    };
  }, "discover");
}

export async function setMeterEnabledAction(
  formData: FormData,
): Promise<ActionResult> {
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

export async function deleteMeterAction(
  formData: FormData,
): Promise<ActionResult> {
  const siteId = stringValue(formData, "siteId");
  const returnPath = optionalStringValue(formData, "returnPath") ?? "/";

  return runAction(
    async () => {
      const meterId = stringValue(formData, "meterId");
      await deleteMeter({ id: meterId, siteId });
      return {
        notice: `Deleted meter ${meterId}.`,
        path: returnPath,
        tab: "devices",
      };
    },
    "devices",
    returnPath,
  );
}

export async function deleteSolarEnergyProviderAction(
  formData: FormData,
): Promise<ActionResult> {
  const siteId = stringValue(formData, "siteId");
  const returnPath = optionalStringValue(formData, "returnPath") ?? "/";

  return runAction(
    async () => {
      const providerId = stringValue(formData, "solarEnergyProviderId");
      await deleteSolarEnergyProvider({ id: providerId, siteId });
      return {
        notice: `Deleted solar energy provider ${providerId}.`,
        path: returnPath,
        tab: "devices",
      };
    },
    "devices",
    returnPath,
  );
}

export async function setSolarEnergyProviderProductionEnabledAction(
  formData: FormData,
): Promise<ActionResult> {
  const siteId = stringValue(formData, "siteId");
  const returnPath = optionalStringValue(formData, "returnPath") ?? "/";

  return runAction(
    async () => {
      const providerId = stringValue(formData, "solarEnergyProviderId");
      const providerName =
        optionalStringValue(formData, "solarEnergyProviderName") ?? providerId;
      const providerModel = optionalStringValue(
        formData,
        "solarEnergyProviderModel",
      );
      const enabled =
        optionalStringValue(formData, "productionControlStatus") === "enabled";

      await setSolarEnergyProviderProductionEnabled({
        enabled,
        id: providerId,
        siteId,
      });

      return {
        notice:
          providerModel === "enphase-local"
            ? `Saved production control request for ${providerName}. This may take up to 30 minutes on Enphase.`
            : `Saved production control request for ${providerName}.`,
        path: returnPath,
        tab: "devices",
      };
    },
    "devices",
    returnPath,
  );
}

export async function createWeatherForecastSourceAction(
  formData: FormData,
): Promise<ActionResult> {
  const siteId = stringValue(formData, "siteId");
  const returnPath = optionalStringValue(formData, "returnPath") ?? "/";

  return runAction(
    async () => {
      const sourceId = stringValue(formData, "sourceId");
      await createWeatherForecastSource({
        id: sourceId,
        name: stringValue(formData, "name"),
        siteId,
        provider: "open-meteo",
        surface: "open-meteo-shortwave-radiation",
      });
      await requestWeatherForecastRefresh({ siteId });
      return {
        notice: `Added solar forecast source ${sourceId}. Data will refresh shortly.`,
        path: returnPath,
        tab: "forecast",
      };
    },
    "forecast",
    returnPath,
  );
}

export async function updateWeatherForecastSourceAction(
  formData: FormData,
): Promise<ActionResult> {
  const siteId = stringValue(formData, "siteId");
  const returnPath = optionalStringValue(formData, "returnPath") ?? "/";

  return runAction(
    async () => {
      const sourceId = stringValue(formData, "sourceId");
      await updateWeatherForecastSource({
        id: sourceId,
        name: stringValue(formData, "name"),
        siteId,
        provider: "open-meteo",
        surface: "open-meteo-shortwave-radiation",
      });
      await requestWeatherForecastRefresh({ siteId });
      return {
        notice: `Updated solar forecast source ${sourceId}. Data will refresh shortly.`,
        path: returnPath,
        tab: "forecast",
      };
    },
    "forecast",
    returnPath,
  );
}

export async function deleteWeatherForecastSourceAction(
  formData: FormData,
): Promise<ActionResult> {
  const siteId = stringValue(formData, "siteId");
  const returnPath = optionalStringValue(formData, "returnPath") ?? "/";

  return runAction(
    async () => {
      const sourceId = stringValue(formData, "sourceId");
      await deleteWeatherForecastSource({ id: sourceId, siteId });
      return {
        notice: `Deleted solar forecast source ${sourceId}.`,
        path: returnPath,
        tab: "forecast",
      };
    },
    "forecast",
    returnPath,
  );
}

export async function createDynamicPriceSourceAction(
  formData: FormData,
): Promise<ActionResult> {
  const siteId = stringValue(formData, "siteId");
  const returnPath = optionalStringValue(formData, "returnPath") ?? "/";

  return runAction(
    async () => {
      const sourceId = stringValue(formData, "sourceId");
      await createDynamicPriceSource({
        id: sourceId,
        name: stringValue(formData, "name"),
        provider: "tibber",
        siteId,
      });
      await requestDynamicPriceSnapshotRefresh({ siteId });
      return {
        notice: `Added price source ${sourceId}. Data will refresh shortly.`,
        path: returnPath,
        tab: "pricing",
      };
    },
    "pricing",
    returnPath,
  );
}

export async function updateDynamicPriceSourceAction(
  formData: FormData,
): Promise<ActionResult> {
  const siteId = stringValue(formData, "siteId");
  const returnPath = optionalStringValue(formData, "returnPath") ?? "/";

  return runAction(
    async () => {
      const sourceId = stringValue(formData, "sourceId");
      await updateDynamicPriceSource({
        id: sourceId,
        name: stringValue(formData, "name"),
        provider: "tibber",
        siteId,
      });
      await requestDynamicPriceSnapshotRefresh({ siteId });
      return {
        notice: `Updated price source ${sourceId}. Data will refresh shortly.`,
        path: returnPath,
        tab: "pricing",
      };
    },
    "pricing",
    returnPath,
  );
}

export async function deleteDynamicPriceSourceAction(
  formData: FormData,
): Promise<ActionResult> {
  const siteId = stringValue(formData, "siteId");
  const returnPath = optionalStringValue(formData, "returnPath") ?? "/";

  return runAction(
    async () => {
      const sourceId = stringValue(formData, "sourceId");
      await deleteDynamicPriceSource({ id: sourceId, siteId });
      return {
        notice: `Deleted price source ${sourceId}.`,
        path: returnPath,
        tab: "pricing",
      };
    },
    "pricing",
    returnPath,
  );
}

export async function updateDynamicPriceSourceExportDeductionAction(
  formData: FormData,
): Promise<ActionResult> {
  const siteId = stringValue(formData, "siteId");
  const returnPath = optionalStringValue(formData, "returnPath") ?? "/";

  return runAction(
    async () => {
      const sourceId = stringValue(formData, "sourceId");
      const name = stringValue(formData, "name");
      const exportDeduction = Number(stringValue(formData, "exportDeduction"));
      await updateDynamicPriceSourceExportDeduction({
        exportDeduction,
        id: sourceId,
        name,
        siteId,
      });
      return {
        notice: `Updated export deduction for price source ${sourceId}.`,
        path: returnPath,
        tab: "price-provider",
      };
    },
    "price-provider",
    returnPath,
  );
}

export async function setHouseStrategyAction(
  formData: FormData,
): Promise<ActionResult> {
  const siteId = stringValue(formData, "siteId");

  return runAction(
    async () => {
      const returnPath = optionalStringValue(formData, "returnPath") ?? "/";
      const strategyMode = stringValue(formData, "strategyMode");
      const manualLabel = optionalStringValue(formData, "manualLabel");
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
      const manualModeActiveRaw = optionalStringValue(
        formData,
        "manualModeActive",
      );
      const targetMethodRaw = optionalStringValue(formData, "targetMethod");
      const targetDurationMinutesRaw = optionalStringValue(
        formData,
        "targetDurationMinutes",
      );
      const targetEndTimeRaw = optionalStringValue(formData, "targetEndTime");
      const manualTargetSocRaw = optionalStringValue(
        formData,
        "manualTargetSoc",
      );
      await setHouseStrategy({
        manualLabel,
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
        targetMethod:
          targetMethodRaw === "soc" ||
          targetMethodRaw === "duration" ||
          targetMethodRaw === "end-time" ||
          targetMethodRaw === "auto"
            ? targetMethodRaw
            : null,
        targetDurationMinutes:
          targetDurationMinutesRaw === null ||
          targetDurationMinutesRaw.length === 0
            ? null
            : Number(targetDurationMinutesRaw),
        targetEndTime:
          targetEndTimeRaw === null || targetEndTimeRaw.length === 0
            ? null
            : targetEndTimeRaw,
        manualModeActive: manualModeActiveRaw === "true",
        strategyMode:
          strategyMode === "manual" ||
          strategyMode === "self-consumption" ||
          strategyMode === "auto"
            ? strategyMode
            : "auto",
        siteId,
      });
      return {
        notice:
          manualModeActiveRaw === "true"
            ? "Applied manual mode for all batteries."
            : "Updated strategy for all batteries.",
        path: returnPath,
        tab: null,
      };
    },
    null,
    optionalStringValue(formData, "returnPath") ?? "/",
  );
}

export async function setHouseStrategyPlanAction(
  formData: FormData,
): Promise<ActionResult> {
  const siteId = stringValue(formData, "siteId");

  return runAction(
    async () => {
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

      await setHouseStrategyPlan({
        siteId,
        strategyPlan,
      });

      return {
        notice: "Applied schedule for all batteries.",
        path: returnPath,
        tab: null,
      };
    },
    null,
    optionalStringValue(formData, "returnPath") ?? "/",
  );
}

export async function createLocalApiTokenAction(): Promise<{
  token?: string;
  error?: string;
}> {
  const session = await getServerSession(authOptions);

  if (!session) {
    return { error: "Unauthorized" };
  }

  try {
    const token = generateLocalApiToken();
    return { token };
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Failed to generate token",
    };
  }
}

export async function revokeLocalApiTokenAction(): Promise<{
  ok?: boolean;
  error?: string;
}> {
  const session = await getServerSession(authOptions);

  if (!session) {
    return { error: "Unauthorized" };
  }

  try {
    revokeLocalApiToken();
    return { ok: true };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Failed to revoke token",
    };
  }
}

export async function getLocalApiTokenStatusAction(): Promise<{
  configured: boolean;
  envConfigured: boolean;
}> {
  const session = await getServerSession(authOptions);

  if (!session) {
    return { configured: false, envConfigured: false };
  }

  return {
    configured: hasConfiguredToken(),
    envConfigured: isEnvConfiguredToken(),
  };
}
