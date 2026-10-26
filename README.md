# MeloBreed

Pick the melodies you like and breed new music with interactive evolutionary computation.

## Setup

Requires [mise](https://mise.jdx.dev/) (or any way to run Node 24, as pinned in `mise.toml` and `package.json` `engines`).

```sh
mise install   # installs Node 24 for this directory
npm ci
npm run dev    # http://localhost:3000
```

## Commands

| Command          | What it does                                        |
| ---------------- | --------------------------------------------------- |
| `npm run dev`    | Start the dev server                                |
| `npm run verify` | Format check, lint, typecheck and unit tests (= CI) |
| `npm run build`  | Production build                                    |
| `npm test`       | Unit tests once (`npm run test:watch` to watch)     |
| `npm run format` | Format all files with Prettier                      |

## Layout

- `src/app/` — Next.js App Router UI
- `src/engine/` — evolution engine: pure TypeScript, no UI or I/O, seedable RNG (enforced by ESLint)
