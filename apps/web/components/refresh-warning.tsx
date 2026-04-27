import type { ReactNode } from "react";
import { cn } from "../lib/utils";

export function RefreshWarning({
  action,
  className,
  message,
}: {
  action?: ReactNode;
  className?: string;
  message: string;
}) {
  return (
    <div
      className={cn(
        "rounded-[1.25rem] border border-rose-400/20 bg-rose-500/10 p-4 text-sm text-rose-100",
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p>{message}</p>
        {action ?? null}
      </div>
    </div>
  );
}
