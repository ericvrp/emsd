import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { deriveBatteryStatusFromPower } from "@emsd/core/client";
import { authOptions } from "../../../../auth";
import { getLiveStatus } from "../../../../lib/ems-bridge";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const snapshot = await getLiveStatus();
  const siteId = request.nextUrl.searchParams.get("siteId");
  const site = siteId
    ? (snapshot.sites.find((entry) => entry.id === siteId) ?? null)
    : (snapshot.sites[0] ?? null);

  const batteries =
    site?.devices.filter((device) => device.kind === "battery") ?? [];
  const batteryChargeValues = batteries
    .map((battery) => battery.telemetry?.socPercent)
    .filter((value): value is number => typeof value === "number");
  const currentBatteryChargePercent =
    batteryChargeValues.length > 0
      ? batteryChargeValues.reduce((total, value) => total + value, 0) /
        batteryChargeValues.length
      : null;
  const currentBatteryPowerW = batteries.reduce<number | null>(
    (total, battery) => {
      const powerW = battery.telemetry?.powerW;

      if (typeof powerW !== "number") {
        return total;
      }

      return total === null ? powerW : total + powerW;
    },
    null,
  );
  const currentStrategySummary =
    batteries.find(
      (battery) => typeof battery.batteryStrategySummary === "string",
    )?.batteryStrategySummary ?? null;
  const currentBatteryStrategySummaryById = Object.fromEntries(
    batteries.map((battery) => [
      battery.id,
      battery.batteryStrategySummary ?? null,
    ]),
  );
  const currentManualModeActive = batteries.some(
    (battery) => battery.batteryManualModeActive,
  );
  const currentBatteryManualModeActiveById = Object.fromEntries(
    batteries.map((battery) => [battery.id, battery.batteryManualModeActive]),
  );
  const currentGridPowerW =
    site?.devices
      .filter((device) => device.kind === "meter")
      .reduce<number | null>((total, device) => {
        const powerW = device.telemetry?.powerW;

        if (typeof powerW !== "number") {
          return total;
        }

        return total === null ? -powerW : total - powerW;
      }, null) ?? null;
  const currentSolarPowerW =
    site?.devices
      .filter((device) => device.kind === "solar-energy-provider")
      .reduce<number | null>((total, device) => {
        const powerW = device.telemetry?.powerW;

        if (typeof powerW !== "number") {
          return total;
        }

        return total === null ? powerW : total + powerW;
      }, null) ?? null;

  return NextResponse.json({
    currentBatteryChargePercent,
    currentBatteryManualModeActiveById,
    currentBatteryStrategySummaryById,
    currentManualModeActive,
    currentBatteryPowerW,
    currentBatteryState: deriveBatteryStatusFromPower(currentBatteryPowerW),
    currentStrategySummary,
    currentGridPowerW,
    currentSolarPowerW,
  });
}
