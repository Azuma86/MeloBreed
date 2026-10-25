---
name: handoff
description: Save the current task state to a handoff note so a fresh session can continue it, or resume from such a note.
disable-model-invocation: true
argument-hint: "[topic] | resume [note-file]"
metadata:
  managed-by: claude-harness
---
Arguments: $ARGUMENTS

Handoff notes live in `.handoff/` at the repository root. They are personal session state: `.handoff/.gitignore` (containing `*`) keeps them out of git without touching the project's own `.gitignore`.

## If the arguments start with "resume"
1. Read the given note, or the most recently modified `.handoff/*.md` if none is named.
2. Check its claims against the repository (`git status --short`, `git log --oneline -10`, the files it lists) and flag anything that no longer matches.
3. Summarize the goal, the current state and the first next step, then ask the user to confirm before continuing.

## Otherwise: write a handoff note
1. Collect facts: current branch, `git status --short`, `git diff --stat`, recent commits, the spec or plan in use, and the latest verification commands with their results.
2. Write `.handoff/<YYYY-MM-DD>-<topic-slug>.md` (topic from the arguments or the task), at most about 60 lines, with these sections:
   - Goal
   - Status: done / in progress / not started
   - Decisions, each with its reason
   - Changed files
   - Verification state: commands, results, known failures
   - Next steps: ordered and concrete
   - Open questions and blockers
   - Pointers: spec, plan, branch, PR, issues
   Record facts only, mark anything uncertain, and never include secrets. If `.handoff/.gitignore` does not exist yet, create it with the single line `*`.
3. If writing the file is denied, do not try another location or shell redirection; put the note in your reply so the user can save it.
4. Tell the user the path and how to continue: run `/clear` or start a new session, then `/handoff resume`.

To share a note with a teammate, move it into the project's docs.
