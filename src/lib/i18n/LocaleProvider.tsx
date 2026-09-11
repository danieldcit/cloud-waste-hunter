"use client";

import { createContext, useContext, useState } from "react";
import { translate, type Locale } from "@/lib/i18n/dictionaries";

const STORAGE_KEY = "cwh-locale";
const DEFAULT_LOCALE: Locale = "pt-BR";

interface LocaleContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string) => string;
}

const LocaleContext = createContext<LocaleContextValue | undefined>(undefined);

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    if (typeof window === "undefined") {
      return DEFAULT_LOCALE;
    }
    const stored = window.localStorage.getItem(STORAGE_KEY) as Locale | null;
    if (stored === "pt-BR" || stored === "en" || stored === "es") {
      return stored;
    }
    return DEFAULT_LOCALE;
  });

  const setLocale = (next: Locale) => {
    setLocaleState(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  };

  const t = (key: string) => translate(locale, key);

  return (
    <LocaleContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale(): LocaleContextValue {
  const context = useContext(LocaleContext);
  if (!context) {
    throw new Error("useLocale must be used within a LocaleProvider");
  }
  return context;
}
