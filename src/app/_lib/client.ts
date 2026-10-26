/** Browser helpers for the UI: storage, seeds, downloads and string templates. */
import { useSyncExternalStore } from "react";
import { deserialize, serialize, type Session } from "@/engine/session";

const SESSION_KEY = "melobreed.session";

const subscribeNothing = () => () => {};

/** False during the server render and hydration, true afterwards. */
export const useHydrated = (): boolean =>
  useSyncExternalStore(
    subscribeNothing,
    () => true,
    () => false,
  );

/** The saved session, or `undefined` if there is none, storage is blocked or it is invalid. */
export function loadSession(): Session | undefined {
  try {
    const text = localStorage.getItem(SESSION_KEY);
    return text === null ? undefined : deserialize(text);
  } catch {
    return undefined;
  }
}

export function saveSession(session: Session | undefined): void {
  try {
    if (session) localStorage.setItem(SESSION_KEY, serialize(session));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    // Storage blocked or full: the app still works, it just cannot resume later.
  }
}

/** A fresh random 32-bit seed for a new session. */
export function newSeed(): number {
  const value = new Uint32Array(1);
  crypto.getRandomValues(value);
  return value[0] ?? 0;
}

export function downloadFile(
  bytes: Uint8Array<ArrayBuffer>,
  filename: string,
): void {
  const url = URL.createObjectURL(new Blob([bytes], { type: "audio/midi" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  // iOS Safari reads the blob only after the user confirms the download prompt, so keep the
  // URL alive for a while (FileSaver.js uses 40 s).
  setTimeout(() => URL.revokeObjectURL(url), 40_000);
}

/** Replaces `{name}` placeholders. */
export const format = (
  template: string,
  values: Record<string, string | number>,
): string =>
  template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in values ? String(values[name]) : match,
  );

export const KEY_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
] as const;
