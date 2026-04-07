"use client";

import type {
  DynamicPricePointRecord,
  DynamicPriceSnapshotRecord,
  DynamicPriceSourceRecord,
  ManagedDeviceStatusRecord,
  SiteRecord,
  WeatherForecastRecord,
  WeatherForecastPointRecord,
  WeatherForecastSourceRecord,
} from "@emsd/core";
import { HardDrive, Home, LocateFixed, Save, ScanSearch, Search, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import {
  createDynamicPriceSourceAction,
  createSiteAction,
  createWeatherForecastSourceAction,
  deleteBatteryAction,
  deleteDynamicPriceSourceAction,
  deleteMeterAction,
  deleteSiteAction,
  deleteWeatherForecastSourceAction,
  setBatteryMinimumDischargePercentAction,
  updateDynamicPriceSourceAction,
  updateSiteAction,
  updateWeatherForecastSourceAction,
} from "../app/actions";
import { DiscoveryPanel } from "./discovery-panel";
import { SubmitButton } from "./submit-button";
import { ToastOnSearchParams } from "./toast-on-search-params";
import { Button } from "./ui/button";

type SettingsTab = "devices" | "forecast" | "pricing" | "site" | "discover";

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
  dynamicPriceSnapshot,
  dynamicPriceSnapshotError,
  initialTab,
  notice,
  tone,
  weatherForecast,
  weatherForecastError,
}: {
  currentSite: SiteSnapshot | null;
  dynamicPriceSnapshot: DynamicPriceSnapshotRecord | null;
  dynamicPriceSnapshotError: string | null;
  initialTab: string | null;
  notice: string | null;
  tone: "error" | "success";
  weatherForecast: WeatherForecastRecord | null;
  weatherForecastError: string | null;
}) {
  const [activeTab, setActiveTab] = useState<SettingsTab>(
    resolveTab(initialTab, Boolean(currentSite)),
  );

  return (
    <div className="space-y-4">
      <ToastOnSearchParams notice={notice} tone={tone} />

      <section className="rounded-[1.6rem] border border-white/10 bg-slate-950/55 p-3 shadow-[0_20px_90px_rgba(0,0,0,0.25)] backdrop-blur">
        <div className="grid gap-2 sm:grid-cols-5">
          {([
            "site",
            "devices",
            "forecast",
            "pricing",
            "discover",
          ] as SettingsTab[]).map((tab) => (
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
              ) : tab === "forecast" ? (
                <Search size={15} />
              ) : tab === "pricing" ? (
                <Save size={15} />
              ) : (
                <ScanSearch size={15} />
              )}
              {tab === "devices"
                ? "Devices"
                : tab === "forecast"
                  ? "Forecast"
                  : tab === "pricing"
                    ? "Pricing"
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
              <ResourceSection title="Batteries">
                <DeviceList kind="battery" site={currentSite} />
              </ResourceSection>
              <ResourceSection title="Meters">
                <DeviceList kind="meter" site={currentSite} />
              </ResourceSection>
            </section>
          </>
        ) : (
          <SiteSetupPanel />
        )
      ) : null}

      {activeTab === "forecast" ? (
        currentSite ? (
          <WeatherForecastSection
            error={weatherForecastError}
            forecast={weatherForecast}
            site={currentSite}
            source={currentSite.weatherSources[0] ?? null}
          />
        ) : (
          <SiteSetupPanel />
        )
      ) : null}

      {activeTab === "pricing" ? (
        currentSite ? (
          <PricingSection
            error={dynamicPriceSnapshotError}
            site={currentSite}
            snapshot={dynamicPriceSnapshot}
            source={currentSite.dynamicPriceSources[0] ?? null}
          />
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

  return tab === "site" || tab === "discover" || tab === "forecast" || tab === "pricing"
    ? tab
    : "devices";
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

  const batteries = site.devices.filter((device) => device.kind === "battery");
  const meters = site.devices.filter((device) => device.kind === "meter");
  const deletionBlockers = [
    formatNamedBlocker("battery", batteries.map((device) => device.name)),
    formatNamedBlocker("meter", meters.map((device) => device.name)),
    formatNamedBlocker(
      "dynamic price source",
      site.dynamicPriceSources.map((source) => source.name),
    ),
  ].filter((value): value is string => value !== null);
  const deleteBlocked = deletionBlockers.length > 0;

  return (
    <section className="relative overflow-hidden rounded-[1.75rem] border border-white/10 bg-slate-950/55 p-5 shadow-[0_20px_90px_rgba(0,0,0,0.25)] backdrop-blur">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-300/40 to-transparent" />
      <div>
        <h2 className="text-2xl font-semibold text-white">{site.name}</h2>
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
        {deleteBlocked ? (
          <div className="mt-4 rounded-[1.25rem] border border-amber-400/20 bg-amber-500/10 p-4 text-sm text-amber-100">
            You cannot delete this site until you remove {joinWithAnd(deletionBlockers)}.
          </div>
        ) : null}
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
            <input type="hidden" name="siteName" value={site.name} />
            <Button className={dangerButtonClass} disabled={deleteBlocked} type="submit">
              <Trash2 size={14} />
              Delete site
            </Button>
          </form>
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
        toast.error(error.message || "Unable to read the current GPS location.");
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
    </div>
  );
}

function WeatherForecastSection({
  site,
  forecast,
  error,
  source,
}: {
  site: SiteSnapshot;
  forecast: WeatherForecastRecord | null;
  error: string | null;
  source: WeatherForecastSourceRecord | null;
}) {
  const visiblePoints = forecast
    ? selectForecastPoints({
        generatedAt: forecast.generatedAt,
        horizonHours: 48,
        points: forecast.points,
        sampleRateMinutes: 15,
        sourcePeriodMinutes: forecast.periodMinutes,
      })
    : [];

  return (
    <section className="relative overflow-hidden rounded-[1.75rem] border border-white/10 bg-slate-950/55 p-5 shadow-[0_20px_90px_rgba(0,0,0,0.25)] backdrop-blur">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-sky-300/40 to-transparent" />
      <div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-sky-300/90">
            Forecast
          </p>
          <h3 className="mt-2 text-xl font-semibold text-white">
            Solar forecast for {site.name}
          </h3>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            Open-Meteo provides the built-in ground sunlight forecast for this site.
          </p>
        </div>
      </div>

      {site.location.trim().length === 0 ? (
        <p className="mt-4 rounded-[1.25rem] border border-amber-400/20 bg-amber-500/10 p-4 text-sm text-amber-100">
          Add a GPS location on the Site tab to load a solar forecast.
        </p>
      ) : source === null ? (
        <p className="mt-4 text-sm leading-6 text-slate-400">
          Save the site once to create the built-in forecast source.
        </p>
      ) : error ? (
        <p className="mt-4 rounded-[1.25rem] border border-amber-400/20 bg-amber-500/10 p-4 text-sm text-amber-100">
          {error}
        </p>
      ) : forecast === null ? (
        <p className="mt-4 text-sm leading-6 text-slate-400">
          Forecast data is not available yet.
        </p>
      ) : visiblePoints.length === 0 ? (
        <p className="mt-4 text-sm leading-6 text-slate-400">
          No forecast points were returned for this time range.
        </p>
      ) : (
        <div className="mt-5 space-y-4 rounded-[1.4rem] border border-white/10 bg-white/5 p-4">
          <ForecastChart
            metricLabel={forecast.metricLabel}
            points={visiblePoints}
            unitLabel={forecast.unitLabel}
          />
          <p className="text-xs text-slate-500">
            {`Showing the latest forecast snapshot for ${forecast.location}.`}
          </p>
        </div>
      )}
    </section>
  );
}

function PricingSection({
  site,
  snapshot,
  error,
  source,
}: {
  site: SiteSnapshot;
  snapshot: DynamicPriceSnapshotRecord | null;
  error: string | null;
  source: DynamicPriceSourceRecord | null;
}) {
  const visiblePoints = snapshot?.points ?? [];
  const [homeId, setHomeId] = useState(source?.homeId ?? "");
  const originalHomeId = source?.homeId ?? "";

  // Enable save button when:
  // 1. There's a homeId entered (not empty) AND it's different from original
  // 2. OR there was originally a homeId but now it's cleared (user wants to remove it)
  const isHomeIdChanged = homeId !== originalHomeId;
  const shouldEnableSave = isHomeIdChanged || (homeId.length > 0 && originalHomeId.length === 0);

  return (
    <section className="relative overflow-hidden rounded-[1.75rem] border border-white/10 bg-slate-950/55 p-5 shadow-[0_20px_90px_rgba(0,0,0,0.25)] backdrop-blur">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-violet-300/40 to-transparent" />
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-violet-300/90">
          Pricing
        </p>
        <h3 className="mt-2 text-xl font-semibold text-white">
          Dynamic electricity prices for {site.name}
        </h3>
        <p className="mt-2 text-sm leading-6 text-slate-400">
          Tibber provides the built-in dynamic price snapshot for this site.
        </p>
      </div>

      <form
        action={source ? updateDynamicPriceSourceAction : createDynamicPriceSourceAction}
        className="mt-5 space-y-4 rounded-[1.4rem] border border-white/10 bg-white/5 p-4"
      >
        <input type="hidden" name="siteId" value={site.id} />
        <input type="hidden" name="sourceId" value={source?.id ?? `price-${site.id}`} />
        <input type="hidden" name="name" value={source?.name ?? "Tibber dynamic price"} />
        <label className="block space-y-2">
          <span className="text-sm font-medium text-slate-300">
            Tibber home ID (optional)
          </span>
          <input
            className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-slate-100 outline-none transition focus:border-cyan-400/50"
            name="homeId"
            value={homeId}
            onChange={(e) => setHomeId(e.target.value)}
          />
        </label>
        <p className="text-xs text-slate-500">
          Leave this empty to use the first Tibber home from your account. Set `TIBBER_ACCESS_TOKEN` in the daemon environment.
        </p>
        <SubmitButton className={primaryButtonClass} disabled={!shouldEnableSave}>
          Save pricing settings
        </SubmitButton>
      </form>

      {error ? (
        <p className="mt-4 rounded-[1.25rem] border border-amber-400/20 bg-amber-500/10 p-4 text-sm text-amber-100">
          {error}
        </p>
      ) : snapshot === null ? (
        <p className="mt-4 text-sm leading-6 text-slate-400">
          Dynamic price data is not available yet.
        </p>
      ) : visiblePoints.length === 0 ? (
        <p className="mt-4 text-sm leading-6 text-slate-400">
          No price points were returned for this time range.
        </p>
      ) : (
        <div className="mt-5 space-y-4 rounded-[1.4rem] border border-white/10 bg-white/5 p-4">
          <PriceChart currency={snapshot.currency} points={visiblePoints} />
          <p className="text-xs text-slate-500">
            Showing the latest Tibber price snapshot for {site.name}.
          </p>
        </div>
      )}
    </section>
  );
}

function PriceChart({
  points,
  currency,
}: {
  points: DynamicPricePointRecord[];
  currency: string;
}) {
  const chartPoints = points.map((point) => ({
    ...point,
    timeLabel: formatForecastTimeLabel(point.startsAt),
  }));
  const values = points.map((point) => point.importPrice);
  const maxValue = Math.max(0.01, ...values);

  return (
    <div className="space-y-3">
      <div className="h-[260px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartPoints} margin={{ top: 16, right: 8, left: 8, bottom: 0 }}>
            <defs>
              <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="rgb(196,181,253)" stopOpacity={0.3}/>
                <stop offset="95%" stopColor="rgb(196,181,253)" stopOpacity={0}/>
              </linearGradient>
            </defs>
            <XAxis dataKey="timeLabel" tick={{ fill: "rgba(226,232,240,0.72)", fontSize: 12 }} axisLine={false} tickLine={false} minTickGap={30} />
            <YAxis hide domain={[0, 'dataMax']} />
            <Tooltip 
              contentStyle={{ backgroundColor: 'rgba(15, 23, 42, 0.9)', borderColor: 'rgba(255,255,255,0.1)', borderRadius: '8px', color: '#f8fafc' }}
              itemStyle={{ color: 'rgb(196,181,253)' }}
              formatter={(value: unknown) => [`${value} ${currency}/kWh`, 'Price']}
            />
            <Area type="monotone" dataKey="importPrice" stroke="rgb(196,181,253)" strokeWidth={3} fillOpacity={1} fill="url(#colorPrice)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>{`0 ${currency}/kWh`}</span>
        <span>{`${points.length > 0 ? points[points.length - 1]?.currency ?? currency : currency}/kWh max ${maxValue.toFixed(3)}`}</span>
      </div>
    </div>
  );
}

function ForecastChart({
  metricLabel,
  points,
  unitLabel,
}: {
  metricLabel: string;
  points: WeatherForecastPointRecord[];
  unitLabel: string;
}) {
  const chartPoints = points.map((point) => ({
    ...point,
    timeLabel: formatForecastTimeLabel(point.periodEnd),
  }));
  const values = points.map((point) => point.value ?? 0);
  const maxValue = Math.max(100, ...values);

  return (
    <div className="space-y-3">
      <div className="h-[260px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartPoints} margin={{ top: 16, right: 8, left: 8, bottom: 0 }}>
            <defs>
              <linearGradient id="colorForecast" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="rgb(125,211,252)" stopOpacity={0.3}/>
                <stop offset="95%" stopColor="rgb(125,211,252)" stopOpacity={0}/>
              </linearGradient>
            </defs>
            <XAxis dataKey="timeLabel" tick={{ fill: "rgba(226,232,240,0.72)", fontSize: 12 }} axisLine={false} tickLine={false} minTickGap={30} />
            <YAxis hide domain={[0, 'dataMax']} />
            <Tooltip 
              contentStyle={{ backgroundColor: 'rgba(15, 23, 42, 0.9)', borderColor: 'rgba(255,255,255,0.1)', borderRadius: '8px', color: '#f8fafc' }}
              itemStyle={{ color: 'rgb(125,211,252)' }}
              formatter={(value: unknown) => [`${value} ${unitLabel}`, metricLabel]}
            />
            <Area type="monotone" dataKey="value" stroke="rgb(125,211,252)" strokeWidth={3} fillOpacity={1} fill="url(#colorForecast)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>{`0 ${unitLabel}`}</span>
        <span>{`${formatForecastValue(maxValue)} ${unitLabel}`}</span>
      </div>
    </div>
  );
}

function formatForecastValue(value: number): string {
  return value >= 10 ? String(Math.round(value)) : value.toFixed(2);
}

function selectForecastPoints(input: {
  generatedAt: string;
  horizonHours: 24 | 48;
  points: WeatherForecastPointRecord[];
  sampleRateMinutes: 15 | 60;
  sourcePeriodMinutes: number;
}): WeatherForecastPointRecord[] {
  const generatedAt = new Date(input.generatedAt).getTime();
  const cutoff = generatedAt + input.horizonHours * 60 * 60 * 1000;
  const withinRange = input.points.filter(
    (point) => new Date(point.periodEnd).getTime() <= cutoff,
  );
  const stride = Math.max(1, Math.round(input.sampleRateMinutes / input.sourcePeriodMinutes));

  return withinRange.filter((_, index) => index % stride === 0);
}

function buildTickIndexes(length: number, count: number): number[] {
  if (length <= count) {
    return Array.from({ length }, (_, index) => index);
  }

  return Array.from({ length: count }, (_, index) =>
    Math.min(length - 1, Math.round((index / (count - 1)) * (length - 1))),
  );
}

function formatForecastTimeLabel(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function ResourceSection({
  title,
  children,
}: { title: string; children: ReactNode }) {
  return (
    <section className="relative overflow-hidden rounded-[1.75rem] border border-white/10 bg-slate-950/55 p-5 shadow-[0_20px_90px_rgba(0,0,0,0.25)] backdrop-blur">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-violet-300/30 to-transparent" />
      <h3 className="mb-4 text-xl font-semibold text-white">{title}</h3>
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
            className={`flex min-h-[220px] flex-col rounded-[1.4rem] border border-white/10 bg-white/5 p-4 ${kind === "battery" ? "ring-1 ring-cyan-300/5" : "ring-1 ring-violet-300/5"}`}
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
              {kind === "battery" ? (
                <MetaItem
                  label="Min discharge"
                  value={`${device.minimumDischargePercent ?? 10}%`}
                />
              ) : null}
            </dl>
            {kind === "battery" ? (
              <form
                action={setBatteryMinimumDischargePercentAction}
                className="mt-4 space-y-2"
              >
                <input type="hidden" name="siteId" value={site.id} />
                <input type="hidden" name="batteryId" value={device.id} />
                <label className="block space-y-2">
                  <span className="text-sm font-medium text-slate-300">
                    Minimum discharge (%)
                  </span>
                  <input
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-slate-100 outline-none transition focus:border-cyan-400/50"
                    defaultValue={device.minimumDischargePercent ?? 10}
                    max={100}
                    min={10}
                    name="minimumDischargePercent"
                    step={1}
                    type="number"
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  <SubmitButton className={secondaryButtonClass}>
                    <Save size={14} />
                    Save minimum
                  </SubmitButton>
                </div>
              </form>
            ) : null}
            <div className="mt-auto pt-4 flex flex-wrap gap-2">
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
        {kind === "price" ? (
          <label className="block space-y-2">
            <span className="text-sm font-medium text-slate-300">
              Tibber home ID (optional)
            </span>
            <input
              className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-slate-100 outline-none transition focus:border-cyan-400/50"
              name="homeId"
            />
          </label>
        ) : null}
        {kind === "weather" ? (
          <p className="text-xs text-slate-500">
            Weather sources default to `open-meteo` using the current site GPS location.
          </p>
        ) : kind === "price" ? (
          <p className="text-xs text-slate-500">
            Dynamic price sources currently use `tibber` and read prices with `TIBBER_ACCESS_TOKEN`.
          </p>
        ) : null}
        <SubmitButton className={primaryButtonClass}>
          {kind === "weather" ? "Add solar forecast source" : "Add price source"}
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
                    ? updateWeatherForecastSourceAction
                    : updateDynamicPriceSourceAction
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
                {kind === "price" ? (
                  <label className="block space-y-2">
                    <span className="text-sm font-medium text-slate-300">
                      Tibber home ID (optional)
                    </span>
                    <input
                      className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-slate-100 outline-none transition focus:border-cyan-400/50"
                      defaultValue={(record as DynamicPriceSourceRecord).homeId ?? ""}
                      name="homeId"
                    />
                  </label>
                ) : null}
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
          {kind === "weather"
            ? "No named solar forecast sources configured yet. Open-Meteo is used as the default forecast provider for this site."
            : "No dynamic price sources configured yet."}
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
