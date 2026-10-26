import { describe, expect, it } from "vitest";
import { isValidEmail, parseWaitlistRequest } from "@/app/_lib/waitlist";

describe("isValidEmail", () => {
  it.each(["a@b.co", "first.last+tag@example.co.jp"])("accepts %s", (email) => {
    expect(isValidEmail(email)).toBe(true);
  });

  it.each([
    "",
    "plain",
    "a@b",
    "a @b.co",
    "a@@b.co",
    `${"a".repeat(250)}@b.co`,
  ])("rejects %j", (email) => {
    expect(isValidEmail(email)).toBe(false);
  });
});

describe("parseWaitlistRequest", () => {
  const ok = {
    email: " Me@Example.com ",
    locale: "ja",
    source: "header",
    honeypot: "",
  };

  it("normalises the email and keeps the honeypot", () => {
    expect(parseWaitlistRequest(ok)).toEqual({
      email: "me@example.com",
      locale: "ja",
      source: "header",
      honeypot: "",
    });
    expect(parseWaitlistRequest({ ...ok, honeypot: "ACME" })?.honeypot).toBe(
      "ACME",
    );
  });

  it.each([
    null,
    "text",
    { ...ok, email: 3 },
    { ...ok, locale: "fr" },
    { ...ok, source: "footer" },
  ])("rejects %j", (body) => {
    expect(parseWaitlistRequest(body)).toBeUndefined();
  });
});
