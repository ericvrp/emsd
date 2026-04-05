import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { ToastViewport } from "../components/toast-viewport";

export const metadata: Metadata = {
  title: "EMSD Control Center",
  description:
    "Authenticated EMS management UI for sites, devices, and sources.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(99,102,241,0.22),transparent_28%),radial-gradient(circle_at_top_right,rgba(16,185,129,0.16),transparent_24%),linear-gradient(180deg,#050816_0%,#02040a_100%)] text-slate-100 antialiased">
        {children}
        <ToastViewport />
      </body>
    </html>
  );
}
