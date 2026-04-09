"use client";

import { Toaster } from "sonner";

export function ToastViewport() {
  return (
    <Toaster
      position="bottom-right"
      richColors
      theme="dark"
      toastOptions={{
        style: {
          background:
            "linear-gradient(135deg, rgba(14, 28, 54, 0.98), rgba(5, 8, 22, 0.98))",
          border: "1px solid rgba(103, 232, 249, 0.32)",
          color: "#f8fafc",
          borderRadius: "16px",
          boxShadow:
            "0 22px 70px rgba(2, 6, 23, 0.55), 0 0 0 1px rgba(255,255,255,0.04) inset",
          fontSize: "0.98rem",
          fontWeight: 600,
          lineHeight: 1.45,
          minWidth: "320px",
          padding: "0.95rem 1rem",
        },
      }}
    />
  );
}
