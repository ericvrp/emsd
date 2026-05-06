"use client";

import {
  BatteryCharging,
  Gauge,
  LoaderCircle,
  Plus,
  ScanSearch,
  SunMedium,
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  createAllFromDiscoveryAction,
  createBatteryFromDiscoveryAction,
  createMeterFromDiscoveryAction,
  createSolarEnergyProviderFromDiscoveryAction,
} from "../app/actions";
import type { SignedDiscoveredDevice } from "../lib/discovery-proof";
import { UI_STYLES } from "../lib/ui-colors";
import { SubmitButton } from "./submit-button";
import { useFormActionToast } from "./use-form-action-toast";

interface DiscoveryCachePayload {
  version: number;
  devices: SignedDiscoveredDevice[];
  host: string;
}

const DISCOVERY_CACHE_PREFIX = "emsd-discovery:";
const DISCOVERY_CACHE_VERSION = 4;

const primaryButtonClass = UI_STYLES.buttonPrimary;

const secondaryButtonClass = UI_STYLES.buttonSecondary;
const DEFAULT_BATTERY_BACKUP_RESERVE_PERCENT = 10;

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

          <section className="grid gap-4 xl:grid-cols-3">
            <DiscoveryResourceSection title="Batteries">
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
            <DiscoveryResourceSection title="Solar Providers">
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
            <DiscoveryResourceSection title="Meters">
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

function DiscoveryResourceSection({
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
      className={`relative flex min-h-[440px] flex-col overflow-hidden rounded-[1.4rem] border border-white/10 bg-white/5 p-4 ${
        alreadyAdded
          ? "opacity-60"
          : device.category === "battery"
            ? "ring-1 ring-cyan-300/5"
            : device.category === "meter"
              ? "ring-1 ring-violet-300/5"
              : "ring-1 ring-amber-300/5"
      }`}
    >
      <div
        className={`pointer-events-none absolute inset-x-0 top-0 h-px ${device.category === "battery" ? "bg-gradient-to-r from-transparent via-cyan-300/40 to-transparent" : device.category === "meter" ? "bg-gradient-to-r from-transparent via-violet-300/40 to-transparent" : "bg-gradient-to-r from-transparent via-amber-300/40 to-transparent"}`}
      />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold text-white">
            {device.name}
          </h3>
          <p className="mt-1 truncate text-xs text-slate-400">
            {device.discoveryId}
          </p>
        </div>
        <span
          className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${device.category === "battery" ? "border-cyan-400/20 bg-cyan-500/10 text-cyan-100" : device.category === "meter" ? "border-violet-400/20 bg-violet-500/10 text-violet-100" : "border-amber-400/20 bg-amber-500/10 text-amber-100"}`}
        >
          {formatDiscoveryCategoryLabel(device.category)}
        </span>
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
          <DiscoveryMetaItem label="Capacity" value="Unavailable" />
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

      <div className="mt-4">
        {!alreadyAdded && selectedSiteId ? (
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
    <div className="rounded-2xl border border-white/8 bg-slate-950/55 px-3 py-2">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-slate-100">{value}</dd>
    </div>
  );
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
