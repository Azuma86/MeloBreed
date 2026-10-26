"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { Dictionary } from "@/app/[lang]/dictionaries";
import { track } from "@/app/_analytics/analytics";
import { isValidEmail, type WaitlistSource } from "@/app/_lib/waitlist";
import type { Locale } from "@/i18n";

interface Props {
  dict: Dictionary["pro"];
  lang: Locale;
  source: WaitlistSource;
  privacyLabel: string;
  onClose: () => void;
}

type Status = "idle" | "submitting" | "success" | "invalid" | "error";

export function ProModal({ dict, lang, source, privacyLabel, onClose }: Props) {
  const [email, setEmail] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialog.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit() {
    const address = email.trim();
    if (!isValidEmail(address)) {
      setStatus("invalid");
      return;
    }
    setStatus("submitting");
    try {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: address,
          locale: lang,
          source,
          honeypot,
        }),
      });
      if (!response.ok) throw new Error(String(response.status));
      setStatus("success");
      track("waitlist_submitted", { source });
    } catch {
      setStatus("error");
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pro-title"
        tabIndex={-1}
        className="w-full max-w-md rounded-2xl border border-foreground/15 bg-background p-5 shadow-xl outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 id="pro-title" className="text-lg font-semibold">
            {dict.title}{" "}
            <span className="ml-1 rounded-full bg-amber-400/20 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
              {dict.comingSoon}
            </span>
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 min-w-11 rounded-lg text-xl"
            aria-label={dict.close}
          >
            ×
          </button>
        </div>

        <ul className="mb-4 list-disc space-y-1 pl-5 text-sm">
          {Object.values(dict.features).map((feature) => (
            <li key={feature}>{feature}</li>
          ))}
        </ul>
        <p className="mb-4 text-2xl font-bold">{dict.price}</p>

        {status === "success" ? (
          <p role="status" className="rounded-lg bg-green-500/10 p-3 text-sm">
            {dict.success}
          </p>
        ) : (
          <form
            noValidate
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <p className="text-sm font-medium">{dict.notify}</p>
            <label className="sr-only" htmlFor="waitlist-email">
              {dict.emailLabel}
            </label>
            <input
              id="waitlist-email"
              type="email"
              autoComplete="email"
              inputMode="email"
              placeholder={dict.emailPlaceholder}
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (status === "invalid") setStatus("idle");
              }}
              aria-invalid={status === "invalid"}
              aria-describedby="waitlist-message"
              className="min-h-11 rounded-lg border border-foreground/20 bg-background px-3 text-base"
            />
            {/* Bots fill every field; people never see this one. */}
            <input
              type="text"
              name="mb_hp"
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              value={honeypot}
              onChange={(e) => setHoneypot(e.target.value)}
              className="absolute -left-[9999px] h-px w-px opacity-0"
            />
            <p
              id="waitlist-message"
              role="alert"
              className="min-h-5 text-sm text-red-600 dark:text-red-400"
            >
              {status === "invalid"
                ? dict.invalidEmail
                : status === "error"
                  ? dict.error
                  : ""}
            </p>
            <button
              type="submit"
              disabled={status === "submitting"}
              className="min-h-11 rounded-full bg-violet-600 px-5 font-semibold text-white hover:bg-violet-500 disabled:opacity-60"
            >
              {status === "submitting" ? dict.submitting : dict.submit}
            </button>
            <p className="text-xs opacity-70">
              {dict.privacyNote}{" "}
              <Link
                href={`/${lang}/privacy`}
                className="inline-flex min-h-11 items-center underline"
              >
                {privacyLabel}
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
