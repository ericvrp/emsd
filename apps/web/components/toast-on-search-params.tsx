"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

export function ToastOnSearchParams() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const notice = searchParams.get("notice");
  const tone = searchParams.get("tone");
  const lastToasted = useRef<string | null>(null);

  useEffect(() => {
    if (!notice) {
      lastToasted.current = null;
      return;
    }

    const toastKey = `${tone}:${notice}`;
    if (lastToasted.current === toastKey) {
      return;
    }

    if (tone === "error") {
      toast.error(notice);
    } else {
      toast.success(notice);
    }

    lastToasted.current = toastKey;

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
