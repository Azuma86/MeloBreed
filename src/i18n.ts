/** Supported UI languages and how a visitor's language is picked. */

export const LOCALES = ["ja", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";
/** Cookie that remembers a language picked with the switcher. */
export const LOCALE_COOKIE = "NEXT_LOCALE";

export const hasLocale = (value: string): value is Locale =>
  (LOCALES as readonly string[]).includes(value);

/**
 * The saved choice if any, else the highest-weighted `Accept-Language` entry we support
 * (`ja-JP` counts as `ja`), else English.
 */
export function pickLocale(
  acceptLanguage: string | null | undefined,
  saved?: string,
): Locale {
  if (saved !== undefined && hasLocale(saved)) return saved;
  const entries = (acceptLanguage ?? "")
    .split(",")
    .map((part, index) => {
      const [tag = "", ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      const weight = q === undefined ? 1 : Number(q.slice(2));
      return {
        language: tag.toLowerCase().split("-")[0] ?? "",
        weight: Number.isFinite(weight) ? weight : 0,
        index,
      };
    })
    .filter((e) => e.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.index - b.index);
  const match = entries.find((e) => hasLocale(e.language));
  return match !== undefined && hasLocale(match.language)
    ? match.language
    : DEFAULT_LOCALE;
}
