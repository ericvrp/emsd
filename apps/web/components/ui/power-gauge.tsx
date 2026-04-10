import { formatAbsolutePowerValue } from "../../lib/power-format";
import { UI_STYLES } from "../../lib/ui-colors";
import { cn } from "../../lib/utils";

export function PowerGauge({
  className,
  label,
  max = 2400,
  state,
  value,
}: {
  className?: string;
  label: string;
  max?: number;
  state: string;
  value: number | null;
}) {
  const normalizedValue = value === null ? 0 : Math.min(max, Math.abs(value));
  const activeBars = Math.max(
    0,
    Math.min(4, Math.ceil((normalizedValue / max) * 4)),
  );

  return (
    <div
      className={cn(
        "rounded-xl border border-white/10 bg-white/[0.04] p-5",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
        <span>{label}</span>
        <span>{formatStateLabel(state)}</span>
      </div>

      <div className="mt-5 flex flex-col items-center">
        <div
          aria-label={`${label} ${formatPower(value)} strength ${activeBars} of 4`}
          className="flex h-[190px] w-full max-w-[340px] items-end justify-center gap-4 rounded-[2rem] border border-white/8 bg-slate-950/70 px-8 py-6"
          role="img"
        >
          {[1, 2, 3, 4].map((bar) => (
            <div
              className={cn(
                "w-10 rounded-t-2xl border border-white/10 bg-white/6 transition-all duration-300",
                getBarClass(state, bar <= activeBars),
              )}
              key={bar}
              style={{ height: `${48 + bar * 24}px` }}
            />
          ))}
        </div>

        <div className="mt-4 flex w-full max-w-[340px] items-center justify-between text-xs font-semibold text-slate-400">
          <span>0 W</span>
          <span>
            {max}
            {" W"}
          </span>
        </div>

        <p className="mt-3 whitespace-nowrap text-4xl font-semibold text-white">
          {formatPower(value)}
        </p>
      </div>
    </div>
  );
}

function formatPower(value: number | null): string {
  if (value === null) {
    return "Unavailable";
  }

  return formatAbsolutePowerValue(value);
}

function formatStateLabel(state: string): string {
  return state.replace(/-/g, " ");
}

function getBarClass(state: string, isActive: boolean): string {
  if (!isActive) {
    return "border-white/10 bg-white/6 shadow-none";
  }

  if (state === "charging") {
    return UI_STYLES.powerBarCharging;
  }

  if (state === "discharging") {
    return UI_STYLES.powerBarDischarging;
  }

  if (state === "idle") {
    return UI_STYLES.powerBarIdle;
  }

  return UI_STYLES.powerBarOffline;
}
