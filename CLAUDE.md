# Bramwell — workspace

Single-user perpetual-calendar PWA over Google Calendar, with a Supabase
habit tracker and a journal that lives as markdown in the Obsidian vault.
Fresh build; nothing from the v3 tree is carried except the decisions in
this folder.

## Layout (ICM)
The product is the Vite tree at repo root. Layers: this file (L0, always
loaded) · `CONTEXT.md` (L1, routing, read on entry) · `NN_*/CONTEXT.md`
(L2, one stage's contract) · `_references/` (L3, stable rules) ·
`NN_*/output/` (L4, working artifacts and the human's edit surface).

## Canonical sources (L3, in `_references/`)
- `SPEC.md` — the contract. Conflicts resolve to the spec; fixes go
  upstream into it, never patched downstream.
- `HABITS.md`, `JOURNAL.md` — scope specs for the two non-calendar stores.
- `DECISIONS.md` — why, and what was rejected. Do not retry a rejected
  approach without a new reason recorded there.
- `CONVENTIONS.md` — code and verification rules. Read before writing code.
- `OPEN.md` — unverified items and undecided questions. Close them with a
  dated line and move the ruling to `DECISIONS.md`.

## Routing
See `CONTEXT.md` at root (Layer 1): the stage table and the entry rule.


## How a stage session runs
ICM sets the structure (one stage, one contract, one human gate);
superpowers runs the work inside it:
1. Read only this stage's CONTEXT.md and the spec sections it names.
2. `brainstorming` against the contract — question it, don't restate it.
   If the contract or a reference is wrong, fix it upstream first.
3. `writing-plans` → `NN_stage/output/plan.md`, tasks small enough to
   verify individually.
4. `executing-plans` / `subagent-driven-development`;
   `test-driven-development` for pure cores (dates, lane packing,
   sanitize, snap math, streaks).
5. `verification-before-completion`, then write
   `NN_stage/output/verification.md`: gate criteria, results, rulings the
   spec left open, what was not tested. Flip the contract's Status line.
6. Stop. The human runs the gate. The next stage does not open until the
   human closes this one.
7. Gate close (human + agent, same session): every ruling in
   `verification.md` is promoted upstream — into `DECISIONS.md`, or into
   `SPEC.md` when it changes the contract — and every closed `OPEN.md`
   item gets its dated line. After that, `verification.md` is a record,
   not an input: the next stage reads references only. Docs over outputs.
`systematic-debugging` on any regression; the second time the same kind
of fix happens, the rule goes into `CONVENTIONS.md`.

## Rules
- One stage per session. Stages run in order; a stage does not start until
  the previous verification file exists and the human has closed the gate.
- Module boundaries in `_references/SPEC.md` "File layout" are hard. `gcal.ts` is the
  only Google caller; `habits.ts` the only Supabase caller; `auth.ts` the
  only file that knows Google auth. Leaf modules are DOM-free and never
  import `state.ts`.
- A file the layout lacks is added to `_references/SPEC.md` first, then created.
- Every "this control works" claim is backed by `elementFromPoint()`.
- Motion values exist only in `motion.css`.

## Manual steps (human-only)
Google Cloud Console OAuth client (`_references/SPEC.md` MANUAL SETUP) — the v3 client
ID carries over into `.env.local`. Supabase project, Google provider, and
schema (`_references/HABITS.md` Manual setup). Claude cannot do these.
