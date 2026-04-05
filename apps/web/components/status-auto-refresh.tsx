"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const REFRESH_INTERVAL_MS = 5000;

export function StatusAutoRefresh() {
  const router = useRouter();
  const [isPaused, setIsPaused] = useState(false);

  useEffect(() => {
    function handleVisibilityChange() {
      setIsPaused(document.visibilityState !== "visible");
    }

    handleVisibilityChange();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    if (isPaused) {
      return;
    }

    const interval = window.setInterval(() => {
      router.refresh();
    }, REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(interval);
    };
  }, [isPaused, router]);

  return null;
}
