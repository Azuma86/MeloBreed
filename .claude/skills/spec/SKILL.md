---
name: spec
description: Use when a feature request is large or its requirements are unclear, before planning high-risk work. Interviews the user and writes a spec with testable acceptance criteria.
argument-hint: "[feature description]"
metadata:
  managed-by: claude-harness
---
Write a spec for: $ARGUMENTS

1. Ground yourself first. Follow the pointers in CLAUDE.md and use the Explore subagent to find the code, data and interfaces the feature touches. Do not ask the user anything the repository can answer.
2. Interview the user with AskUserQuestion, at most 4 questions per round. Ask only about decisions that change scope, design or acceptance: edge-case behavior, error handling, compatibility and data constraints, performance or security expectations, and what is explicitly out of scope. Offer concrete options and mark a recommended default.
3. Stop when the remaining unknowns would not change the implementation; record them as open questions.
4. Write the spec with the structure in [template.md](template.md). Save it where CLAUDE.md says design docs live, otherwise at `docs/specs/<YYYY-MM-DD>-<slug>.md`. Keep it under about 150 lines. Every acceptance criterion must be observable and testable.
5. Give the user the path and a five-line summary, and ask whether to move on to planning. Do not start implementing in this step.
