"use client";

import { RotateCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "./ui/button";

export function PageRefreshButton() {
  const router = useRouter();

  return (
    <Button onClick={() => router.refresh()} type="button" variant="danger">
      <RotateCw size={14} />
      Refresh page
    </Button>
  );
}
