import type * as React from "react";
import { cn } from "../../lib/utils";

export function Input({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "flex h-11 w-full rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-cyan-400/50 disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
      {...props}
    />
  );
}
