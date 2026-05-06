"use client";

import { useEffect, useMemo, useState } from "react";

type VisibilityState = Record<string, boolean>;

export function useChartSeriesVisibility({
  seriesIds,
  storageKey,
}: {
  seriesIds: string[];
  storageKey: string | undefined;
}) {
  const seriesIdsKey = seriesIds.join(",");
  const defaultVisibility = useMemo(
    () => buildDefaultVisibility(seriesIds),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [seriesIdsKey],
  );
  const [visibility, setVisibility] = useState<VisibilityState | null>(null);

  useEffect(() => {
    if (!storageKey) {
      setVisibility(defaultVisibility);
      return;
    }

    const storedValue = window.localStorage.getItem(storageKey);

    if (!storedValue) {
      setVisibility(defaultVisibility);
      return;
    }

    try {
      const parsed = JSON.parse(storedValue) as unknown;

      if (!isVisibilityState(parsed)) {
        setVisibility(defaultVisibility);
        return;
      }

      setVisibility(mergeVisibility(defaultVisibility, parsed));
    } catch {
      setVisibility(defaultVisibility);
    }
  }, [defaultVisibility, storageKey]);

  useEffect(() => {
    if (!storageKey || visibility === null) {
      return;
    }

    window.localStorage.setItem(storageKey, JSON.stringify(visibility));
  }, [storageKey, visibility]);

  const resolvedVisibility = visibility ?? defaultVisibility;

  return {
    isVisible: (seriesId: string) => resolvedVisibility[seriesId] !== false,
    toggle: (seriesId: string) => {
      setVisibility((currentVisibility) => {
        const nextVisibility = currentVisibility ?? defaultVisibility;

        return {
          ...nextVisibility,
          [seriesId]: nextVisibility[seriesId] === false,
        };
      });
    },
  };
}

function buildDefaultVisibility(seriesIds: string[]): VisibilityState {
  return Object.fromEntries(seriesIds.map((seriesId) => [seriesId, true]));
}

function mergeVisibility(
  defaultVisibility: VisibilityState,
  storedVisibility: VisibilityState,
): VisibilityState {
  return {
    ...defaultVisibility,
    ...storedVisibility,
  };
}

function isVisibilityState(value: unknown): value is VisibilityState {
  if (!value || typeof value !== "object") {
    return false;
  }

  return Object.values(value).every((entry) => typeof entry === "boolean");
}
