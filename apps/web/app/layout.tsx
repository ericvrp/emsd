import type { Metadata } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import "./globals.css";
import { LocaleProvider } from "../components/locale-provider";
import { ToastViewport } from "../components/toast-viewport";

export const metadata: Metadata = {
  title: "EMS",
  description: "Energy Management System",
  icons: {
    icon: "/favicon.png",
    apple: "/favicon.png",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  const requestHeaders = await headers();
  const locale = getPreferredLocale(requestHeaders.get("accept-language"));

  return (
    <html lang={locale} suppressHydrationWarning>
      <body
        className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(99,102,241,0.22),transparent_28%),radial-gradient(circle_at_top_right,rgba(16,185,129,0.16),transparent_24%),linear-gradient(180deg,#050816_0%,#02040a_100%)] text-slate-100 antialiased"
        suppressHydrationWarning
      >
        <LocaleProvider locale={locale}>
          <div className="min-h-screen [content-visibility:auto]">
            {children}
          </div>
          <ToastViewport />
        </LocaleProvider>
      </body>
    </html>
  );
}

function getPreferredLocale(acceptLanguage: string | null): string {
  const rawLocale = acceptLanguage?.split(",")[0]?.split(";")[0]?.trim();

  if (!rawLocale) {
    return "en-GB";
  }

  try {
    return Intl.getCanonicalLocales(rawLocale)[0] ?? "en-GB";
  } catch {
    return "en-GB";
  }
}
