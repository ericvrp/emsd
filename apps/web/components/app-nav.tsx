"use client";

import { Activity } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "../lib/utils";

export function AppNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-wrap items-center gap-6" aria-label="Primary">
      <Link
        className={cn(
          "inline-flex items-center gap-2 border-b-2 border-transparent px-1 py-2 text-sm font-medium text-slate-400 transition",
          pathname === "/"
            ? "border-white text-white"
            : "hover:border-white/25 hover:text-slate-200",
        )}
        href="/"
        prefetch
        scroll={false}
      >
        <Activity size={14} />
        Live
      </Link>
    </nav>
  );
}
