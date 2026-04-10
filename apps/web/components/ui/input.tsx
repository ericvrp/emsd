import type * as React from "react";
import { UI_STYLES } from "../../lib/ui-colors";
import { cn } from "../../lib/utils";

export function Input({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(UI_STYLES.input, className)} {...props} />;
}
