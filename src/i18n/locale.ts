import { useSyncExternalStore } from "react";
import catalog from "./catalog.json";
export type Language = "ar" | "en";
const listeners = new Set<() => void>();
let language: Language = "ar";
try {
  if (localStorage.getItem("unicore.language") === "en") language = "en";
} catch {
  /* Private storage may be unavailable. */
}
export const getLanguage = () => language;
export function setLanguage(value: Language) {
  language = value;
  try {
    localStorage.setItem("unicore.language", value);
  } catch {
    /* Preference remains usable in memory. */
  }
  document.documentElement.lang = value;
  document.documentElement.dir = value === "ar" ? "rtl" : "ltr";
  listeners.forEach((listener) => listener());
}
export function useLanguage() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getLanguage,
    () => "ar" as const,
  );
}
export function tr(key: string, args: unknown[] = []) {
  const entry = (catalog as Record<string, { ar: string; en: string }>)[key];
  return (entry?.[language] ?? entry?.ar ?? key).replace(
    /\{(\d+)\}/g,
    (_, index) => String(args[Number(index)] ?? ""),
  );
}
/** Lazy catalogs allow switching without remounting forms or translating stored academic values. */
export function dynamic<T extends object>(factory: () => T): T {
  return new Proxy(factory(), { get: (_, key) => Reflect.get(factory(), key) });
}
export const dateLabel = (
  date: Date,
  options: Intl.DateTimeFormatOptions = { dateStyle: "full" },
) =>
  new Intl.DateTimeFormat(language === "ar" ? "ar" : "en", {
    calendar: "gregory",
    ...options,
  }).format(date);
export const numberLabel = (value: number) =>
  new Intl.NumberFormat(language).format(value);

/** Reformat an already-visible system message on a language change; arguments remain untouched. */
export function translateMessage(message: string) {
  for (const [key, entry] of Object.entries(catalog)) {
    for (const source of [entry.ar, entry.en]) {
      const parts = source.split(/\{\d+\}/);
      const pattern = parts
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("(.*?)");
      const match = message.match(new RegExp("^" + pattern + "$"));
      if (match) return tr(key, match.slice(1));
    }
  }
  return message;
}
