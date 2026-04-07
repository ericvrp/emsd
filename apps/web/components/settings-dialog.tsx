"use client";

import { Settings, X } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { DialogPortal } from "./ui/dialog-portal";
import { Button } from "./ui/button";

export function SettingsDialog({
  children,
  defaultOpen = false,
}: {
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

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

  function openDialog() {
    setIsOpen(true);
  }

  function closeDialog() {
    setIsOpen(false);
  }

  return (
    <>
      <Button onClick={openDialog} type="button" variant="ghost">
        <Settings size={16} />
        Settings
      </Button>

      {isOpen ? (
        <DialogPortal>
          <div className="fixed inset-0 z-[100] overflow-y-auto bg-slate-950/75 p-4 backdrop-blur-sm">
            <div className="flex min-h-full items-start justify-center py-6">
              <div className="flex h-[min(90vh,960px)] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-white/10 bg-slate-950 p-4 shadow-[0_30px_120px_rgba(0,0,0,0.45)] sm:p-6">
                <div className="mb-4 flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold uppercase tracking-[0.22em] text-cyan-300">
                      Settings
                    </p>
                    {/* <h2 className="mt-3 text-3xl font-semibold text-white">
                      EMSD settings
                    </h2> */}
                  </div>
                  <Button
                    aria-label="Close settings dialog"
                    className="h-9 w-9 px-0"
                    onClick={closeDialog}
                    type="button"
                    variant="ghost"
                  >
                    <X size={18} />
                  </Button>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
              </div>
            </div>
          </div>
        </DialogPortal>
      ) : null}
    </>
  );
}
