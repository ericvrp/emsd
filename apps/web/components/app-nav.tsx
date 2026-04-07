"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "../lib/utils";

export function AppNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-wrap items-center gap-6" aria-label="Primary">
      <Link
        className={cn(
          "inline-flex items-center border-b-2 border-transparent pb-1 text-sm font-medium text-slate-400 transition",
          pathname === "/"
            ? "border-white text-white"
            : "hover:border-white/25 hover:text-slate-200",
        )}
        href="/"
        prefetch
        scroll={false}
      >
        Live
      </Link>
    </nav>
  );
}
