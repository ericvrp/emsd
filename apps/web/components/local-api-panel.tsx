"use client";

import { Copy, Globe, Key, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  createLocalApiTokenAction,
  getLocalApiTokenStatusAction,
  revokeLocalApiTokenAction,
} from "../app/actions";
import { Button } from "./ui/button";

const ROUTE_PATH = "/api/local/v1/current";

const ENTITY_DEFAULTS = [
  {
    id: "ems_price_now",
    label: "Price Now",
    template: "{{ value_json.summary.currentImportPrice }}",
    unit: "EUR/kWh",
    deviceClass: "",
  },
  {
    id: "ems_negative_price_now",
    label: "Negative Price Now",
    template: "{{ value_json.summary.currentImportPriceIsNegative }}",
    unit: "",
    deviceClass: "",
    binary: true,
  },
  {
    id: "ems_battery_soc",
    label: "Battery SOC",
    template: "{{ value_json.summary.totalBatterySocPercent }}",
    unit: "%",
    deviceClass: "battery",
  },
  {
    id: "ems_solar_forecast_now",
    label: "Solar Forecast Now",
    template: "{{ value_json.summary.currentForecastSolarPowerW }}",
    unit: "W",
    deviceClass: "power",
    stateClass: "measurement",
  },
  {
    id: "ems_solar_power_now",
    label: "Solar Power Now",
    template: "{{ value_json.summary.totalSolarPowerW }}",
    unit: "W",
    deviceClass: "power",
    stateClass: "measurement",
  },
  {
    id: "ems_battery_power",
    label: "Battery Power",
    template: "{{ value_json.summary.totalBatteryPowerW }}",
    unit: "W",
    deviceClass: "power",
    stateClass: "measurement",
  },
  {
    id: "ems_meter_power",
    label: "Meter Power",
    template: "{{ value_json.summary.totalMeterPowerW }}",
    unit: "W",
    deviceClass: "power",
    stateClass: "measurement",
  },
];

interface EntityOption {
  id: string;
  label: string;
  template: string;
  unit: string;
  deviceClass: string;
  stateClass?: string;
  binary?: boolean;
}

export function LocalApiPanel() {
  const [tokenConfigured, setTokenConfigured] = useState<boolean | null>(null);
  const [generatedToken, setGeneratedToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [host, setHost] = useState(
    () =>
      typeof window !== "undefined" ? window.location.host : "localhost:3300",
  );
  const [scanInterval, setScanInterval] = useState(30);
  const [entityPrefix, setEntityPrefix] = useState("ems");
  const [selectedEntities, setSelectedEntities] = useState<Set<string>>(
    new Set(ENTITY_DEFAULTS.map((e) => e.id)),
  );
  const [showCopied, setShowCopied] = useState(false);

  async function checkStatus() {
    try {
      const result = await getLocalApiTokenStatusAction();
      setTokenConfigured(result.configured);
    } catch {
      setTokenConfigured(false);
    }
  }

  if (tokenConfigured === null) {
    checkStatus();
  }

  async function handleGenerateToken() {
    setLoading(true);
    try {
      const result = await createLocalApiTokenAction();

      if (result.error) {
        toast.error(result.error);
      } else if (result.token) {
        setGeneratedToken(result.token);
        setTokenConfigured(true);
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to generate token",
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleRevokeToken() {
    setLoading(true);
    try {
      const result = await revokeLocalApiTokenAction();

      if (result.error) {
        toast.error(result.error);
      } else {
        setGeneratedToken(null);
        setTokenConfigured(false);
        toast.success("Local API token revoked.");
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to revoke token",
      );
    } finally {
      setLoading(false);
    }
  }

  function handleCopy(text: string, label?: string) {
    const done = () => {
      setShowCopied(true);
      toast.success(
        label ? `${label} copied to clipboard` : "Copied to clipboard",
      );
      setTimeout(() => setShowCopied(false), 2000);
    };

    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, () => {
        toast.error("Failed to copy to clipboard");
      });
      return;
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand("copy");
      done();
    } catch {
      toast.error("Failed to copy to clipboard");
    }
    document.body.removeChild(textarea);
  }

  function toggleEntity(id: string) {
    setSelectedEntities((prev) => {
      const next = new Set(prev);

      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }

      return next;
    });
  }

  function generateYaml(): string {
    const entities = ENTITY_DEFAULTS.filter((e) => selectedEntities.has(e.id));

    const sensors = entities.filter((e) => !e.binary);
    const binarySensors = entities.filter((e) => e.binary);

    let sensorLines = "";

    for (const sensor of sensors) {
      const prefix = entityPrefix || "ems";
      sensorLines += `      - name: "${sensor.label}"\n`;
      sensorLines += `        unique_id: ${prefix}_${sensor.id.split("_").pop()}\n`;
      sensorLines += `        value_template: "${sensor.template}"\n`;

      if (sensor.unit) {
        sensorLines += `        unit_of_measurement: "${sensor.unit}"\n`;
      }

      if (sensor.deviceClass) {
        sensorLines += `        device_class: ${sensor.deviceClass}\n`;
      }

      if (sensor.stateClass) {
        sensorLines += `        state_class: ${sensor.stateClass}\n`;
      }

      sensorLines += "\n";
    }

    let binaryLines = "";

    for (const bs of binarySensors) {
      const prefix = entityPrefix || "ems";
      binaryLines += `      - name: "${bs.label}"\n`;
      binaryLines += `        unique_id: ${prefix}_${bs.id.split("_").pop()}\n`;
      binaryLines += `        value_template: "${bs.template}"\n\n`;
    }

    const yaml = `rest:
  - resource: http://${host}${ROUTE_PATH}
    scan_interval: ${scanInterval}
    timeout: 10
    headers:
      Authorization: !secret ems_local_api_token
    sensor:
${sensorLines.trimEnd() || "      []"}
    binary_sensor:
${binaryLines.trimEnd() || "      []"}
`;

    return yaml;
  }

  function generateSecretsEntry(): string {
    return `ems_local_api_token: "Bearer ${generatedToken || "YOUR_TOKEN_HERE"}"`;
  }

  return (
    <section className="space-y-5">
      <div>
        <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-300/90">
          <Globe size={13} />
          Local API
        </p>
        <h2 className="mt-2 text-2xl font-semibold text-white">
          Local API
        </h2>
        <p className="mt-2 text-sm leading-6 text-slate-400">
          Expose EMS data through a local HTTP endpoint. The API itself is
          generic and can be consumed by any system that speaks HTTP and JSON.
          The examples, YAML generator, and setup instructions below are written
          for Home Assistant, which is the primary target. The endpoint is
          available at{" "}
          <code className="rounded bg-slate-800 px-1.5 py-0.5 text-xs text-cyan-300">
            {ROUTE_PATH}
          </code>
          .
        </p>
      </div>

      <div className="rounded-[1.4rem] border border-white/10 bg-white/5 p-5 ring-1 ring-cyan-300/5">
        <h3 className="flex items-center gap-2 text-base font-semibold text-white">
          <Key size={16} />
          Bearer Token
        </h3>
        <p className="mt-1 text-sm text-slate-400">
          {tokenConfigured
            ? "A local API token is configured. Generate a new one to rotate."
            : "No local API token configured yet. Generate one to enable the API."}
        </p>

        {generatedToken && (
          <div className="mt-4 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-rose-300">
              Copy this token now. It will not be shown again.
            </p>
            <div className="rounded-xl border border-white/10 bg-slate-950/60 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
                secrets.yaml entry
              </p>
              <div className="mt-2 flex items-center gap-2">
                <code className="flex-1 break-all rounded-lg border border-white/10 bg-slate-950/80 px-3 py-2 text-xs text-slate-300">
                  {generateSecretsEntry()}
                </code>
                <Button
                  onClick={() =>
                    handleCopy(generateSecretsEntry(), "Secrets entry")
                  }
                  title="Copy secrets.yaml entry"
                  variant="ghost"
                >
                  <Copy size={14} />
                </Button>
              </div>
            </div>
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            disabled={loading}
            onClick={handleGenerateToken}
            variant="default"
          >
            <RefreshCw size={14} />
            {tokenConfigured ? "Generate new token" : "Generate token"}
          </Button>
          {tokenConfigured && (
            <Button
              disabled={loading}
              onClick={handleRevokeToken}
              variant="danger"
            >
              <Trash2 size={14} />
              Revoke
            </Button>
          )}
        </div>
      </div>

      <div className="rounded-[1.4rem] border border-white/10 bg-white/5 p-5 ring-1 ring-cyan-300/5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-white">
              Home Assistant YAML Generator
            </h3>
            <p className="mt-1 text-sm text-slate-400">
              Configure your setup and generate a ready-to-paste Home Assistant
              configuration.
            </p>
          </div>
          <Button
            className="shrink-0"
            onClick={() => handleCopy(generateYaml(), "YAML")}
            title="Copy YAML to clipboard"
            variant="ghost"
          >
            <Copy size={14} />
          </Button>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label
              className="block text-xs font-semibold uppercase tracking-[0.14em] text-slate-400"
              htmlFor="la-host"
            >
              EMS Host
            </label>
            <input
              className="mt-1 flex h-11 w-full rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-cyan-400/50"
              id="la-host"
              onChange={(e) => setHost(e.target.value)}
              placeholder="localhost:3300"
              value={host}
            />
          </div>
          <div>
            <label
              className="block text-xs font-semibold uppercase tracking-[0.14em] text-slate-400"
              htmlFor="la-scan-interval"
            >
              Scan Interval (seconds)
            </label>
            <input
              className="mt-1 flex h-11 w-full rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-cyan-400/50"
              id="la-scan-interval"
              onChange={(e) => setScanInterval(Number(e.target.value) || 30)}
              type="number"
              value={scanInterval}
            />
          </div>
          <div>
            <label
              className="block text-xs font-semibold uppercase tracking-[0.14em] text-slate-400"
              htmlFor="la-entity-prefix"
            >
              Entity Name Prefix
            </label>
            <input
              className="mt-1 flex h-11 w-full rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-cyan-400/50"
              id="la-entity-prefix"
              onChange={(e) => setEntityPrefix(e.target.value)}
              placeholder="ems"
              value={entityPrefix}
            />
          </div>
        </div>

        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
            Entities to include
          </p>
          <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
            {ENTITY_DEFAULTS.map((entity) => (
              <label
                className="flex items-center gap-2 text-sm text-slate-300"
                key={entity.id}
              >
                <input
                  checked={selectedEntities.has(entity.id)}
                  className="accent-cyan-400"
                  onChange={() => toggleEntity(entity.id)}
                  type="checkbox"
                />
                {entity.label}
                {entity.binary && (
                  <span className="text-[10px] text-slate-500">(binary)</span>
                )}
              </label>
            ))}
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-cyan-400/15 bg-cyan-400/5 px-4 py-3 text-xs leading-relaxed text-slate-300">
            <p className="mb-2 font-semibold text-cyan-200">How to use this YAML</p>
            <p className="mb-1">
              <span className="font-medium text-white">Option 1 — Package file</span>{" "}
              (recommended): save as{" "}
              <code className="rounded bg-cyan-400/10 px-1 py-0.5 text-cyan-200">
                packages/ems.yaml
              </code>{" "}
              in your Home Assistant config directory. If you haven&apos;t enabled
              packages yet, add this to{" "}
              <code className="rounded bg-cyan-400/10 px-1 py-0.5 text-cyan-200">
                configuration.yaml
              </code>
              :
            </p>
            <pre className="mb-2 ml-4 text-cyan-200/80">
              homeassistant:{"\n"}
              {"  "}packages: !include_dir_named packages
            </pre>
            <p>
              <span className="font-medium text-white">Option 2 — Direct</span>: paste
              the block directly into{" "}
              <code className="rounded bg-cyan-400/10 px-1 py-0.5 text-cyan-200">
                configuration.yaml
              </code>
              .
            </p>
          </div>

        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
            Generated YAML
          </p>
          <pre className="mt-2 max-h-96 overflow-auto rounded-xl border border-white/10 bg-slate-950/80 p-4 text-xs leading-relaxed text-slate-300">
            {generateYaml()}
          </pre>
        </div>
      </div>
    </section>
  );
}
