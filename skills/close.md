# Skill: close

Use this skill at the end of a session to persist what you learned into the `memories/` directory.

## Steps

1. **Scan the conversation** — identify facts worth keeping: user preferences, project context, decisions made, things to remember next time.

2. **Write leaf files** — for each distinct topic, call `write_file` with a path like `memories/<topic>.md`. Use this frontmatter:
   ```
   ---
   updated: <YYYY-MM-DD>
   tags: [<relevant>, <tags>]
   ---
   ```
   Keep each file focused on one topic. Overwrite if it already exists (merge new facts in).

3. **Update the index** — call `write_file` with path `memories/_index.md` and add a one-line entry for any new file you created.

4. **Report** — tell the user what you saved and where.

## What to save

- User preferences (style, language, timezone, model choices)
- Project context (active goals, constraints, key decisions)
- Things the user corrected or emphasized
- Domain facts you had to look up that will be relevant again

## What NOT to save

- Ephemeral task details (already in git / IDB)
- Information derivable from reading the current codebase
- Anything the user asked you to forget
