"use client";

import { LoaderCircle } from "lucide-react";
import { useFormStatus } from "react-dom";
import { Button } from "./ui/button";

export function SubmitButton({
  children,
  className,
  disabled,
  showPendingIndicator = true,
  showPendingText = true,
  variant,
}: {
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
  showPendingIndicator?: boolean;
  showPendingText?: boolean;
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
      {pending ? (
        <>
          {showPendingIndicator ? (
            <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />
          ) : null}
          {showPendingText ? "Working..." : children}
        </>
      ) : (
        children
      )}
    </Button>
  );
}
