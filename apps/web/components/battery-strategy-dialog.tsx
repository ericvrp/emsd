"use client";

import type { BatteryStrategyRecord } from "@emsd/core";
import { Settings2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { BatteryStrategyForm } from "./battery-strategy-form";
import { DialogPortal } from "./ui/dialog-portal";
import { Button } from "./ui/button";

export function BatteryStrategyDialog({
  batteryId,
  batteryName,
  siteId,
  strategy,
}: {
  batteryId: string;
  batteryName: string;
  siteId: string;
  strategy: BatteryStrategyRecord;
}) {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen]);

  return (
    <>
      <Button onClick={() => setIsOpen(true)} variant="ghost">
        <Settings2 size={16} />
        {formatStrategyLabel(strategy.strategyMode)}
      </Button>

      {isOpen ? (
        <DialogPortal>
          <div className="fixed inset-0 z-[100] overflow-y-auto bg-slate-950/75 p-4 backdrop-blur-sm">
            <div className="flex min-h-full items-center justify-center py-6">
              <div className="w-full max-w-xl rounded-3xl border border-white/10 bg-slate-950 p-6 shadow-[0_30px_120px_rgba(0,0,0,0.45)]">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold uppercase tracking-[0.22em] text-cyan-300">
                      Battery strategy
                    </p>
                    <h2 className="mt-3 text-3xl font-semibold text-white">
                      {batteryName}
                    </h2>
                  </div>
                  <Button
                    aria-label="Close strategy dialog"
                    className="h-9 w-9 px-0"
                    onClick={() => setIsOpen(false)}
                    type="button"
                    variant="ghost"
                  >
                    <X size={18} />
                  </Button>
                </div>

                <div className="mt-6">
                  <BatteryStrategyForm
                    batteryId={batteryId}
                    returnPath="/"
                    siteId={siteId}
                    strategy={strategy}
                    submitLabel="Save strategy"
                  />
                </div>
              </div>
            </div>
          </div>
        </DialogPortal>
      ) : null}
    </>
  );
}

function formatStrategyLabel(
  value: BatteryStrategyRecord["strategyMode"],
): string {
  if (value === "self-consumption") {
    return "Strategy: Self-consumption";
  }

  if (value === "manual") {
    return "Strategy: Manual";
  }

  return "Strategy: Auto";
}
