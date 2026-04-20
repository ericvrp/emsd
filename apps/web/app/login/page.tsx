import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "../../auth";
import { LoginForm } from "../../components/login-form";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function getSingleValue(value: string | string[] | undefined): string | null {
  if (typeof value === "string") {
    return value;
  }

  return value?.[0] ?? null;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const session = await getServerSession(authOptions);

  if (session) {
    redirect("/");
  }

  const params = (await searchParams) ?? {};
  const error = getSingleValue(params.error);

  return (
    <main className="mx-auto grid min-h-screen w-full max-w-6xl place-items-center px-4 py-8 sm:px-6">
      <section className="grid w-full max-w-5xl overflow-hidden rounded-[2rem] border border-white/10 bg-slate-950/65 shadow-[0_30px_120px_rgba(0,0,0,0.35)] backdrop-blur xl:grid-cols-[1.1fr_0.9fr]">
        <div className="relative overflow-hidden border-b border-white/8 p-8 sm:p-10 xl:border-b-0 xl:border-r">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(99,102,241,0.22),transparent_35%),radial-gradient(circle_at_bottom_right,rgba(34,197,94,0.12),transparent_28%)]" />
          <div className="relative space-y-6">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-300/90">
              EMSD Secure Access
            </p>
            <h1 className="max-w-xl text-4xl font-semibold tracking-tight text-white sm:text-5xl">
              Secure access for your energy control center.
            </h1>
            <p className="max-w-lg text-base leading-7 text-slate-300">
              Sign in with the server-managed admin password. No signup, OAuth,
              email login, or account creation is supported.
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-white/6 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-400">
                  Auth
                </p>
                <p className="mt-2 text-sm font-medium text-slate-100">
                  Credentials only
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/6 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-400">
                  Scope
                </p>
                <p className="mt-2 text-sm font-medium text-slate-100">
                  Single admin access
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/6 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-400">
                  Backend
                </p>
                <p className="mt-2 text-sm font-medium text-slate-100">
                  Server-side only
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="p-8 sm:p-10">
          <header className="mb-6">
            <p className="text-sm font-medium text-slate-400">Admin Sign In</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">
              Enter your password
            </h2>
          </header>

          <LoginForm error={error} />

          <section className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm leading-6 text-slate-300">
            <p>
              Authentication is handled server-side through NextAuth
              credentials.
            </p>
            <p className="mt-2">
              Configure the admin password with{" "}
              <code className="rounded bg-white/8 px-1.5 py-0.5 text-slate-100">
                EMSD_ADMIN_PASSWORD
              </code>{" "}
              in the web app environment.
            </p>
            <p className="mt-4 rounded-2xl border border-amber-400/20 bg-amber-500/10 px-4 py-3 text-amber-100">
              Use of this app is entirely at your own responsibility. Battery
              charge and discharge power limits must match what is permitted by
              your installation and local rules. For example, in the Netherlands
              that can differ between a normal circuit and a dedicated breaker
              group. Verify your setup yourself before enabling control.
            </p>
          </section>
        </div>
      </section>
    </main>
  );
}
