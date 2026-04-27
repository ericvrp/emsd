"use client";

import { RotateCw } from "lucide-react";
import { Button } from "./ui/button";

export function PageRefreshButton() {
  return (
    <Button
      onClick={() => window.location.reload()}
      type="button"
      variant="danger"
    >
      <RotateCw size={14} />
      Refresh page
    </Button>
  );
}
