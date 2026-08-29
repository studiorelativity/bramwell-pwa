# Stage 01 — Scaffold

**Status: VERIFIED — awaiting human gate.** Verification in output/verification.md.

## What this stage is
The repo skeleton, the type system, and the date core — the only stage
that touches every file, because it creates all of them as stubs.

## Inputs
- L3: `../_references/SPEC.md` — "Stack", "File layout", "Dates", "Auth"
  and "Calendar API" (for `types.ts` shapes only), "Categories and
  customization" (the `StoredCategory` and prefs shapes)
- L3: `../_references/HABITS.md` — "Schema" (for the habit types)
- L3: `../_references/CONVENTIONS.md`
- L3: `../_references/DECISIONS.md` — "In force — data and dates"
Do not read the rest of the spec in this stage.

## Outputs
- Vite + vanilla TS (strict) at repo root, `.node-version`, `.gitignore`
  with `.env.local`, `package.json` scripts `dev` / `build` / `preview`.
- `index.html` with the viewport meta and the GIS `<script>`; seed tokens
  in a `<style>` block; `src/style.css` and `src/motion.css` empty but
  present.
- Every `src/` module from the file layout as a stub exporting its public
  interface, headed `// STAGE NN` and throwing `Error('STAGE NN: not
  implemented')`.
- `src/types.ts` implemented in full: `DayNumber`, `WeekIndex`,
  `DayOffset`, `CalendarEvent`, `EventDraft`, `EventSpan`,
  `StoredCategory`, `Prefs`, `EventCache`, `MonthLoadState`, `Habit`,
  `HabitLog`, `HabitCache`; plus the shapes the design added
  (`DECISIONS.md` "stage 01 types"): `MonthKey`, `MoodId`, `RepeatRule`,
  `WriteScope`, `PendingWrite`, `Cadence`, `StoredEvent`, `MonthEntry`,
  `HabitMonthEntry`.
- The anchorless date core in `src/dates.ts` (brands and constructors,
  `civilToDay`, `dayToCivil`, `monthKey`) implemented with `Date.UTC`
  math, importing nothing; the anchored functions (`today`, `weekOf`,
  `dayAt`) implemented in `state.ts`; a `selfTest()` in `src/selftest.ts`
  covering both, dynamically imported by `main.ts` under `/?selftest`.
  Everything else in `state.ts` stays a stub.
- `public/manifest.webmanifest`, `public/icon-*.png`, `public/_headers`.

## Process
Run the superpowers workflow inside this stage: `brainstorming` on the
type shapes (the one place a bad call costs every later stage),
`writing-plans`, `test-driven-development` for the date core (write the
selftest first: civil round-trip incl. a leap day, epoch anchoring,
801-day weekday oracle, Monday start, year boundary in one row, DST-safe
stepping across two local years, weekOf/dayAt round-trip, week 0 contains
today, month keys across a boundary), `verification-before-completion`.

## Gate (human)
- `npm run dev` serves without errors; `tsc --noEmit` clean; `npm run
  build` clean.
- `/?selftest` passes 9/9 in the browser.
- `types.ts` reviewed by the human against the spec's API and HABITS
  schema sections.
- `output/verification.md` written: gate results, rulings the spec left
  open, what was not tested.

## Blocking human step before stage 02
`.env.local` with `VITE_GOOGLE_CLIENT_ID=` (v3's client carries over).
