---
name: harness-setup
description: Configure claude-harness for this repository - the verification command used by the quality gate, the CLAUDE.md commands, and an optional permission allowlist.
disable-model-invocation: true
metadata:
  managed-by: claude-harness
---
Set up claude-harness for this repository. Propose each change and get the user's confirmation before writing any file.

## 1. Inspect
- Read CLAUDE.md (or AGENTS.md), `.claude/settings.json`, and `.claude/settings.local.json` if present.
- Find the real commands from manifests and automation: package.json scripts, pyproject.toml / setup.cfg / tox.ini / noxfile.py, go.mod, Cargo.toml, Makefile / justfile / Taskfile, pre-commit config, and CI workflows. CI is the most trustworthy source. Use the Explore subagent in large repositories.

## 2. Choose the verification command
- Compose `HARNESS_VERIFY_CMD`: the fast checks that must pass before any change is reported done, usually lint + typecheck + unit tests joined with `&&`. Aim for under two minutes; leave slow end-to-end suites out and list them in CLAUDE.md instead. Prefer quiet flags (`npm run -s`, `pytest -q`).
- Try it on the current tree: `HARNESS_VERIFY_CMD='<command>' python3 .claude/hooks/quality_gate.py verify`. Report the duration and result. If it fails before any change, tell the user that the gate would flag these pre-existing failures and suggest fixing them or narrowing the command first.
- Ask where to store it: `.claude/settings.json` (shared with the team) or `.claude/settings.local.json` (this user only). Add it under `"env"` without touching other keys. Optionally set `HARNESS_VERIFY_TIMEOUT` (seconds, default 300).

## 3. Fill in CLAUDE.md
- Fill the Commands section with the real install / build / test / single-test / lint / format commands. Fill the other sections only with facts Claude cannot infer quickly from the code; delete placeholder lines that stay empty.
- Keep the file under 200 lines. Point to longer docs by path instead of `@`-importing them.
- If the project keeps shared instructions in AGENTS.md, leave them there and put only Claude-specific notes in CLAUDE.md.

## 4. Optional: fewer permission prompts
- Suggest allow rules for the exact safe commands chosen above, such as `Bash(npm run lint)` or `Bash(pytest *)`, and add only the ones the user accepts. Mention `/fewer-permission-prompts` for later tuning.

## 5. Report
List each file changed and why, the final `HARNESS_VERIFY_CMD` with its measured duration, and anything left for the user to decide.
