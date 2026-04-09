"use client";

import {
  BatteryCharging,
  Gauge,
  LoaderCircle,
  Plus,
  ScanSearch,
  SunMedium,
} from "lucide-react";
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

interface DiscoveryCachePayload {
  version: number;
  devices: SignedDiscoveredDevice[];
  host: string;
}

const DISCOVERY_CACHE_PREFIX = "emsd-discovery:";
const DISCOVERY_CACHE_VERSION = 3;

const primaryButtonClass = UI_STYLES.buttonPrimary;

const secondaryButtonClass = UI_STYLES.buttonSecondary;

export function DiscoveryPanel({
  existingDeviceIds,
  selectedSiteId,
}: {
  existingDeviceIds: string[];
  selectedSiteId: string | null;
}) {
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
            <form
              action={createAllFromDiscoveryAction}
              className="flex justify-start"
            >
              <input type="hidden" name="siteId" value={selectedSiteId} />
              <input
                type="hidden"
                name="discoveryDevices"
                value={JSON.stringify(
                  devices.filter((device) =>
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

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {devices.map((device) => (
              <DiscoveryDeviceCard
                device={device}
                existingIdSet={existingIdSet}
                host={host.trim()}
                key={device.discoveryId}
                selectedSiteId={selectedSiteId}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function DiscoveryDeviceCard({
  device,
  existingIdSet,
  host,
  selectedSiteId,
}: {
  device: SignedDiscoveredDevice;
  existingIdSet: Set<string>;
  host: string;
  selectedSiteId: string | null;
}) {
  const alreadyAdded = existingIdSet.has(device.discoveryId);

  return (
    <article
      className={`relative flex h-full flex-col overflow-hidden rounded-[1.6rem] border p-4 shadow-[0_16px_60px_rgba(0,0,0,0.22)] ${
        alreadyAdded
          ? "border-white/6 bg-slate-950/35 opacity-60"
          : "border-white/10 bg-slate-950/60"
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

      <div
        className={`mt-4 flex-1 space-y-2 rounded-2xl border p-3 text-sm ${
          alreadyAdded
            ? "border-white/6 bg-white/3 text-slate-400"
            : "border-white/8 bg-white/4 text-slate-300"
        }`}
      >
        <p>
          <span className="text-slate-500">Model:</span> {device.model}
        </p>
        <p>
          <span className="text-slate-500">Address:</span> {device.ipAddress}
        </p>
        {device.state ? (
          <p>
            <span className="text-slate-500">State:</span>{" "}
            {formatDiscoveryState(device.state)}
          </p>
        ) : null}
        {device.category === "battery" && isFiniteNumber(device.socPercent) ? (
          <p>
            <span className="text-slate-500">SoC:</span>{" "}
            {Math.round(device.socPercent)}%
          </p>
        ) : null}
        {isFiniteNumber(device.powerW) ? (
          <p>
            <span className="text-slate-500">Power:</span>{" "}
            {Math.round(device.powerW)} W
          </p>
        ) : null}
      </div>

      <div className="mt-4">
        {!alreadyAdded && selectedSiteId ? (
          <form
            action={
              device.category === "battery"
                ? createBatteryFromDiscoveryAction
                : device.category === "meter"
                  ? createMeterFromDiscoveryAction
                  : createSolarEnergyProviderFromDiscoveryAction
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

function formatDiscoveryState(
  state: "idle" | "charging" | "discharging" | "connected" | "offline" | null,
): string {
  return state ? state.replace(/-/g, " ") : "";
}

function formatDiscoveryCategoryLabel(
  category: SignedDiscoveredDevice["category"],
): string {
  if (category === "solar-energy-provider") {
    return "solar provider";
  }

  return category;
}
