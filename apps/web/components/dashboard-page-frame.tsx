import type { ReactNode } from "react";
import { AppShell } from "./app-shell";
import { HouseStrategyDialog } from "./house-strategy-dialog";
import { SettingsDialog } from "./settings-dialog";
import { SettingsPanel } from "./settings-panel";
import { ToastOnSearchParams } from "./toast-on-search-params";

type DashboardPageFrameProps = {
  children: ReactNode;
  currentSite: Parameters<typeof SettingsPanel>[0]["currentSite"];
  generatedAt: string;
};

export function DashboardPageFrame({
  children,
  currentSite,
  generatedAt,
}: DashboardPageFrameProps) {
  const batteries =
    currentSite?.devices
      .filter((device) => device.kind === "battery")
      .map((device) => ({
        id: device.id,
        name: device.name,
        minimumDischargePercent: device.minimumDischargePercent ?? 10,
        batteryStrategy: device.batteryStrategy,
        batteryStrategyPlan: device.batteryStrategyPlan ?? [],
        batteryManualModeActive: device.batteryManualModeActive ?? false,
        telemetry: device.telemetry,
      })) ?? [];

  return (
    <>
      <ToastOnSearchParams />
      <AppShell
        generatedAt={generatedAt}
        headerActions={
          <>
            {batteries.length > 0 && currentSite ? (
              <HouseStrategyDialog
                batteries={batteries}
                siteId={currentSite.id}
                siteName={currentSite.name}
              />
            ) : null}
            <SettingsDialog>
              <SettingsPanel currentSite={currentSite} />
            </SettingsDialog>
          </>
        }
      >
        {children}
      </AppShell>
    </>
  );
}
