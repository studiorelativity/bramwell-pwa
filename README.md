# Bramwell

A perpetual calendar over Google Calendar — weeks stack vertically forever,
months are labels, not walls — plus a habit tracker and a journal, each in
its own store.

This folder is the consolidated starting point for the rebuild
(2026-08-29). It holds decisions and specs only; there is no source here
yet. The v3 tree at `../bramwell-calendar` is the record of how these
decisions were reached and is not a dependency.

| File | What |
|---|---|
| `_references/SPEC.md` | The build contract for the calendar: interaction, visual direction (Night Depth), motion, categories, demo, PWA, auth, API, file layout, definition of done, setup, deploy |
| `_references/HABITS.md` | Habit tracker on Supabase: schema, auth, rendering, DoD |
| `_references/JOURNAL.md` | Journal as linked markdown in the Obsidian vault; how the calendar links out |
| `_references/DECISIONS.md` | Rulings in force and approaches rejected, with reasons |
| `_references/CONVENTIONS.md` | Code, boundary, and verification rules |
| `_references/OPEN.md` | What was never verified and what is still undecided |
| `NN_*/CONTEXT.md` | One contract per stage: inputs it may read, outputs, human gate; `output/` holds the plan and verification |
| `CONTEXT.md` | Layer 1 routing: stage table and entry rule |
| `CLAUDE.md` | How Claude Code runs the build here (superpowers workflow, stage order, rules) |

## Tree

```
bramwell/
├── CLAUDE.md                 L0  where am I — layers, process, rules (always loaded)
├── CONTEXT.md                L1  where do I go — stage table, entry rule
├── README.md
├── _references/              L3  stable rules, loaded by section per stage
│   ├── SPEC.md                   calendar contract
│   ├── HABITS.md                 Supabase scope
│   ├── JOURNAL.md                vault scope
│   ├── DECISIONS.md              rulings in force + rejected approaches
│   ├── CONVENTIONS.md            code and verification rules
│   └── OPEN.md                   unverified / undecided
├── 01_scaffold/
│   ├── CONTEXT.md            L2  what do I do — Inputs / Process / Outputs / Gate
│   └── output/               L4  plan.md, verification.md (human edit surface)
├── 02_data/        (same shape)
├── 03_engine/
├── 04_day/
├── 05_shell/
├── 06_demo/
├── 07_habits/
└── 08_journal/
```

After stage 01 the Vite product tree (`index.html`, `src/`, `public/`)
sits at this same root; stage folders never hold source.

What changed from v3, in one line each: the overlay drawer is gone
(inline day expansion); the visual direction is Night Depth; day notes no
longer live in Google Calendar (journal → vault); habits are new
(Supabase); the file layout gains `day.ts`, `motion.css`, `habits.ts`,
`journal.ts`.
