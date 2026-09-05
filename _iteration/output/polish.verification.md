# Iteration C — polish: verification (2026-09-05)

Brief: `_iteration/polish.md`. Plan: `polish.plan.md`. Evidence:
`polish-probe.mjs` (CDP against `npm run dev`, PORT derived from vite's own
output each run — 5173 on the first run, **5174** after the restart because
session B's vite had taken 5173; the harness has no default) and the PNGs under
`polish-shots/`: `before-*` from the untouched tree (commit 1303034),
`final-*` from the tree rebased on `origin/planning-layer`. Chrome
152.0.7977.77 headless; colour scheme and reduced motion via
`Emulation.setEmulatedMedia`; a coarse pointer via
`Emulation.setTouchEmulationEnabled`, which makes `(pointer: coarse)` and
`(hover: none)` match (the instrument reports `false` without it, so it can
return both answers). The signed-out state is reached through a fake GIS that
fails at once (the real `accounts.google.com` script is blocked); the
`foreground` and `yrnote.whenLoaded` probes use a fake GIS that issues a token
and a `fetch` stub answering googleapis.com with `{ items: [] }` while logging
the URL. Results JSON: `polish-shots/before.results.json`,
`polish-shots/final.results.json`.

The human was not available; every ruling below is mine and is recorded here
for the gate, not promoted upstream.

## Gate

- `npm run selftest` — **67/67** (57 on entry; +2 mine, +5 A's, +3 B's).
- `npm run build` — green: `tsc --noEmit`, vite build, `sw.js: 8 precached paths`.
- `grep -n 'transition\|animation' src/style.css` — **returns nothing** (exit 1).
  On entry it returned one line (a comment, "this view transitions a track
  size"); after the rebase on A a second (A's "no transition here"). Both were
  prose; both reworded. See "Out of bounds" for the second.
- Rebased first on `origin/planning-layer` (A, 5 commits), then — once B had
  pushed — on **`origin/demo`** (7 commits on top of A, A confirmed an
  ancestor). Two conflicts in all, both adjacent-line unions in `main.ts`
  `showYear()`/`openYear()` (A's `exitMode()` and `toast` host beside my
  `lastView` write and `yrNote` append) and two import-line unions in
  `selftest.ts` against B. Every `final-*` shot and number below is from the
  tree on top of `origin/demo`.
- Pushed: `polish`, `--force-with-lease -u` (rebased). Not merged.

## Tickets

### 1. First-run copy pitches the year
Changed: `chrome.ts` `buildFirstRun` — the one-liner and the three lines.
Structure, Connect, demo button + its note, privacy note, support link are
untouched (the demo button and note are B's). Copy shipped, for the human to
approve or replace:

- one-liner: **A year planner over your Google Calendar.**
- **Your whole year on one screen — what is planned, and what is still open.**
- **Paint vacations, blackouts and commitments straight onto the days.**
- **Every category counts its days against the budget you give it.**
- (unchanged, carries the fourth point) Events live only in your Google
  Calendar. Bramwell keeps no copy of its own.

Shots: `before-firstrun-390-dark.png` → `final-firstrun-390-dark.png`; also
`{before,final}-firstrun-{390,1440}-{light,dark}.png`. Probe: Connect hit by
`elementFromPoint` at its centre, card inside the viewport, at all four.

### 2. Month ↔ Year switch motion
Changed: `main.ts` `showYear()` — the incoming view gets `.enter`, a forced
reflow, then `[data-in]`; the outgoing view is hidden and its enter state
cleared. Nothing added to `motion.css`; the utility expressed it.
Probe (`switch`): one frame after the click the year view reads opacity `0`,
`translateY(6px)`, `transition-property: opacity, transform` at `0.24s`
(`--t-base`), and opacity `1`/`none` 400ms later; the way back does the same
on the scroller. **Reduced motion:** transition-property `opacity`, `0.08s`,
transform snaps to none in the first frame, the view still switches
(`yearHidden: true` on the way back). Shots: `final-switch-no-preference-mid.png`
(mid-fade) → `-end.png`; `final-switch-reduce-{mid,end}.png`;
`before-switch-*` for contrast (the before build is at opacity 1 in its first frame).

### 3. "January – June not loaded"
Changed: `state.ts` `monthsNotLoaded(year)` (pure; selftested: absent and
error months listed, `null` while any loads, `[]` when ready);
`main.ts` `refreshYearNote()` + `monthRuns()` (consecutive months collapse
to a range), a `.yrnote` div appended into `yearRoot` after `year.mount()`
and refreshed on open, year step, Today and cache change; `style.css`
`.yrnote { --ink-dim; 12px }`. **Ruling:** the note lives in `main.ts`, not
`year.ts` (A's file); `year.ts` only ever touches `root`'s children at mount
and in `destroy()`, so it sits under the grid untouched (re-checked after the
rebase: A's strip is prepended at mount, the note is still last).
Probe (`yrnote`): seeded Jul–Sep only, signed out → text
`January – June, October – December not loaded`, colour = `--ink-dim`
(`rgb(107,107,107)` light / `rgb(154,151,143)` dark), 12px, in view at 390
and 1440; absent while a month is `loading` (a GIS that never answers);
absent once every month is fetched (12 fetches logged). `--today`/`--past`
never used. Shots: `before-yrnote-390-dark.png` (empty half-year, no line) →
`final-yrnote-390-dark.png`; also `{before,final}-yrnote-{390,1440}-{light,dark}.png`.

### 4. Keyboard focus
Changed: `style.css` — `:focus-visible` on every control family: `outline:
1px solid var(--ring); outline-offset: -1px` (an inset ring that leaves each
control's own box-shadow and border alone). **Ruling:** on the two ink-filled
controls (Connect, FAB) `--ring` is ink on ink, so those two use
`--surface` for the ring colour — still an existing token, same 1px inset.
Two defects the probe found and fixed (`chrome.ts`, `style.css`): the cold
first-run screen covered the header visually but not in the tab order (Tab
from the body reached Year and Today behind it) — every other child of the
root is `inert` while first-run shows; and the `--surface` override lost to
the list's `:is()` specificity — written as `button.set-fr-connect` /
`button.set-fab`. Probe (`focus`): real Tab keystrokes via
`Input.dispatchKeyEvent`; every stop reports `:focus-visible` true and the
outline `solid 1px <--ring> off=-1px` (Connect: `rgb(20,18,16)` = `--surface`
dark). First-run cycles Connect → support → (browser chrome) → Connect; header
Year → Today → Reconnect; sheet Sign out → 15 → 30 → … → colour select; form
title → first chip. Shots: `before-focus-header.png` (browser's blue ring) →
`final-focus-header.png`; `{before,final}-focus-{firstrun-connect,sheet,sheet-cat,form}.png`.
**Flag for the human:** `--ring` is a 22–26% alpha hairline; it is what the
brief asked for and it is perceivable in the shots, but it is at the faint
end of what counts as a visible focus indicator. Nothing new was added.

### 5. Settings sheet, 11 categories, 390×844
Changed: nothing — no fix was needed. Probe (`sheet11`, prefs seeded with 11
categories, both schemes): 11 rows, 0 rows with a child outside the sheet's
box, 0 rows with horizontal overflow, sheet `scrollHeight > clientHeight`
(scrolls inside itself, 692px of 844), document does not scroll, the last
Remove button is in view after scrolling and `elementFromPoint` hits it. Held
after the rebase with A's Budget/Blocks second line per row (the `coarse`
probe re-measures `.set-cat` and `.plan-row`: 12 rows, 0 clipped). Shots:
`before-sheet11-390-{light,dark}-{top,bottom}.png` →
`final-sheet11-390-{light,dark}-{top,bottom}.png` (the final ones show A's rows).

### 6. Light mode pass
Changed: nothing — no contrast or hierarchy regression found. Reviewed:
month, year, sheet open, form, toast at 390/1440/1920 in light (dark taken
alongside as the reference). Shots: `final-light-{390,1440,1920}-light-{month,year,sheet,form,toast}.png`
(and `-dark-`); `before-light-*` for the same states minus toast (the before
instrument could not raise one — see ticket 7).

### 7. Toast placement
Changed: `style.css` `#toasts { bottom: calc(var(--fab-inset) + 8px) }` —
the strip `#app` already reserves for the FAB, `env(safe-area-inset-bottom)`
included. **Ruling:** one rule at every width rather than a phone
breakpoint; on desktop it moves the toast from 24px to 72px up, into the
reserved strip. Probe (`toast`, 390×844 dark): toast rect `[142,738,248,772]`,
FAB `[326,780,374,828]`, `overlapsFab: false`, 72px above the bottom; headless
`env()` is 0, so the safe-area term is verified by reading `bottom: 72px`
(= 64 + 8) rather than on a notch. Before, same probe with the old rule: toast `[142,786,248,820]`, i.e. inside
the FAB's vertical band (780–828) at 24px up — this short message clears it
sideways, a `90vw` one would not — and under a 34px home indicator on device.
Shots: `before-toast-390-dark.png` (the
pre-ticket rule re-injected on the final build — the before-run's toast never
fired because `raiseToast` saved an empty title, which day.ts keeps in the
form and never toasts; fixed to save a titled event that the signed-out write
path rejects) → `final-toast-390-dark.png`.

### 8. Header buttons under emulated pointer input
Changed: nothing. Probe (`hdrpointer`, 1440×900): CDP
`Input.dispatchMouseEvent` press/release at the centre of Year and Today, and
`Input.dispatchTouchEvent` touchStart/touchEnd with touch emulation on.
Capture-phase log on the buttons: mouse fires
`pointerdown → mousedown → pointerup → mouseup → click`; touch fires
`pointerdown(touch) → touchstart → pointerup → touchend → mousedown → mouseup → click(touch)`;
`elementsFromPoint` at the centre is `BUTTON#btn-mode` first; the view toggles
and Today re-docks in both. So `.hdr` buttons receive both pointer sequences
correctly under Chrome's emulation, and the pane-emulated failure in OPEN.md
is not reproduced. **Not tested:** a real trackpad and a real touch screen —
this machine has headless Chrome only. The OPEN.md item stays open; it is not
closed here because the brief conditions the close on a real browser.

### 9. Press feedback
Changed: `style.css` `:active:not(:disabled) { transform: translateY(1px) }`
on every button family; `motion.css` `transition: transform var(--t-fast)
var(--ease-out)` on the same list (the two lists mirror each other; comments
on both say so). Probe (`active`): mouse held on Today → `:active` true,
transform `matrix(1,0,0,1,0,1)`, transition-property `transform` `0.14s`;
released → `none`; the disabled FAB held → transform `none`. **Reduced
motion:** the press still lands (`matrix(…,0,1)`), transition-property
`opacity` `0.08s` — the movement is instant, not animated. Shots:
`before-active-today-no-preference.png` → `final-active-today-no-preference.png`;
`final-active-today-reduce.png`.

### 10. Open in the last-used view
Changed: `state.ts` `resolveLaunchView(prefs)` (pure; selftested over the
eight-row table); `main.ts` writes `lastView` on every `showYear()` and
launches through `resolveLaunchView`; `chrome.ts` segment Last / Month /
Year, stored `last`/`cal`/`year`, Last selected when the field is absent.
Probe (`lastview`): launch → month; switch → prefs gain `lastView: "year"`;
reload with those prefs → **year**; sheet shows `Last:true, Month:false,
Year:false`; pick Month → `defaultView: "cal"`; reload → **month**. Shots:
`before-lastview-reload-year.png` (lands in month) → `final-lastview-reload-year.png`;
`{before,final}-lastview-sheet.png`, `final-lastview-reload-month.png`.

### 11. iOS auto-zoom (beta blocker)
Changed: `style.css` `@media (pointer: coarse)` — `.dp-form input/textarea/
select`, `.set-cat-lab`, `.set-cat-hex`, `.set-cat-cid`, and after the rebase
`input.plan-bud` (A's Budget number input; `input.` because A's own
`.plan-bud { font-size: 12px }` is later in the file at equal specificity) →
16px. No `maximum-scale`. Probe (`coarse`): fine pointer → every field 12px
(hex 13.33px, label 13px, as before); coarse → **every field 16px**
including `.plan-bud`; the form's right edge 381 of 390, document
`scrollWidth` 390 in both views, sheet rows unclipped. Shots:
`before-coarse-coarse-form.png` → `final-coarse-coarse-form.png`;
`{before,final}-coarse-{fine,coarse}-{form,sheet}.png`. **Not tested:** the
phone itself (reload, tap a title field, no zoom) — the brief's device step
is the human's.

### 12. Foreground refresh (beta blocker)
Changed: `main.ts` — `weeksAround(first, last)` is now the single definition
of the list `onRangeChange` passes; `refreshVisible()` re-runs
`ensureMonthsFor` over it on `visibilitychange` (visible only), window
`focus`, and `online`. No timer. Probe (`foreground`, fake GIS + logged
fetch, a form open with text typed): boot fetched 6 months; then each of the
three events while fresh → **0 fetches**; `Date.now` shifted +6 min →
`visibilitychange` → **8 fetches** (Jun–Jan, the visible range); a spoofed
`visibilityState: 'hidden'` → 0; visible again → 8; a plain `resize` as the
instrument's control → 0. **The form and its typed title survived every
case** (transient-UI rule). Shot: `final-foreground-form-after-refresh.png`
(`before-foreground-form-after-refresh.png`: same form, 0 fetches when stale).
`Page.setWebLifecycleState` was tried first as a "real" transition and left
`visibilityState` at `hidden` after `active`, so it was dropped as an
unfaithful instrument (recorded so nobody retries it).

## After B landed: three items from A's and B's verifications, in my surface

**B1 — every field in the sheet at 16px under a coarse pointer (A's
`.plan-bud`).** The coarse rule now covers containers, not classes:
`.dp-form :is(input, textarea, select)` and `#sheet :is(input, textarea,
select)` — so A's Budget number input, and anything a later row adds, is
16px without a per-class entry, and `#sheet`'s id outranks A's own later
`.plan-bud { font-size: 12px }` (a first attempt with `.plan-bud` in the list
lost to exactly that; `input.plan-bud` fixed it; the container form replaced
both). Probe (`coarse`): fine → label 13px, select 12px, hex 13.33px,
`.plan-bud` 12px; coarse → **all 16px**, `.dp-*` fields 16px, 12 sheet rows
(`.set-cat` + `.plan-row`) with 0 clipped at 390. Shots:
`final-coarse-coarse-sheet.png` (with A's rows) vs `final-coarse-fine-sheet.png`.

**B2 — the sheet's account row in demo.** `chrome.ts` `buildSheet`: when
`state.isDemo()` the row reads **Demo** and offers **Connect**
(`#sheet-connect`), which closes the sheet and calls mount's `connect()` —
the same closure B's `#demo-pill` uses (exit demo → `host.onDemoExit()` →
resync → `auth.signIn()`), reached through a module-level `connectRef` set
by mount exactly as `syncRef`/`markLeftRef` are. No new host hook; B's pill
and first-run button untouched. Probe (`demo`, `?demo` at 390, both
schemes): row text `Demo`, buttons `[sheet-connect:Connect]`, the button hit
by `elementFromPoint`; after the click `isDemo: false`, sheet closed, the
pill gone, and the fake GIS's `popup_failed` toast — proof the sign-in path
ran. Shots: `before-demo-390-light-sheet.png` ("Google Calendar · Not
connected" + Sign out) → `final-demo-390-light-sheet.png` (Demo + Connect).

**B3 — the "Demo · Connect" pill wrapped at 390.** `style.css`: `.set-pill {
white-space: nowrap }`, and because a one-line pill plus B's avatar need
144px in the slot, the phone header (`≤560px`) tightens to `gap: 6px`,
`padding: 0 8px`, buttons `6px 6px`, and `.hdr-range` is `nowrap` so a short
row would show as overflow rather than a split label — a first attempt with
8px gaps kept the pill on one line but wrapped the range instead, which the
shot caught and the width probe then explained. No colour, font or shadow.
Probe (`demo`): pill 116×31, one line; header children 114 + 40 + 51 + 144
plus 40 of gaps and padding = 389 of 390, `hdr.scrollWidth` 390, range on
one line, avatar right edge 382. Shots: `before-demo-390-dark-header.png`
(two-line pill) → `final-demo-390-dark-header.png`. Tight by design: any
longer range label or pill text at 390 overflows, and both are B's/render's
copy — recorded, not solved here.

**B's `yearFitsWithoutScroll: false` at 390×844.** Measured in demo, both
schemes: the **document does not scroll** (`scrollingElement.scrollHeight ≤
innerHeight`); the year view scrolls **inside itself** — `scrollHeight` 1188
against a 724px client (844 − 56 header − 64 FAB strip), 27 rows at 14
columns, A's strip 40px of that. So the strip did not make the page scroll;
the year at 390 was already taller than the viewport by roughly eleven rows
before A (the before-run's `before-light-390-light-year.png` shows the same
cut at August), which does not match the stage-03 note "scrolls about one
row". Not retuned — A's grid. Shot: `final-demo-390-dark-year.png`.

## Rulings made here (for the gate to promote or reverse)
1. Ticket 3: the note is `main.ts`'s, appended under the grid after mount;
   `state.monthsNotLoaded` is the query.
2. Ticket 4: `--surface` as the ring colour on ink-filled controls; the
   first-run screen makes its root siblings `inert`.
3. Ticket 7: `#toasts` sits above the FAB strip at every width, not only phones.
4. Ticket 10: the launch table is `state.resolveLaunchView`.
5. Ticket 11: A's `.plan-bud` is a field and gets 16px.
6. Tickets 5, 6, 8: verified, no change shipped.
7. B2: the demo account row reads "Demo" with a Connect on the pill's path.
8. B3: the phone header tightens (6px gaps, 8px padding, 6px button padding,
   range `nowrap`) rather than the pill or the label changing copy or size.

## Upstream amendments I believe are needed (not made)
- SPEC "State API": add `resolveLaunchView(p: Prefs): 'cal' | 'year'` and
  `monthsNotLoaded(year: number): number[] | null` to the export list
  (CONVENTIONS: modules export their spec-defined interface and nothing else;
  the brief authorised the lift, the spec list does not yet carry them).
- SPEC "Event form" says validation errors surface "in the form and as a
  toast"; `day.ts` toasts write errors only (`showError` for validation).
  Either the spec or `day.ts` — not my surface.
- OPEN.md "Pane-emulated clicks on header buttons": add the dated
  emulation finding above; leave open until a real trackpad/touch screen.
- OPEN.md "Settings sheet with 11 categories on a small phone": can be closed
  with the ticket-5 measurement (never on a device, but the layout claim is
  now measured).
- OPEN.md "Year view fetch on a signed-out cache": closed by ticket 3.
- CONVENTIONS "Verification": PORT — a dev server that dies with the session
  leaves its port to whichever vite starts next. Twice here: 5173 answered 200
  from session B's tree after the first restart; later 5174 was answered by
  A's tree (a probe read `window.bramwell.state` as undefined and every
  coarse field as 12px — a stale tree, not a regression). Derive the port
  after every restart, and check the served `main.ts` carries a marker of
  the tree under test before trusting a run.

## Out of bounds, touched or not
- **Touched:** one word in a comment inside A's `.plan*` block of `style.css`
  ("no transition here" → "nothing eases it"), because the gate is the grep
  returning nothing. No rule changed.
- **Touched:** `src/selftest.ts` (two cases inserted beside the existing
  state cases, not appended — A appends at the end; the rebase was clean).
- **Not touched:** `year.ts`, `day.ts`, `render.ts`, `_references/*.md`,
  `index.html`, `public/` (nothing in the tickets needed them).

## Not tested
- Any real device: iOS auto-zoom on the phone, the home indicator, a
  trackpad, a touch screen, the installed PWA.
- Demo mode on a device; the demo header at widths between 390 and 560 with a
  longer range label (e.g. "Dec 2026 – Jan 2027") — the 389/390 fit above is
  for "Aug – Sep 2026".

## Gate fix folded in after the three sessions landed (2026-09-05)
- **The year view stayed stale after a write made in the month view** (found
  by the human at the planning-layer gate: paint in the year, erase in the
  month, reopen the year, the run is still drawn until a reload). Cause, in
  `main.ts` since stage 03: `onCacheChange` cleared `yearDirty` whether or not
  the year view was visible, and `year.ts` bails on a hidden root, so the
  rebuild never happened and the flag was gone. Fix: only a visible year
  consumes the flag; `openYear()` invalidates when it finds it set. Probe
  `_iteration/output/stale-year.probe.mjs` (open year, back to month, save an
  event there, reopen): `gridRebuiltOnOpen` false before, true after; 67/67,
  build clean. Not A's, not C's surface — a gate fix on the integration tip.
