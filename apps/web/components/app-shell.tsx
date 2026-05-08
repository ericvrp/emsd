import type { ReactNode } from "react";
import { AppNav } from "./app-nav";

export function AppShell({
  children,
  headerActions,
}: {
  children: ReactNode;
  headerActions?: ReactNode;
}) {
  return (
    <main className="flex w-full flex-col">
      <header className="sticky top-0 z-20 w-full border-b border-white/10 bg-slate-950/85 backdrop-blur-xl">
        <section className="mx-auto flex min-h-16 w-full max-w-[1600px] items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center">
            <AppNav />
          </div>
          <div className="flex shrink-0 items-center gap-3">
            {headerActions ?? null}
          </div>
        </section>
      </header>
      <section className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 px-4 pb-6 pt-2 sm:px-6 sm:pb-6 sm:pt-3 lg:px-8">
        {children}
      </section>
    </main>
  );
}
