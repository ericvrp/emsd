"use client";

import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

type MeasuredChartContainerProps = {
  children: (size: { height: number; width: number }) => ReactNode;
  className: string;
};

export function MeasuredChartContainer({
  children,
  className,
}: MeasuredChartContainerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ height: 0, width: 0 });

  useEffect(() => {
    const element = containerRef.current;

    if (!element) {
      return;
    }

    function updateSize() {
      const currentElement = containerRef.current;

      if (!currentElement) {
        return;
      }

      const nextWidth = Math.floor(currentElement.clientWidth);
      const nextHeight = Math.floor(currentElement.clientHeight);

      setSize((current) =>
        current.width === nextWidth && current.height === nextHeight
          ? current
          : { height: nextHeight, width: nextWidth },
      );
    }

    updateSize();

    const observer = new ResizeObserver(() => {
      updateSize();
    });

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <div className={className} ref={containerRef}>
      {size.width > 0 && size.height > 0 ? children(size) : null}
    </div>
  );
}
