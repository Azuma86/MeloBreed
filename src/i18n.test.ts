import { describe, expect, it } from "vitest";
import { pickLocale } from "@/i18n";

describe("pickLocale (AC1)", () => {
  it.each([
    ["ja", "ja"],
    ["ja-JP,ja;q=0.9,en-US;q=0.8", "ja"],
    ["en-US,en;q=0.9", "en"],
    ["en-US,ja;q=0.9", "en"],
    ["fr-FR,ja;q=0.5", "ja"],
    ["fr-FR,de;q=0.8", "en"],
    ["ja;q=0.3,en;q=0.7", "en"],
    ["ja;q=0", "en"],
    ["", "en"],
  ])("%j → %s", (header, expected) => {
    expect(pickLocale(header)).toBe(expected);
  });

  it("prefers a saved choice and ignores an unknown one", () => {
    expect(pickLocale("ja", "en")).toBe("en");
    expect(pickLocale("ja", "xx")).toBe("ja");
    expect(pickLocale(null)).toBe("en");
  });
});
