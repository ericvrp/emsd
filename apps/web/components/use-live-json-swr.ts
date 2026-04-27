"use client";

import type {
  HistoryArchive,
  WeatherForecastRecord,
} from "@emsd/core/client";
import { useEffect, useState } from "react";
import useSWR from "swr";

const DEFAULT_RETRY_INTERVAL_MS = 5_000;
const DEFAULT_SILENT_RETRY_COUNT = 2;
const DEFAULT_DEDUPE_INTERVAL_MS = 1_000;

class ClientRequestError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ClientRequestError";
    this.status = status;
  }
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });

  if (response.status === 401) {
    window.location.href = "/login";
    throw new ClientRequestError(401, "Unauthorized");
  }

  if (!response.ok) {
    throw new ClientRequestError(response.status, `Request failed: ${response.status}`);
  }

  return (await response.json()) as T;
}

export interface SiteCurrentResponse {
  currentBatteryChargePercent?: number | null;
  currentBatteryPowerW?: number | null;
  currentBatteryState?: string | null;
  currentGridPowerW?: number | null;
  currentSolarPowerW?: number | null;
  currentStrategySummary?: string | null;
}

export interface SolarGraphResponse {
  archive: HistoryArchive;
  forecast: WeatherForecastRecord | null;
  forecastError: string | null;
}

export interface SolarCurrentResponse {
  currentGeneratedPower?: number | null;
}

export interface PricesGraphResponse {
  archive: HistoryArchive;
  dynamicPriceSnapshot: import("@emsd/core/client").DynamicPriceSnapshotRecord | null;
  dynamicPriceSnapshotError: string | null;
  highestMarkerPeriodStarts: string[];
  lowestMarkerPeriodStarts: string[];
}

export interface DashboardStateResponse {
  batteryCount: number;
  currentSiteId: string | null;
  daemonRunning: boolean;
}

export function useLiveJsonSWR<T>(
  url: string | null,
  {
    dedupingIntervalMs = DEFAULT_DEDUPE_INTERVAL_MS,
    enabled = true,
    failureMessage,
    refreshIntervalMs,
    retryIntervalMs = DEFAULT_RETRY_INTERVAL_MS,
    silentRetryCount = DEFAULT_SILENT_RETRY_COUNT,
  }: {
    dedupingIntervalMs?: number;
    enabled?: boolean;
    failureMessage: string;
    refreshIntervalMs: number;
    retryIntervalMs?: number;
    silentRetryCount?: number;
  },
) {
  const [consecutiveFailureCount, setConsecutiveFailureCount] = useState(0);

  useEffect(() => {
    setConsecutiveFailureCount(0);
  }, [url]);

  const swr = useSWR<T>(enabled ? url : null, fetchJson<T>, {
    dedupingInterval: dedupingIntervalMs,
    onError: (error) => {
      if (error instanceof ClientRequestError && error.status === 401) {
        return;
      }

      setConsecutiveFailureCount((count) => count + 1);
    },
    onSuccess: () => {
      setConsecutiveFailureCount(0);
    },
    refreshInterval:
      consecutiveFailureCount > 0 ? retryIntervalMs : refreshIntervalMs,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
    shouldRetryOnError: false,
  });

  return {
    ...swr,
    consecutiveFailureCount,
    refreshError:
      consecutiveFailureCount > silentRetryCount ? failureMessage : null,
  };
}
