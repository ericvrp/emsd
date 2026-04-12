"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { logBrowserIntervalHeartbeat } from "../lib/browser-heartbeat";

const DEFAULT_REFRESH_INTERVAL_MS = 5_000;
const CLIENT_GRAPH_REFRESH_PATHS = new Set(["/", "/solar", "/prices", "/grid"]);
const GRAPH_PAGE_STATE_INTERVAL_MS = 15_000;

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

export function LiveRefreshIndicator({
  batteryCount,
  currentSiteId,
  generatedAt,
}: {
  batteryCount: number;
  currentSiteId: string | null;
  generatedAt: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [isPaused, setIsPaused] = useState(false);
  const isClientGraphPage = CLIENT_GRAPH_REFRESH_PATHS.has(pathname);

  useEffect(() => {
    void generatedAt;
  }, [generatedAt]);

  useEffect(() => {
    function handleVisibilityChange() {
      const isVisible = document.visibilityState === "visible";
      setIsPaused(!isVisible);

      if (isVisible && !isClientGraphPage) {
        router.refresh();
      }
    }

    handleVisibilityChange();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [isClientGraphPage, router]);

  useEffect(() => {
    if (isPaused || isClientGraphPage) {
      return;
    }

    const interval = window.setInterval(() => {
      logBrowserIntervalHeartbeat(getRefreshHeartbeatLabel(pathname));
      router.refresh();
    }, DEFAULT_REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(interval);
    };
  }, [isClientGraphPage, isPaused, pathname, router]);

  useEffect(() => {
    if (isPaused || !isClientGraphPage) {
      return;
    }

    let cancelled = false;

    async function refreshGraphPageState() {
      try {
        const response = await fetch("/api/dashboard/state", {
          cache: "no-store",
        });

        if (response.status === 401) {
          window.location.href = "/login";
          return;
        }

        if (!response.ok) {
          throw new Error(`Page state request failed: ${response.status}`);
        }

        const payload = (await response.json()) as {
          batteryCount: number;
          currentSiteId: string | null;
          daemonRunning: boolean;
        };

        if (cancelled) {
          return;
        }

        const batteryCountChanged =
          pathname === "/" && payload.batteryCount !== batteryCount;
        const currentSiteChanged = payload.currentSiteId !== currentSiteId;

        if (
          !payload.daemonRunning ||
          batteryCountChanged ||
          currentSiteChanged
        ) {
          router.refresh();
        }
      } catch {
        router.refresh();
      }
    }

    void refreshGraphPageState();

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        void refreshGraphPageState();
      }
    }

    const interval = window.setInterval(() => {
      void refreshGraphPageState();
    }, GRAPH_PAGE_STATE_INTERVAL_MS);

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [
    batteryCount,
    currentSiteId,
    isClientGraphPage,
    isPaused,
    pathname,
    router,
  ]);

  return null;
}
