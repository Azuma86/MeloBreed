"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useState } from "react";
import type { Dictionary } from "@/app/[lang]/dictionaries";
import {
  denyConsent,
  grantConsent,
  readConsent,
  startAnalytics,
  type Consent,
} from "@/app/_analytics/analytics";
import { useHydrated } from "@/app/_lib/client";
import type { Locale } from "@/i18n";

const SettingsContext = createContext<() => void>(() => {});

/** Opens the consent banner again (footer link). */
export const useOpenAnalyticsSettings = () => useContext(SettingsContext);

interface Props {
  dict: Dictionary["consent"];
  lang: Locale;
  children: React.ReactNode;
}

/** Asks for analytics consent on the first visit and starts PostHog only once it is given. */
export function AnalyticsProvider({ dict, lang, children }: Props) {
  const hydrated = useHydrated();
  const [consent, setConsent] = useState<Consent | undefined>(() =>
    typeof window === "undefined" ? undefined : readConsent(),
  );
  const [reopened, setReopened] = useState(false);

  useEffect(() => {
    if (consent === "granted") startAnalytics();
  }, [consent]);

  const choose = (choice: Consent) => {
    if (choice === "granted") grantConsent();
    else denyConsent();
    setConsent(choice);
    setReopened(false);
  };

  const visible = hydrated && (consent === undefined || reopened);

  return (
    <SettingsContext.Provider value={() => setReopened(true)}>
      {children}
      {visible && (
        <div
          role="region"
          aria-label={dict.privacy}
          className="fixed inset-x-0 bottom-0 z-40 border-t border-foreground/15 bg-background py-4 shadow-[0_-4px_16px_rgba(0,0,0,0.08)]"
        >
          <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 sm:flex-row sm:items-center">
            <p className="flex-1 text-sm">
              {dict.message}{" "}
              <Link
                href={`/${lang}/privacy`}
                className="inline-flex min-h-11 items-center underline"
              >
                {dict.privacy}
              </Link>
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => choose("denied")}
                className="min-h-11 flex-1 rounded-full border border-foreground/20 px-4 text-sm font-medium sm:flex-none"
              >
                {dict.decline}
              </button>
              <button
                type="button"
                onClick={() => choose("granted")}
                className="min-h-11 flex-1 rounded-full bg-violet-600 px-4 text-sm font-semibold text-white sm:flex-none"
              >
                {dict.accept}
              </button>
            </div>
          </div>
        </div>
      )}
    </SettingsContext.Provider>
  );
}
