import type { ReactNode } from "react";
import { AppShell } from "./app-shell";
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
  return (
    <>
      <ToastOnSearchParams />
      <AppShell
        generatedAt={generatedAt}
        headerActions={
          <SettingsDialog>
            <SettingsPanel currentSite={currentSite} />
          </SettingsDialog>
        }
      >
        {children}
      </AppShell>
    </>
  );
}
