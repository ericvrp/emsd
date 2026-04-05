import { Activity, SlidersHorizontal } from "lucide-react";
import Link from "next/link";

export function AppNav({ current }: { current: "config" | "status" }) {
  return (
    <nav className="mt-3 flex flex-wrap gap-2" aria-label="Primary">
      <Link
        className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-semibold transition ${
          current === "config"
            ? "border-emerald-400/40 bg-white/12 text-white"
            : "border-white/10 bg-white/5 text-slate-300 hover:border-white/20 hover:bg-white/8"
        }`}
        href="/config"
      >
        <SlidersHorizontal size={14} />
        Config
      </Link>
      <Link
        className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-semibold transition ${
          current === "status"
            ? "border-cyan-400/40 bg-white/12 text-white"
            : "border-white/10 bg-white/5 text-slate-300 hover:border-white/20 hover:bg-white/8"
        }`}
        href="/"
      >
        <Activity size={14} />
        Live Status
      </Link>
    </nav>
  );
}
