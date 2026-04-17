export const UI_COLORS = {
  batteryChargeLevel: "#f8fafc",
  batteryPowerCharging: "#34d399",
  batteryPowerDischarging: "#38bdf8",
  cardBorder: "rgba(255,255,255,0.1)",
  cardBorderSoft: "rgba(255,255,255,0.08)",
  chartGrid: "rgba(148,163,184,0.12)",
  chartReference: "rgba(255,255,255,0.24)",
  chartSeriesFallback: "#06b6d4",
  chartTick: "rgba(226,232,240,0.72)",
  chartTickMuted: "rgba(148,163,184,0.75)",
  chartZeroLine: "rgba(148,163,184,0.36)",
  error: "#f43f5e",
  focus: "rgba(34,211,238,0.5)",
  forecast: "#84cc16",
  gridExport: "#8F71BF",
  gridImport: "#407BA7",
  price: "#ca8a04",
  priceSection: "#f59e0b",
  solarEnergy: "#f97316",
  solarPrediction: "#facc15",
  success: "#34d399",
  strategyAutomaticBorder: "rgba(255,255,255,0)",
  strategyCharge: "#34d399",
  strategyDischarge: "#7dd3fc",
  strategyIdle: "#b6bfcb",
  strategyManualBorder: "rgba(248,250,252,0.45)",
  strategySelfConsumption: "#c9c06f",
  textPrimary: "#f8fafc",
} as const;

export const UI_CHART_STYLES = {
  axisTick: { fill: UI_COLORS.chartTick, fontSize: 12 },
  axisTickMuted: { fill: UI_COLORS.chartTickMuted, fontSize: 12 },
  tooltipContentStyle: {
    backgroundColor: "rgba(15, 23, 42, 0.9)",
    borderColor: UI_COLORS.cardBorder,
    borderRadius: "8px",
    color: UI_COLORS.textPrimary,
  },
} as const;

export const UI_STYLES = {
  appNavActive: "border-white text-white",
  appNavInactive: "text-slate-200 hover:border-white/25 hover:text-white",
  batteryFillHigh: "bg-emerald-400/85",
  batteryFillLow: "bg-rose-500/85",
  batteryFillMid: "bg-sky-400/85",
  batteryFillUnknown: "bg-slate-500/70",
  buttonDanger:
    "inline-flex h-9 items-center justify-center gap-2 rounded-md border border-rose-400/20 bg-rose-500/10 px-4 text-sm font-medium text-rose-100 transition hover:bg-rose-500/15",
  buttonPrimary:
    "inline-flex h-9 items-center justify-center gap-2 rounded-md bg-gradient-to-r from-indigo-500 via-cyan-500 to-emerald-400 px-4 text-sm font-medium text-slate-950 shadow-[0_18px_50px_rgba(6,182,212,0.18)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60",
  buttonPrimaryLarge:
    "inline-flex items-center justify-center rounded-2xl bg-gradient-to-r from-indigo-500 via-cyan-500 to-emerald-400 px-4 py-3 text-sm font-semibold text-slate-950 shadow-[0_20px_60px_rgba(6,182,212,0.18)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60",
  buttonSecondary:
    "inline-flex h-9 items-center justify-center gap-2 rounded-md border border-white/10 bg-white/6 px-4 text-sm font-medium text-slate-100 transition hover:border-white/20 hover:bg-white/10",
  buttonSecondaryIcon:
    "inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/6 text-slate-200 transition hover:bg-white/10",
  card: "rounded-3xl border border-white/10 bg-slate-950/60 shadow-[0_20px_90px_rgba(0,0,0,0.25)] backdrop-blur",
  input:
    "flex h-11 w-full rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-cyan-400/50 disabled:cursor-not-allowed disabled:opacity-60",
  panel:
    "rounded-[1.6rem] border border-white/10 bg-slate-950/55 shadow-[0_20px_90px_rgba(0,0,0,0.25)] backdrop-blur",
  panelSection:
    "relative overflow-hidden rounded-[1.75rem] border border-white/10 bg-slate-950/55 p-5 shadow-[0_20px_90px_rgba(0,0,0,0.25)] backdrop-blur",
  powerBarCharging:
    "border-sky-300/30 bg-sky-300 shadow-[0_0_24px_rgba(125,211,252,0.32)]",
  powerBarDischarging:
    "border-amber-300/30 bg-amber-300 shadow-[0_0_24px_rgba(252,211,77,0.32)]",
  powerBarIdle:
    "border-emerald-300/30 bg-emerald-300 shadow-[0_0_24px_rgba(110,231,183,0.32)]",
  powerBarOffline:
    "border-slate-300/20 bg-slate-300 shadow-[0_0_24px_rgba(203,213,225,0.2)]",
  powerFillCharging: "bg-emerald-400/85",
  powerFillDischarging: "bg-sky-400/85",
  powerFillUnknown: "bg-slate-500/70",
  selectContent:
    "z-[120] min-w-[8rem] overflow-hidden rounded-xl border border-white/10 bg-slate-950 text-slate-100 shadow-lg",
  selectItem:
    "relative flex cursor-default select-none items-center rounded-lg py-2 pl-8 pr-3 text-sm outline-none focus:bg-white/10 data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
  selectTrigger:
    "flex h-11 w-full items-center justify-between rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2 text-sm text-slate-100 outline-none data-[placeholder]:text-slate-500",
  tabBar:
    "flex flex-wrap items-center justify-center gap-6 border-b border-white/10 px-4 pb-1",
  tabItem:
    "inline-flex items-center gap-2 border-b-2 border-transparent px-1 py-2 text-sm font-medium transition",
  tabItemActive: "border-white text-white",
  tabItemDisabled: "cursor-not-allowed text-slate-500 opacity-50",
  tabItemInactive: "text-slate-200 hover:border-white/25 hover:text-white",
  tooltipPanel:
    "rounded-lg border border-white/10 bg-slate-900/90 px-3 py-2 text-sm text-slate-50 shadow-lg backdrop-blur",
} as const;
