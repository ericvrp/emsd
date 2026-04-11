"use client";

import { createContext, useContext } from "react";

const LocaleContext = createContext("en-GB");

export function LocaleProvider({
  children,
  locale,
}: {
  children: React.ReactNode;
  locale: string;
}) {
  return (
    <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>
  );
}

export function useAppLocale(): string {
  return useContext(LocaleContext);
}
