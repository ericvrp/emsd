"use client";

import type {
  DynamicPriceSourceRecord,
  ManagedDeviceStatusRecord,
  SiteRecord,
  WeatherForecastSourceRecord,
} from "@emsd/core";
import { HardDrive, Home, LocateFixed, Save, ScanSearch, Search, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import {
  createDynamicPriceSourceAction,
  createSiteAction,
  createWeatherForecastSourceAction,
  deleteBatteryAction,
  deleteDynamicPriceSourceAction,
  deleteMeterAction,
  deleteSiteAction,
  deleteWeatherForecastSourceAction,
  updateDynamicPriceSourceAction,
  updateSiteAction,
  updateWeatherForecastSourceAction,
} from "../app/actions";
import { DiscoveryPanel } from "./discovery-panel";
import { SubmitButton } from "./submit-button";
import { ToastOnSearchParams } from "./toast-on-search-params";
import { Button } from "./ui/button";

type SettingsTab = "devices" | "site" | "discover";

function formatManagedDeviceState(state: string): string {
  return state.replace(/-/g, " ");
}

const primaryButtonClass =
  "inline-flex h-9 items-center justify-center gap-2 rounded-md bg-gradient-to-r from-indigo-500 via-cyan-500 to-emerald-400 px-4 text-sm font-medium text-slate-950 shadow-[0_18px_50px_rgba(6,182,212,0.18)] transition hover:brightness-110";
const secondaryButtonClass =
  "inline-flex h-9 items-center justify-center gap-2 rounded-md border border-white/10 bg-white/6 px-4 text-sm font-medium text-slate-100 transition hover:border-white/20 hover:bg-white/10";
const dangerButtonClass =
  "inline-flex h-9 items-center justify-center gap-2 rounded-md border border-rose-400/20 bg-rose-500/10 px-4 text-sm font-medium text-rose-100 transition hover:bg-rose-500/15";

export function SettingsPanel({
  currentSite,
  initialTab,
  notice,
  tone,
}: {
  currentSite: SiteSnapshot | null;
  initialTab: string | null;
  notice: string | null;
  tone: "error" | "success";
}) {
  const [activeTab, setActiveTab] = useState<SettingsTab>(
    resolveTab(initialTab, Boolean(currentSite)),
  );

  return (
    <div className="space-y-4">
      <ToastOnSearchParams notice={notice} tone={tone} />

      <section className="rounded-[1.6rem] border border-white/10 bg-slate-950/55 p-3 shadow-[0_20px_90px_rgba(0,0,0,0.25)] backdrop-blur">
        <div className="grid gap-2 sm:grid-cols-3">
          {(["devices", "site", "discover"] as SettingsTab[]).map((tab) => (
            <button
              key={tab}
              className={`inline-flex h-9 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium transition ${
                activeTab === tab
                  ? "border border-cyan-300/30 bg-gradient-to-r from-cyan-300 via-white to-emerald-200 !text-slate-950 shadow-[0_12px_40px_rgba(125,211,252,0.22)] [&_svg]:!text-slate-950"
                  : "border border-white/8 bg-white/5 text-slate-200 hover:bg-white/8"
              }`}
              onClick={() => setActiveTab(tab)}
              type="button"
            >
              {tab === "devices" ? (
                <HardDrive size={15} />
              ) : tab === "site" ? (
                <Home size={15} />
              ) : (
                <ScanSearch size={15} />
              )}
              {tab === "devices"
                ? "Devices"
                : tab === "site"
                  ? "Site"
                  : "Discover"}
            </button>
          ))}
        </div>
      </section>

      {activeTab === "devices" ? (
        currentSite ? (
          <>
            <section className="relative overflow-hidden rounded-[1.75rem] border border-white/10 bg-slate-950/55 p-5 shadow-[0_20px_90px_rgba(0,0,0,0.25)] backdrop-blur">
              <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-300/40 to-transparent" />
              <h2 className="text-2xl font-semibold text-white">
                {currentSite.name}
              </h2>
            </section>

            <section className="grid gap-4 xl:grid-cols-2">
              <ResourceSection
                title="Batteries"
                description="Manage installed batteries."
              >
                <DeviceList kind="battery" site={currentSite} />
              </ResourceSection>
              <ResourceSection
                title="Meters"
                description="Manage installed meters."
              >
                <DeviceList kind="meter" site={currentSite} />
              </ResourceSection>
              <ResourceSection
                title="Weather Sources"
                description="Manage forecast providers."
              >
                <SourceList
                  kind="weather"
                  records={currentSite.weatherSources}
                  site={currentSite}
                  titleLabel="Weather source"
                />
              </ResourceSection>
              <ResourceSection
                title="Dynamic Price Sources"
                description="Manage tariff providers."
              >
                <SourceList
                  kind="price"
                  records={currentSite.dynamicPriceSources}
                  site={currentSite}
                  titleLabel="Dynamic price source"
                />
              </ResourceSection>
            </section>
          </>
        ) : (
          <SiteSetupPanel />
        )
      ) : null}

      {activeTab === "site" ? <SitePanel site={currentSite} /> : null}

      {activeTab === "discover" ? (
        currentSite ? (
          <section className="relative overflow-hidden rounded-[1.75rem] border border-white/10 bg-slate-950/55 p-5 shadow-[0_20px_90px_rgba(0,0,0,0.25)] backdrop-blur">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/40 to-transparent" />
            <div className="mb-5">
              <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-300/90">
                <ScanSearch size={13} />
                Discover
              </p>
              <h2 className="mt-2 text-2xl font-semibold text-white">
                Find and add batteries and meters
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                Scan once and add devices one by one or all at once.
              </p>
            </div>
            <DiscoveryPanel
              existingDeviceIds={currentSite.devices.map((device) => device.id)}
              selectedSiteId={currentSite.id}
            />
          </section>
        ) : (
          <SiteSetupPanel />
        )
      ) : null}
    </div>
  );
}

function resolveTab(tab: string | null, hasSite: boolean): SettingsTab {
  if (!hasSite) {
    return "site";
  }

  return tab === "site" || tab === "discover" ? tab : "devices";
}

function formatGpsCoordinate(latitude: number, longitude: number): string {
  return `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
}

function SiteSetupPanel() {
  return (
    <section className="relative overflow-hidden rounded-[1.75rem] border border-white/10 bg-slate-950/55 p-5 shadow-[0_20px_90px_rgba(0,0,0,0.25)] backdrop-blur">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-300/40 to-transparent" />
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
        action={createSiteAction}
        className="space-y-4 rounded-[1.4rem] border border-white/10 bg-white/5 p-4"
      >
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

function SitePanel({ site }: { site: SiteSnapshot | null }) {
  if (!site) {
    return <SiteSetupPanel />;
  }

  return (
    <section className="relative overflow-hidden rounded-[1.75rem] border border-white/10 bg-slate-950/55 p-5 shadow-[0_20px_90px_rgba(0,0,0,0.25)] backdrop-blur">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-300/40 to-transparent" />
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-emerald-300/90">
          Current Site
        </p>
        <h2 className="mt-2 text-2xl font-semibold text-white">{site.name}</h2>
        <p className="mt-1 text-sm text-slate-400">{site.id}</p>
        <p className="mt-2 text-sm text-slate-300">GPS: {site.location || "Unavailable"}</p>
      </div>

      <div className="mt-5">
        <form
          action={updateSiteAction}
          className="space-y-4 rounded-[1.4rem] border border-white/10 bg-white/5 p-4"
          id={`site-update-${site.id}`}
        >
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
          <form action={deleteSiteAction}>
            <input type="hidden" name="siteId" value={site.id} />
            <SubmitButton className={dangerButtonClass}>
              <Trash2 size={14} />
              Delete site
            </SubmitButton>
          </form>
        </div>
      </div>
    </section>
  );
}

function SiteLocationFields({ defaultLocation }: { defaultLocation: string }) {
  const [location, setLocation] = useState(defaultLocation);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [statusTone, setStatusTone] = useState<"error" | "success" | null>(null);
  const [isLocating, setIsLocating] = useState(false);
  const [isSearching, setIsSearching] = useState(false);

  async function lookupLocation() {
    const trimmedQuery = query.trim();

    if (!trimmedQuery) {
      setStatus("Enter a place name to look up.");
      setStatusTone("error");
      return;
    }

    setIsSearching(true);
    setStatus(null);

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
      setStatus(`Resolved '${trimmedQuery}' to ${payload.location}.`);
      setStatusTone("success");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      setStatusTone("error");
    } finally {
      setIsSearching(false);
    }
  }

  function useCurrentLocation() {
    if (!("geolocation" in navigator)) {
      setStatus("Browser geolocation is not available here.");
      setStatusTone("error");
      return;
    }

    setIsLocating(true);
    setStatus(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const nextLocation = formatGpsCoordinate(
          position.coords.latitude,
          position.coords.longitude,
        );

        setLocation(nextLocation);
        setStatus(`Using current GPS location ${nextLocation}.`);
        setStatusTone("success");
        setIsLocating(false);
      },
      (error) => {
        setStatus(error.message || "Unable to read the current GPS location.");
        setStatusTone("error");
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
          Store the site as `latitude, longitude` using Google Maps style coordinates.
        </p>
      </label>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto_auto] lg:items-end">
        <label className="block space-y-2">
          <span className="text-sm font-medium text-slate-300">Place lookup</span>
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

      {status ? (
        <p
          className={`text-sm ${statusTone === "error" ? "text-rose-300" : "text-emerald-300"}`}
        >
          {status}
        </p>
      ) : null}
    </div>
  );
}

function ResourceSection({
  title,
  description,
  children,
}: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="relative overflow-hidden rounded-[1.75rem] border border-white/10 bg-slate-950/55 p-5 shadow-[0_20px_90px_rgba(0,0,0,0.25)] backdrop-blur">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-violet-300/30 to-transparent" />
      <div className="mb-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
          Resource
        </p>
        <h3 className="mt-2 text-xl font-semibold text-white">{title}</h3>
        <p className="mt-2 text-sm leading-6 text-slate-400">{description}</p>
      </div>
      {children}
    </section>
  );
}

function DeviceList({
  site,
  kind,
}: { site: SiteSnapshot; kind: "battery" | "meter" }) {
  const devices = site.devices.filter((device) => device.kind === kind);

  if (devices.length === 0) {
    return (
      <p className="text-sm leading-6 text-slate-400">
        No {kind === "battery" ? "batteries" : "meters"} configured yet.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {devices.map((device) => {
        const currentState = device.telemetry?.state ?? device.state;

        return (
          <article
            key={device.id}
            className={`rounded-[1.4rem] border border-white/10 bg-white/5 p-4 ${kind === "battery" ? "ring-1 ring-cyan-300/5" : "ring-1 ring-violet-300/5"}`}
          >
            <div className="min-w-0">
              <h4 className="truncate text-base font-semibold text-white">
                {device.name}
              </h4>
              <p className="mt-1 truncate text-xs text-slate-400">
                {device.id}
              </p>
            </div>
            <dl className="mt-4 grid gap-3 text-sm text-slate-300 sm:grid-cols-2">
              <MetaItem label="Model" value={device.model} />
              <MetaItem label="Address" value={device.address} />
              <MetaItem
                label="State"
                value={formatManagedDeviceState(currentState)}
              />
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
              <MetaItem
                label="Power"
                value={
                  device.telemetry?.powerW !== null &&
                  device.telemetry?.powerW !== undefined
                    ? `${Math.round(device.telemetry.powerW)} W`
                    : "Unavailable"
                }
              />
            </dl>
            <div className="mt-4 flex flex-wrap gap-2">
              <form
                action={
                  kind === "battery" ? deleteBatteryAction : deleteMeterAction
                }
              >
                <input type="hidden" name="siteId" value={site.id} />
                <input
                  type="hidden"
                  name={kind === "battery" ? "batteryId" : "meterId"}
                  value={device.id}
                />
                <SubmitButton className={dangerButtonClass}>
                  <Trash2 size={14} />
                  Delete
                </SubmitButton>
              </form>
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
  return (
    <>
      <form
        action={
          kind === "weather"
            ? createWeatherForecastSourceAction
            : createDynamicPriceSourceAction
        }
        className="space-y-4 rounded-[1.4rem] border border-white/10 bg-white/5 p-4"
      >
        <input type="hidden" name="siteId" value={site.id} />
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
        <SubmitButton className={primaryButtonClass}>
          {kind === "weather" ? "Add weather source" : "Add price source"}
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
              </div>
              <form
                action={
                  kind === "weather"
                    ? updateWeatherForecastSourceAction
                    : updateDynamicPriceSourceAction
                }
                className="mt-4 space-y-3"
              >
                <input type="hidden" name="siteId" value={site.id} />
                <input type="hidden" name="sourceId" value={record.id} />
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
                  <SubmitButton className={secondaryButtonClass}>
                    Save
                  </SubmitButton>
                </div>
              </form>
              <form
                action={
                  kind === "weather"
                    ? deleteWeatherForecastSourceAction
                    : deleteDynamicPriceSourceAction
                }
                className="mt-2"
              >
                <input type="hidden" name="siteId" value={site.id} />
                <input type="hidden" name="sourceId" value={record.id} />
                <SubmitButton className={dangerButtonClass}>
                  Delete
                </SubmitButton>
              </form>
            </article>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-sm leading-6 text-slate-400">
          No {kind === "weather" ? "weather" : "dynamic price"} sources
          configured yet.
        </p>
      )}
    </>
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
