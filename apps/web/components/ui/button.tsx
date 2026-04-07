import { Slot } from "@radix-ui/react-slot";
import type * as React from "react";
import { cn } from "../../lib/utils";

const buttonVariants = {
  default:
    "bg-cyan-400 text-slate-950 shadow-sm hover:bg-cyan-300 disabled:bg-cyan-400/70",
  ghost:
    "border border-white/10 bg-white/5 text-slate-100 shadow-sm hover:bg-white/10 disabled:bg-white/5",
  danger:
    "border border-rose-400/20 bg-rose-500/10 text-rose-100 shadow-sm hover:bg-rose-500/15 disabled:bg-rose-500/10",
};

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean;
  variant?: keyof typeof buttonVariants;
}

export function Button({
  asChild = false,
  className,
  variant = "default",
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      className={cn(
        "inline-flex h-9 items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60",
        buttonVariants[variant],
        className,
      )}
      {...props}
    />
  );
}
