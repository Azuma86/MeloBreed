/** Waitlist request shape and validation, shared by the Pro form and the API route. */
import { hasLocale, type Locale } from "@/i18n";

export const WAITLIST_SOURCES = ["header", "after_export"] as const;
export type WaitlistSource = (typeof WAITLIST_SOURCES)[number];

export const MAX_EMAIL_LENGTH = 254;

/** A pragmatic check: one @, no spaces, a dot in the domain, and the RFC 5321 length limit. */
export const isValidEmail = (email: string): boolean =>
  email.length <= MAX_EMAIL_LENGTH && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

export interface WaitlistRequest {
  email: string;
  locale: Locale;
  source: WaitlistSource;
  /** Honeypot: filled only by bots. */
  honeypot: string;
}

/** Parses an untrusted request body, or returns `undefined` if it is malformed. */
export function parseWaitlistRequest(
  body: unknown,
): WaitlistRequest | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const b = body as Record<string, unknown>;
  if (
    typeof b.email !== "string" ||
    typeof b.locale !== "string" ||
    !hasLocale(b.locale) ||
    typeof b.source !== "string" ||
    !(WAITLIST_SOURCES as readonly string[]).includes(b.source)
  ) {
    return undefined;
  }
  return {
    email: b.email.trim().toLowerCase(),
    locale: b.locale,
    source: b.source as WaitlistSource,
    honeypot: typeof b.honeypot === "string" ? b.honeypot : "",
  };
}
