"use client";

import {
  Copy,
  Eye,
  EyeOff,
  FileCode,
  Globe,
  Key,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  createLocalApiTokenAction,
  getLocalApiTokenStatusAction,
  revokeLocalApiTokenAction,
} from "../app/actions";
import {
  LOCAL_API_REFRESH_SECONDS,
  LOCAL_API_ROUTE_PATH,
  generateLocalApiYaml,
} from "../lib/local-api-yaml";
import { UI_STYLES } from "../lib/ui-colors";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";

type OutputTab = "yaml" | "api-response";

export function LocalApiPanel() {
  const [tokenConfigured, setTokenConfigured] = useState<boolean | null>(null);
  const [envConfigured, setEnvConfigured] = useState(false);
  const [generatedToken, setGeneratedToken] = useState<string | null>(null);
  const [manualToken, setManualToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [loading, setLoading] = useState(false);

  const [host, setHost] = useState(() =>
    typeof window !== "undefined" ? window.location.host : "localhost:3300",
  );
  const [entityPrefix, setEntityPrefix] = useState("ems");
  const [outputTab, setOutputTab] = useState<OutputTab>("yaml");
  const [apiPreview, setApiPreview] = useState<{
    data: string;
    error: string;
  } | null>(null);
  const [fetchingApi, setFetchingApi] = useState(false);

  const activeToken = generatedToken || manualToken.trim() || null;

  const abortRef = useRef<AbortController | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const checkStatus = useCallback(async () => {
    try {
      const result = await getLocalApiTokenStatusAction();
      setTokenConfigured(result.configured);
      setEnvConfigured(result.envConfigured);
    } catch {
      setTokenConfigured(false);
      setEnvConfigured(false);
    }
  }, []);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  async function handleGenerateToken() {
    setLoading(true);
    try {
      const result = await createLocalApiTokenAction();

      if (result.error) {
        toast.error(result.error);
      } else if (result.token) {
        setGeneratedToken(result.token);
        setManualToken("");
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
        setManualToken("");
        setTokenConfigured(false);
        setApiPreview(null);
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
      toast.success(
        label ? `${label} copied to clipboard` : "Copied to clipboard",
      );
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

  const handleFetchApi = useCallback(
    async (silent = false) => {
      if (!activeToken) {
        return;
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      if (!silent) {
        setFetchingApi(true);
      }

      try {
        const response = await fetch(`http://${host}${LOCAL_API_ROUTE_PATH}`, {
          headers: { Authorization: `Bearer ${activeToken}` },
          signal: controller.signal,
        });

        const text = await response.text();

        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          if (!controller.signal.aborted) {
            setApiPreview({
              data: "",
              error: `HTTP ${response.status}: ${text.slice(0, 500)}`,
            });
          }
          return;
        }

        if (!controller.signal.aborted) {
          setApiPreview({
            data: JSON.stringify(parsed, null, 2),
            error: "",
          });
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        if (!controller.signal.aborted) {
          setApiPreview({
            data: "",
            error:
              error instanceof Error ? error.message : "Failed to fetch API",
          });
        }
      } finally {
        if (!controller.signal.aborted && !silent) {
          setFetchingApi(false);
        }
      }
    },
    [activeToken, host],
  );

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (outputTab !== "api-response" || !activeToken) {
      return;
    }

    handleFetchApi(true);

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        void handleFetchApi(true);
      }
    }

    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
    }

    intervalRef.current = setInterval(() => {
      if (document.visibilityState === "visible") {
        void handleFetchApi(true);
      }
    }, LOCAL_API_REFRESH_SECONDS * 1000);

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }

      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [activeToken, handleFetchApi, outputTab]);

  function generateYaml(): string {
    return generateLocalApiYaml({
      entityPrefix,
      host,
    });
  }

  function generateSecretsEntry(): string {
    return `ems_local_api_token: "Bearer ${activeToken || "YOUR_TOKEN_HERE"}"`;
  }

  return (
    <section className="space-y-5">
      <div>
        <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-300/90">
          <Globe size={13} />
          Local API
        </p>
        <h2 className="mt-2 text-2xl font-semibold text-white">Local API</h2>
        <p className="mt-2 text-sm leading-6 text-slate-400">
          Expose EMS data through a local HTTP endpoint. The API itself is
          generic and can be consumed by any system that speaks HTTP and JSON.
          The examples, YAML generator, and setup instructions below are written
          for Home Assistant, which is the primary target. The endpoint is
          available at{" "}
          <code className="rounded bg-slate-800 px-1.5 py-0.5 text-xs text-cyan-300">
            {LOCAL_API_ROUTE_PATH}
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
          {envConfigured
            ? "The local API token is set via the EMSD_LOCAL_API_TOKEN environment variable. Enter the same token below to preview the API response."
            : tokenConfigured
              ? "A local API token is configured. Generate a new one to rotate, or enter a token manually below."
              : "No local API token configured yet. Generate one, or enter one manually below."}
        </p>

        <div className="mt-3">
          <label
            className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400"
            htmlFor="la-manual-token"
          >
            Enter token manually
          </label>
          <div className="mt-1 flex gap-2">
            <div className="relative flex h-11 w-full rounded-xl border border-white/10 bg-slate-950/80 transition focus-within:border-cyan-400/50">
              <input
                className="h-full w-full rounded-xl bg-transparent px-3 py-2 pr-10 text-sm text-slate-100 outline-none placeholder:text-slate-500"
                id="la-manual-token"
                onChange={(e) => {
                  setManualToken(e.target.value);
                  setGeneratedToken(null);
                }}
                placeholder="Paste a bearer token here..."
                type={showToken ? "text" : "password"}
                value={manualToken}
              />
              <button
                aria-label={showToken ? "Hide token" : "Show token"}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
                onClick={() => setShowToken((prev) => !prev)}
                type="button"
              >
                {showToken ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {envConfigured
              ? "Enter the EMSD_LOCAL_API_TOKEN value to preview the API response. The token is only stored in this browser tab."
              : "Enter a token to preview the API response, or generate one below. The token is only stored in this browser tab."}
          </p>
        </div>

        {generatedToken && (
          <div className="mt-4 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-rose-300">
              Copy this token now. It will not be shown again.
            </p>
            <div className="rounded-xl border border-white/10 bg-slate-950/60 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
                secrets.yaml entry (Home Assistant config directory)
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

        {!envConfigured && (
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
        )}
      </div>

      <div className="rounded-[1.4rem] border border-white/10 bg-white/5 p-5 ring-1 ring-cyan-300/5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-white">
              Home Assistant Setup
            </h3>
            <p className="mt-1 text-sm text-slate-400">
              Generate a ready-to-paste Home Assistant configuration that
              exports every currently available Local API entity.
            </p>
          </div>
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

        <div className={UI_STYLES.tabBar}>
          {(
            [
              ["yaml", "YAML", FileCode] as const,
              ["api-response", "API response", Eye] as const,
            ] satisfies [OutputTab, string, typeof FileCode][]
          ).map(([tab, label, Icon]) => (
            <button
              className={cn(
                UI_STYLES.tabItem,
                outputTab === tab
                  ? UI_STYLES.tabItemActive
                  : !activeToken && tab === "api-response"
                    ? UI_STYLES.tabItemDisabled
                    : UI_STYLES.tabItemInactive,
              )}
              disabled={!activeToken && tab === "api-response"}
              key={tab}
              onClick={() => setOutputTab(tab)}
              type="button"
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>

        {outputTab === "yaml" && (
          <>
            <div className="mt-4 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
                Generated YAML
              </p>
              <Button
                onClick={() => handleCopy(generateYaml(), "YAML")}
                title="Copy YAML to clipboard"
                variant="ghost"
              >
                <Copy size={14} />
              </Button>
            </div>

            <div className="mt-4 rounded-xl border border-cyan-400/15 bg-cyan-400/5 px-4 py-3 text-xs leading-relaxed text-slate-300">
              <p className="mb-2 font-semibold text-cyan-200">
                How to use this YAML
              </p>
              <p className="mb-1">
                Save as{" "}
                <code className="rounded bg-cyan-400/10 px-1 py-0.5 text-cyan-200">
                  packages/ems.yaml
                </code>{" "}
                in your Home Assistant config directory. If packages are not yet
                enabled, add this to{" "}
                <code className="rounded bg-cyan-400/10 px-1 py-0.5 text-cyan-200">
                  configuration.yaml
                </code>
                :
              </p>
              <pre className="mb-2 ml-4 text-cyan-200/80">
                homeassistant:{"\n"}
                {"  "}packages: !include_dir_named packages
              </pre>
              <p className="mb-1">
                Then add this line to{" "}
                <code className="rounded bg-cyan-400/10 px-1 py-0.5 text-cyan-200">
                  secrets.yaml
                </code>
                :
              </p>
              <pre className="mb-2 ml-4 text-cyan-200/80">
                {generateSecretsEntry()}
              </pre>
              <p className="mb-1">
                <strong className="text-white">
                  After saving, restart Home Assistant
                </strong>{" "}
                (Settings &rarr; System &rarr; Restart, or{" "}
                <code className="rounded bg-cyan-400/10 px-1 py-0.5 text-cyan-200">
                  docker restart homeassistant
                </code>
                ). No manual RESTful integration setup is needed; the YAML is
                auto-detected.
              </p>
              <p>
                To verify, go to{" "}
                <strong className="text-white">
                  Developer Tools &rarr; States
                </strong>{" "}
                and search for{" "}
                <code className="rounded bg-cyan-400/10 px-1 py-0.5 text-cyan-200">
                  ems
                </code>
                . The entities will appear ungrouped under a single RESTful
                integration (no device is created). To update the configuration,
                replace{" "}
                <code className="rounded bg-cyan-400/10 px-1 py-0.5 text-cyan-200">
                  packages/ems.yaml
                </code>{" "}
                and restart HA again.
              </p>
            </div>

            <pre className="mt-4 max-h-96 overflow-auto rounded-xl border border-white/10 bg-slate-950/80 p-4 text-xs leading-relaxed text-slate-300">
              {generateYaml()}
            </pre>
          </>
        )}

        {outputTab === "api-response" && (
          <div className="mt-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
                API response
              </p>
              <div className="flex gap-2">
                {apiPreview?.data && (
                  <Button
                    onClick={() => handleCopy(apiPreview.data, "API response")}
                    title="Copy API response"
                    variant="ghost"
                  >
                    <Copy size={14} />
                  </Button>
                )}
              </div>
            </div>

            {!apiPreview && !fetchingApi && (
              <div className="mt-2 rounded-xl border border-dashed border-white/10 bg-slate-950/40 px-4 py-8 text-center text-sm text-slate-500">
                {activeToken
                  ? "Loading..."
                  : "Enter a token above to enable the API response preview."}
              </div>
            )}

            {fetchingApi && !apiPreview && (
              <div className="mt-2 rounded-xl border border-dashed border-white/10 bg-slate-950/40 px-4 py-8 text-center text-sm text-slate-500">
                <RefreshCw className="mx-auto animate-spin" size={16} />
              </div>
            )}

            {apiPreview?.error && (
              <div className="mt-2 rounded-xl border border-rose-400/20 bg-rose-500/5 px-4 py-3 text-xs text-rose-300">
                {apiPreview.error}
              </div>
            )}

            {apiPreview?.data && (
              <pre className="mt-2 max-h-96 overflow-auto rounded-xl border border-white/10 bg-slate-950/80 p-4 text-xs leading-relaxed text-slate-300">
                {apiPreview.data}
              </pre>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
