"use client";

import { useEffect, useState } from "react";

export function DaemonIndicator({
  generatedAt,
  running,
  title,
}: {
  generatedAt: string;
  running: boolean;
  title: string;
}) {
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    void generatedAt;
    setIsRefreshing(true);
    const timeout = window.setTimeout(() => {
      setIsRefreshing(false);
    }, 1200);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [generatedAt]);

  return (
    <div
      aria-label={running ? "Daemon running" : "Daemon offline"}
      className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/6"
      title={title}
    >
      <span
        className={`h-3 w-3 rounded-full transition-all ${running ? "bg-emerald-400" : "bg-slate-400"} ${running && isRefreshing ? "scale-110 shadow-[0_0_24px_rgba(52,211,153,1)]" : running ? "shadow-[0_0_12px_rgba(52,211,153,0.7)]" : ""}`}
      />
    </div>
  );
}
