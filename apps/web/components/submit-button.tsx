"use client";

import { useFormStatus } from "react-dom";
import { Button } from "./ui/button";

export function SubmitButton({
  children,
  className,
  disabled,
  variant,
}: {
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
  variant?: "default" | "ghost" | "danger";
}) {
  const { pending } = useFormStatus();

  return (
    <Button
      className={className}
      disabled={pending || disabled}
      type="submit"
      variant={variant ?? "default"}
    >
      {pending ? "Working..." : children}
    </Button>
  );
}
