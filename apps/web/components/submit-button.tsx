"use client";

import { useFormStatus } from "react-dom";
import { Button } from "./ui/button";

export function SubmitButton({
  children,
  className,
  variant,
}: {
  children: React.ReactNode;
  className?: string;
  variant?: "default" | "ghost" | "danger";
}) {
  const { pending } = useFormStatus();

  return (
    <Button
      className={className}
      disabled={pending}
      type="submit"
      variant={variant ?? "default"}
    >
      {pending ? "Working..." : children}
    </Button>
  );
}
