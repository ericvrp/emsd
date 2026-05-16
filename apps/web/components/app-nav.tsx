"use client";

import {
  BatteryCharging,
  Gauge,
  HandCoins,
  Layers3,
  SunMedium,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { UI_STYLES } from "../lib/ui-colors";
import { cn } from "../lib/utils";

export function AppNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selectedDay = searchParams.get("day");
  const navItems = [
    { href: "/", icon: Layers3, label: "Combined" },
    { href: "/old", icon: BatteryCharging, label: "Battery" },
    { href: "/old/forecast", icon: SunMedium, label: "Forecast" },
    { href: "/old/pricing", icon: HandCoins, label: "Pricing" },
    { href: "/old/grid", icon: Gauge, label: "Grid" },
  ];

  return (
    <nav
      className="flex flex-wrap items-center gap-4 md:gap-5"
      aria-label="Primary"
    >
      {navItems.map(({ href, icon: Icon, label }) => {
        const params = new URLSearchParams();

        if (selectedDay) {
          params.set("day", selectedDay);
        }

        const targetHref = params.toString()
          ? `${href}?${params.toString()}`
          : href;

        return (
          <Link
            aria-label={label}
            key={href}
            className={cn(
              UI_STYLES.tabItem,
              "px-1 py-1",
              pathname === href
                ? UI_STYLES.appNavActive
                : UI_STYLES.appNavInactive,
            )}
            href={targetHref}
            prefetch
            scroll={false}
          >
            <Icon size={14} />
            <span className="hidden sm:inline">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
