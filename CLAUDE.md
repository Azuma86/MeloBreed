<!--
プロジェクト固有の事実を Claude に伝えるファイル（目安 100 行以内）。HTML コメントは Claude のコンテキストに入らない。
共通の作業規約は .claude/rules/harness.md。コードから分かることは書かない。
コマンドが実際に動くようになったら Commands を追加し、HARNESS_VERIFY_CMD を設定する（/harness-setup）。
-->
# MeloBreed

An app that generates music with evolutionary computation: the user picks the melodies they like, and the app evolves them from there (interactive evolutionary computation).
The project's goal is to generate revenue, so weigh decisions by how they serve paying users.

## Status
- Early stage: no application code yet. The stack below is decided; scaffold it before adding features.

## Stack (decided)
- Web app first: TypeScript + Next.js (App Router), deployable to Vercel; works in mobile browsers.
- Evolution engine: pure TypeScript module under `src/engine/` with no UI or I/O imports, so it runs in the browser and is unit-testable. Melodies are plain data (note sequences: pitch, start, duration), not audio.
- Playback: Tone.js in the browser. No server-side audio rendering (keeps hosting cost near zero).
- Accounts and saved melodies: Supabase (auth + Postgres). Payments: Stripe.
- Tooling: npm, ESLint, `tsc --noEmit`, Vitest for unit tests, Playwright later for end-to-end.

## Conventions
- Evolution randomness must be seedable (inject the RNG) so tests are deterministic.
- Never put Stripe or Supabase secret keys in client code; only `NEXT_PUBLIC_*` values may reach the browser.
