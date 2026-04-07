"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

const RETRY_INTERVAL_MS = 2000;

export function OfflineAutoRetry() {
  const router = useRouter();

  useEffect(() => {
    const interval = window.setInterval(() => {
      router.refresh();
    }, RETRY_INTERVAL_MS);

    return () => {
      window.clearInterval(interval);
    };
  }, [router]);

  return null;
}
