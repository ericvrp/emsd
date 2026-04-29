"use client";

import type {
  DynamicPriceSourceRecord,
  ManagedDeviceStatusRecord,
  SiteRecord,
  SolarEnergyProviderProductionControlStatus,
  WeatherForecastSourceRecord,
} from "@emsd/core/client";
import {
  Globe,
  HardDrive,
  Home,
  LocateFixed,
  Save,
  ScanSearch,
  Search,
  Sun,
  Trash2,
  Zap,
} from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  createDynamicPriceSourceAction,
  createSiteAction,
  createWeatherForecastSourceAction,
  deleteBatteryAction,
  deleteDynamicPriceSourceAction,
  deleteMeterAction,
  deleteSiteAction,
  deleteSolarEnergyProviderAction,
  deleteWeatherForecastSourceAction,
  setSolarEnergyProviderProductionEnabledAction,
  updateBatterySettingsAction,
  updateDynamicPriceSourceAction,
  updateDynamicPriceSourceExportDeductionAction,
  updateSiteAction,
  updateWeatherForecastSourceAction,
} from "../app/actions";
import { UI_COLORS, UI_STYLES } from "../lib/ui-colors";
import { cn } from "../lib/utils";
import { DiscoveryPanel } from "./discovery-panel";
import { LocalApiPanel } from "./local-api-panel";
import { MeasuredChartContainer } from "./measured-chart-container";
import { SectionSummaryCard } from "./section-summary-card";
import { SubmitButton } from "./submit-button";
import { useFormActionToast } from "./use-form-action-toast";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader } from "./ui/card";
import { DialogPortal } from "./ui/dialog-portal";

type SettingsTab =
  | "devices"
  | "site"
  | "discover"
  | "price-provider"
  | "solar-forecast-provider"
  | "local-api";

function formatManagedDeviceState(state: string): string {
  return state.replace(/-/g, " ");
}

function formatCapacity(capacityWh: number | null | undefined): string {
  if (capacityWh === null || capacityWh === undefined) {
    return "Unavailable";
  }

  return `${(capacityWh / 1000).toFixed(1)} kWh`;
}

function formatProductionControlStatus(
  status: SolarEnergyProviderProductionControlStatus | null | undefined,
): string {
  switch (status) {
    case "enabled":
      return "Enabled";
    case "disabled":
      return "Disabled";
    default:
      return "Unavailable";
  }
}

const primaryButtonClass = UI_STYLES.buttonPrimary;
const secondaryButtonClass = UI_STYLES.buttonSecondary;
const dangerButtonClass = UI_STYLES.buttonDanger;

export function SettingsPanel({
  currentSite,
}: {
  currentSite: SiteSnapshot | null;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const hasSite = currentSite !== null;
  const hasDevices = (currentSite?.devices.length ?? 0) > 0;
  const returnPath = buildReturnPath(pathname, searchParams);
  const [activeTab, setActiveTab] = useState<SettingsTab>(
    resolveTab({ hasDevices, hasSite }),
  );

  return (
    <Card className="overflow-hidden border-white/10 bg-slate-950/75">
      <CardHeader className="border-b border-white/8 p-0">
        <div className={`${UI_STYLES.tabBar} pt-2.5 sm:pt-3`}>
          {(
            [
              "site",
              "discover",
              "devices",
              "price-provider",
              "solar-forecast-provider",
              "local-api",
            ] as SettingsTab[]
          ).map((tab) => {
            const isDisabled =
              !hasSite && tab !== "site" && tab !== "local-api";

            return (
              <button
                key={tab}
                className={cn(
                  UI_STYLES.tabItem,
                  activeTab === tab
                    ? UI_STYLES.tabItemActive
                    : isDisabled
                      ? UI_STYLES.tabItemDisabled
                      : UI_STYLES.tabItemInactive,
                )}
                disabled={isDisabled}
                onClick={() => setActiveTab(tab)}
                type="button"
              >
                {tab === "devices" ? (
                  <HardDrive size={15} />
                ) : tab === "site" ? (
                  <Home size={15} />
                ) : tab === "discover" ? (
                  <ScanSearch size={15} />
                ) : tab === "price-provider" ? (
                  <Zap size={15} />
                ) : tab === "local-api" ? (
                  <Globe size={15} />
                ) : (
                  <Sun size={15} />
                )}
                <span className="hidden lg:inline">
                  {tab === "devices"
                    ? "Devices"
                    : tab === "site"
                      ? "Site"
                      : tab === "discover"
                        ? "Discover"
                        : tab === "price-provider"
                          ? "Price provider"
                          : tab === "local-api"
                            ? "Local API"
                            : "Solar forecast"}
                </span>
              </button>
            );
          })}
        </div>
      </CardHeader>

      <CardContent className="space-y-5 pt-5">
        {activeTab === "devices" ? (
          currentSite ? (
            <section className="grid gap-4 xl:grid-cols-3">
              <ResourceSection title="Batteries">
                <DeviceList
                  kind="battery"
                  returnPath={returnPath}
                  site={currentSite}
                />
              </ResourceSection>
              <ResourceSection title="Solar Providers">
                <DeviceList
                  kind="solar-energy-provider"
                  returnPath={returnPath}
                  site={currentSite}
                />
              </ResourceSection>
              <ResourceSection title="Meters">
                <DeviceList
                  kind="meter"
                  returnPath={returnPath}
                  site={currentSite}
                />
              </ResourceSection>
            </section>
          ) : (
            <SiteSetupPanel embedded returnPath={returnPath} />
          )
        ) : null}
        {activeTab === "site" ? (
          <SitePanel embedded returnPath={returnPath} site={currentSite} />
        ) : null}

        {activeTab === "discover" ? (
          currentSite ? (
            <section className="space-y-5">
              <div>
                <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-300/90">
                  <ScanSearch size={13} />
                  Discover
                </p>
                <h2 className="mt-2 text-2xl font-semibold text-white">
                  Find and add batteries, solar providers, and meters
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  Scan once and add devices one by one or all at once.
                </p>
              </div>
              <DiscoveryPanel
                existingDeviceIds={currentSite.devices.map(
                  (device) => device.id,
                )}
                selectedSiteId={currentSite.id}
              />
            </section>
          ) : (
            <SiteSetupPanel embedded returnPath={returnPath} />
          )
        ) : null}
        {activeTab === "price-provider" ? (
          currentSite ? (
            <PriceProviderPanel returnPath={returnPath} site={currentSite} />
          ) : (
            <SiteSetupPanel embedded returnPath={returnPath} />
          )
        ) : null}
        {activeTab === "solar-forecast-provider" ? (
          currentSite ? (
            <SolarForecastProviderPanel site={currentSite} />
          ) : (
            <SiteSetupPanel embedded returnPath={returnPath} />
          )
        ) : null}
        {activeTab === "local-api" ? <LocalApiPanel /> : null}
      </CardContent>
    </Card>
  );
}

function resolveTab(options: {
  hasDevices: boolean;
  hasSite: boolean;
}): SettingsTab {
  if (!options.hasSite) {
    return "site";
  }

  if (!options.hasDevices) {
    return "discover";
  }

  return "devices";
}

function formatGpsCoordinate(latitude: number, longitude: number): string {
  return `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
}

export function SiteSetupPanel({
  embedded = false,
  returnPath,
}: {
  embedded?: boolean;
  returnPath?: string;
}) {
  const createSiteFormAction = useFormActionToast(createSiteAction);

  return (
    <section
      className={cn(
        embedded
          ? "space-y-5"
          : "relative overflow-hidden rounded-[1.75rem] border border-white/10 bg-slate-950/55 p-5 shadow-[0_20px_90px_rgba(0,0,0,0.25)] backdrop-blur",
      )}
    >
      {embedded ? null : (
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-300/40 to-transparent" />
      )}
      <div className="mb-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-emerald-300/90">
          Site Setup
        </p>
        <h2 className="mt-2 text-2xl font-semibold text-white">
          Create your site
        </h2>
        <p className="mt-2 text-sm leading-6 text-slate-400">
          Create the current site before discovery and device management unlock.
        </p>
      </div>
      <form
        action={createSiteFormAction}
        className="space-y-4 rounded-[1.4rem] border border-white/10 bg-white/5 p-4"
      >
        <input type="hidden" name="returnPath" value={returnPath ?? "/"} />
        <label className="block space-y-2">
          <span className="text-sm font-medium text-slate-300">
            Display name
          </span>
          <input
            className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-cyan-400/50"
            name="name"
            placeholder="Main House"
            required
          />
        </label>
        <SiteLocationFields defaultLocation="" />
        <SubmitButton className={primaryButtonClass}>
          <Save size={14} />
          Create site
        </SubmitButton>
      </form>
    </section>
  );
}

function SitePanel({
  site,
  embedded = false,
  returnPath,
}: {
  site: SiteSnapshot | null;
  embedded?: boolean;
  returnPath: string;
}) {
  const updateSiteFormAction = useFormActionToast(updateSiteAction);
  const deleteSiteFormAction = useFormActionToast(deleteSiteAction);

  if (!site) {
    return <SiteSetupPanel embedded={embedded} returnPath={returnPath} />;
  }

  const batteries = site.devices.filter((device) => device.kind === "battery");
  const meters = site.devices.filter((device) => device.kind === "meter");
  const solarEnergyProviders = site.devices.filter(
    (device) => device.kind === "solar-energy-provider",
  );
  const deletionWarning = [
    formatNamedBlocker(
      "battery",
      batteries.map((device) => device.name),
    ),
    formatNamedBlocker(
      "meter",
      meters.map((device) => device.name),
    ),
    formatNamedBlocker(
      "solar energy provider",
      solarEnergyProviders.map((device) => device.name),
    ),
    formatNamedBlocker(
      "solar forecast source",
      site.weatherSources.map(formatWeatherSourceDeleteName),
    ),
    formatNamedBlocker(
      "dynamic price source",
      site.dynamicPriceSources.map((source) => source.name),
    ),
  ].filter((value): value is string => value !== null);

  return (
    <section
      className={cn(
        embedded
          ? "space-y-4"
          : "relative overflow-hidden rounded-[1.75rem] border border-white/10 bg-slate-950/55 p-5 shadow-[0_20px_90px_rgba(0,0,0,0.25)] backdrop-blur",
      )}
    >
      {embedded ? null : (
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-300/40 to-transparent" />
      )}
      <div className={embedded ? "space-y-4" : "space-y-4"}>
        <form
          action={updateSiteFormAction}
          className="space-y-4 rounded-[1.4rem] border border-white/10 bg-white/5 p-4"
          id={`site-update-${site.id}`}
        >
          <input type="hidden" name="returnPath" value={returnPath} />
          <input type="hidden" name="siteId" value={site.id} />
          <label className="block space-y-2">
            <span className="text-sm font-medium text-slate-300">
              Site name
            </span>
            <input
              className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-slate-100 outline-none transition focus:border-cyan-400/50"
              defaultValue={site.name}
              name="name"
              required
            />
          </label>
          <SiteLocationFields defaultLocation={site.location} />
        </form>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button
            className={secondaryButtonClass}
            form={`site-update-${site.id}`}
            type="submit"
          >
            <Save size={14} />
            Save site
          </Button>
          <DestructiveConfirmButton
            action={deleteSiteFormAction}
            confirmLabel="Delete site"
            description={
              deletionWarning.length > 0
                ? `This deletes ${site.name}, ${joinWithAnd(deletionWarning)}, and the stored telemetry, forecast, and price history for this site. This cannot be undone.`
                : `This deletes ${site.name} and the stored telemetry, forecast, and price history for this site. This cannot be undone.`
            }
            hiddenFields={[
              { name: "returnPath", value: returnPath },
              { name: "siteId", value: site.id },
              { name: "siteName", value: site.name },
            ]}
            title={`Delete ${site.name}?`}
            triggerClassName={dangerButtonClass}
          >
            <Trash2 size={14} />
            Delete site and linked data
          </DestructiveConfirmButton>
        </div>
      </div>
    </section>
  );
}

function formatNamedBlocker(label: string, names: string[]): string | null {
  if (names.length === 0) {
    return null;
  }

  const normalizedLabel = names.length === 1 ? label : `${label}s`;
  return `${names.length} ${normalizedLabel} (${names.join(", ")})`;
}

function formatWeatherSourceDeleteName(
  source: WeatherForecastSourceRecord,
): string {
  return source.provider === "open-meteo" ? "Open-Meteo" : source.name;
}

function joinWithAnd(values: string[]): string {
  if (values.length <= 1) {
    return values[0] ?? "";
  }

  if (values.length === 2) {
    return `${values[0]} and ${values[1]}`;
  }

  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}

function SiteLocationFields({ defaultLocation }: { defaultLocation: string }) {
  const [location, setLocation] = useState(defaultLocation);
  const [query, setQuery] = useState("");
  const [isLocating, setIsLocating] = useState(false);
  const [isSearching, setIsSearching] = useState(false);

  async function lookupLocation() {
    const trimmedQuery = query.trim();

    if (!trimmedQuery) {
      toast.error("Enter a place name to look up.");
      return;
    }

    setIsSearching(true);

    try {
      const response = await fetch(
        `/api/geocode?q=${encodeURIComponent(trimmedQuery)}`,
      );
      const payload = (await response.json()) as {
        error?: string;
        location?: string;
      };

      if (!response.ok || !payload.location) {
        throw new Error(payload.error ?? "Unable to look up that location.");
      }

      setLocation(payload.location);
      toast.success(`Resolved '${trimmedQuery}' to ${payload.location}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSearching(false);
    }
  }

  function useCurrentLocation() {
    if (!("geolocation" in navigator)) {
      toast.error("Browser geolocation is not available here.");
      return;
    }

    setIsLocating(true);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const nextLocation = formatGpsCoordinate(
          position.coords.latitude,
          position.coords.longitude,
        );

        setLocation(nextLocation);
        toast.success(`Using current GPS location ${nextLocation}.`);
        setIsLocating(false);
      },
      (error) => {
        toast.error(
          error.message || "Unable to read the current GPS location.",
        );
        setIsLocating(false);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
      },
    );
  }

  return (
    <div className="space-y-4 rounded-[1.25rem] border border-white/8 bg-slate-950/40 p-4">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto_auto] lg:items-end">
        <label className="block space-y-2">
          <span className="text-sm font-medium text-slate-300">
            Place lookup
          </span>
          <input
            className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-cyan-400/50"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Amsterdam, Netherlands"
            value={query}
          />
        </label>
        <button
          className={secondaryButtonClass}
          disabled={isSearching}
          onClick={lookupLocation}
          type="button"
        >
          <Search size={14} />
          {isSearching ? "Looking up..." : "Look up place"}
        </button>
        <button
          className={secondaryButtonClass}
          disabled={isLocating}
          onClick={useCurrentLocation}
          type="button"
        >
          <LocateFixed size={14} />
          {isLocating ? "Locating..." : "Use current GPS"}
        </button>
      </div>

      <label className="block space-y-2">
        <span className="text-sm font-medium text-slate-300">GPS location</span>
        <input
          className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-cyan-400/50"
          name="location"
          onChange={(event) => setLocation(event.target.value)}
          placeholder="52.367600, 4.904100"
          required
          value={location}
        />
        <p className="text-xs text-slate-500">
          Store the site as `latitude, longitude` using Google Maps style
          coordinates.
        </p>
      </label>
    </div>
  );
}

function DestructiveConfirmButton({
  action,
  children,
  confirmLabel,
  description,
  hiddenFields,
  title,
  triggerClassName,
}: {
  action: (formData: FormData) => Promise<void>;
  children: ReactNode;
  confirmLabel: string;
  description: string;
  hiddenFields: Array<{ name: string; value: string }>;
  title: string;
  triggerClassName: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const formAction = async (formData: FormData) => {
    await action(formData);
    setIsOpen(false);
  };

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen]);

  return (
    <>
      <button
        className={triggerClassName}
        onClick={() => setIsOpen(true)}
        type="button"
      >
        {children}
      </button>

      {isOpen ? (
        <DialogPortal>
          <div className="fixed inset-0 z-[110] bg-slate-950/80 p-4 backdrop-blur-sm">
            <div className="flex min-h-full items-center justify-center">
              <div className="w-full max-w-md rounded-3xl border border-white/10 bg-slate-950 p-5 shadow-[0_30px_120px_rgba(0,0,0,0.45)]">
                <p className="text-sm font-semibold uppercase tracking-[0.22em] text-rose-300">
                  Confirm delete
                </p>
                <h3 className="mt-3 text-xl font-semibold text-white">
                  {title}
                </h3>
                <p className="mt-3 text-sm leading-6 text-slate-300">
                  {description}
                </p>
                <div className="mt-5 flex flex-wrap justify-end gap-3">
                  <Button
                    onClick={() => setIsOpen(false)}
                    type="button"
                    variant="ghost"
                  >
                    Cancel
                  </Button>
                  <form action={formAction}>
                    {hiddenFields.map((field) => (
                      <input
                        key={field.name}
                        name={field.name}
                        type="hidden"
                        value={field.value}
                      />
                    ))}
                    <SubmitButton className={dangerButtonClass}>
                      {confirmLabel}
                    </SubmitButton>
                  </form>
                </div>
              </div>
            </div>
          </div>
        </DialogPortal>
      ) : null}
    </>
  );
}

function ResourceSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="relative overflow-hidden rounded-[1.75rem] border border-white/10 bg-slate-950/55 p-5 shadow-[0_20px_90px_rgba(0,0,0,0.25)] backdrop-blur">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-violet-300/30 to-transparent" />
      <h3 className="mb-4 text-xl font-semibold text-white">{title}</h3>
      {children}
    </section>
  );
}

function DeviceList({
  returnPath,
  site,
  kind,
}: {
  returnPath: string;
  site: SiteSnapshot;
  kind: "battery" | "meter" | "solar-energy-provider";
}) {
  const updateBatterySettingsFormAction = useFormActionToast(
    updateBatterySettingsAction,
  );
  const setSolarProductionFormAction = useFormActionToast(
    setSolarEnergyProviderProductionEnabledAction,
  );
  const deleteBatteryFormAction = useFormActionToast(deleteBatteryAction);
  const deleteMeterFormAction = useFormActionToast(deleteMeterAction);
  const deleteSolarProviderFormAction = useFormActionToast(
    deleteSolarEnergyProviderAction,
  );

  const devices = site.devices.filter((device) => device.kind === kind);

  if (devices.length === 0) {
    return (
      <p className="text-sm leading-6 text-slate-400">
        No{" "}
        {kind === "battery"
          ? "batteries"
          : kind === "meter"
            ? "meters"
            : "solar energy providers"}{" "}
        configured yet.
      </p>
    );
  }

  return (
    <div className="grid gap-3">
      {devices.map((device) => {
        return (
          <article
            key={device.id}
            className={`flex min-h-[440px] flex-col rounded-[1.4rem] border border-white/10 bg-white/5 p-4 ${kind === "battery" ? "ring-1 ring-cyan-300/5" : kind === "meter" ? "ring-1 ring-violet-300/5" : "ring-1 ring-amber-300/5"}`}
          >
            <div className="min-w-0">
              <h4 className="truncate text-base font-semibold text-white">
                {device.name}
              </h4>
              <p className="mt-1 truncate text-xs text-slate-400">
                {device.id}
              </p>
            </div>
            <dl className="mt-4 grid flex-1 content-start gap-3 text-sm text-slate-300 sm:grid-cols-2">
              <MetaItem label="Model" value={device.model} />
              <MetaItem label="Address" value={device.address} />
              {kind === "battery" ? (
                <MetaItem
                  label="SoC"
                  value={
                    device.telemetry?.socPercent !== null &&
                    device.telemetry?.socPercent !== undefined
                      ? `${Math.round(device.telemetry.socPercent)}%`
                      : "Unavailable"
                  }
                />
              ) : null}
              {kind === "battery" ? (
                <MetaItem
                  label="Capacity"
                  value={formatCapacity(device.telemetry?.capacityWh)}
                />
              ) : null}
              <MetaItem
                label="Power"
                value={
                  device.telemetry?.powerW !== null &&
                  device.telemetry?.powerW !== undefined
                    ? `${Math.round(device.telemetry.powerW)} W`
                    : "Unavailable"
                }
              />
              {kind === "solar-energy-provider" ? (
                <MetaItem
                  label="Production control"
                  value={formatProductionControlStatus(
                    device.telemetry?.productionControlStatus,
                  )}
                />
              ) : null}
              {kind === "battery" ? (
                  <form
                    action={updateBatterySettingsFormAction}
                  className="rounded-2xl border border-white/8 bg-slate-950/55 px-3 py-2"
                  id={`battery-settings-${device.id}`}
                >
                  <input type="hidden" name="returnPath" value={returnPath} />
                  <input type="hidden" name="siteId" value={site.id} />
                  <input type="hidden" name="batteryId" value={device.id} />
                  <input type="hidden" name="batteryName" value={device.name} />
                  <div className="space-y-3">
                    <label className="block space-y-2">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                        Maximum charge power
                      </span>
                      <div className="flex items-center gap-2">
                        <input
                          className="w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-cyan-400/50"
                          defaultValue={device.maximumChargePowerW ?? 800}
                          max={2400}
                          min={800}
                          name="maximumChargePowerW"
                          step={10}
                          type="number"
                        />
                        <span className="text-sm text-slate-400">W</span>
                      </div>
                    </label>
                    <label className="block space-y-2">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                        Maximum discharge power
                      </span>
                      <div className="flex items-center gap-2">
                        <input
                          className="w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-cyan-400/50"
                          defaultValue={device.maximumDischargePowerW ?? 800}
                          max={2400}
                          min={800}
                          name="maximumDischargePowerW"
                          step={10}
                          type="number"
                        />
                        <span className="text-sm text-slate-400">W</span>
                      </div>
                    </label>
                    <label className="block space-y-2">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                        Backup reserve
                      </span>
                      <div className="flex items-center gap-2">
                        <input
                          className="w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-cyan-400/50"
                          defaultValue={device.minimumDischargePercent ?? 10}
                          max={100}
                          min={10}
                          name="minimumDischargePercent"
                          step={1}
                          type="number"
                        />
                        <span className="text-sm text-slate-400">%</span>
                      </div>
                    </label>
                  </div>
                </form>
              ) : null}
              {kind === "solar-energy-provider" ? (
                  <form
                    action={setSolarProductionFormAction}
                  className="rounded-2xl border border-white/8 bg-slate-950/55 px-3 py-3 sm:col-span-2"
                  id={`solar-provider-settings-${device.id}`}
                >
                  <input type="hidden" name="returnPath" value={returnPath} />
                  <input type="hidden" name="siteId" value={site.id} />
                  <input
                    type="hidden"
                    name="solarEnergyProviderId"
                    value={device.id}
                  />
                  <input
                    type="hidden"
                    name="solarEnergyProviderName"
                    value={device.name}
                  />
                  <div className="space-y-3">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                        Solar production
                      </p>
                      <p className="mt-1 text-sm text-slate-100">
                        Provider-reported state:{" "}
                        {formatProductionControlStatus(
                          device.telemetry?.productionControlStatus,
                        )}
                      </p>
                      {device.telemetry?.productionControlStatus ===
                        "unavailable" ||
                      device.telemetry?.productionControlStatus === null ||
                      device.telemetry?.productionControlStatus ===
                        undefined ? (
                        <p className="mt-1 text-xs leading-5 text-slate-400">
                          Not supported by this provider or the current account.
                        </p>
                      ) : null}
                    </div>
                    <label className="block space-y-2">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                        Desired state
                      </span>
                      <select
                        className="w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-cyan-400/50 disabled:cursor-not-allowed disabled:opacity-60"
                        defaultValue={
                          device.telemetry?.productionControlStatus ===
                          "disabled"
                            ? "disabled"
                            : "enabled"
                        }
                        disabled={
                          device.telemetry?.productionControlStatus ===
                            "unavailable" ||
                          device.telemetry?.productionControlStatus === null ||
                          device.telemetry?.productionControlStatus ===
                            undefined
                        }
                        name="productionControlStatus"
                      >
                        <option value="enabled">Enabled</option>
                        <option value="disabled">Disabled</option>
                      </select>
                    </label>
                  </div>
                </form>
              ) : null}
            </dl>
            <div className="mt-auto pt-4 flex flex-wrap gap-2">
              {kind === "battery" ? (
                <Button
                  className={secondaryButtonClass}
                  form={`battery-settings-${device.id}`}
                  type="submit"
                >
                  <Save size={14} />
                  Save
                </Button>
              ) : null}
              {kind === "solar-energy-provider" ? (
                <Button
                  className={secondaryButtonClass}
                  disabled={
                    device.telemetry?.productionControlStatus ===
                      "unavailable" ||
                    device.telemetry?.productionControlStatus === null ||
                    device.telemetry?.productionControlStatus === undefined
                  }
                  form={`solar-provider-settings-${device.id}`}
                  type="submit"
                >
                  <Save size={14} />
                  Save
                </Button>
              ) : null}
              <DestructiveConfirmButton
                action={
                  kind === "battery"
                    ? deleteBatteryFormAction
                    : kind === "meter"
                      ? deleteMeterFormAction
                      : deleteSolarProviderFormAction
                }
                confirmLabel={
                  kind === "battery"
                    ? "Delete battery"
                    : kind === "meter"
                      ? "Delete meter"
                      : "Delete solar provider"
                }
                description={`This deletes ${device.name}. This cannot be undone.`}
                hiddenFields={[
                  { name: "returnPath", value: returnPath },
                  { name: "siteId", value: site.id },
                  {
                    name:
                      kind === "battery"
                        ? "batteryId"
                        : kind === "meter"
                          ? "meterId"
                          : "solarEnergyProviderId",
                    value: device.id,
                  },
                ]}
                title={`Delete ${device.name}?`}
                triggerClassName={dangerButtonClass}
              >
                <Trash2 size={14} />
                Delete
              </DestructiveConfirmButton>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function SourceList({
  site,
  kind,
  titleLabel,
  records,
}: {
  site: SiteSnapshot;
  kind: "weather" | "price";
  titleLabel: string;
  records: WeatherForecastSourceRecord[] | DynamicPriceSourceRecord[];
}) {
  const createWeatherSourceFormAction = useFormActionToast(
    createWeatherForecastSourceAction,
  );
  const createPriceSourceFormAction = useFormActionToast(
    createDynamicPriceSourceAction,
  );
  const updateWeatherSourceFormAction = useFormActionToast(
    updateWeatherForecastSourceAction,
  );
  const updatePriceSourceFormAction = useFormActionToast(
    updateDynamicPriceSourceAction,
  );
  const deleteWeatherSourceFormAction = useFormActionToast(
    deleteWeatherForecastSourceAction,
  );
  const deletePriceSourceFormAction = useFormActionToast(
    deleteDynamicPriceSourceAction,
  );

  return (
    <>
      <form
        action={
          kind === "weather"
            ? createWeatherSourceFormAction
            : createPriceSourceFormAction
        }
        className="space-y-4 rounded-[1.4rem] border border-white/10 bg-white/5 p-4"
      >
        <input type="hidden" name="siteId" value={site.id} />
        {kind === "weather" ? (
          <>
            <input type="hidden" name="provider" value="open-meteo" />
            <input
              type="hidden"
              name="surface"
              value="open-meteo-shortwave-radiation"
            />
          </>
        ) : null}
        {kind === "price" ? (
          <input type="hidden" name="provider" value="tibber" />
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-2">
            <span className="text-sm font-medium text-slate-300">
              {titleLabel} ID
            </span>
            <input
              className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-slate-100 outline-none transition focus:border-cyan-400/50"
              name="sourceId"
              required
            />
          </label>
          <label className="block space-y-2">
            <span className="text-sm font-medium text-slate-300">Name</span>
            <input
              className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-slate-100 outline-none transition focus:border-cyan-400/50"
              name="name"
              required
            />
          </label>
        </div>
        {kind === "weather" ? (
          <p className="text-xs text-slate-500">
            Weather sources default to `open-meteo` using the current site GPS
            location.
          </p>
        ) : kind === "price" ? (
          <p className="text-xs text-slate-500">
            Dynamic price sources currently use `tibber` and read prices with
            `TIBBER_ACCESS_TOKEN`, plus optional `TIBBER_HOME_ID`.
          </p>
        ) : null}
        <SubmitButton className={primaryButtonClass}>
          {kind === "weather"
            ? "Add solar forecast source"
            : "Add price source"}
        </SubmitButton>
      </form>

      {records.length > 0 ? (
        <div className="mt-3 space-y-3">
          {records.map((record) => (
            <article
              key={record.id}
              className="rounded-[1.4rem] border border-white/10 bg-white/5 p-4 ring-1 ring-emerald-300/5"
            >
              <div className="min-w-0">
                <h4 className="truncate text-base font-semibold text-white">
                  {record.name}
                </h4>
                <p className="mt-1 truncate text-xs text-slate-400">
                  {record.id}
                </p>
                {kind === "weather" ? (
                  <p className="mt-1 text-xs uppercase tracking-[0.14em] text-sky-300/80">
                    {(record as WeatherForecastSourceRecord).provider}
                  </p>
                ) : kind === "price" ? (
                  <p className="mt-1 text-xs uppercase tracking-[0.14em] text-violet-300/80">
                    {(record as DynamicPriceSourceRecord).provider}
                  </p>
                ) : null}
              </div>
              <form
                action={
                  kind === "weather"
                    ? updateWeatherSourceFormAction
                    : updatePriceSourceFormAction
                }
                className="mt-4 space-y-3"
              >
                <input type="hidden" name="siteId" value={site.id} />
                <input type="hidden" name="sourceId" value={record.id} />
                {kind === "price" ? (
                  <input type="hidden" name="provider" value="tibber" />
                ) : null}
                <label className="block space-y-2">
                  <span className="text-sm font-medium text-slate-300">
                    Rename
                  </span>
                  <input
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-slate-100 outline-none transition focus:border-cyan-400/50"
                    defaultValue={record.name}
                    name="name"
                    required
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  <SubmitButton
                    className={secondaryButtonClass}
                    showPendingText={false}
                  >
                    <Save size={14} />
                    Save
                  </SubmitButton>
                </div>
              </form>
              <div className="mt-2">
                <DestructiveConfirmButton
                  action={
                    kind === "weather"
                      ? deleteWeatherSourceFormAction
                      : deletePriceSourceFormAction
                  }
                  confirmLabel={
                    kind === "weather"
                      ? "Delete forecast source"
                      : "Delete price source"
                  }
                  description={
                    kind === "weather"
                      ? `This deletes the forecast source ${formatWeatherSourceDeleteName(record as WeatherForecastSourceRecord)}. This cannot be undone.`
                      : `This deletes the price source ${record.name}. This cannot be undone.`
                  }
                  hiddenFields={[
                    { name: "siteId", value: site.id },
                    { name: "sourceId", value: record.id },
                  ]}
                  title={`Delete ${kind === "weather" ? formatWeatherSourceDeleteName(record as WeatherForecastSourceRecord) : record.name}?`}
                  triggerClassName={dangerButtonClass}
                >
                  Delete
                </DestructiveConfirmButton>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-sm leading-6 text-slate-400">
          {kind === "weather"
            ? "No named solar forecast sources configured yet. Open-Meteo is used as the default forecast provider for this site."
            : "No dynamic price sources configured yet."}
        </p>
      )}
    </>
  );
}

function PriceProviderPanel({
  site,
  returnPath,
}: {
  site: SiteSnapshot;
  returnPath: string;
}) {
  const updateExportDeductionFormAction = useFormActionToast(
    updateDynamicPriceSourceExportDeductionAction,
  );

  return (
    <section className="space-y-5">
      <div>
        <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-violet-300/90">
          <Zap size={13} />
          Price Provider
        </p>
        <h2 className="mt-2 text-2xl font-semibold text-white">
          Dynamic price provider settings
        </h2>
        <p className="mt-2 text-sm leading-6 text-slate-400">
          Manage export price deduction for your normalized price provider.
        </p>
      </div>
      {site.dynamicPriceSources.length === 0 ? (
        <p className="text-sm leading-6 text-slate-400">
          No dynamic price sources configured yet.
        </p>
      ) : (
        <div className="grid gap-3">
          {site.dynamicPriceSources.map((source) => (
            <article
              key={source.id}
              className="rounded-[1.4rem] border border-white/10 bg-white/5 p-4 ring-1 ring-violet-300/5"
            >
              <div className="min-w-0">
                <h4 className="truncate text-base font-semibold text-white">
                  {source.name}
                </h4>
                <p className="mt-1 truncate text-xs text-slate-400">
                  {source.id}
                </p>
                <p className="mt-1 text-xs uppercase tracking-[0.14em] text-violet-300/80">
                  {source.provider}
                </p>
              </div>
              <form
                action={updateExportDeductionFormAction}
                className="mt-4 space-y-3"
              >
                <input type="hidden" name="returnPath" value={returnPath} />
                <input type="hidden" name="siteId" value={site.id} />
                <input type="hidden" name="sourceId" value={source.id} />
                <input type="hidden" name="name" value={source.name} />
                <label className="block space-y-2">
                  <span className="text-sm font-medium text-slate-300">
                    Export deduction ({source.provider} computes export price as
                    import price minus this value)
                  </span>
                  <div className="flex items-center gap-2">
                    <input
                      className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-slate-100 outline-none transition focus:border-cyan-400/50"
                      defaultValue={source.exportDeduction}
                      inputMode="decimal"
                      lang="en-US"
                      max={10}
                      min={0}
                      name="exportDeduction"
                      step="any"
                      type="number"
                    />
                    <span className="text-sm text-slate-400">
                      {source.provider === "tibber" ? "EUR/kWh" : "unit/kWh"}
                    </span>
                  </div>
                </label>
                <div className="flex flex-wrap gap-2">
                  <SubmitButton
                    className={secondaryButtonClass}
                    showPendingIndicator={false}
                    showPendingText={false}
                  >
                    <Save size={14} />
                    Save
                  </SubmitButton>
                </div>
              </form>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function SolarForecastProviderPanel({ site }: { site: SiteSnapshot }) {
  return (
    <section className="space-y-5">
      <div>
        <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-sky-300/90">
          <Sun size={13} />
          Solar Forecast Provider
        </p>
        <h2 className="mt-2 text-2xl font-semibold text-white">
          Solar forecast provider settings
        </h2>
        <p className="mt-2 text-sm leading-6 text-slate-400">
          View the configured solar forecast provider for this site.
        </p>
      </div>
      {site.weatherSources.length === 0 ? (
        <p className="text-sm leading-6 text-slate-400">
          No solar forecast sources configured yet. Open-Meteo is used as the
          default forecast provider.
        </p>
      ) : (
        <div className="grid gap-3">
          {site.weatherSources.map((source) => (
            <article
              key={source.id}
              className="rounded-[1.4rem] border border-white/10 bg-white/5 p-4 ring-1 ring-sky-300/5"
            >
              <div className="min-w-0">
                <h4 className="truncate text-base font-semibold text-white">
                  {source.name}
                </h4>
                <p className="mt-1 truncate text-xs text-slate-400">
                  {source.id}
                </p>
                <p className="mt-1 text-xs uppercase tracking-[0.14em] text-sky-300/80">
                  {source.provider}
                </p>
              </div>
              <dl className="mt-4 grid gap-3 text-sm text-slate-300 sm:grid-cols-2">
                <MetaItem label="Provider" value={source.provider} />
                <MetaItem label="Surface" value={source.surface} />
              </dl>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-slate-950/55 px-3 py-2">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-slate-100">{value}</dd>
    </div>
  );
}

export type SiteSnapshot = SiteRecord & {
  devices: ManagedDeviceStatusRecord[];
  weatherSources: WeatherForecastSourceRecord[];
  dynamicPriceSources: DynamicPriceSourceRecord[];
};

function buildReturnPath(
  pathname: string,
  searchParams: ReturnType<typeof useSearchParams>,
): string {
  const search = searchParams.toString();

  return search ? `${pathname}?${search}` : pathname;
}
