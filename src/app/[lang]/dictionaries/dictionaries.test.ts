import { describe, expect, it } from "vitest";
import en from "./en.json";
import ja from "./ja.json";

/** Dotted paths of every string in a nested dictionary. */
function keys(value: unknown, prefix = ""): string[] {
  if (typeof value === "string") return [prefix];
  if (typeof value !== "object" || value === null) {
    throw new TypeError(`${prefix} is not a string or object`);
  }
  return Object.entries(value).flatMap(([k, v]) =>
    keys(v, prefix ? `${prefix}.${k}` : k),
  );
}

const placeholders = (text: string): string[] =>
  [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? "").sort();

describe("dictionaries (AC1)", () => {
  it("have exactly the same keys in Japanese and English", () => {
    expect(keys(ja).sort()).toEqual(keys(en).sort());
  });

  it("have no empty strings and the same placeholders", () => {
    const lookup = (dict: unknown, path: string): string =>
      path
        .split(".")
        .reduce<unknown>(
          (node, k) => (node as Record<string, unknown>)[k],
          dict,
        ) as string;
    for (const path of keys(en)) {
      const english = lookup(en, path);
      const japanese = lookup(ja, path);
      expect(english.trim(), path).not.toBe("");
      expect(japanese.trim(), path).not.toBe("");
      expect(placeholders(japanese), path).toEqual(placeholders(english));
    }
  });
});
