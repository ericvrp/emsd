"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  createAllFromDiscoveryAction,
  createBatteryFromDiscoveryAction,
  createMeterFromDiscoveryAction,
} from "../app/actions";
import { SubmitButton } from "./submit-button";

interface DiscoveredDevice {
  category: "battery" | "meter";
  details: string;
  discoveryId: string;
  ipAddress: string;
  model: string;
  name: string;
  powerW: number | null;
  socPercent: number | null;
  state: "idle" | "charging" | "discharging" | "connected" | "offline" | null;
}

interface DiscoveryCachePayload {
  version: number;
  devices: DiscoveredDevice[];
  host: string;
}

const DISCOVERY_CACHE_PREFIX = "emsd-discovery:";
const DISCOVERY_CACHE_VERSION = 2;

const primaryButtonClass =
  "inline-flex items-center justify-center rounded-2xl bg-gradient-to-r from-indigo-500 via-cyan-500 to-emerald-400 px-4 py-2.5 text-sm font-semibold text-slate-950 shadow-[0_18px_50px_rgba(6,182,212,0.18)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60";

const secondaryButtonClass =
  "inline-flex items-center justify-center rounded-2xl border border-white/10 bg-white/6 px-4 py-2.5 text-sm font-semibold text-slate-100 transition hover:border-white/20 hover:bg-white/10";

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
  const [devices, setDevices] = useState<DiscoveredDevice[]>([]);
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

  function persistDiscovery(nextDevices: DiscoveredDevice[], nextHost: string) {
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

      const payload = (await response.json()) as DiscoveredDevice[];
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
          {isLoading
            ? "Scanning..."
            : host.trim()
              ? "Probe host"
              : "Scan network"}
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
              ? "Run discovery to see reachable batteries and meters."
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
              <input type="hidden" name="host" value={host.trim()} />
              <input
                type="hidden"
                name="discoveryIds"
                value={JSON.stringify(addableDiscoveryIds)}
              />
              <SubmitButton
                className={primaryButtonClass}
              >{`Add all (${addableDiscoveryIds.length})`}</SubmitButton>
            </form>
          ) : (
            <button className={secondaryButtonClass} disabled type="button">
              All discovered devices are already added
            </button>
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
  device: DiscoveredDevice;
  existingIdSet: Set<string>;
  host: string;
  selectedSiteId: string | null;
}) {
  const alreadyAdded = existingIdSet.has(device.discoveryId);

  return (
    <article className="relative overflow-hidden rounded-[1.6rem] border border-white/10 bg-slate-950/60 p-4 shadow-[0_16px_60px_rgba(0,0,0,0.22)]">
      <div
        className={`pointer-events-none absolute inset-x-0 top-0 h-px ${device.category === "battery" ? "bg-gradient-to-r from-transparent via-cyan-300/40 to-transparent" : "bg-gradient-to-r from-transparent via-violet-300/40 to-transparent"}`}
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
          className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${device.category === "battery" ? "border-cyan-400/20 bg-cyan-500/10 text-cyan-100" : "border-violet-400/20 bg-violet-500/10 text-violet-100"}`}
        >
          {device.category}
        </span>
      </div>

      <div className="mt-4 space-y-2 rounded-2xl border border-white/8 bg-white/4 p-3 text-sm text-slate-300">
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
        {alreadyAdded ? (
          <button
            className="inline-flex w-full items-center justify-center rounded-2xl border border-white/10 bg-white/6 px-4 py-2.5 text-sm font-semibold text-slate-300"
            disabled
            type="button"
          >
            Already added
          </button>
        ) : selectedSiteId ? (
          <form
            action={
              device.category === "battery"
                ? createBatteryFromDiscoveryAction
                : createMeterFromDiscoveryAction
            }
          >
            <input type="hidden" name="siteId" value={selectedSiteId} />
            <input
              type="hidden"
              name="discoveryId"
              value={device.discoveryId}
            />
            <input type="hidden" name="host" value={host} />
            <SubmitButton className={secondaryButtonClass}>
              {device.category === "battery" ? "Add battery" : "Add meter"}
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
