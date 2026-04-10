import type { ReactNode } from "react";

type SectionSummaryCardProps = {
  children: ReactNode;
  title: string;
};

export function SectionSummaryCard({
  children,
  title,
}: SectionSummaryCardProps) {
  return (
    <div className="rounded-[1.4rem] border border-amber-400/20 bg-amber-500/10 px-4 py-3 text-right">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-100/80">
        {title}
      </p>
      <div className="mt-2">{children}</div>
    </div>
  );
}
