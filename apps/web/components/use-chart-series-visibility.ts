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
    () =>
      buildDefaultVisibility(
        seriesIdsKey === "" ? [] : seriesIdsKey.split(","),
      ),
    [seriesIdsKey],
  );
  const [visibility, setVisibility] = useState<VisibilityState | null>(null);

  useEffect(() => {
    if (!storageKey) {
      setVisibility((current) =>
        areVisibilityStatesEqual(current, defaultVisibility)
          ? current
          : defaultVisibility,
      );
      return;
    }

    const storedValue = window.localStorage.getItem(storageKey);

    if (!storedValue) {
      setVisibility((current) =>
        areVisibilityStatesEqual(current, defaultVisibility)
          ? current
          : defaultVisibility,
      );
      return;
    }

    try {
      const parsed = JSON.parse(storedValue) as unknown;

      if (!isVisibilityState(parsed)) {
        setVisibility((current) =>
          areVisibilityStatesEqual(current, defaultVisibility)
            ? current
            : defaultVisibility,
        );
        return;
      }

      const nextVisibility = mergeVisibility(defaultVisibility, parsed);
      setVisibility((current) =>
        areVisibilityStatesEqual(current, nextVisibility)
          ? current
          : nextVisibility,
      );
    } catch {
      setVisibility((current) =>
        areVisibilityStatesEqual(current, defaultVisibility)
          ? current
          : defaultVisibility,
      );
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

function areVisibilityStatesEqual(
  left: VisibilityState | null,
  right: VisibilityState,
): boolean {
  if (left === null) {
    return false;
  }

  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);

  if (leftKeys.length !== rightKeys.length) {
    return false;
  }

  return rightKeys.every((key) => left[key] === right[key]);
}
