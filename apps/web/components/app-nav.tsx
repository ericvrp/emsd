"use client";

import { Activity, CloudSun, HandCoins } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "../lib/utils";

export function AppNav() {
  const pathname = usePathname();
  const navItems = [
    { href: "/", icon: Activity, label: "Live" },
    { href: "/forecast", icon: CloudSun, label: "Forecast" },
    { href: "/pricing", icon: HandCoins, label: "Pricing" },
  ];

  return (
    <nav className="flex flex-wrap items-center gap-6" aria-label="Primary">
      {navItems.map(({ href, icon: Icon, label }) => (
        <Link
          key={href}
          className={cn(
            "inline-flex items-center gap-2 border-b-2 border-transparent px-1 py-2 text-sm font-medium text-slate-400 transition",
            pathname === href
              ? "border-white text-white"
              : "hover:border-white/25 hover:text-slate-200",
          )}
          href={href}
          prefetch
          scroll={false}
        >
          <Icon size={14} />
          {label}
        </Link>
      ))}
    </nav>
  );
}
