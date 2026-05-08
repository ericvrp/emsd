import type {
  ManagedDeviceTelemetryRecord,
  SolarEnergyProviderProductionControlStatus,
} from "@emsd/core";
import type { SolarEnergyProviderControlRequestRecord } from "./database";

export function resolveEffectiveSolarProductionControlStatus(
  providerTelemetry: ManagedDeviceTelemetryRecord | null,
  latestControlRequest: SolarEnergyProviderControlRequestRecord | null,
): Extract<SolarEnergyProviderProductionControlStatus, "enabled" | "disabled"> {
  const reportedStatus = providerTelemetry?.productionControlStatus ?? null;

  if (reportedStatus === "enabled" || reportedStatus === "disabled") {
    return reportedStatus;
  }

  if (latestControlRequest !== null) {
    return latestControlRequest.requestedEnabled ? "enabled" : "disabled";
  }

  return "enabled";
}
