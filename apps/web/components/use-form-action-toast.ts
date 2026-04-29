"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { toast } from "sonner";
import type { ActionResult } from "../app/actions";

type FormAction = (formData: FormData) => Promise<ActionResult>;

export function useFormActionToast(
  action: FormAction,
  options?: {
    onSuccess?: () => void;
    refresh?: boolean;
  },
) {
  const router = useRouter();

  return useCallback(
    async (formData: FormData) => {
      const result = await action(formData);

      if (result.tone === "error") {
        toast.error(result.notice);
        return;
      }

      toast.success(result.notice);
      options?.onSuccess?.();

      if (options?.refresh ?? true) {
        router.refresh();
      }
    },
    [action, options, router],
  );
}
