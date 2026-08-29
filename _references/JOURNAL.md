# Journal — scope spec

The journal cannot live inside the calendar. It is a set of markdown files
that can be created, stored, and linked to each other. Nothing about a
journal entry is written to Google Calendar.

## Where it lives: the Obsidian vault

`~/_obsidian/vault` already exists, is the declared home for everything,
and gives the three required primitives for free:

- **create** — a daily note (Obsidian's Daily Notes core plugin, or a
  Claude Code skill writing the file).
- **store** — plain `.md` files under git, transported by Obsidian Sync
  (the vault's existing transport design; no iCloud).
- **link** — `[[wikilinks]]` and backlinks, which are the whole point of
  Obsidian.

Superpowers has no journal, notes, or markdown primitive (checked
2026-08-29 against obra/superpowers: its skills are brainstorming,
writing-plans, executing-plans, TDD, systematic-debugging, code review,
worktrees, subagent-driven development, writing-skills). It is the build
methodology, not a storage layer. The rebuild uses it to plan and execute
this spec; it contributes nothing to where the journal lives.

## Layout in the vault

```
journal/
  YYYY/
    YYYY-MM-DD.md
```

Front matter and body template:

```markdown
---
date: 2026-08-29
tags: [journal]
---
# Saturday, 29 August 2026

← [[2026-08-28]] · [[2026-08-30]] →

## Notes

## Links
```

- File name is the ISO date; that is the key the calendar links on.
- Previous/next links are written at creation so days chain without a
  plugin.
- Anything else in the vault links to a day with `[[2026-08-29]]`; the
  day's backlinks panel is the "what happened around this" view.

## How the calendar reaches it

The PWA cannot read local files, so the calendar **links out**; it never
renders journal text.

- `src/journal.ts` builds the URI for a `DayNumber`:
  `obsidian://open?vault=<prefs.journal.vault>&file=journal/YYYY/YYYY-MM-DD`
  (path-encoded). Vault name and path template are prefs with the defaults
  above. No network.
- **Expanded day**: a "Journal" row with an open-in-Obsidian action. On a
  device without Obsidian installed the link does nothing useful; the row
  says so once per session, not on every day.
- **Day cell**: no marker in v1 — the calendar cannot know whether a file
  exists. Open item below.

## Presence marker (open, two options)

1. **Link-out only** (v1). Zero infrastructure. The cell never shows
   whether a day has an entry.
2. **`journal_days` index in Supabase.** A small table `(day date primary
   key, title text, updated_at)` written by a vault-side script — a git
   post-commit hook or a Claude Code skill run from the vault root — that
   lists `journal/**/*.md` and upserts. `habits.ts`'s Supabase client
   would carry the read; the calendar shows a quiet marker bottom-right.
   Still no journal text in the app.

Option 2 is cheap once habits exist. Decide after the habit stage lands.

## Legacy day notes

v3 stored notes as Google Calendar all-day events tagged
`extendedProperties.private.bramwell = "daynote"`. The rebuild treats them
as ordinary all-day events. Open: a one-off script that reads them through
the Calendar API and writes them into `journal/YYYY/YYYY-MM-DD.md` (body
from `description`), then deletes the events. Run once, by hand, before
the first real-account gate, or leave them — they are harmless.

## Definition of done

- A day's Journal action opens (or creates, via Obsidian's daily-note
  behaviour) the right file in the vault on the Mac and on the iPhone.
- The file name, front matter, and prev/next links match the template.
- `[[2026-08-29]]` typed anywhere in the vault resolves to that day.
- `journal.ts` has no network and no DOM.
- Nothing journal-related is written to Google Calendar or localStorage
  beyond the two prefs.
