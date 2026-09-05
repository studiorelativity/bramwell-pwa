# Iteration C — polish: implementation plan (2026-09-05)

Brief: `_iteration/polish.md`. Bounded work against an approved contract; the
human is not available, so rulings the brief leaves open are made here and
recorded in `polish.verification.md`. Files owned: `src/style.css` (not the
`.plan*` tail), `src/motion.css`, `src/chrome.ts` first-run copy/layout and
the sheet (not `buildColors()` row internals, not the demo button/pill),
`index.html`, `public/`, `src/main.ts` for tickets 2, 10, 12. Pure helpers
for 3 and 10 go in `state.ts` next to `monthState()`/`prefs()` (far from B's
seed at the file's end) with selftests inserted beside the existing state
cases, not appended (A appends `plan.ts` cases at the end).

## Questions the contract left open, and the rulings taken

- **Ticket 3, where the note lives.** `year.ts` is A's. The note is a
  `.yrnote` div `main.ts` appends to `yearRoot` after `year.mount()` and
  refreshes on show, year step, Today, and cache change (all main.ts hooks).
  The query is pure: `state.monthsNotLoaded(year)` returns `null` while any
  month of that year is `loading`, else the list of `absent`/`error` month
  numbers. Label shaping ("January – June", "January, March – May") is a
  small main.ts function exercised by the screenshot probe.
- **Ticket 4, ring on inverted buttons.** `--ring` is a 22–26% alpha ink;
  inset on Connect and the FAB (ink ground) it is invisible. Ruling: those two
  use `--surface` for the ring colour — still an existing token, still 1px
  inset, nothing new. Implemented as `outline: 1px solid; outline-offset:
  -1px` (an inset ring that does not clobber the element's own box-shadow).
- **Ticket 7, toast height.** The collision is with the FAB at phone widths
  only, but one rule is more honest than a breakpoint: `#toasts` sits at
  `calc(var(--fab-inset) + 8px)` at every width — the strip `#app` already
  reserves for the FAB, safe-area included.
- **Ticket 9.** No `:active` rule exists. `translateY(1px)` on every button
  family, `:not(:disabled)`, transition in `motion.css` only.
- **Ticket 10.** `state.resolveLaunchView(p: Prefs): 'cal' | 'year'`. Sheet
  segment Last / Month / Year; stored `last`/`cal`/`year`; `last` selected
  when absent.
- **Ticket 12.** One `refreshVisible()` in main.ts, the exact week list
  `onRangeChange` passes; listeners on `visibilitychange` (visible only),
  `focus`, `online`. No timer.
- **Ticket 8.** No trackpad or touch screen here. CDP
  `Input.dispatchMouseEvent` (press/release) and `Input.dispatchTouchEvent`
  on Year/Today, with a capture-phase event log on the buttons. Real-device
  half stays open.

## Tasks (execution order; commits one per ticket)

0. Probe script `_iteration/output/polish-probe.mjs` (CDP, seeded cache like
   `scripts/shot.mjs`, PORT from env). Capture every BEFORE shot from the
   untouched tree. Commit the script with the before shots.
1. Ticket 11 — `@media (pointer: coarse)` 16px fields. Probe: emulate
   `pointer: coarse`, read computed font-size of every field; 390 shots of
   the form in both views.
2. Ticket 12 — `refreshVisible` + three listeners. Probe: fake GIS +
   stubbed fetch logging URLs; form open; dispatch `visibilitychange`: form
   survives, 0 fetches while fresh; shift `Date.now` +6 min, dispatch again:
   visible months fetched. Both answers from one instrument.
3. Ticket 10 — `resolveLaunchView` (selftest), `lastView` written in
   `showYear`, sheet segment. Probe: switch to Year, reload → year; set
   Month in the sheet, reload → month.
4. Ticket 2 — `.enter`/`[data-in]` on the incoming view. Probe: computed
   opacity mid-transition < 1 then 1; reduced motion still switches.
5. Ticket 3 — `.yrnote`. Probe: seeded cache with Jul–Sep only, year view
   shows "January – June, October – December not loaded"; hidden while
   loading; never `--today`/`--past`.
6. Ticket 1 — copy. Shots at 390 and 1440 both schemes.
7. Ticket 4 — `:focus-visible`. Probe: `.focus()` via CDP keyboard Tab
   (real focus-visible), shots of the ring on header, FAB, sheet, form.
8. Ticket 9 — `:active`. Probe: CDP mouse press held, shot + computed
   transform; reduced motion: transform still applies, transition opacity-only.
9. Ticket 7 — toast. Probe: rects of `.toast` vs `#fab` at 390 with a
   safe-area emulated via a `--fab-inset` read.
10. Ticket 5 — 11 categories at 390×844 both schemes: rect of every row and
    the Remove button inside the sheet's scrollport; sheet scrollHeight >
    clientHeight; document does not scroll.
11. Ticket 6 — light pass, three widths, both views, sheet, toast.
12. Ticket 8 — as ruled above.
13. Rebase on A/B if landed; final pass: selftest, build, grep, full probe,
    `polish.verification.md`. Push.
