# MeloBreed

Music generation by interactive evolutionary computation: the user picks the melodies they like, and the app breeds new ones from them.
The goal is revenue, so weigh decisions by how they serve paying users.

## Status

- Read `docs/status.md` first: current state, what is unverified, and next steps (in Japanese; update it at the end of each session).
- Validation prototype built per `docs/specs/2026-10-26-validation-prototype.md`: breeding UI, MIDI export, consent-gated PostHog, Pro waitlist. No accounts or payments yet.
- Target users (hobbyist beatmakers / DTMers) and pricing are provisional, under test; don't change them without asking.

## Stack

- Next.js 16 (App Router), React 19, TypeScript (strict + `noUncheckedIndexedAccess`), Tailwind CSS v4. Deploys to Vercel and must work in mobile browsers.
- Evolution engine: `src/engine/`, pure TypeScript. Melodies are plain data (note sequences: pitch, start, duration), not audio.
- Playback: Tone.js in the browser only. No server-side audio rendering, which keeps hosting cost near zero.
- Accounts and saved melodies: Supabase (auth + Postgres); installed only for the Pro waitlist so far (server-side secret key). Payments: Stripe, not installed yet; add it with the first feature that needs it.
- Analytics: PostHog, loaded only after the visitor consents.
- Node 24 (pinned in `mise.toml` and `package.json` `engines`), npm.

## Commands

- `npm run dev`: dev server at http://localhost:3000
- `npm run verify`: format check, lint, typecheck, unit tests. The same as CI; the Stop-hook gate runs it.
- `npm run build`: production build (CI runs it after verify)
- `npx vitest run <file>` runs one test file; `npx vitest run -t "<name>"` runs one test.
- `npm run format` (Prettier write) and `npx eslint --fix <path>`
- End-to-end tests (Playwright) are not set up yet.

## Layout

- `src/app/`: UI (App Router)
- `src/engine/`: evolution engine; unit tests sit next to the code as `*.test.ts` (Vitest, node environment)
- `.github/`: CI (`workflows/ci.yml`) and Dependabot

## Conventions

- `src/engine/` must not import UI, audio or I/O libraries (React, Next, Tone.js, Supabase, Stripe), Node built-ins, or anything outside `src/engine/`, and must not use `Math.random`, `Date.now` or browser globals. ESLint enforces this (`eslint.config.mjs`).
- Randomness comes from an injected `Rng` (`createRng(seed)` in `src/engine/rng.ts`), so evolution is reproducible and tests are deterministic. Do not change its output: saved runs replay from their seed, and a golden-value test guards it.
- Never put Stripe or Supabase secret keys in client code; only `NEXT_PUBLIC_*` values may reach the browser. `.env*` is gitignored except `.env.example`, which holds placeholders only.

## Context economy

- Search with `rg` or `git grep`; both skip `node_modules/` and `.next/`. Never run `grep -r` or `find` from the repo root.
- Don't read `package-lock.json` (about 270KB; reads are denied in settings). Use `npm ls <pkg>` or `npm view <pkg>` instead.

## Gotchas

- This Next.js version is newer than your training data. Before writing Next.js code, find the relevant page in `node_modules/next/dist/docs/` with `rg` and read only the matching section, since pages run up to 60KB. Delegate broader doc research to the Explore subagent. `AGENTS.md` says the same but is not loaded by Claude Code; `next dev` rewrites it, so commit it as is.
- TypeScript is pinned to `~6.0` because typescript-eslint supports only TS `<6.1` (TS 7 is out). ESLint stays on 9 because Next's react, import and jsx-a11y plugins do not support ESLint 10. Dependabot ignores both majors; lift the pins once the peer ranges allow.
- On a clean checkout, plain `tsc` fails (`LayoutProps` not found). Use `npm run typecheck`, which runs `next typegen` first.
- Commands run from Claude Code can get the system Node 22 instead of mise's Node 24. Everything works on both, but CI and Vercel use 24; prefix `mise exec --` when the version matters.
- npm's `allowScripts` (in `package.json`) gates install scripts. A new dependency with an install script triggers a warning until you run `npm install-scripts approve <pkg>` or `npm install-scripts deny <pkg>`.
- Prettier skips `.claude/` (hash-locked by claude-harness) and `AGENTS.md`.
