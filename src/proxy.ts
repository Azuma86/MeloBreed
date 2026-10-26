import { NextResponse, type NextRequest } from "next/server";
import { LOCALES, LOCALE_COOKIE, pickLocale } from "@/i18n";

/** Sends paths without a language prefix to /ja or /en. */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasPrefix = LOCALES.some(
    (locale) => pathname === `/${locale}` || pathname.startsWith(`/${locale}/`),
  );
  if (hasPrefix) return;

  const locale = pickLocale(
    request.headers.get("accept-language"),
    request.cookies.get(LOCALE_COOKIE)?.value,
  );
  request.nextUrl.pathname = `/${locale}${pathname === "/" ? "" : pathname}`;
  return NextResponse.redirect(request.nextUrl);
}

export const config = {
  // Skip the waitlist API, the analytics relay, Next internals and files with an extension.
  matcher: ["/((?!api|ingest|_next|.*\\..*).*)"],
};
