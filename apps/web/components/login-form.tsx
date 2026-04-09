"use client";

import { Eye, EyeOff } from "lucide-react";
import { signIn } from "next-auth/react";
import { useState } from "react";
import { UI_STYLES } from "../lib/ui-colors";
import { Input } from "./ui/input";

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
      <label className="block space-y-2" htmlFor="login-password">
        <span className="text-sm font-medium text-slate-300">Password</span>
        <div className="relative">
          <Input
            autoComplete="current-password"
            className="h-auto rounded-2xl bg-slate-950/70 px-4 py-3 pr-14"
            id="login-password"
            name="password"
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Enter admin password"
            required
            type={showPassword ? "text" : "password"}
            value={password}
          />
          <button
            aria-label={showPassword ? "Hide password" : "Show password"}
            className={`absolute right-2 top-1/2 -translate-y-1/2 ${UI_STYLES.buttonSecondaryIcon}`}
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
        className={`w-full ${UI_STYLES.buttonPrimaryLarge}`}
        disabled={isSubmitting}
        type="submit"
      >
        {isSubmitting ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}
