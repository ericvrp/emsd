"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { logBrowserIntervalHeartbeat } from "../lib/browser-heartbeat";

const DEFAULT_REFRESH_INTERVAL_MS = 5_000;
const GRAPH_REFRESH_INTERVAL_MS = 60 * 1_000;
const PRICE_REFRESH_INTERVAL_MS = 15 * 60 * 1_000;

function getRefreshHeartbeatLabel(pathname: string): string {
  switch (pathname) {
    case "/":
      return "refresh graph";
    case "/solar":
      return "refresh graph";
    case "/prices":
      return "refresh graph";
    case "/grid":
      return "refresh graph";
    case "/control":
      return "refresh control";
    case "/config":
      return "refresh config";
    default:
      return "refresh page";
  }
}

function getRefreshIntervalMs(pathname: string): number {
  switch (pathname) {
    case "/":
    case "/solar":
    case "/grid":
      return GRAPH_REFRESH_INTERVAL_MS;
    case "/prices":
      return PRICE_REFRESH_INTERVAL_MS;
    default:
      return DEFAULT_REFRESH_INTERVAL_MS;
  }
}

export function LiveRefreshIndicator({
  generatedAt,
}: {
  generatedAt: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [isPaused, setIsPaused] = useState(false);
  const refreshIntervalMs = getRefreshIntervalMs(pathname);

  useEffect(() => {
    void generatedAt;
  }, [generatedAt]);

  useEffect(() => {
    function handleVisibilityChange() {
      const isVisible = document.visibilityState === "visible";
      setIsPaused(!isVisible);

      if (isVisible) {
        router.refresh();
      }
    }

    handleVisibilityChange();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [router]);

  useEffect(() => {
    if (isPaused) {
      return;
    }

    const interval = window.setInterval(() => {
      logBrowserIntervalHeartbeat(getRefreshHeartbeatLabel(pathname));
      router.refresh();
    }, refreshIntervalMs);

    return () => {
      window.clearInterval(interval);
    };
  }, [isPaused, pathname, refreshIntervalMs, router]);

  return null;
}
