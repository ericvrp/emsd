"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { logBrowserIntervalHeartbeat } from "../lib/browser-heartbeat";

const RETRY_INTERVAL_MS = 2000;

export function OfflineAutoRetry() {
  const router = useRouter();

  useEffect(() => {
    const interval = window.setInterval(() => {
      logBrowserIntervalHeartbeat("retry offline");
      router.refresh();
    }, RETRY_INTERVAL_MS);

    return () => {
      window.clearInterval(interval);
    };
  }, [router]);

  return null;
}
