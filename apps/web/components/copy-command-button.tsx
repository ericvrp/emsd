"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "./ui/button";

export function CopyCommandButton({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(command);
      } else if (typeof document !== "undefined") {
        const input = document.createElement("textarea");
        input.value = command;
        input.setAttribute("readonly", "true");
        input.style.position = "absolute";
        input.style.left = "-9999px";
        document.body.appendChild(input);
        input.select();
        document.execCommand("copy");
        document.body.removeChild(input);
      }

      toast.success("Command copied");
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      toast.error("Unable to copy command");
    }
  }

  return (
    <Button
      aria-label={`Copy command: ${command}`}
      className="h-9 w-9 rounded-lg px-0"
      onClick={handleCopy}
      type="button"
      variant="ghost"
    >
      {copied ? <Check size={16} /> : <Copy size={16} />}
    </Button>
  );
}
