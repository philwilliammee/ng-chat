# Skill: memory

Load this skill when past context would help — user preferences, prior decisions, project state.

## Recall

1. Call `read_file` with path `memories/_index.md` to see what clusters exist.
2. For any cluster relevant to the current task, call `read_file` on its leaf file.
3. Quietly incorporate what you find — no need to narrate the recall process unless asked.

## When to load

- User references something from a past session ("last time…", "do you remember…")
- Starting a task that touches known preferences or project context
- User asks what you know about them or the project

## Saving new memories

At the end of a session, use the `close` skill to persist what you learned.
