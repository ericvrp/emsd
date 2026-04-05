"use client";

import { Toaster } from "sonner";

export function ToastViewport() {
  return (
    <Toaster
      closeButton
      position="top-right"
      richColors
      theme="dark"
      toastOptions={{
        style: {
          background: "rgba(5, 8, 22, 0.96)",
          border: "1px solid rgba(255,255,255,0.1)",
          color: "#f8fafc",
          borderRadius: "16px",
        },
      }}
    />
  );
}
