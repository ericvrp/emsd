import { Slot } from "@radix-ui/react-slot";
import type * as React from "react";
import { UI_STYLES } from "../../lib/ui-colors";
import { cn } from "../../lib/utils";

const buttonVariants = {
  default: UI_STYLES.buttonPrimary,
  ghost: UI_STYLES.buttonSecondary,
  danger: UI_STYLES.buttonDanger,
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
