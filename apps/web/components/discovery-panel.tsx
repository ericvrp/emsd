"use client";

import {
  BatteryCharging,
  CircleHelp,
  Gauge,
  HandCoins,
  LoaderCircle,
  Plus,
  ScanSearch,
  SunMedium,
  X,
} from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  createAllFromDiscoveryAction,
  createBatteryFromDiscoveryAction,
  createMeterFromDiscoveryAction,
  createSolarEnergyProviderFromDiscoveryAction,
} from "../app/actions";
import type { SignedDiscoveredDevice } from "../lib/discovery-proof";
import { formatKilowattHoursFromWh } from "../lib/energy-format";
import { UI_STYLES } from "../lib/ui-colors";
import { cn } from "../lib/utils";
import { SubmitButton } from "./submit-button";
import { useMatchedCardHeights } from "./use-matched-card-heights";
import { Button } from "./ui/button";
import { DialogPortal } from "./ui/dialog-portal";
import { useFormActionToast } from "./use-form-action-toast";

interface DiscoveryCachePayload {
  version: number;
  devices: SignedDiscoveredDevice[];
  host: string;
}

const DISCOVERY_CACHE_PREFIX = "emsd-discovery:";
const DISCOVERY_CACHE_VERSION = 5;

const primaryButtonClass = UI_STYLES.buttonPrimary;

const secondaryButtonClass = UI_STYLES.buttonSecondary;
const DEFAULT_BATTERY_BACKUP_RESERVE_PERCENT = 10;

type SupportedPluginStatus = "working" | "untested" | "incomplete" | "issues";

interface SupportedPluginEntry {
  type: (typeof SUPPORTED_PLUGIN_TYPES)[number];
  plugin: string;
  status: SupportedPluginStatus;
  notes: string;
}

const SUPPORTED_PLUGIN_TYPES = [
  "Battery",
  "Meter",
  "Solar",
  "Price",
  "Forecast",
] as const;

const SUPPORTED_DISCOVERY_PLUGINS: readonly SupportedPluginEntry[] = [
  {
    type: "Battery",
    plugin: "Indevolt Battery",
    status: "working",
    notes: "Discovery, telemetry, and strategy control are implemented.",
  },
  {
    type: "Battery",
    plugin: "sonnenBatterie",
    status: "untested",
    notes:
      "Discovery, telemetry, and strategy control are implemented, but field validation is still limited.",
  },
  {
    type: "Battery",
    plugin: "HomeWizard Battery",
    status: "untested",
    notes:
      "Uses the controller battery group API, so per-battery SoC and direct setpoints stay limited.",
  },
  {
    type: "Meter",
    plugin: "HomeWizard P1",
    status: "working",
    notes: "Discovery and live meter telemetry are implemented.",
  },
  {
    type: "Solar",
    plugin: "Enphase IQ Gateway",
    status: "incomplete",
    notes:
      "Telemetry works, but some gateways need owner auth and production control can depend on hardware or firmware.",
  },
  {
    type: "Solar",
    plugin: "SolarEdge Inverter",
    status: "untested",
    notes:
      "Discovery and telemetry are implemented. Production control is unavailable.",
  },
  {
    type: "Solar",
    plugin: "Huawei SUN2000",
    status: "untested",
    notes:
      "Modbus-based discovery and runtime support exist, but field validation is still limited.",
  },
  {
    type: "Price",
    plugin: "Tibber",
    status: "working",
    notes: "Dynamic price provider integration is implemented.",
  },
  {
    type: "Forecast",
    plugin: "Open-Meteo",
    status: "working",
    notes: "Solar forecast provider integration is implemented.",
  },
];

export function DiscoveryPanel({
  existingDeviceIds,
  selectedSiteId,
}: {
  existingDeviceIds: string[];
  selectedSiteId: string | null;
}) {
  const createAllFormAction = useFormActionToast(createAllFromDiscoveryAction);
  const createBatteryFormAction = useFormActionToast(
    createBatteryFromDiscoveryAction,
  );
  const createMeterFormAction = useFormActionToast(
    createMeterFromDiscoveryAction,
  );
  const createSolarProviderFormAction = useFormActionToast(
    createSolarEnergyProviderFromDiscoveryAction,
  );
  const [host, setHost] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<SignedDiscoveredDevice[]>([]);
  const existingIdSet = useMemo(
    () => new Set(existingDeviceIds),
    [existingDeviceIds],
  );
  const addableDiscoveryIds = useMemo(
    () =>
      devices
        .filter((device) => !existingIdSet.has(device.discoveryId))
        .map((device) => device.discoveryId),
    [devices, existingIdSet],
  );
  const orderedDevices = useMemo(
    () => [...devices].sort(compareDiscoveryDevices),
    [devices],
  );
  const matchedDiscoveryCardsRef = useMatchedCardHeights(
    orderedDevices.map((device) => device.discoveryId),
  );
  const batteries = orderedDevices.filter(
    (device) => device.category === "battery",
  );
  const solarProviders = orderedDevices.filter(
    (device) => device.category === "solar-energy-provider",
  );
  const meters = orderedDevices.filter((device) => device.category === "meter");

  useEffect(() => {
    if (!selectedSiteId) {
      setDevices([]);
      setHost("");
      return;
    }

    const rawValue = window.sessionStorage.getItem(
      `${DISCOVERY_CACHE_PREFIX}${selectedSiteId}`,
    );

    if (!rawValue) {
      return;
    }

    try {
      const payload = JSON.parse(rawValue) as DiscoveryCachePayload;

      if (payload.version !== DISCOVERY_CACHE_VERSION) {
        window.sessionStorage.removeItem(
          `${DISCOVERY_CACHE_PREFIX}${selectedSiteId}`,
        );
        return;
      }

      setDevices(Array.isArray(payload.devices) ? payload.devices : []);
      setHost(typeof payload.host === "string" ? payload.host : "");
    } catch {
      window.sessionStorage.removeItem(
        `${DISCOVERY_CACHE_PREFIX}${selectedSiteId}`,
      );
    }
  }, [selectedSiteId]);

  function persistDiscovery(
    nextDevices: SignedDiscoveredDevice[],
    nextHost: string,
  ) {
    if (!selectedSiteId) {
      return;
    }

    window.sessionStorage.setItem(
      `${DISCOVERY_CACHE_PREFIX}${selectedSiteId}`,
      JSON.stringify({
        version: DISCOVERY_CACHE_VERSION,
        devices: nextDevices,
        host: nextHost,
      } satisfies DiscoveryCachePayload),
    );
  }

  async function runDiscovery() {
    if (!selectedSiteId) {
      const message = "Create a site before running device discovery.";
      setError(message);
      setDevices([]);
      toast.error(message);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();

      if (host.trim()) {
        params.set("host", host.trim());
      }

      const response = await fetch(
        `/api/discover${params.toString() ? `?${params.toString()}` : ""}`,
        { cache: "no-store" },
      );

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(payload?.error ?? "Discovery request failed.");
      }

      const payload = (await response.json()) as SignedDiscoveredDevice[];
      setDevices(payload);
      persistDiscovery(payload, host.trim());

      if (payload.length === 0) {
        toast.info(
          host.trim()
            ? `No supported devices responded on ${host.trim()}.`
            : "No supported devices are reachable right now.",
        );
      } else {
        toast.success(
          host.trim()
            ? `Found ${payload.length} device${payload.length === 1 ? "" : "s"} on ${host.trim()}.`
            : `Found ${payload.length} EMS device${payload.length === 1 ? "" : "s"}.`,
        );
      }
    } catch (caughtError) {
      const message =
        caughtError instanceof Error
          ? caughtError.message
          : String(caughtError);
      setError(message);
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <label className="block space-y-2">
          <span className="text-sm font-medium text-slate-300">
            Optional single host
          </span>
          <input
            className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-cyan-400/50"
            onChange={(event) => setHost(event.target.value)}
            placeholder="192.168.1.42"
            value={host}
          />
        </label>

        <div className="flex flex-wrap items-end gap-3 lg:justify-end">
          <button
            className={primaryButtonClass}
            disabled={isLoading || !selectedSiteId}
            onClick={runDiscovery}
            type="button"
          >
            {isLoading ? (
              <>
                <LoaderCircle
                  aria-hidden="true"
                  className="h-4 w-4 animate-spin"
                />
                Scanning...
              </>
            ) : (
              <>
                <ScanSearch aria-hidden="true" className="h-4 w-4" />
                {host.trim() ? "Probe host" : "Scan network"}
              </>
            )}
          </button>
        </div>
      </div>

      {!selectedSiteId ? (
        <p className="rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm font-medium text-rose-100">
          Create a site before running discovery or onboarding devices.
        </p>
      ) : null}

      {error ? (
        <p className="rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm font-medium text-rose-100">
          {error}
        </p>
      ) : null}

      {devices.length === 0 ? (
        <div className="rounded-[1.8rem] border border-dashed border-white/10 bg-white/4 px-6 py-10 text-center text-sm text-slate-400">
          {isLoading
            ? "Scanning the network for EMS-compatible devices..."
            : selectedSiteId
              ? "Run discovery to see reachable batteries, meters, and solar energy providers."
              : "Create a site to unlock discovery."}
        </div>
      ) : (
        <div className="space-y-4">
          {selectedSiteId && addableDiscoveryIds.length > 0 ? (
            <form action={createAllFormAction} className="flex justify-start">
              <input type="hidden" name="siteId" value={selectedSiteId} />
              <input
                type="hidden"
                name="discoveryDevices"
                value={JSON.stringify(
                  orderedDevices.filter((device) =>
                    addableDiscoveryIds.includes(device.discoveryId),
                  ),
                )}
              />
              <SubmitButton className={primaryButtonClass}>
                <Plus aria-hidden="true" className="h-4 w-4" />
                {`Add all discovered (${addableDiscoveryIds.length})`}
              </SubmitButton>
            </form>
          ) : (
            <></>
          )}

          <section
            className="grid gap-4 xl:grid-cols-3"
            ref={matchedDiscoveryCardsRef}
          >
            <DiscoveryResourceSection title="Batteries" type="Battery">
              <DiscoveryDeviceList
                batteryAction={createBatteryFormAction}
                devices={batteries}
                existingIdSet={existingIdSet}
                host={host.trim()}
                kind="battery"
                meterAction={createMeterFormAction}
                selectedSiteId={selectedSiteId}
                solarProviderAction={createSolarProviderFormAction}
              />
            </DiscoveryResourceSection>
            <DiscoveryResourceSection title="Solar Providers" type="Solar">
              <DiscoveryDeviceList
                batteryAction={createBatteryFormAction}
                devices={solarProviders}
                existingIdSet={existingIdSet}
                host={host.trim()}
                kind="solar-energy-provider"
                meterAction={createMeterFormAction}
                selectedSiteId={selectedSiteId}
                solarProviderAction={createSolarProviderFormAction}
              />
            </DiscoveryResourceSection>
            <DiscoveryResourceSection title="Meters" type="Meter">
              <DiscoveryDeviceList
                batteryAction={createBatteryFormAction}
                devices={meters}
                existingIdSet={existingIdSet}
                host={host.trim()}
                kind="meter"
                meterAction={createMeterFormAction}
                selectedSiteId={selectedSiteId}
                solarProviderAction={createSolarProviderFormAction}
              />
            </DiscoveryResourceSection>
          </section>
        </div>
      )}
    </div>
  );
}

export function SupportedPluginsButton() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <Button
        className={secondaryButtonClass}
        onClick={() => setIsOpen(true)}
        title="Current discovery and device integration coverage in EMSD."
        type="button"
      >
        <CircleHelp aria-hidden="true" className="h-4 w-4" />
        Plugins
      </Button>

      {isOpen ? (
        <SupportedPluginsDialog onClose={() => setIsOpen(false)} />
      ) : null}
    </>
  );
}

function SupportedPluginsDialog({ onClose }: { onClose: () => void }) {
  const [activeTab, setActiveTab] =
    useState<(typeof SUPPORTED_PLUGIN_TYPES)[number]>("Battery");

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      onClose();
    }

    document.addEventListener("keydown", handleEscape, true);

    return () => {
      document.removeEventListener("keydown", handleEscape, true);
    };
  }, [onClose]);

  const visiblePlugins = SUPPORTED_DISCOVERY_PLUGINS.filter(
    (plugin) => plugin.type === activeTab,
  );

  return (
    <DialogPortal>
      <div className="fixed inset-0 z-[110] overflow-y-auto bg-slate-950/80 p-4 backdrop-blur-sm">
        <div className="flex min-h-full items-start justify-center py-6">
          <div className="w-full max-w-4xl rounded-3xl border border-white/10 bg-slate-950 p-4 shadow-[0_30px_120px_rgba(0,0,0,0.45)] sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.22em] text-cyan-300">
                  Discover
                </p>
                <h2 className="mt-3 text-2xl font-semibold text-white">
                  Supported plugins
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-300">
                  Current discovery and device integration coverage in EMSD.
                </p>
              </div>
              <button
                aria-label="Close supported plugins dialog"
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-200 transition hover:bg-white/10"
                onClick={onClose}
                type="button"
              >
                <X aria-hidden="true" className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-6 overflow-hidden rounded-[1.5rem] border border-white/10 bg-white/5">
              <div
                className={`${UI_STYLES.tabBar} justify-start px-3 pt-3 sm:px-4`}
              >
                <div className="flex flex-wrap items-center gap-6">
                  {SUPPORTED_PLUGIN_TYPES.map((pluginType) => (
                    <button
                      className={cn(
                        UI_STYLES.tabItem,
                        pluginType === activeTab
                          ? UI_STYLES.tabItemActive
                          : UI_STYLES.tabItemInactive,
                      )}
                      key={pluginType}
                      onClick={() => setActiveTab(pluginType)}
                      type="button"
                    >
                      <PluginTypeIcon
                        aria-hidden="true"
                        className="h-4 w-4"
                        type={pluginType}
                      />
                      {pluginType}
                    </button>
                  ))}
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-white/10 text-left text-sm text-slate-200">
                  <thead className="bg-white/5 text-xs uppercase tracking-[0.18em] text-slate-400">
                    <tr>
                      <th className="px-4 py-3 font-medium">Plugin</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium">Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {visiblePlugins.map((plugin) => {
                      const status = formatPluginStatus(plugin.status);

                      return (
                        <tr key={`${plugin.type}-${plugin.plugin}`}>
                          <td className="px-4 py-3 font-medium text-white">
                            <span className="inline-flex items-center gap-2">
                              <PluginTypeIcon
                                aria-hidden="true"
                                className="h-4 w-4 text-slate-300"
                                type={plugin.type}
                              />
                              {plugin.plugin}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className={status.className}>
                              <span aria-hidden="true">{status.emoji}</span>
                              {status.label}
                            </span>
                          </td>
                          <td className="px-4 py-3 leading-6 text-slate-300">
                            {plugin.notes}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    </DialogPortal>
  );
}

function DiscoveryResourceSection({
  type,
  title,
  children,
}: {
  type: (typeof SUPPORTED_PLUGIN_TYPES)[number];
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="relative flex h-full flex-col overflow-hidden rounded-[1.75rem] border border-white/10 bg-slate-950/55 px-5 pb-4 pt-5 shadow-[0_20px_90px_rgba(0,0,0,0.25)] backdrop-blur">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-violet-300/30 to-transparent" />
      <h3 className="mb-4 inline-flex items-center gap-2 text-xl font-semibold text-white">
        <PluginTypeIcon aria-hidden="true" className="h-5 w-5" type={type} />
        {title}
      </h3>
      <div className="flex-1">{children}</div>
    </section>
  );
}

function DiscoveryDeviceList({
  batteryAction,
  devices,
  existingIdSet,
  host,
  kind,
  meterAction,
  solarProviderAction,
  selectedSiteId,
}: {
  batteryAction: (formData: FormData) => Promise<void>;
  devices: SignedDiscoveredDevice[];
  existingIdSet: Set<string>;
  host: string;
  kind: SignedDiscoveredDevice["category"];
  meterAction: (formData: FormData) => Promise<void>;
  selectedSiteId: string | null;
  solarProviderAction: (formData: FormData) => Promise<void>;
}) {
  if (devices.length === 0) {
    return (
      <p className="text-sm leading-6 text-slate-400">
        No {formatDiscoveryEmptyLabel(kind)} discovered in the latest scan.
      </p>
    );
  }

  return (
    <div className="grid gap-3">
      {devices.map((device) => (
        <DiscoveryDeviceCard
          batteryAction={batteryAction}
          device={device}
          existingIdSet={existingIdSet}
          host={host}
          key={device.discoveryId}
          meterAction={meterAction}
          selectedSiteId={selectedSiteId}
          solarProviderAction={solarProviderAction}
        />
      ))}
    </div>
  );
}

function DiscoveryDeviceCard({
  batteryAction,
  device,
  existingIdSet,
  host,
  meterAction,
  selectedSiteId,
  solarProviderAction,
}: {
  batteryAction: (formData: FormData) => Promise<void>;
  device: SignedDiscoveredDevice;
  existingIdSet: Set<string>;
  host: string;
  meterAction: (formData: FormData) => Promise<void>;
  selectedSiteId: string | null;
  solarProviderAction: (formData: FormData) => Promise<void>;
}) {
  const alreadyAdded = existingIdSet.has(device.discoveryId);

  return (
    <article
      className={`relative overflow-hidden rounded-[1.4rem] border border-white/10 bg-white/5 p-4 ${
        alreadyAdded
          ? "opacity-60"
          : device.category === "battery"
            ? "ring-1 ring-cyan-300/5"
            : device.category === "meter"
              ? "ring-1 ring-violet-300/5"
              : "ring-1 ring-amber-300/5"
      }`}
      data-matched-card
    >
      <div
        className={`pointer-events-none absolute inset-x-0 top-0 h-px ${device.category === "battery" ? "bg-gradient-to-r from-transparent via-cyan-300/40 to-transparent" : device.category === "meter" ? "bg-gradient-to-r from-transparent via-violet-300/40 to-transparent" : "bg-gradient-to-r from-transparent via-amber-300/40 to-transparent"}`}
      />
      <div className="flex h-full flex-col" data-matched-card-content>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="break-words text-base font-semibold text-white">
              {device.name}
            </h3>
            <p className="mt-1 break-all text-xs text-slate-400">
              {device.discoveryId}
            </p>
          </div>
        </div>

        <dl className="mt-4 grid flex-1 content-start gap-3 text-sm text-slate-300 sm:grid-cols-2">
          <DiscoveryMetaItem label="Model" value={device.model} />
          <DiscoveryMetaItem
            label="Address"
            value={formatDiscoveryAddress(device)}
          />
          {device.category === "battery" ? (
            <DiscoveryMetaItem
              label="SoC"
              value={
                isFiniteNumber(device.socPercent)
                  ? `${Math.round(device.socPercent)}%`
                  : "Unavailable"
              }
            />
          ) : null}
          {device.category === "battery" ? (
            <DiscoveryMetaItem
              label="Capacity"
              value={formatDiscoveryCapacity(device.capacityWh)}
            />
          ) : null}
          <DiscoveryMetaItem
            label="Power"
            value={
              isFiniteNumber(device.powerW)
                ? `${Math.round(device.powerW)} W`
                : "Unavailable"
            }
          />
          {device.category === "battery" ? (
            <DiscoveryMetaItem
              label="Backup reserve"
              value={`${DEFAULT_BATTERY_BACKUP_RESERVE_PERCENT}%`}
            />
          ) : null}
        </dl>

        {!alreadyAdded && selectedSiteId ? (
          <div className="mt-auto pt-4">
            <form
              action={
                device.category === "battery"
                  ? batteryAction
                  : device.category === "meter"
                    ? meterAction
                    : solarProviderAction
              }
            >
              <input type="hidden" name="siteId" value={selectedSiteId} />
              <input
                type="hidden"
                name="discoveryDevice"
                value={JSON.stringify(device)}
              />
              <SubmitButton className={secondaryButtonClass}>
                {device.category === "battery" ? (
                  <>
                    <BatteryCharging aria-hidden="true" className="h-4 w-4" />
                    Add battery
                  </>
                ) : device.category === "meter" ? (
                  <>
                    <Gauge aria-hidden="true" className="h-4 w-4" />
                    Add meter
                  </>
                ) : (
                  <>
                    <SunMedium aria-hidden="true" className="h-4 w-4" />
                    Add solar energy provider
                  </>
                )}
              </SubmitButton>
            </form>
          </div>
        ) : null}
      </div>
    </article>
  );
}

function isFiniteNumber(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function DiscoveryMetaItem({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0 rounded-2xl border border-white/8 bg-slate-950/55 px-3 py-2">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
        {label}
      </dt>
      <dd className="mt-1 break-all text-sm text-slate-100">{value}</dd>
    </div>
  );
}

function formatDiscoveryCapacity(capacityWh: number | null): string {
  if (!isFiniteNumber(capacityWh)) {
    return "Unavailable";
  }

  return formatKilowattHoursFromWh(capacityWh);
}

function PluginTypeIcon({
  className,
  type,
  ...props
}: ComponentProps<"svg"> & {
  type: (typeof SUPPORTED_PLUGIN_TYPES)[number];
}) {
  const Icon =
    type === "Battery"
      ? BatteryCharging
      : type === "Meter"
        ? Gauge
        : type === "Price"
          ? HandCoins
          : SunMedium;

  return <Icon className={className} {...props} />;
}

function formatDiscoveryCategoryLabel(
  category: SignedDiscoveredDevice["category"],
): string {
  if (category === "solar-energy-provider") {
    return "solar provider";
  }

  return category;
}

function compareDiscoveryDevices(
  left: SignedDiscoveredDevice,
  right: SignedDiscoveredDevice,
): number {
  const order = {
    battery: 0,
    "solar-energy-provider": 1,
    meter: 2,
  } as const;

  const kindDifference = order[left.category] - order[right.category];

  if (kindDifference !== 0) {
    return kindDifference;
  }

  return left.name.localeCompare(right.name);
}

function formatDiscoveryAddress(device: SignedDiscoveredDevice): string {
  return typeof device.port === "number"
    ? `${device.ipAddress}:${device.port}`
    : device.ipAddress;
}

function formatDiscoveryEmptyLabel(
  category: SignedDiscoveredDevice["category"],
): string {
  if (category === "battery") {
    return "batteries";
  }

  if (category === "solar-energy-provider") {
    return "solar energy providers";
  }

  return "meters";
}

function formatPluginStatus(status: SupportedPluginStatus) {
  if (status === "working") {
    return {
      emoji: "✅",
      label: "Working",
      className:
        "inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-100",
    };
  }

  if (status === "untested") {
    return {
      emoji: "❓",
      label: "Untested",
      className:
        "inline-flex items-center gap-2 rounded-full border border-amber-400/20 bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-100",
    };
  }

  if (status === "incomplete") {
    return {
      emoji: "🚧",
      label: "Incomplete",
      className:
        "inline-flex items-center gap-2 rounded-full border border-yellow-400/20 bg-yellow-500/10 px-2.5 py-1 text-xs font-semibold text-yellow-100",
    };
  }

  return {
    emoji: "❌",
    label: "Issues",
    className:
      "inline-flex items-center gap-2 rounded-full border border-rose-400/20 bg-rose-500/10 px-2.5 py-1 text-xs font-semibold text-rose-100",
  };
}
