"use client";

import { Eye, EyeOff } from "lucide-react";
import { signIn } from "next-auth/react";
import { useState } from "react";

export function LoginForm({ error }: { error: string | null }) {
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setLocalError(null);

    const result = await signIn("credentials", {
      password,
      callbackUrl: "/",
      redirect: false,
    });

    if (!result || result.error) {
      setLocalError("Invalid admin password.");
      setIsSubmitting(false);
      return;
    }

    window.location.assign(result.url ?? "/");
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <label className="block space-y-2">
        <span className="text-sm font-medium text-slate-300">Password</span>
        <div className="relative">
          <input
            autoComplete="current-password"
            className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 pr-14 text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-cyan-400/50"
            name="password"
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Enter admin password"
            required
            type={showPassword ? "text" : "password"}
            value={password}
          />
          <button
            aria-label={showPassword ? "Hide password" : "Show password"}
            className="absolute right-2 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-xl border border-white/10 bg-white/6 text-slate-200 transition hover:bg-white/10"
            onClick={() => setShowPassword((value) => !value)}
            type="button"
          >
            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </label>
      {error || localError ? (
        <p className="rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm font-medium text-rose-100">
          {localError ?? error}
        </p>
      ) : null}
      <button
        className="inline-flex w-full items-center justify-center rounded-2xl bg-gradient-to-r from-indigo-500 via-cyan-500 to-emerald-400 px-4 py-3 text-sm font-semibold text-slate-950 shadow-[0_20px_60px_rgba(6,182,212,0.18)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={isSubmitting}
        type="submit"
      >
        {isSubmitting ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}
