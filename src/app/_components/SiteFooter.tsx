"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Dictionary } from "@/app/[lang]/dictionaries";
import { LOCALE_COOKIE, type Locale } from "@/i18n";
import { useOpenAnalyticsSettings } from "./AnalyticsProvider";

interface Props {
  dict: Dictionary["footer"];
  lang: Locale;
}

export function SiteFooter({ dict, lang }: Props) {
  const openSettings = useOpenAnalyticsSettings();
  const pathname = usePathname();
  const other: Locale = lang === "ja" ? "en" : "ja";
  // Same page in the other language: /ja/privacy ↔ /en/privacy.
  const switchHref = pathname.replace(/^\/(ja|en)(?=\/|$)/, `/${other}`);

  return (
    <footer className="mt-auto border-t border-foreground/10 px-4 py-6 pb-28 text-sm">
      <nav className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-5 gap-y-2 opacity-80">
        <Link
          href={`/${lang}/privacy`}
          className="inline-flex min-h-11 items-center underline"
        >
          {dict.privacy}
        </Link>
        <button
          type="button"
          onClick={openSettings}
          className="min-h-11 underline"
        >
          {dict.analytics}
        </button>
        <Link
          href={switchHref}
          hrefLang={other}
          onClick={() => {
            document.cookie = `${LOCALE_COOKIE}=${other}; path=/; max-age=31536000; samesite=lax`;
          }}
          className="inline-flex min-h-11 items-center underline"
        >
          {dict.language}
        </Link>
      </nav>
    </footer>
  );
}
