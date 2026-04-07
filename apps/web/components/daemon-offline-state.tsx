import type { ReactNode } from "react";
import { CopyCommandButton } from "./copy-command-button";
import { OfflineAutoRetry } from "./offline-auto-retry";

export function DaemonOfflineState() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-10">
      <OfflineAutoRetry />
      <section className="mx-auto flex max-w-3xl flex-col items-center text-center">
        <p className="text-sm font-semibold uppercase tracking-[0.22em] text-rose-300">
          EMSD daemon offline
        </p>
        {/* <h1 className="mt-6 text-4xl font-semibold tracking-tight text-white sm:text-6xl">
          Start it with one of these methods
        </h1> */}

        <div className="mt-10 grid w-full gap-4 text-left">
          <StartMethod
            description="Start the daemon in watch mode for development. This is intended for active local development."
            title="Method 1: Development mode"
          >
            <CommandRow command="bun run daemon:dev" />
          </StartMethod>

          <StartMethod
            description="Start the checked-in daemon launcher script. This is the normal non-PM2 startup path in this repository."
            title="Method 2: Direct start"
          >
            <CommandRow command="bun run daemon:start" />
          </StartMethod>

          <StartMethod
            description="Start the daemon through PM2 using the checked-in ecosystem configuration."
            title="Method 3: PM2"
          >
            <CommandRow command="bun run daemon:start:pm2" />
          </StartMethod>
        </div>
      </section>
    </main>
  );
}

function StartMethod({
  children,
  description,
  title,
}: {
  children: ReactNode;
  description: string;
  title: string;
}) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
      <h2 className="text-lg font-semibold text-white">{title}</h2>
      <p className="mt-2 text-sm leading-7 text-slate-300">{description}</p>
      <div className="mt-4 space-y-3">{children}</div>
    </section>
  );
}

function CommandRow({ command }: { command: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-slate-950/60 p-2">
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap px-3 py-2 text-sm text-slate-200">
        {command}
      </code>
      <CopyCommandButton command={command} />
    </div>
  );
}
