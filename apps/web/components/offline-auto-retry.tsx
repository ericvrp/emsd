"use client";

import { useEffect } from "react";
import { PageRefreshButton } from "./page-refresh-button";
import { RefreshWarning } from "./refresh-warning";
import {
  type DashboardStateResponse,
  useLiveJsonSWR,
} from "./use-live-json-swr";

const RETRY_INTERVAL_MS = 2000;

export function OfflineAutoRetry() {
  const { data, refreshError } = useLiveJsonSWR<DashboardStateResponse>(
    "/api/dashboard/state",
    {
      failureMessage:
        "Unable to recheck daemon status right now. Retrying automatically.",
      refreshIntervalMs: RETRY_INTERVAL_MS,
    },
  );

  useEffect(() => {
    if (data?.daemonRunning) {
      window.location.reload();
    }
  }, [data?.daemonRunning]);

  return refreshError ? (
    <RefreshWarning
      action={<PageRefreshButton />}
      className="mb-6 w-full"
      message={refreshError}
    />
  ) : null;
}
