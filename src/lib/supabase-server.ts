import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | undefined;

/**
 * Server-only Supabase client using the secret key, which bypasses RLS. The waitlist table has
 * RLS on and no policies, so this route is the only way to write to it.
 * Returns `undefined` when the environment is not configured (e.g. local dev without keys).
 */
export function getSupabaseServer(): SupabaseClient | undefined {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return undefined;
  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}
