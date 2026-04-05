"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { toast } from "sonner";

export function ToastOnSearchParams({
  notice,
  tone,
}: {
  notice: string | null;
  tone: "error" | "success";
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!notice) {
      return;
    }

    if (tone === "error") {
      toast.error(notice);
    } else {
      toast.success(notice);
    }

    const params = new URLSearchParams(searchParams.toString());
    params.delete("notice");
    params.delete("tone");
    const nextUrl = params.toString()
      ? `${pathname}?${params.toString()}`
      : pathname;
    router.replace(nextUrl, { scroll: false });
  }, [notice, pathname, router, searchParams, tone]);

  return null;
}
