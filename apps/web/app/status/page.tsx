import { formatManagedDeviceState } from "@emsd/core";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "../../auth";
import { AppNav } from "../../components/app-nav";
import { DaemonIndicator } from "../../components/daemon-indicator";
import { StatusAutoRefresh } from "../../components/status-auto-refresh";
import { getLiveStatus } from "../../lib/ems-bridge";

export const dynamic = "force-dynamic";

export default async function StatusPage() {
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect("/login");
  }

  const snapshot = await getLiveStatus();
  const currentSite = snapshot.sites[0] ?? null;
  const totalManagedDevices = snapshot.sites.reduce(
    (count, site) => count + site.devices.length,
    0,
  );

  if (!currentSite) {
    redirect("/config?tab=site");
  }

  if (totalManagedDevices === 0) {
    redirect("/config?tab=discover");
  }

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-4 py-3 sm:px-6 lg:px-8">
      <section className="rounded-[1.2rem] border border-white/10 bg-slate-950/60 px-3 py-2.5 shadow-[0_18px_60px_rgba(0,0,0,0.28)] backdrop-blur">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-300/90">
              EMSD Live Status
            </p>
            <AppNav current="status" />
          </div>

          <div className="flex items-center gap-2 sm:justify-end">
            <DaemonIndicator
              generatedAt={snapshot.generatedAt}
              running={snapshot.daemon.running}
              title={
                snapshot.daemon.running
                  ? `Daemon running${snapshot.daemon.pid ? ` · PID ${snapshot.daemon.pid}` : ""}`
                  : "Daemon offline"
              }
            />
            <StatusAutoRefresh />
          </div>
        </div>
      </section>

      {snapshot.daemon.running ? (
        <section className="grid gap-4 xl:grid-cols-2">
          {snapshot.sites.map((site) => (
            <section
              key={site.id}
              className="relative overflow-hidden rounded-[1.75rem] border border-white/10 bg-slate-950/55 p-5 shadow-[0_20px_90px_rgba(0,0,0,0.25)] backdrop-blur"
            >
              <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/40 to-transparent" />
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="text-2xl font-semibold text-white">
                    {site.name}
                  </h2>
                </div>
              </div>

              <div className="mt-5 grid gap-4 lg:grid-cols-3">
                <StatusGroup title="Battery State">
                  {site.devices.some((device) => device.kind === "battery") ? (
                    site.devices
                      .filter((device) => device.kind === "battery")
                      .map((battery) => (
                        <StatusRow
                          key={battery.id}
                          label={battery.name}
                          meta={`${battery.model} · ${battery.address}`}
                          badge={
                            <StatusBadge tone={battery.state}>
                              {formatManagedDeviceState(battery.state)}
                            </StatusBadge>
                          }
                          details={[
                            ...(battery.telemetry?.socPercent !== null &&
                            battery.telemetry?.socPercent !== undefined
                              ? [
                                  `SoC ${formatSocPercent(battery.telemetry.socPercent)}`,
                                ]
                              : ["SoC unavailable"]),
                            ...(battery.telemetry?.powerW !== null &&
                            battery.telemetry?.powerW !== undefined
                              ? [formatPower(battery.telemetry.powerW)]
                              : []),
                            battery.connected ? "Connected" : "Offline",
                            battery.enabled ? "Enabled" : "Disabled",
                            `Seen ${formatObservedAt(battery.telemetry?.observedAt ?? battery.updatedAt)}`,
                          ]}
                        />
                      ))
                  ) : (
                    <EmptyState>No batteries configured.</EmptyState>
                  )}
                </StatusGroup>

                <StatusGroup title="Meter State">
                  {site.devices.some((device) => device.kind === "meter") ? (
                    site.devices
                      .filter((device) => device.kind === "meter")
                      .map((meter) => (
                        <StatusRow
                          key={meter.id}
                          label={meter.name}
                          meta={`${meter.model} · ${meter.address}`}
                          badge={
                            <StatusBadge tone={meter.state}>
                              {formatManagedDeviceState(meter.state)}
                            </StatusBadge>
                          }
                          details={[
                            ...(meter.telemetry?.powerW !== null &&
                            meter.telemetry?.powerW !== undefined
                              ? [formatPower(meter.telemetry.powerW)]
                              : ["Power unavailable"]),
                            meter.enabled ? "Enabled" : "Disabled",
                            `Seen ${formatObservedAt(meter.telemetry?.observedAt ?? meter.updatedAt)}`,
                          ]}
                        />
                      ))
                  ) : (
                    <EmptyState>No meters configured.</EmptyState>
                  )}
                </StatusGroup>

                <StatusGroup title="Sources">
                  <div className="space-y-4">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                        Weather
                      </p>
                      <div className="mt-2 space-y-2">
                        {site.weatherSources.length > 0 ? (
                          site.weatherSources.map((source) => (
                            <SourceRow
                              key={source.id}
                              id={source.id}
                              name={source.name}
                            />
                          ))
                        ) : (
                          <EmptyState>None configured.</EmptyState>
                        )}
                      </div>
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                        Dynamic Price
                      </p>
                      <div className="mt-2 space-y-2">
                        {site.dynamicPriceSources.length > 0 ? (
                          site.dynamicPriceSources.map((source) => (
                            <SourceRow
                              key={source.id}
                              id={source.id}
                              name={source.name}
                            />
                          ))
                        ) : (
                          <EmptyState>None configured.</EmptyState>
                        )}
                      </div>
                    </div>
                  </div>
                </StatusGroup>
              </div>
            </section>
          ))}
        </section>
      ) : (
        <section className="rounded-[1.5rem] border border-white/10 bg-slate-950/55 px-5 py-8 text-sm text-slate-300 shadow-[0_20px_80px_rgba(0,0,0,0.24)] backdrop-blur">
          The daemon is offline. Start it to view live device and site status.
        </section>
      )}
    </main>
  );
}

function StatusGroup({
  title,
  children,
}: { title: string; children: React.ReactNode }) {
  return (
    <article className="rounded-[1.4rem] border border-white/8 bg-white/4 p-4 ring-1 ring-white/5">
      <h3 className="text-sm font-semibold text-white">{title}</h3>
      <div className="mt-3 space-y-3">{children}</div>
    </article>
  );
}

function StatusRow({
  label,
  meta,
  badge,
  details,
}: { label: string; meta: string; badge: React.ReactNode; details: string[] }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-slate-950/55 p-3 ring-1 ring-white/5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">{label}</p>
          <p className="mt-1 truncate text-xs text-slate-400">{meta}</p>
        </div>
        {badge}
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-300">
        {details.map((detail) => (
          <span key={detail} className="rounded-full bg-white/6 px-2.5 py-1">
            {detail}
          </span>
        ))}
      </div>
    </div>
  );
}

function SourceRow({ id, name }: { id: string; name: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/8 bg-slate-950/50 px-3 py-2">
      <span className="truncate text-sm font-medium text-white">{name}</span>
      <span className="text-xs text-slate-400">{id}</span>
    </div>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return <p className="text-sm leading-6 text-slate-400">{children}</p>;
}

function StatusBadge({
  tone,
  children,
}: { tone: string; children: React.ReactNode }) {
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

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(value));
}

function formatObservedAt(value: string): string {
  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function formatPower(value: number): string {
  return `Power ${Math.round(value)} W`;
}

function formatSocPercent(value: number): string {
  return `${Math.round(value)}%`;
}
