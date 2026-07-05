/**
 * Lightweight i18n runtime.
 *
 * Translation messages live in i18n.messages.ts. This file owns language
 * resolution, interpolation, React context, and locale-aware formatting.
 */

import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import type { AppLanguage, LanguageMode } from "@shared/types";
import { LOCALES, zhCN, type TranslationKey } from "./i18n.messages";

export type { TranslationKey } from "./i18n.messages";

type TranslationParams = Record<string, string | number>;

export interface I18nFormatters {
  dateTime: (
    value: number | Date | null | undefined,
    options?: Intl.DateTimeFormatOptions,
  ) => string;
  number: (value: number, options?: Intl.NumberFormatOptions) => string;
  compactNumber: (value: number) => string;
  bytes: (value: number) => string;
  usd: (value: number) => string;
  relativeDuration: (futureTimestamp: number | null | undefined, expiredLabel: string) => string;
  fixed: (value: number, digits: number) => string;
}

export interface I18nContextValue {
  locale: AppLanguage;
  t: (key: string, params?: TranslationParams) => string;
  f: I18nFormatters;
}

export function resolveLanguage(mode: LanguageMode, systemLocale?: string | null): AppLanguage {
  if (mode !== "system") return mode;
  const normalized = (systemLocale || "").toLowerCase();
  if (normalized.startsWith("zh")) return "zh-CN";
  if (normalized.startsWith("en")) return "en";
  return "en";
}

export const LANGUAGE_OPTIONS: { value: LanguageMode; labelKey: TranslationKey }[] = [
  { value: "system", labelKey: "system.language.system" },
  { value: "zh-CN", labelKey: "system.language.zhCN" },
  { value: "en", labelKey: "system.language.en" },
];

export function translate(locale: AppLanguage, key: string, params?: TranslationParams): string {
  const dict = LOCALES[locale] ?? zhCN;
  let text = dict[key as TranslationKey] ?? zhCN[key as TranslationKey] ?? key;
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{${name}\\}`, "g"), String(value));
    }
  }
  return text;
}

export function createFormatters(locale: AppLanguage): I18nFormatters {
  const normalizedLocale = locale === "zh-CN" ? "zh-CN" : "en-US";

  return {
    dateTime(value, options) {
      if (value == null) return "";
      return new Intl.DateTimeFormat(normalizedLocale, {
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        ...options,
      }).format(value instanceof Date ? value : new Date(value));
    },
    number(value, options) {
      if (!Number.isFinite(value)) return "0";
      return new Intl.NumberFormat(normalizedLocale, options).format(value);
    },
    compactNumber(value) {
      if (!Number.isFinite(value)) return "0";
      return new Intl.NumberFormat(normalizedLocale, {
        notation: "compact",
        maximumFractionDigits: value < 10_000 ? 1 : 0,
      }).format(value);
    },
    bytes(value) {
      if (!Number.isFinite(value) || value <= 0) return "0 B";
      const units = ["B", "KB", "MB", "GB", "TB"];
      let amount = value;
      let unitIndex = 0;
      while (amount >= 1024 && unitIndex < units.length - 1) {
        amount /= 1024;
        unitIndex += 1;
      }
      const maximumFractionDigits = unitIndex === 0 ? 0 : 1;
      return `${new Intl.NumberFormat(normalizedLocale, {
        maximumFractionDigits,
        minimumFractionDigits: unitIndex === 0 ? 0 : 1,
      }).format(amount)} ${units[unitIndex]}`;
    },
    usd(value) {
      const formatter = new Intl.NumberFormat(normalizedLocale, {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 2,
      });
      if (!Number.isFinite(value) || value <= 0) return formatter.format(0);
      if (value < 0.01) {
        return `<${formatter.format(0.01)}`;
      }
      return new Intl.NumberFormat(normalizedLocale, {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: value < 1 ? 3 : 2,
      }).format(value);
    },
    relativeDuration(futureTimestamp, expiredLabel) {
      if (futureTimestamp == null) return expiredLabel;
      const remaining = futureTimestamp - Date.now();
      if (remaining <= 0) return expiredLabel;
      const days = Math.floor(remaining / 86_400_000);
      const hours = Math.ceil((remaining % 86_400_000) / 3_600_000);
      if (days <= 0) return translate(locale, "format.duration.hours", { hours });
      return translate(locale, "format.duration.daysHours", { days, hours });
    },
    fixed(value, digits) {
      if (!Number.isFinite(value)) return "0";
      return new Intl.NumberFormat(normalizedLocale, {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      }).format(value);
    },
  };
}

const fallbackFormatters = createFormatters("zh-CN");

const I18nContext = createContext<I18nContextValue>({
  locale: "zh-CN",
  t: (key, params) => translate("zh-CN", key, params),
  f: fallbackFormatters,
});

export function AppI18nProvider({
  locale,
  children,
}: {
  locale: AppLanguage;
  children: ReactNode;
}): React.JSX.Element {
  useEffect(() => {
    if (typeof document !== "undefined") document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      t: (key, params) => translate(locale, key, params),
      f: createFormatters(locale),
    }),
    [locale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useT(): I18nContextValue {
  return useContext(I18nContext);
}
