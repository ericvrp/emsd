import type {
  NormalizedSolarEnergyProviderInfo,
  SolarEnergyProviderRecord,
} from "@emsd/core";
import {
  type HomeWizardLocalSnapshot,
  fetchHomeWizardLocalSnapshot,
  formatHomeWizardDetails,
  isHomeWizardCt,
  isHomeWizardSmartPlug,
} from "../homewizard-local";
import type { DiscoveryPlugin } from "../types";

const HOMEWIZARD_CT_MODEL = "homewizard-ct";
const HOMEWIZARD_CT_NAME = "HomeWizard CT";
const HOMEWIZARD_SMART_PLUG_MODEL = "homewizard-smart-plug";
const HOMEWIZARD_SMART_PLUG_NAME = "HomeWizard Smart Plug";
const HOMEWIZARD_DISCOVERY_REQUEST_TIMEOUT_MS = 750;

type HomeWizardSolarKind = "ct" | "smart-plug";

export class HomeWizardSolarEnergyProviderPlugin {
  constructor(private readonly provider: SolarEnergyProviderRecord) {}

  async getNormalizedInfo(): Promise<NormalizedSolarEnergyProviderInfo | null> {
    const snapshot = await fetchHomeWizardLocalSnapshot(
      this.provider.ipAddress,
    );
    const currentPowerW = normalizeInvertedSolarPowerW(snapshot.powerW);

    return {
      currentPowerW,
      productionControlStatus: "unavailable",
      status: currentPowerW === null ? "offline" : "connected",
    };
  }

  async setProductionEnabled(): Promise<NormalizedSolarEnergyProviderInfo | null> {
    throw new Error(
      `HomeWizard production control is unavailable for provider ${this.provider.id}.`,
    );
  }
}

export const homeWizardSolarEnergyProviderDiscoveryPlugins: DiscoveryPlugin[] =
  [
    createHomeWizardDiscoveryPlugin({
      kind: "smart-plug",
      model: HOMEWIZARD_SMART_PLUG_MODEL,
      name: HOMEWIZARD_SMART_PLUG_NAME,
      matches: isHomeWizardSmartPlug,
    }),
    createHomeWizardDiscoveryPlugin({
      kind: "ct",
      model: HOMEWIZARD_CT_MODEL,
      name: HOMEWIZARD_CT_NAME,
      matches: isHomeWizardCt,
    }),
  ];

function createHomeWizardDiscoveryPlugin(input: {
  kind: HomeWizardSolarKind;
  matches: (snapshot: HomeWizardLocalSnapshot) => boolean;
  model: string;
  name: string;
}): DiscoveryPlugin {
  return {
    pluginType: "solar-energy-provider",
    category: "solar-energy-provider",
    model: input.model,
    name: input.name,
    port: 80,
    schemes: ["http"],
    async probe({ ipAddress }) {
      const snapshot = await fetchHomeWizardLocalSnapshot(ipAddress, {
        requestTimeoutMs: HOMEWIZARD_DISCOVERY_REQUEST_TIMEOUT_MS,
      }).catch(() => null);

      if (!snapshot || !input.matches(snapshot)) {
        return null;
      }

      return {
        category: "solar-energy-provider",
        capacityWh: null,
        details: formatHomeWizardDetails(snapshot),
        ipAddress,
        model: input.model,
        name: input.name,
        port: 80,
        powerW: snapshot.powerW,
        socPercent: null,
        state: "connected",
      };
    },
  };
}

function normalizeInvertedSolarPowerW(powerW: number | null): number | null {
  return powerW === null ? null : Math.max(0, -powerW);
}
