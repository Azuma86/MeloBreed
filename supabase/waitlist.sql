-- Pro waitlist (spec AC12, AC13). Run once in the Supabase SQL editor.
-- Only the server route writes here, with the secret key (service_role). The public API keys
-- can neither read nor write: RLS is on with no policies, and anon/authenticated get no grants.

create table if not exists public.waitlist (
  -- A UUID rather than an identity column: no sequence privileges to grant.
  id uuid primary key default gen_random_uuid(),
  email text not null check (char_length(email) <= 254),
  locale text not null check (locale in ('ja', 'en')),
  source text not null check (source in ('header', 'after_export')),
  created_at timestamptz not null default now()
);

-- One row per address, case-insensitively.
create unique index if not exists waitlist_email_key on public.waitlist (lower(email));

alter table public.waitlist enable row level security;

revoke all on table public.waitlist from anon, authenticated;
-- From 2026-10-30 new tables need explicit grants to be reachable through the Data API.
grant insert on table public.waitlist to service_role;
