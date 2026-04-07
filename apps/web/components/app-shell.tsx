import type { ReactNode } from "react";
import { AppNav } from "./app-nav";
import { LiveRefreshIndicator } from "./live-refresh-indicator";

export function AppShell({
  children,
  generatedAt,
  headerActions,
}: {
  children: ReactNode;
  generatedAt: string;
  headerActions?: ReactNode;
}) {
  return (
    <main className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 px-4 py-4 sm:px-6 lg:px-8">
      <LiveRefreshIndicator generatedAt={generatedAt} />
      <section className="sticky top-0 z-10 flex min-h-20 items-center justify-between gap-4 rounded-3xl border border-white/10 bg-slate-950/75 p-4 backdrop-blur">
        <AppNav />
        {headerActions ?? null}
      </section>
      {children}
    </main>
  );
}
