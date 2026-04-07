"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const REFRESH_INTERVAL_MS = 5000;

export function LiveRefreshIndicator({
  generatedAt,
}: {
  generatedAt: string;
}) {
  const router = useRouter();
  const [isPaused, setIsPaused] = useState(false);

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
      router.refresh();
    }, REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(interval);
    };
  }, [isPaused, router]);

  return null;
}
