"use client";

import { CloudSun, Gauge, HandCoins, History as HistoryIcon, Zap } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { UI_STYLES } from "../lib/ui-colors";
import { cn } from "../lib/utils";

export function AppNav() {
  const pathname = usePathname();
  const navItems = [
    { href: "/", icon: Zap, label: "Battery" },
    { href: "/forecast", icon: CloudSun, label: "Solar Forecast" },
    { href: "/pricing", icon: HandCoins, label: "Price" },
    { href: "/grid", icon: Gauge, label: "Grid" },
    { href: "/history", icon: HistoryIcon, label: "History" },
  ];

  return (
    <nav className="flex flex-wrap items-center gap-6" aria-label="Primary">
      {navItems.map(({ href, icon: Icon, label }) => (
        <Link
          key={href}
          className={cn(
            UI_STYLES.tabItem,
            pathname === href
              ? UI_STYLES.appNavActive
              : UI_STYLES.appNavInactive,
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
