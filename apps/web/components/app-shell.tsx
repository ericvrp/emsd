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
    <main className="flex w-full flex-col">
      <LiveRefreshIndicator generatedAt={generatedAt} />
      <header className="sticky top-0 z-20 w-full border-b border-white/10 bg-slate-950/85 backdrop-blur-xl">
        <section className="mx-auto flex min-h-20 w-full max-w-[1600px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-6">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-cyan-300">
                EMSD
              </p>
              <p className="mt-1 text-sm text-slate-400">Energy management</p>
            </div>
            <AppNav />
          </div>
          <div className="flex shrink-0 items-center gap-3">
            {headerActions ?? null}
          </div>
        </section>
      </header>
      <section className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        {children}
      </section>
    </main>
  );
}
