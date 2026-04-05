import type {
  DynamicPriceSourceRecord,
  ManagedDeviceStatusRecord,
  SiteRecord,
  WeatherForecastSourceRecord,
} from "@emsd/core";
import { formatManagedDeviceState } from "@emsd/core";
import { HardDrive, Home, ScanSearch } from "lucide-react";
import { getServerSession } from "next-auth";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { authOptions } from "../../auth";
import { AppNav } from "../../components/app-nav";
import { DiscoveryPanel } from "../../components/discovery-panel";
import { SubmitButton } from "../../components/submit-button";
import { ToastOnSearchParams } from "../../components/toast-on-search-params";
import { getDashboardSnapshot } from "../../lib/ems-bridge";
import {
  createDynamicPriceSourceAction,
  createSiteAction,
  createWeatherForecastSourceAction,
  deleteBatteryAction,
  deleteDynamicPriceSourceAction,
  deleteMeterAction,
  deleteSiteAction,
  deleteWeatherForecastSourceAction,
  setBatteryEnabledAction,
  setMeterEnabledAction,
  updateDynamicPriceSourceAction,
  updateSiteAction,
  updateWeatherForecastSourceAction,
} from "../actions";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
type ConfigTab = "devices" | "site" | "discover";

const primaryButtonClass =
  "inline-flex items-center justify-center rounded-2xl bg-gradient-to-r from-indigo-500 via-cyan-500 to-emerald-400 px-4 py-2.5 text-sm font-semibold text-slate-950 shadow-[0_18px_50px_rgba(6,182,212,0.18)] transition hover:brightness-110";
const secondaryButtonClass =
  "inline-flex items-center justify-center rounded-2xl border border-white/10 bg-white/6 px-4 py-2.5 text-sm font-semibold text-slate-100 transition hover:border-white/20 hover:bg-white/10";
const dangerButtonClass =
  "inline-flex items-center justify-center rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-2.5 text-sm font-semibold text-rose-100 transition hover:bg-rose-500/15";

function getSingleValue(value: string | string[] | undefined): string | null {
  if (typeof value === "string") {
    return value;
  }

  return value?.[0] ?? null;
}

function resolveTab(tab: string | null, hasSite: boolean): ConfigTab {
  if (!hasSite) {
    return "site";
  }

  return tab === "site" || tab === "discover" ? tab : "devices";
}

function getTabHref(tab: ConfigTab): string {
  const params = new URLSearchParams({ tab });
  return `/config?${params.toString()}`;
}

export default async function ConfigPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect("/login");
  }

  const resolvedSearchParams = (await searchParams) ?? {};
  const snapshot = await getDashboardSnapshot();
  const currentSite = snapshot.sites[0] ?? null;
  const activeTab = resolveTab(
    getSingleValue(resolvedSearchParams.tab),
    Boolean(currentSite),
  );
  const notice = getSingleValue(resolvedSearchParams.notice);
  const tone =
    getSingleValue(resolvedSearchParams.tone) === "error" ? "error" : "success";
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-4 py-3 sm:px-6 lg:px-8">
      <section className="rounded-[1.2rem] border border-white/10 bg-slate-950/60 px-3 py-2.5 shadow-[0_18px_60px_rgba(0,0,0,0.28)] backdrop-blur">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-emerald-300/90">
              EMSD Configuration
            </p>
            <AppNav current="config" />
          </div>
        </div>
      </section>

      <ToastOnSearchParams notice={notice} tone={tone} />

      <section className="rounded-[1.6rem] border border-white/10 bg-slate-950/55 p-3 shadow-[0_20px_90px_rgba(0,0,0,0.25)] backdrop-blur">
        <div className="grid gap-2 sm:grid-cols-3">
          {(["devices", "site", "discover"] as ConfigTab[]).map((tab) => (
            <Link
              key={tab}
              className={`inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold transition ${
                activeTab === tab
                  ? "border border-cyan-300/30 bg-gradient-to-r from-cyan-300 via-white to-emerald-200 text-slate-950 shadow-[0_12px_40px_rgba(125,211,252,0.22)]"
                  : "border border-white/8 bg-white/5 text-slate-200 hover:bg-white/8"
              }`}
              href={getTabHref(tab)}
            >
              {tab === "devices" ? (
                <HardDrive size={15} />
              ) : tab === "site" ? (
                <Home size={15} />
              ) : (
                <ScanSearch size={15} />
              )}
              {tab === "devices"
                ? "Current Devices"
                : tab === "site"
                  ? "Current Site"
                  : "Discover"}
            </Link>
          ))}
        </div>
      </section>

      {activeTab === "devices" ? (
        currentSite ? (
          <>
            <section className="relative overflow-hidden rounded-[1.75rem] border border-white/10 bg-slate-950/55 p-5 shadow-[0_20px_90px_rgba(0,0,0,0.25)] backdrop-blur">
              <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-300/40 to-transparent" />
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="text-2xl font-semibold text-white">
                    {currentSite.name}
                  </h2>
                </div>
              </div>
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
                  site={currentSite}
                  kind="weather"
                  titleLabel="Weather source"
                  records={currentSite.weatherSources}
                />
              </ResourceSection>
              <ResourceSection
                title="Dynamic Price Sources"
                description="Manage tariff providers."
              >
                <SourceList
                  site={currentSite}
                  kind="price"
                  titleLabel="Dynamic price source"
                  records={currentSite.dynamicPriceSources}
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
              existingDeviceIds={[
                ...currentSite.devices.map((device) => device.id),
              ]}
              selectedSiteId={currentSite.id}
            />
          </section>
        ) : (
          <SiteSetupPanel />
        )
      ) : null}
    </main>
  );
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
        <SubmitButton className={primaryButtonClass}>Create site</SubmitButton>
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
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-emerald-300/90">
            Current Site
          </p>
          <h2 className="mt-2 text-2xl font-semibold text-white">
            {site.name}
          </h2>
          <p className="mt-1 text-sm text-slate-400">{site.id}</p>
        </div>
        <span className="inline-flex items-center rounded-full border border-white/10 bg-white/6 px-3 py-1.5 text-xs font-semibold text-slate-200">
          Updated {formatTimestamp(site.updatedAt)}
        </span>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <form
          action={updateSiteAction}
          className="space-y-4 rounded-[1.4rem] border border-white/10 bg-white/5 p-4"
        >
          <input type="hidden" name="siteId" value={site.id} />
          <label className="block space-y-2">
            <span className="text-sm font-medium text-slate-300">
              Site name
            </span>
            <input
              className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-slate-100 outline-none transition focus:border-cyan-400/50"
              name="name"
              defaultValue={site.name}
              required
            />
          </label>
          <SubmitButton className={secondaryButtonClass}>
            Save name
          </SubmitButton>
        </form>

        <form
          action={deleteSiteAction}
          className="space-y-4 rounded-[1.4rem] border border-rose-400/15 bg-rose-500/6 p-4"
        >
          <input type="hidden" name="siteId" value={site.id} />
          <p className="text-sm leading-6 text-slate-300">
            Delete the current site and return to initial setup.
          </p>
          <SubmitButton className={dangerButtonClass}>Delete site</SubmitButton>
        </form>
      </div>
    </section>
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
      {devices.map((device) =>
        (() => {
          const currentState = device.telemetry?.state ?? device.state;
          const currentObservedAt =
            device.telemetry?.observedAt ?? device.updatedAt;

          return (
            <article
              key={device.id}
              className={`rounded-[1.4rem] border border-white/10 bg-white/5 p-4 ${kind === "battery" ? "ring-1 ring-cyan-300/5" : "ring-1 ring-violet-300/5"}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h4 className="truncate text-base font-semibold text-white">
                    {device.name}
                  </h4>
                  <p className="mt-1 truncate text-xs text-slate-400">
                    {device.id}
                  </p>
                </div>
                <StatusBadge tone={currentState}>
                  {formatManagedDeviceState(currentState)}
                </StatusBadge>
              </div>
              <dl className="mt-4 grid gap-3 text-sm text-slate-300 sm:grid-cols-2">
                <MetaItem label="Model" value={device.model} />
                <MetaItem label="Address" value={device.address} />
                <MetaItem
                  label="State"
                  value={formatManagedDeviceState(currentState)}
                />
                <MetaItem
                  label="Enabled"
                  value={device.enabled ? "yes" : "no"}
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
                <MetaItem
                  label="Seen"
                  value={formatObservedAt(currentObservedAt)}
                />
              </dl>
              <div className="mt-4 flex flex-wrap gap-2">
                <form
                  action={
                    kind === "battery"
                      ? setBatteryEnabledAction
                      : setMeterEnabledAction
                  }
                >
                  <input type="hidden" name="siteId" value={site.id} />
                  <input
                    type="hidden"
                    name={kind === "battery" ? "batteryId" : "meterId"}
                    value={device.id}
                  />
                  <input
                    type="hidden"
                    name="enabled"
                    value={device.enabled ? "false" : "true"}
                  />
                  <SubmitButton className={secondaryButtonClass}>
                    {device.enabled ? "Disable" : "Enable"}
                  </SubmitButton>
                </form>
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
                    Delete
                  </SubmitButton>
                </form>
              </div>
            </article>
          );
        })(),
      )}
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
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h4 className="truncate text-base font-semibold text-white">
                    {record.name}
                  </h4>
                  <p className="mt-1 truncate text-xs text-slate-400">
                    {record.id}
                  </p>
                </div>
                <span className="inline-flex items-center rounded-full border border-white/10 bg-white/6 px-3 py-1.5 text-xs font-semibold text-slate-200">
                  Updated {formatTimestamp(record.updatedAt)}
                </span>
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
                    name="name"
                    defaultValue={record.name}
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

function StatusBadge({
  tone,
  children,
}: { tone: string; children: ReactNode }) {
  const toneClass =
    tone === "charging"
      ? "border-sky-400/20 bg-sky-500/10 text-sky-100"
      : tone === "discharging"
        ? "border-amber-400/20 bg-amber-500/10 text-amber-100"
        : tone === "connected" || tone === "idle"
          ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-100"
          : "border-slate-400/20 bg-slate-500/10 text-slate-200";

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${toneClass}`}
    >
      {children}
    </span>
  );
}

function friendlyStateLabel(state: string): string {
  return state.replace(/-/g, " ");
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatObservedAt(value: string): string {
  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

type SiteSnapshot = SiteRecord & {
  devices: ManagedDeviceStatusRecord[];
  weatherSources: WeatherForecastSourceRecord[];
  dynamicPriceSources: DynamicPriceSourceRecord[];
};
