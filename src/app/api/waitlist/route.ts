import { isValidEmail, parseWaitlistRequest } from "@/app/_lib/waitlist";
import { getSupabaseServer } from "@/lib/supabase-server";

/** Postgres unique_violation: the email is already on the list. */
const UNIQUE_VIOLATION = "23505";

/** Adds an email to the Pro waitlist (AC12). */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }
  const parsed = parseWaitlistRequest(body);
  if (!parsed || !isValidEmail(parsed.email)) {
    return Response.json({ error: "invalid_email" }, { status: 400 });
  }
  // Honeypot filled: answer as if it worked, store nothing.
  if (parsed.honeypot !== "") return Response.json({ ok: true });

  const supabase = getSupabaseServer();
  if (!supabase) {
    return Response.json({ error: "not_configured" }, { status: 503 });
  }
  // No .select(): returning rows would need SELECT permission the table does not grant.
  const { error } = await supabase.from("waitlist").insert({
    email: parsed.email,
    locale: parsed.locale,
    source: parsed.source,
  });
  // Already registered: same answer, so the form does not reveal who is on the list.
  if (error && error.code !== UNIQUE_VIOLATION) {
    console.error("waitlist insert failed", error.code);
    return Response.json({ error: "insert_failed" }, { status: 500 });
  }
  return Response.json({ ok: true });
}
