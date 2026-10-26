/**
 * Consent-gated analytics. posthog-js is neither imported nor initialised until the visitor
 * allows it: `posthog.init` alone makes network requests, so loading it early would leak.
 */
import type { PostHog } from "posthog-js";

export type AnalyticsEvent =
  | "session_started"
  | "candidate_played"
  | "generation_bred"
  | "midi_exported"
  | "pro_viewed"
  | "waitlist_submitted";

export type Consent = "granted" | "denied";

const CONSENT_KEY = "melobreed.consent";
const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const REGION = process.env.NEXT_PUBLIC_POSTHOG_REGION === "eu" ? "eu" : "us";

let client: PostHog | undefined;
let loading: Promise<void> | undefined;
const queue: [AnalyticsEvent, Record<string, unknown>][] = [];
/**
 * The choice made on this page. Kept in memory as well as storage, so it holds when storage is
 * blocked and so a decline made while posthog-js is still loading is seen when it arrives.
 */
let choice: Consent | undefined;

export function readConsent(): Consent | undefined {
  if (choice) return choice;
  try {
    const value = localStorage.getItem(CONSENT_KEY);
    return value === "granted" || value === "denied" ? value : undefined;
  } catch {
    return undefined;
  }
}

function writeConsent(consent: Consent): void {
  choice = consent;
  try {
    localStorage.setItem(CONSENT_KEY, consent);
  } catch {
    // Storage blocked (private mode): the in-memory choice lasts for this page.
  }
}

/** Loads and initialises PostHog. Call only after consent. */
export function startAnalytics(): void {
  if (!POSTHOG_KEY || client || loading) return;
  loading = import("posthog-js")
    .then(({ default: posthog }) => {
      // The visitor may have declined while the chunk was loading.
      if (readConsent() !== "granted") {
        loading = undefined;
        return;
      }
      posthog.init(POSTHOG_KEY, {
        // Relayed through next.config.ts rewrites, so ad blockers drop fewer events.
        api_host: "/ingest",
        ui_host: `https://${REGION}.posthog.com`,
        defaults: "2026-08-30",
        // Feature flags, surveys, recordings and autocapture are not used: no extra calls.
        advanced_disable_flags: true,
        disable_surveys: true,
        disable_session_recording: true,
        disable_external_dependency_loading: true,
        autocapture: false,
        capture_pageleave: false,
        // Anonymous visitors need person profiles for week-later retention to count.
        person_profiles: "always",
      });
      client = posthog;
      for (const [event, properties] of queue.splice(0)) {
        posthog.capture(event, properties);
      }
    })
    .catch(() => {
      loading = undefined;
    });
}

export function grantConsent(): void {
  writeConsent("granted");
  if (client) client.opt_in_capturing({ captureEventName: false });
  else startAnalytics();
}

export function denyConsent(): void {
  writeConsent("denied");
  queue.length = 0;
  if (client) {
    client.opt_out_capturing();
    client.reset();
  }
}

/** Records an event if the visitor has allowed analytics; otherwise does nothing. */
export function track(
  event: AnalyticsEvent,
  properties: Record<string, unknown> = {},
): void {
  if (!POSTHOG_KEY || readConsent() !== "granted") return;
  if (client) {
    client.capture(event, properties);
  } else {
    queue.push([event, properties]);
    startAnalytics();
  }
}
