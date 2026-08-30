# Stage 04 — Inline day, motion system, event form: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A day expands in place inside its week row, carrying the event list and the
add/edit form, driven by one CSS transition and zero per-frame JavaScript.

**Architecture:** The scroller is synthetic — `y` is a number we own — so `setExpanded`
jumps the *maths* to the final state (`expanded`, and `y` moved by `fitY` so the grown row
fits), writes each row's final geometry **once**, and lets CSS interpolate. Expansion and
scroll-to-fit are therefore the same transition. `scroll.ts` learns when it ended by reading
the row's own computed `transition-duration`, so `motion.css` stays the single home for the
value and reduced motion is honoured by construction. `day.ts` owns one persistent panel node
it moves between cells, which is what makes the transient-UI rule structural rather than
remembered.

**Tech Stack:** TypeScript strict, Vite 6, no runtime dependencies. Tests: `npm run selftest`
(bare node, `src/selftest.ts` case array) and `npm run shot` (`scripts/shot.mjs`, dependency-free
CDP against `npm run dev`).

**Spec:** `_references/SPEC.md` — "Inline day expansion", "Motion", "Visual direction — Night
Depth", "Event form", "Write orchestration", "Scroll engine API". Contract: `04_day/CONTEXT.md`.

## Global Constraints

- **No transition or animation value outside `motion.css`.** The only carve-out is
  `scroll.ts`'s per-frame physics constants, which already exist. This stage adds **no new
  constant to `scroll.ts`** — the expand is CSS-driven, so its duration lives in `motion.css`.
  Grep-proven at Task 9.
- **Module boundaries are hard.** `day.ts` never imports `gcal.ts`; writes go
  UI → `state.ts` → `gcal.ts`. `scroll.ts` imports `types.ts` and `dates.ts` only and never
  imports `state.ts`. `categories.ts` stays DOM-free.
- **A file the layout lacks is added to `SPEC.md` first.** No new files this stage —
  `day.ts`, `motion.css`, `chrome.ts` all already exist. New *API* is added to `SPEC.md`
  first (Task 1) and only then written.
- **Every "this control works" claim is backed by `document.elementFromPoint()`** at the
  control's centre. `element.click()` is not evidence.
- **A background refresh must never destroy transient UI.** `refresh()` is a no-op while the
  form is open.
- **Any selector that sets `display` re-asserts `[hidden]`.**
- **Grep the whole `src/` tree for a bare class token before adding a CSS class.** The day
  panel family is `dp-` — verified 0 hits across `src/`, `scripts/`, `index.html`.
- TypeScript strict. No `any` without a `// why:` comment. `DayNumber` for storage;
  `WeekIndex`/`DayOffset` are layout-time only, converted in `state.ts`.
- Modules reachable from `src/selftest.ts` touch browser globals **inside functions only**,
  never at module scope — `npm run selftest` runs that graph under bare node. `day.ts` joins
  that graph, so its panel node is created lazily.

## File Structure

| File | Change | Responsibility after this stage |
|---|---|---|
| `_references/SPEC.md` | modify | The contract: new API blocks, motion ruling, phone rule |
| `_references/DECISIONS.md` | modify | "Stage 04 rulings (plan time)" |
| `_references/OPEN.md` | modify | Phone-expansion item closed with a dated line |
| `src/motion.css` | modify | + expand/collapse transitions, stagger token, exit state, jump guard, toast lifetime |
| `src/style.css` | modify | + `.dp` family, `.day[data-open]`, phone gap, toast surface |
| `src/scroll.ts` | modify | + `fitY` (pure), `setExpanded`, `rowHeight`, `data-anim` lifecycle |
| `src/render.ts` | modify | + `columnsFor` (pure) — the expanded row's column template |
| `src/day.ts` | rewrite | Panel: header, event list, reserved slots, form, validation, writes |
| `src/chrome.ts` | modify | `toast()` built for real; `mount()` stays a stage-05 stub |
| `src/main.ts` | modify | Wiring: tap→open, one at a time, Escape, delta measurement, held repaint |
| `src/selftest.ts` | modify | + cases for `fitY`, `columnsFor`, `validate` |
| `scripts/shot.mjs` | modify | + expand/collapse, hit-test, reduced-motion, jump-guard, typed-text probes |
| `04_day/output/verification.md` | create | Gate criteria, results, rulings, what was not tested |

---

### Task 1: Upstream contract edits

Nothing is built before the contract says it exists. No code in this task.

**Files:**
- Modify: `_references/SPEC.md` — "Scroll engine API", "Motion", "Inline day expansion", "Event form"
- Modify: `_references/DECISIONS.md` — new section after "Stage 03 gate close"
- Modify: `_references/OPEN.md` — "Rebuild questions"

**Interfaces:**
- Consumes: nothing.
- Produces: the signatures every later task implements — `setExpanded`, `rowHeight`,
  `onExpandEnd`, `fitY`, `columnsFor`, and the `day.ts` API block.

- [ ] **Step 1: SPEC "Scroll engine API" — extend the two API blocks**

In the fenced block, replace the `ScrollHost` / `ScrollController` lines with:

```
scroll.mount(root: HTMLElement, host: ScrollHost): ScrollController
ScrollHost      = { fillRow(node, week, rowH), mondayOf(week), weekOf(day),
                    onDock(week), onRangeChange(firstWeek, lastWeek), onExpandEnd() }
ScrollController= { goToWeek(week, animate), setSnapStep(15|30|45),
                    setExpanded(ex: Expanded, animate: boolean), rowHeight(),
                    invalidate(weeks?), destroy() }
render.renderWeek(node: HTMLElement, week: WeekIndex, spans: EventSpan[], rowH: number): void
render.packLanes(spans: EventSpan[]): PackedSpan[]
render.columnsFor(offset: DayOffset, full: boolean): string
render.renderRange(node: HTMLElement, firstWeek: WeekIndex, lastWeek: WeekIndex): void
year.mount(root: HTMLElement, host: YearHost): YearController
```

Add `fitY(y, ex, rowH, viewportH)` to the pure-maths fenced list, on the line after
`snapTargetY(...)`.

Then append these bullets to that section:

```
- **`setExpanded` jumps the maths and lets CSS carry the pixels.** It sets
  `expanded`, moves `y` through `fitY` so the grown row is fully on screen, and
  writes each row's FINAL transform and height once. `posOf`/`weekAtY` are
  therefore never mid-flight-wrong: a click during the animation resolves
  against the layout the pixels are heading for, bounded by `--t-open`.
  Expansion and the scroll-to-fit ride are one transition, not two.
- **`rowHeight()` exists so no consumer measures the row.** The expanded delta
  is `max(0, panel height − rowHeight())`; reading it off a DOM node would read
  a mid-animation height.
- **`data-anim` on the scroller gates the transition**, carrying `expand` or
  `collapse`. Any pointerdown, wheel or `goToWeek` clears it first, so a drag is
  never transitioned. A node recycled INTO view mid-animation is stamped
  `data-jump` — without it the node would fly in from its position 14 rows away.
  The stamp is written only while `data-anim` is set, so steady-state recycling
  keeps its two style writes per row per frame.
- **`onExpandEnd()` fires when the animation is over.** `scroll.ts` reads the
  duration from the row's own computed `transition-duration` plus
  `transition-delay`, so `motion.css` keeps the single home for the value and
  reduced motion's 80ms is honoured without a second code path.
```

- [ ] **Step 2: SPEC "Motion" — resolve the stage-04 note**

Replace the parenthetical `(Stage 04 note: the expand row-height animation may be driven
either way; whichever it is decides which home its duration lives in.)` with:

```
  (Stage 04 ruling: the expand is driven by CSS, so its duration lives in
  `motion.css` and `scroll.ts` gains no new constant. `scroll.ts` reads the
  effective duration back off the element's computed style to know when the
  animation ended — a token read, not a literal.)
```

Add `--t-stagger: 40ms` and `--t-toast: 3200ms` to the token list in the first bullet.

Append to the `prefers-reduced-motion` bullet:

```
  Carve-out: a toast's animation is its LIFETIME, not motion. Collapsing it to
  80ms would make an error unreadable, so under reduced motion the toast keeps
  `--t-toast` and swaps to opacity-only keyframes.
```

Append to the enter/exit-utility bullet:

```
  The utility has three states: `.enter` (hidden at rest), `[data-in]` (entering,
  staggered by `--i`), `[data-out]` (leaving, opacity only, never staggered).
  A component sets `--i` as a plain integer; the 40ms cadence stays a token.
```

- [ ] **Step 3: SPEC "Inline day expansion" — fix the phone rule and add the day API**

Replace the bullet `- Phone (≤560px): the day expands to full row width inline (leaning; rule
at plan time and record it in `DECISIONS.md`).` with:

```
- **Phone (≤560px): inline full width.** Ruled at the stage-04 plan. The other
  six columns go to `0fr` and the column gap to zero, so it is the same
  `grid-template-columns` mechanism as the desktop `3fr`, not a second shell.
  The bottom sheet stays rejected (`DECISIONS.md` "Rejected — do not retry").
```

Append a fenced API block to the end of the section:

```
### Day module API (`src/day.ts`)

configure(host: DayHost): void
expand(day: DayNumber, into: HTMLElement): void   — attach the panel, rebuild the list
beginCollapse(): void                             — fade the content, panel stays until detach
detach(): void                                    — remove the panel from the DOM
openAdd(day: DayNumber): void                     — the FAB entry point
refresh(): void                                   — rebuild the list; NO-OP while the form is open
isFormOpen(): boolean
closeForm(): void                                 — close the form, keep the day open
contentHeight(): number                           — panel offsetTop + offsetHeight, 0 unattached
validate(draft: EventDraft): string | null        — pure; null when writable
DayHost = { toast(message), onHeightChange(), onFormClosed() }
```

`day.ts` owns ONE panel node and moves it between cells. A refill or a resize re-attaches
the same DOM, so typed text cannot be wiped by anything but an explicit rebuild — and
`refresh()` refuses to rebuild while the form is open.

- [ ] **Step 4: SPEC "Event form" — name the error surface**

Append:

```
- Errors surface in the form AND as a toast. `chrome.toast` is built at stage 04
  because that is where the first write error can happen; `chrome.mount` stays a
  stage-05 stub. The file layout puts toasts in `chrome.ts` and that is where
  they go — no interim home to delete later.
```

- [ ] **Step 5: DECISIONS — add the plan-time rulings**

Append after the "Stage 03 gate close" section:

```markdown
## Stage 04 rulings (2026-08-29, made at plan time)

- **The expand is one CSS transition, not a rAF animation.** `scroll.ts` jumps
  `expanded` and `y` to their final values, writes each row's final geometry
  once, and `motion.css` interpolates. Per-frame cost is zero, no cubic-bezier
  solver is needed to reproduce `--ease-spring`'s overshoot, and the motion
  carve-out boundary holds without a new constant in `scroll.ts`.
- **Expansion and scroll-to-fit are the same transition.** Because the scroller
  is synthetic, moving `y` IS writing transforms — so the row growing and the
  view sliding up to fit it interpolate together, one duration, nothing to
  co-ordinate. `fitY` shifts up only as far as the row's own top edge, so
  opening a day never pushes its top above the fold.
- **The animation's end is read from computed style, not from a JS constant.**
  `getComputedStyle(row).transitionDuration + transitionDelay`. Reduced motion's
  80ms is then correct by construction rather than by a parallel constant.
- **Accepted, bounded:** hit-testing during the animation resolves against the
  FINAL layout while the pixels are still in flight. The window is exactly
  `--t-open` (expand) or `--t-fast + --t-base` (collapse). Preferred over the
  alternative — mid-flight-accurate maths would mean per-frame recomputation and
  a click that lands on whatever slid under the finger.
- **`data-jump` guards recycling during an animation only.** A node recycled into
  view mid-animation would transition from its position 14 rows away. The stamp
  is written only while `data-anim` is set, so steady-state recycling keeps its
  two style writes per row per frame. Asserted in the harness so the guard cannot
  leak and deaden normal recycling.
- **Phone (≤560px) is inline full width**, via the same `grid-template-columns`
  mechanism with `0fr` neighbours and zero column gap. The bottom sheet stays
  rejected; no new reason was found to retry it.
- **Reduced motion collapses motion, not dwell.** The global 80ms rule would make
  a toast unreadable, so `.toast` keeps `--t-toast` and swaps to opacity-only
  keyframes under `prefers-reduced-motion`.
- **`chrome.toast` is built at stage 04**, `chrome.mount` stays a stage-05 stub.
  Toasts belong to `chrome.ts` in the file layout; a temporary home in `day.ts`
  would be a boundary bend with a deletion attached.
- **The panel stops pointer events reaching the scroller.** `scroll.ts` calls
  `setPointerCapture` on every pointerdown in the scroller, which retargets the
  compat `click` and would break every form control. One `pointerdown`
  `stopPropagation` on the panel fixes it without `scroll.ts` learning what a
  day panel is.
- **Day taps are detected from the pointer sequence, not `click`**, for the same
  capture reason, with the target resolved by `document.elementFromPoint` at the
  pointerdown position — which is the hit test CONVENTIONS demands anyway. A
  movement past `TAP_SLOP` is a drag, not a tap.
```

- [ ] **Step 6: OPEN.md — close the phone-expansion question**

Under "Rebuild questions", replace `- Phone expansion: inline full-width or bottom sheet
(leaning inline).` with:

```
- **2026-08-29 — Phone expansion: CLOSED at the stage-04 plan.** Inline full
  width: the six neighbours go to `0fr` and the column gap to zero, so it is the
  desktop mechanism with different numbers rather than a second shell. The sheet
  was already in `DECISIONS.md` "Rejected — do not retry" and no new reason was
  found to retry it. Ruling in `DECISIONS.md` "Stage 04 rulings".
```

Add under "Never verified on a device":

```
- **`grid-template-columns` interpolation on iOS Safari.** The expansion animates
  the column template. Chrome interpolates it; if iOS Safari snaps instead, the
  degradation is a hard column jump with the height still animating. Gate row at
  stage 04; the fallback if it snaps is to accept the snap and record it.
```

- [ ] **Step 7: Commit**

```bash
cd /Users/admin/_git/want/bramwell
git add _references/SPEC.md _references/DECISIONS.md _references/OPEN.md 04_day/output/plan.md
git commit -m "stage 04: contract first — day/scroll API, motion ruling, phone rule"
```

---

### Task 2: `motion.css` and `style.css` primitives

The primitive before its consumer. Nothing here depends on `day.ts` existing, and the
grep-cleanliness of the whole stage is decided in this task.

**Files:**
- Modify: `src/motion.css`
- Modify: `src/style.css`

**Interfaces:**
- Consumes: the SPEC token list from Task 1.
- Produces: `--t-stagger`, `--t-toast`, `.enter[data-out]`, `.scroller[data-anim="expand"|"collapse"]`,
  `.week[data-jump]`, `.toast`, `.dp` family, `.day[data-open]`, `.week[data-full]`.

- [ ] **Step 1: Add the two tokens to `motion.css`**

In the `:root` block, after `--t-open: 380ms;`:

```css
  --t-stagger: 40ms;
  /* A toast's dwell. Not a motion value in the reduced-motion sense: see the
     carve-out at the bottom of this file. */
  --t-toast: 3200ms;
```

- [ ] **Step 2: Give the enter/exit utility its third state**

Replace the `.enter` block with:

```css
/* One shared enter/exit utility, so components never write their own.
   Three states: at rest (hidden), entering (staggered by --i), leaving.
   --i is a plain integer a component sets; the 40ms cadence stays a token,
   and anything that never sets --i gets no delay. */
.enter { opacity: 0; transform: translateY(6px); }
.enter[data-in] {
  opacity: 1; transform: none;
  transition: opacity var(--t-base) var(--ease-out), transform var(--t-base) var(--ease-out);
  transition-delay: calc(var(--t-stagger) * var(--i, 0));
}
/* Collapse fades content first and never staggers (SPEC "Motion"). */
.enter[data-out] {
  opacity: 0; transform: none;
  transition: opacity var(--t-base) var(--ease-out);
  transition-delay: 0s;
}
```

`render.ts`'s `renderRange` cross-fade is unaffected: it only ever adds and removes
`data-in`, and the at-rest `.enter` still carries no transition, so its snap stays a snap.

- [ ] **Step 3: Add the expand/collapse transition**

Append to `motion.css`, before the reduced-motion block:

```css
/* The one permitted layout animation (SPEC "Motion"), contained to the scroller.
   scroll.ts writes each row's FINAL geometry once and CSS interpolates: there is
   no per-frame JavaScript in an expand. The columns are set on the row and its
   bar overlay together so the two interpolate in lockstep. */
.scroller[data-anim] .week,
.scroller[data-anim] .bars {
  transition-property: transform, height, grid-template-columns, column-gap;
}
.scroller[data-anim="expand"] .week,
.scroller[data-anim="expand"] .bars {
  transition-duration: var(--t-open);
  transition-timing-function: var(--ease-spring);
}
.scroller[data-anim="collapse"] .week,
.scroller[data-anim="collapse"] .bars {
  transition-duration: var(--t-base);
  transition-timing-function: var(--ease-out);
  transition-delay: var(--t-fast);        /* content fades first (SPEC "Motion") */
}
/* A pool node recycled INTO view mid-animation would otherwise slide in from its
   previous position, 14 rows away. Stamped by scroll.ts only while data-anim is
   set, so steady-state recycling pays nothing. */
.scroller[data-anim] .week[data-jump],
.scroller[data-anim] .week[data-jump] .bars { transition-property: none; }
```

- [ ] **Step 4: Add the toast lifetime**

Append, still before the reduced-motion block:

```css
/* A toast's whole life is one animation, so its timing has a single home. */
@keyframes toast-life {
  0%        { opacity: 0; transform: translateY(6px); }
  10%, 90%  { opacity: 1; transform: none; }
  100%      { opacity: 0; transform: translateY(6px); }
}
@keyframes toast-life-plain {
  0%        { opacity: 0; }
  10%, 90%  { opacity: 1; }
  100%      { opacity: 0; }
}
.toast { animation: toast-life var(--t-toast) var(--ease-out) both; }
```

- [ ] **Step 5: Add the reduced-motion carve-out**

Inside the existing `@media (prefers-reduced-motion: reduce)` block, after the `*` rule:

```css
  /* A toast's animation is its LIFETIME, not motion: collapsing it to 80ms would
     make an error message unreadable. The dwell stays; the movement goes. */
  .toast {
    animation-name: toast-life-plain !important;
    animation-duration: var(--t-toast) !important;
  }
```

- [ ] **Step 6: `style.css` — the day panel family and the open cell**

Append to `style.css`, after the timed-chips section:

```css
/* ---------- inline day expansion ---------- */
/* The picked cell keeps the open elevation — the third and last level; nothing
   else on screen casts a shadow (SPEC "Visual direction — Night Depth"). */
.day[data-open] { box-shadow: var(--el-open); overflow: hidden; }
.day[data-open]::after { opacity: 0; }        /* the hover layer stands down while open */
/* Phone (≤560px): neighbours are 0fr, so the gap between them is dead space. */
.week[data-full] { column-gap: 0; }

.dp {
  position: relative; margin-top: 18px; padding-bottom: 8px;
  display: flex; flex-direction: column; gap: 6px;
  touch-action: auto;                          /* the row is touch-action:none; the panel is not */
}
.dp-head { font-weight: 620; font-size: 13px; }
.dp-list { display: flex; flex-direction: column; gap: 2px; }
.dp-ev {
  display: flex; align-items: center; gap: 6px; min-width: 0;
  font: inherit; font-size: 12px; text-align: left; color: var(--ink);
  background: color-mix(in srgb, var(--cat) 16%, transparent);
  border: 0; border-left: 3px solid var(--cat); border-radius: var(--bar-r);
  padding: 4px 6px;
}
.dp-at { color: var(--ink-dim); font-variant-numeric: tabular-nums; flex: none; }
.dp-ttl { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; flex: 1; }
.dp-cat { color: var(--cat); font-size: 11px; flex: none; }
.dp-none { color: var(--ink-dim); font-size: 12px; }
/* Reserved: stage 07 fills habits, stage 08 the journal link. */
.dp-slot { min-height: 0; }
.dp-add { font: inherit; font-size: 12px; color: var(--ink); background: var(--band-b-end); border: 0; border-radius: 8px; padding: 5px 9px; align-self: start; }

.dp-form { display: flex; flex-direction: column; gap: 6px; }
.dp-form input, .dp-form textarea, .dp-form select {
  font: inherit; font-size: 12px; color: var(--ink);
  background: var(--surface); border: 1px solid var(--rule); border-radius: 6px; padding: 5px 7px;
  min-width: 0; width: 100%; box-sizing: border-box;
}
.dp-form textarea { resize: vertical; min-height: 44px; }
.dp-when { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.dp-when input { width: auto; flex: 1 1 96px; }
.dp-cats { display: flex; flex-wrap: wrap; gap: 4px; }
.dp-chip {
  font: inherit; font-size: 11px; color: var(--cat);
  background: color-mix(in srgb, var(--cat) 14%, transparent);
  border: 1px solid transparent; border-radius: 999px; padding: 3px 9px;
}
.dp-chip[aria-pressed="true"] { border-color: var(--cat); font-weight: 620; }
.dp-line { display: flex; align-items: center; gap: 6px; font-size: 12px; }
.dp-line input[type="checkbox"], .dp-line input[type="radio"] { width: auto; }
.dp-err { color: var(--cat-err, #D14343); font-size: 12px; margin: 0; }
.dp-actions { display: flex; gap: 6px; align-items: center; }
.dp-actions button { font: inherit; font-size: 12px; color: var(--ink); background: var(--band-b-end); border: 0; border-radius: 8px; padding: 5px 9px; }
.dp-save { font-weight: 620; }
.dp-del { margin-left: auto; color: var(--cat-err, #D14343); }
.dp-del[data-confirm] { background: color-mix(in srgb, var(--cat-err, #D14343) 18%, transparent); }
.dp-form[data-busy] { opacity: .6; pointer-events: none; }

/* ---------- toasts ---------- */
#toasts {
  position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%);
  z-index: 10; display: flex; flex-direction: column; gap: 6px; align-items: center;
  pointer-events: none;
}
.toast {
  background: var(--band-b-end); color: var(--ink); box-shadow: var(--el-open);
  border-radius: 8px; padding: 8px 14px; font-size: 13px; max-width: min(90vw, 420px);
}
```

Add `--cat-err` beside the other non-mood tokens in `style.css` `:root` and its dark
override, so the error red is a token like everything else:

```css
  --cat-err: #D14343;      /* in :root */
  --cat-err: #F87171;      /* in the dark @media block */
```

Then remove the `, #D14343` fallbacks from the three `var(--cat-err, …)` uses above — the
token is now always defined.

- [ ] **Step 7: Verify nothing regressed and commit**

```bash
cd /Users/admin/_git/want/bramwell
npm run build
```
Expected: PASS (tsc clean, vite builds). CSS-only changes cannot break tsc, so this is
proving the build still runs.

```bash
git add src/motion.css src/style.css
git commit -m "stage 04: motion primitives — expand/collapse, stagger, exit state, toast"
```

---

### Task 3: `scroll.ts` — `fitY`, `setExpanded`, `rowHeight`

TDD: `fitY` is pure and gets its test first.

**Files:**
- Modify: `src/scroll.ts`
- Modify: `src/selftest.ts` — import `fitY`, add one case

**Interfaces:**
- Consumes: the existing `Expanded`, `posOf`, `heightOf`, `place`.
- Produces:
  - `fitY(y: number, ex: Expanded, rowH: number, viewportH: number): number`
  - `ScrollController.setExpanded(ex: Expanded, animate: boolean): void`
  - `ScrollController.rowHeight(): number`
  - `ScrollHost.onExpandEnd(): void`

- [ ] **Step 1: Write the failing test**

In `src/selftest.ts`, add `fitY` to the existing `from './scroll.ts'` import list. Add this
case to the `cases` array, immediately after `'scroll: snap target puts the anchor row top at
viewport centre'`:

```ts
  ['scroll: fitY keeps the expanded row on screen without pushing its top off', () => {
    const H = 120, VH = 700
    // Week 2's top sits at 240; y = 0 means the viewport starts at the top of week 0.
    const ex: Expanded = { week: asWeek(2), delta: 300 }
    // Fully visible already (240 + 420 = 660 <= 700): nothing moves.
    if (fitY(0, ex, H, VH) !== 0) return `visible row moved: ${fitY(0, ex, H, VH)}`
    // No expansion is never a reason to scroll.
    if (fitY(137, null, H, VH) !== 137) return 'fitY moved the view with nothing expanded'
    // Overruns the bottom by 60 (top 300, bottom 760): shift up by exactly 60.
    if (fitY(-60, ex, H, VH) !== 0) return `bottom overrun: ${fitY(-60, ex, H, VH)}`
    // Row taller than the viewport: clamp at the row's own top, never past it.
    const tall: Expanded = { week: asWeek(2), delta: 900 }
    const clamped = fitY(0, tall, H, VH)
    if (clamped !== 240) return `tall row did not clamp to its own top: ${clamped}`
    if (posOf(asWeek(2), H, tall) - clamped !== 0) return 'the clamped row top is not at the fold'
    // Row above the fold: pull it down to the top edge, not past it.
    if (fitY(400, ex, H, VH) !== 240) return `above the fold: ${fitY(400, ex, H, VH)}`
    // Idempotent — fitting an already-fitted view is a no-op.
    const once = fitY(-500, ex, H, VH)
    if (fitY(once, ex, H, VH) !== once) return `not idempotent: ${once} -> ${fitY(once, ex, H, VH)}`
    return null
  }],
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm run selftest 2>&1 | tail -5
```
Expected: FAIL — the import of `fitY` does not resolve, so the run errors before any case
runs (`SyntaxError: … does not provide an export named 'fitY'`).

- [ ] **Step 3: Implement `fitY`**

In `src/scroll.ts`, immediately after `snapTargetY`:

```ts
/** Scroll offset that keeps the expanded row fully on screen: shift up by however
 *  much its bottom overruns the viewport, but NEVER past its own top edge, and
 *  pull it back down if it starts above the fold. Pure — no layout read, so the
 *  scroll-to-fit ride is decided before a single pixel moves and rides the same
 *  transition as the expansion itself. */
export function fitY(y: number, ex: Expanded, rowH: number, viewportH: number): number {
  if (ex === null) return y
  const top = posOf(ex.week, rowH, ex) - y
  const bottom = top + heightOf(ex.week, rowH, ex)
  if (top < 0) return y + top
  if (bottom > viewportH) return y + Math.min(bottom - viewportH, top)
  return y
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd /Users/admin/_git/want/bramwell && npm run selftest 2>&1 | tail -5
```
Expected: PASS, and the total case count is one higher than before.

- [ ] **Step 5: Add `onExpandEnd` to `ScrollHost` and the two controller methods to the type**

```ts
export type ScrollHost = {
  fillRow(node: HTMLElement, week: WeekIndex, rowH: number): void
  mondayOf(week: WeekIndex): DayNumber
  weekOf(day: DayNumber): WeekIndex
  onDock(week: WeekIndex): void
  onRangeChange(firstWeek: WeekIndex, lastWeek: WeekIndex): void
  /** The expand/collapse transition is over. Fired for a non-animated set too. */
  onExpandEnd(): void
}
export type ScrollController = {
  goToWeek(week: WeekIndex, animate: boolean): void
  setSnapStep(step: 15 | 30 | 45): void
  setExpanded(ex: Expanded, animate: boolean): void
  /** The UNEXPANDED row height. Consumers derive the delta from this rather than
   *  measuring a DOM node, which mid-animation would read an interpolated height. */
  rowHeight(): number
  invalidate(weeks?: WeekIndex[]): void
  destroy(): void
}
```

- [ ] **Step 6: Make `expanded` mutable and add the animation lifecycle**

In `mount`, replace `const expanded: Expanded = null …` with:

```ts
  let expanded: Expanded = null
  let animTimer: ReturnType<typeof setTimeout> | null = null
```

Add these two functions above `place()`:

```ts
  /** The transition gate. `null` clears it, and every path that moves `y` clears
   *  it first so a drag is never transitioned. Clearing also drops the jump
   *  stamps, which only mean anything while an animation is running. */
  function setAnim(kind: 'expand' | 'collapse' | null): void {
    if (animTimer !== null) { clearTimeout(animTimer); animTimer = null }
    if (kind !== null) { root.dataset['anim'] = kind; return }
    if (root.dataset['anim'] === undefined) return
    delete root.dataset['anim']
    for (const n of pool) delete n.dataset['jump']
  }

  /** The effective duration motion.css just applied, read back off the element.
   *  This is why no expand duration exists in this file: the value has one home,
   *  and reduced motion's 80ms arrives here without a second code path. */
  function animMs(node: HTMLElement): number {
    const cs = getComputedStyle(node)
    const longest = (v: string) => Math.max(0, ...v.split(',').map(s => parseFloat(s) || 0))
    return (longest(cs.transitionDuration) + longest(cs.transitionDelay)) * 1000
  }
```

- [ ] **Step 7: Stamp recycled nodes during an animation only**

In `place()`, replace the refill branch:

```ts
  function place(): void {
    // One property read, no layout read: the stamp is only meaningful while an
    // animation is running, so steady-state rows keep exactly two style writes.
    const animating = root.dataset['anim'] !== undefined
    const first = weekAtY(y, rowH, expanded)
    for (let i = 0; i < POOL_SIZE; i++) {
      const w = asWeek(first + i)
      const slot = ((w % POOL_SIZE) + POOL_SIZE) % POOL_SIZE
      const node = pool[slot]!
      if (assigned[slot] !== w) {
        assigned[slot] = w
        // Recycled INTO view mid-animation: without this it slides in from its
        // previous position, 14 rows away.
        if (animating) node.dataset['jump'] = ''
        host.fillRow(node, w, rowH)
      }
      node.style.transform = `translateY(${posOf(w, rowH, expanded) - y}px)`
      node.style.height = `${heightOf(w, rowH, expanded)}px`
    }
    host.onRangeChange(first, asWeek(first + POOL_SIZE - 1))
  }
```

- [ ] **Step 8: Clear the gate on every path that moves `y`**

Add `setAnim(null)` as the first statement of `onPointerDown`, `onWheel` and `frame`, and as
the first statement inside the returned `goToWeek`. `onPointerMove` needs none — it cannot
run without a `pointerdown` first.

- [ ] **Step 9: Implement `setExpanded` and `rowHeight`**

In the returned controller, after `setSnapStep`:

```ts
    setExpanded(ex, animate) {
      setAnim(animate ? (ex === null ? 'collapse' : 'expand') : null)
      // The maths jump; CSS carries the pixels. Moving y IS writing transforms,
      // so the row growing and the view sliding to fit it are one transition.
      expanded = ex
      y = fitY(y, ex, rowH, viewportH)
      place()
      if (!animate) { host.onExpandEnd(); return }
      const ms = animMs(pool[0]!)
      animTimer = setTimeout(() => { animTimer = null; setAnim(null); host.onExpandEnd() }, ms)
    },
    rowHeight() { return rowH },
```

In `destroy()`, add `if (animTimer !== null) clearTimeout(animTimer)` beside the existing
`wheelTimer` clear.

- [ ] **Step 10: Verify the build and the suite**

```bash
cd /Users/admin/_git/want/bramwell && npm run build && npm run selftest 2>&1 | tail -3
```
Expected: build PASSES; selftest reports every case passing. `main.ts` will not compile until
Task 6 adds `onExpandEnd` to its host literal — if `tsc` reports exactly that, add the
temporary line `onExpandEnd: () => {},` to the `scroll.mount` host object in `main.ts` now and
finish the wiring in Task 6.

- [ ] **Step 11: Commit**

```bash
cd /Users/admin/_git/want/bramwell
git add src/scroll.ts src/selftest.ts src/main.ts
git commit -m "stage 04: scroll.ts variable-height row — fitY, setExpanded, anim gate"
```

---

### Task 4: `render.columnsFor` — the expanded row's column template

**Files:**
- Modify: `src/render.ts`
- Modify: `src/selftest.ts`

The contract's Outputs line says "`render.ts` expanded-row rendering". The stage-03 carry-forward
overrides how: `renderWeek` is the seam and `main.ts` substitutes the expanded row there, so
`render.ts`'s share of the expansion is the column template and nothing else. `render.ts` still
does not know `day.ts` exists.

**Interfaces:**
- Consumes: `DayOffset` from `types.ts`.
- Produces: `render.columnsFor(offset: DayOffset, full: boolean): string`,
  `render.PHONE_MAX_W: number`, `render.EXPAND_FR: number`.

- [ ] **Step 1: Write the failing test**

Add `columnsFor` and `PHONE_MAX_W` to the existing `from './render.ts'` import in
`src/selftest.ts`, and add this case after `'render: …'`'s last case (immediately before the
`rangeLabel` case):

```ts
  ['render: the expanded row column template, desktop and phone', () => {
    const desk = columnsFor(asOffset(2), false)
    if (desk !== '1fr 1fr 3fr 1fr 1fr 1fr 1fr') return `desktop offset 2: "${desk}"`
    const phone = columnsFor(asOffset(0), true)
    if (phone !== '1fr 0fr 0fr 0fr 0fr 0fr 0fr') return `phone offset 0: "${phone}"`
    const last = columnsFor(asOffset(6), true)
    if (last !== '0fr 0fr 0fr 0fr 0fr 0fr 1fr') return `phone offset 6: "${last}"`
    // Always exactly seven tracks, or the bar overlay stops lining up with the row.
    for (let o = 0; o <= 6; o++) {
      for (const full of [false, true]) {
        const parts = columnsFor(asOffset(o), full).split(' ')
        if (parts.length !== 7) return `offset ${o} full=${full}: ${parts.length} tracks`
        // The picked column is the only one that differs from its neighbours.
        const picked = parts.filter((p, i) => i === o)
        if (picked[0] !== '1fr' && picked[0] !== '3fr') return `offset ${o}: picked track "${picked[0]}"`
      }
    }
    if (PHONE_MAX_W !== 560) return `phone breakpoint drifted from the SPEC: ${PHONE_MAX_W}`
    return null
  }],
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/admin/_git/want/bramwell && npm run selftest 2>&1 | tail -5
```
Expected: FAIL — `does not provide an export named 'columnsFor'`.

- [ ] **Step 3: Implement**

In `src/render.ts`, after `packLanes`:

```ts
/** SPEC "Inline day expansion": the phone rule is ≤560px. */
export const PHONE_MAX_W = 560
/** Desktop: the open day takes three tracks to a neighbour's one. */
export const EXPAND_FR = 3

/** The expanded row's column template. `full` is the phone rule: neighbours go to
 *  `0fr` and the picked day takes the whole row — the same mechanism as the
 *  desktop `3fr`, not a second shell (DECISIONS "Stage 04 rulings"). Always seven
 *  tracks, because the bar overlay is set from the same string. */
export function columnsFor(offset: DayOffset, full: boolean): string {
  return Array.from({ length: 7 }, (_, i) =>
    i === offset ? (full ? '1fr' : `${EXPAND_FR}fr`) : (full ? '0fr' : '1fr')).join(' ')
}
```

Add `DayOffset` to the existing `import type { EventSpan, WeekIndex } from './types.ts'`.

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd /Users/admin/_git/want/bramwell && npm run selftest 2>&1 | tail -3
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/admin/_git/want/bramwell
git add src/render.ts src/selftest.ts
git commit -m "stage 04: render.columnsFor — the expanded row template"
```

---

### Task 5: `chrome.toast()`

**Files:**
- Modify: `src/chrome.ts`

**Interfaces:**
- Consumes: `.toast` / `#toasts` from Task 2.
- Produces: `chrome.toast(message: string): void`. `chrome.mount` stays a stage-05 stub.

- [ ] **Step 1: Implement**

Replace `src/chrome.ts` entirely:

```ts
// STAGE 05 — first-run, settings sheet, FAB. `toast` is built at stage 04: it is the
// error surface SPEC "Event form" requires, and the file layout puts toasts here, so
// there is no interim home to delete later (DECISIONS "Stage 04 rulings").
export function mount(_root: HTMLElement): void { throw new Error('STAGE 05: not implemented') }

/** Created on first use, so this module stays free of DOM at module scope. */
let host: HTMLElement | null = null

/** One animation is the toast's whole life — appear, dwell, leave — so its timing
 *  lives in motion.css and nothing here counts milliseconds. Under reduced motion
 *  the dwell survives and only the movement goes (motion.css carve-out). */
export function toast(message: string): void {
  if (host === null || !host.isConnected) {
    host = document.createElement('div')
    host.id = 'toasts'
    document.body.append(host)
  }
  const el = document.createElement('div')
  el.className = 'toast'
  el.setAttribute('role', 'status')
  el.textContent = message
  el.addEventListener('animationend', () => el.remove())
  host.append(el)
}
```

- [ ] **Step 2: Verify the build**

```bash
cd /Users/admin/_git/want/bramwell && npm run build
```
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
cd /Users/admin/_git/want/bramwell
git add src/chrome.ts
git commit -m "stage 04: chrome.toast — the write-error surface"
```

---

### Task 6: `day.ts` panel and `main.ts` wiring — the first visible expansion

The panel without its form. This task ends with a day that opens, animates, closes on
Escape, survives a scroll, and lists its events.

**Files:**
- Rewrite: `src/day.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `scroll.setExpanded`/`rowHeight`/`onExpandEnd` (Task 3), `render.columnsFor` /
  `PHONE_MAX_W` (Task 4), `chrome.toast` (Task 5), `.dp` CSS (Task 2).
- Produces:
  - `day.configure(host: DayHost): void`
  - `DayHost = { toast(message: string): void; onHeightChange(): void; onFormClosed(): void }`
  - `day.expand(d: DayNumber, into: HTMLElement): void`
  - `day.beginCollapse(): void` / `day.detach(): void`
  - `day.refresh(): void` / `day.isFormOpen(): boolean` / `day.contentHeight(): number`
  - Task 7 replaces the three placeholders at the end of the file with the real
    `isFormOpen`, `openForm` and `dropForm`, and adds the public `closeForm`.
  - Task 7 adds `openAdd` and `validate` to this same module.

- [ ] **Step 1: Write `day.ts` — the panel, list and reserved slots**

```ts
// STAGE 04 — inline day expansion content: event list, form, habits, journal.
// NEVER imports gcal.ts: writes go UI -> state.ts -> gcal.ts (SPEC "Write orchestration").
// No DOM at module scope — this module is in the selftest graph, which runs under bare node.
import type { CalendarEvent, DayNumber } from './types.ts'
import { dayToCivil, monthKey } from './dates.ts'
import * as state from './state.ts'
import { all as allCategories } from './categories.ts'

export type DayHost = {
  toast(message: string): void
  /** The panel's natural height may have changed: remeasure and re-set the delta. */
  onHeightChange(): void
  /** The form just closed, so a background repaint held while typing may now run. */
  onFormClosed(): void
}

let host: DayHost = { toast: () => {}, onHeightChange: () => {}, onFormClosed: () => {} }
export function configure(h: DayHost): void { host = h }

/** ONE panel node, moved between cells. A refill or a resize re-attaches the SAME
 *  DOM, which is what makes the transient-UI rule structural rather than remembered
 *  (CONVENTIONS): typed text cannot be wiped by anything but an explicit rebuild. */
let panel: HTMLElement | null = null
let shown: DayNumber | null = null
let list: HTMLElement | null = null

function el(tag: string, className: string, text?: string): HTMLElement {
  const n = document.createElement(tag)
  n.className = className
  if (text !== undefined) n.textContent = text
  return n
}

/** Staggered entry: --i is a plain integer, the 40ms cadence is a token in motion.css. */
function staggered(node: HTMLElement, i: number): HTMLElement {
  node.classList.add('enter')
  node.style.setProperty('--i', String(i))
  return node
}

function build(): HTMLElement {
  const p = el('div', 'dp')
  // scroll.ts captures the pointer on every pointerdown in the scroller, which
  // retargets the compat click and would break every control in here. One stop
  // fixes it without scroll.ts learning what a day panel is.
  p.addEventListener('pointerdown', e => e.stopPropagation())
  p.append(staggered(el('div', 'dp-head'), 0))
  p.append(staggered(el('div', 'dp-list'), 1))
  const habits = el('div', 'dp-slot')          // stage 07 fills this
  habits.dataset['slot'] = 'habits'
  habits.hidden = true
  const journal = el('div', 'dp-slot')         // stage 08 fills this
  journal.dataset['slot'] = 'journal'
  journal.hidden = true
  p.append(habits, journal)
  const add = staggered(el('button', 'dp-add', '+ Add'), 2)
  add.addEventListener('click', () => { if (shown !== null) openForm(shown, null) })
  p.append(add)
  return p
}

function labelFor(name: string): string {
  return allCategories().find(c => c.name === name)?.label ?? name
}

function hhmm(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
}

/** Every event touching `d`, all-day first, then timed by start (SPEC "Inline day expansion"). */
function eventsOn(d: DayNumber): CalendarEvent[] {
  const out = state.eventsForMonth(monthKey(d)).filter(ev => {
    const end = ev.allDay ? ev.end : ev.start
    return ev.start <= d && end >= d
  })
  return out.sort((a, b) =>
    Number(b.allDay) - Number(a.allDay) ||
    (a.allDay ? 0 : a.startMin - (b.allDay ? 0 : b.startMin)) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

function renderList(): void {
  if (list === null || shown === null) return
  const events = eventsOn(shown)
  list.replaceChildren()
  if (events.length === 0) {
    list.append(el('p', 'dp-none', 'Nothing on this day.'))
    return
  }
  for (const ev of events) {
    const row = el('button', 'dp-ev')
    row.dataset['cat'] = ev.category
    row.dataset['id'] = ev.id
    row.append(el('span', 'dp-at', ev.allDay ? 'All day' : hhmm(ev.startMin)))
    row.append(el('span', 'dp-ttl', ev.title))
    // The category LABEL, never its name (SPEC "Event form").
    row.append(el('span', 'dp-cat', labelFor(ev.category)))
    row.addEventListener('click', () => { if (shown !== null) openForm(shown, ev) })
    list.append(row)
  }
}

/** Rebuild the list. NO-OP while the form is open: a background refresh must never
 *  wipe text being typed (CONVENTIONS transient-UI rule). This is the inner,
 *  structural half of that rule; main.ts holds the repaint as the outer half. */
export function refresh(): void {
  if (isFormOpen()) return
  renderList()
  host.onHeightChange()
}

/** Attach the panel to `into` and show `d`. Called from main.ts's fillRow seam on
 *  every refill of the open row, so it must be idempotent. */
export function expand(d: DayNumber, into: HTMLElement): void {
  if (panel === null) panel = build()
  const dayChanged = shown !== d
  shown = d
  list = panel.querySelector('.dp-list')
  if (panel.parentElement !== into) into.append(panel)
  if (dayChanged) dropForm()
  const { y, m, d: dd } = dayToCivil(d)
  const head = panel.querySelector('.dp-head')
  if (head !== null) {
    head.textContent = new Date(Date.UTC(y, m - 1, dd))
      .toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
  }
  refresh()
  for (const n of panel.querySelectorAll<HTMLElement>('.enter')) {
    n.removeAttribute('data-out')
    n.dataset['in'] = ''
  }
}

/** Fade the content out. The panel stays in the DOM, clipped by the shrinking cell,
 *  until detach() — so there is nothing to see when the row reaches its rest height. */
export function beginCollapse(): void {
  if (panel === null) return
  for (const n of panel.querySelectorAll<HTMLElement>('.enter')) {
    n.removeAttribute('data-in')
    n.dataset['out'] = ''
  }
}

export function detach(): void {
  dropForm()
  panel?.remove()
  shown = null
}

/** Panel height measured from the cell's top edge, including the panel's own bottom
 *  padding. main.ts turns this into the delta with scroll's rowHeight(). */
export function contentHeight(): number {
  if (panel === null || panel.parentElement === null) return 0
  return panel.offsetTop + panel.offsetHeight
}
```

Task 7 adds `openForm`, `closeForm`, `isFormOpen`, `openAdd` and `validate`. To keep this
task's build green, append these three temporary declarations at the end of `day.ts` and
delete them in Task 7 Step 5:

```ts
// --- replaced in Task 7 ---
export function isFormOpen(): boolean { return false }
function openForm(_d: DayNumber, _ev: CalendarEvent | null): void {}
function dropForm(): void {}
```

- [ ] **Step 2: Wire `main.ts`**

Add to the imports:

```ts
import * as chrome from './chrome.ts'
import * as day from './day.ts'
```

Immediately before the `scroll.mount` call, add the open-day state and its helpers:

```ts
  // ---- inline day expansion (SPEC "Inline day expansion") ----
  // One day open at a time; main.ts is the only owner of that fact.
  let openDay: DayNumber | null = null
  let delta = 0
  let heldRepaint = false
  let heightRaf = 0
  /** False for the one frame between attaching the panel and the first measure.
   *  A CSS transition interpolates from the style at the LAST recalc, so the
   *  column template has to change in the same task as the height — write it a
   *  frame early and the columns snap while the height animates. */
  let expandReady = false
  /** A pointer that travels further than this was a drag, not a tap. */
  const TAP_SLOP = 6

  const weekOfOpen = (): WeekIndex | null => openDay === null ? null : state.weekOf(openDay)
  const openRow = (): HTMLElement | null =>
    scroller.querySelector<HTMLElement>('.day[data-open]')?.closest<HTMLElement>('.week') ?? null

  function clearColumns(node: HTMLElement): void {
    node.style.removeProperty('grid-template-columns')
    node.removeAttribute('data-full')
    node.querySelector<HTMLElement>('.bars')?.style.removeProperty('grid-template-columns')
  }

  function applyColumns(node: HTMLElement, week: WeekIndex): void {
    if (openDay === null || !expandReady || state.weekOf(openDay) !== week) { clearColumns(node); return }
    const full = window.innerWidth <= render.PHONE_MAX_W
    const cols = render.columnsFor(asOffset(openDay - state.dayAt(week, MON)), full)
    // Set on the row AND its bar overlay so the two interpolate in lockstep
    // rather than relying on an inherited value mid-transition.
    node.style.gridTemplateColumns = cols
    const bars = node.querySelector<HTMLElement>('.bars')
    if (bars !== null) bars.style.gridTemplateColumns = cols
    if (full) { node.dataset['full'] = '' } else { node.removeAttribute('data-full') }
  }

  /** The fillRow seam: render.ts draws the week, then the open day is substituted
   *  here — neither scroll.ts nor render.ts learns that day.ts exists. */
  function applyExpansion(node: HTMLElement, week: WeekIndex): void {
    applyColumns(node, week)
    if (openDay === null || state.weekOf(openDay) !== week) return
    const cell = node.querySelector<HTMLElement>(`.day[data-day="${openDay}"]`)
    if (cell === null) return
    cell.dataset['open'] = ''
    day.expand(openDay, cell)
  }

  /** The delta comes from scroll's own rowHeight, never from a DOM read — mid
   *  animation a measured row height is an interpolated one. Columns and height
   *  are written in ONE task, under the data-anim gate setExpanded raises, so
   *  both interpolate instead of one snapping. */
  function remeasure(animate: boolean): void {
    const week = weekOfOpen()
    if (week === null) return
    delta = Math.max(0, day.contentHeight() - ctl.rowHeight())
    expandReady = true
    const row = openRow()
    if (row !== null) applyColumns(row, week)
    ctl.setExpanded({ week, delta }, animate)
  }

  /** ALWAYS deferred by a frame, and this is load-bearing, not a tidy-up: the
   *  height-change signal originates inside `place()` (fillRow -> applyExpansion
   *  -> day.expand -> refresh), and `setExpanded` calls `place()`. Measuring
   *  synchronously would re-enter `place()` from inside its own row loop. The
   *  frame breaks that chain and coalesces a burst of height changes into one
   *  expansion — the same pattern the cache-change repaint already uses. */
  function scheduleRemeasure(animate: boolean): void {
    if (heightRaf !== 0) return
    heightRaf = requestAnimationFrame(() => { heightRaf = 0; remeasure(animate) })
  }

  function openDayAt(d: DayNumber): void {
    if (openDay === d) return
    const prev = weekOfOpen()
    const week = state.weekOf(d)
    // Moving within one week keeps the row expanded, so the columns animate from
    // the old pick to the new one instead of collapsing and rebuilding.
    expandReady = prev !== null && prev === week
    openDay = d
    delta = 0
    if (prev !== null && prev !== week) { day.detach(); ctl.invalidate([prev]) }  // one day open at a time
    ctl.invalidate([week])              // fillRow -> applyExpansion -> day.expand
    scheduleRemeasure(true)
  }

  function closeDay(): void {
    if (openDay === null) return
    const row = openRow()
    day.beginCollapse()
    openDay = null                      // before setExpanded: onExpandEnd reads it
    expandReady = false
    delta = 0
    // Clearing the template in the same task as setExpanded is what makes the
    // columns animate BACK rather than snap at the end of the collapse.
    if (row !== null) clearColumns(row)
    ctl.setExpanded(null, true)         // onExpandEnd detaches and repaints the row
  }
```

`asDay` must be added to the existing `from './dates.ts'` import.

- [ ] **Step 3: Extend the scroll host**

In the `scroll.mount(scroller, { … })` literal, replace `fillRow` and add `onExpandEnd`:

```ts
    fillRow: (node, week, rowH) => {
      render.renderWeek(node, week, state.spansForWeek(week), rowH)
      applyExpansion(node, week)
    },
```

```ts
    onExpandEnd: () => {
      if (openDay !== null) return
      // The collapse is over: drop the panel and repaint the row it was in.
      const stale = scroller.querySelector<HTMLElement>('.day[data-open]')
      day.detach()
      stale?.removeAttribute('data-open')
      ctl.invalidate()
    },
```

`ctl` is referenced inside the host literal, which is assigned from `scroll.mount` — this is
legal because the callbacks run after assignment. `ctl` is already declared with `const`.

- [ ] **Step 4: Configure the day host and wire taps, Escape and resize**

After `ctl.setSnapStep(30)` and the initial `goToWeek`, add:

```ts
  day.configure({
    toast: chrome.toast,
    onHeightChange: () => scheduleRemeasure(true),
    onFormClosed: () => releaseHeldRepaint(),
  })

  // Taps are read from the pointer sequence, not `click`: scroll.ts captures the
  // pointer, which retargets click to the scroller. elementFromPoint at the press
  // point is the hit test CONVENTIONS demands anyway.
  let tapX = 0, tapY = 0
  let tapCell: HTMLElement | null = null
  scroller.addEventListener('pointerdown', e => {
    tapX = e.clientX; tapY = e.clientY
    const hit = document.elementFromPoint(e.clientX, e.clientY)
    tapCell = hit?.closest('.dp') != null ? null : hit?.closest<HTMLElement>('.day') ?? null
  })
  scroller.addEventListener('pointerup', e => {
    const cell = tapCell
    tapCell = null
    if (cell === null) return
    if (Math.hypot(e.clientX - tapX, e.clientY - tapY) > TAP_SLOP) return   // a drag
    const raw = Number(cell.dataset['day'])
    if (!Number.isFinite(raw)) return
    if (openDay === raw) return               // tapping the open day keeps it open
    openDayAt(asDay(raw))
  })

  // Escape collapses. Scrolling does NOT (SPEC): nothing in the scroll path
  // touches openDay, which is what the harness asserts rather than this comment.
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return
    // Escape unwinds one layer at a time: the form first, then the expansion.
    if (day.isFormOpen()) { e.preventDefault(); day.closeForm(); return }
    if (openDay === null) return
    e.preventDefault()
    closeDay()
  })

  // The panel's natural height is width-dependent, so a resize re-derives the delta.
  window.addEventListener('resize', () => { if (openDay !== null) scheduleRemeasure(false) })
```

- [ ] **Step 5: Hold the repaint while a form is open**

Replace the body of the `state.onCacheChange` callback's `requestAnimationFrame` with:

```ts
    repaint = requestAnimationFrame(() => {
      repaint = 0
      // CONVENTIONS transient-UI rule: a background refresh must never wipe an
      // open form. The repaint is HELD, not dropped — it runs when the form closes.
      if (day.isFormOpen()) { heldRepaint = true; return }
      ctl.invalidate()
      if (inYear() && yearDirty) yearCtl?.invalidate()
      yearDirty = false
    })
```

And add, right after that `state.onCacheChange(...)` call:

```ts
  /** Task 7 calls this from the form's close path; declared here because main.ts
   *  owns the repaint it is releasing. */
  function releaseHeldRepaint(): void {
    if (!heldRepaint) return
    heldRepaint = false
    ctl.invalidate()
  }
```

`day.configure` in Step 4 already wires this to `onFormClosed`, so closing the form — by
saving, deleting, cancelling or Escape — is what releases a background refresh that was held
while the user was typing.

- [ ] **Step 6: Expose `ctl` and `day` on the DEV handle**

In the `import.meta.env.DEV` block, replace the `window.bramwell` assignment:

```ts
    // why: augmenting window for a dev-only console handle, without widening the global type
    ;(window as unknown as { bramwell: unknown }).bramwell = { auth, gcal, categories, state, applyTheme, ctl, day }
```

`ctl` and `day` are what the evidence harness drives in Task 8 — a full `invalidate()` with a
form open is a strictly harsher test of the transient-UI rule than a real cache change.

- [ ] **Step 7: Verify**

```bash
cd /Users/admin/_git/want/bramwell && npm run build && npm run selftest 2>&1 | tail -3
```
Expected: build PASSES, every selftest case passes.

Then look at it running:

```bash
cd /Users/admin/_git/want/bramwell && npm run dev
```
Open the URL, click a day. Expected: the row grows, neighbours compress, rows below shift
down together, the date and event list appear staggered, Escape collapses it, and scrolling
with the wheel leaves it open.

- [ ] **Step 8: Commit**

```bash
cd /Users/admin/_git/want/bramwell
git add src/day.ts src/main.ts
git commit -m "stage 04: inline day expansion — panel, list, tap/Escape wiring"
```

---

### Task 7: The event form

TDD: `validate` is pure and gets its test first.

**Files:**
- Modify: `src/day.ts`
- Modify: `src/selftest.ts`

**Interfaces:**
- Consumes: everything Task 6 produced; `state.createEvent` / `updateEvent` / `deleteEvent`;
  `categories.all()`.
- Produces: `day.validate(draft: EventDraft): string | null`, `day.openAdd(day: DayNumber): void`,
  and the real `day.isFormOpen()`.

- [ ] **Step 1: Write the failing test**

Add to `src/selftest.ts` — import `validate` from `./day.ts`, and add this case at the end of
the `cases` array:

```ts
  ['day: form validation rules', () => {
    const base: EventDraft = {
      title: 'Standup', category: 'work', allDay: false,
      start: civilToDay(2026, 9, 2), end: civilToDay(2026, 9, 2),
      startMin: 9 * 60, endMin: 10 * 60, repeat: 'none',
    }
    if (validate(base) !== null) return `a good draft was rejected: ${validate(base)}`
    if (validate({ ...base, title: '' }) === null) return 'an empty title was accepted'
    if (validate({ ...base, title: '   ' }) === null) return 'a whitespace title was accepted'
    // End before start, both forms.
    const backwards = { ...base, end: civilToDay(2026, 9, 1) }
    if (validate(backwards) === null) return 'an end BEFORE the start was accepted'
    // Same day, end time not after start.
    if (validate({ ...base, endMin: 9 * 60 }) === null) return 'a zero-length timed event was accepted'
    if (validate({ ...base, endMin: 8 * 60 }) === null) return 'a backwards timed event was accepted'
    // Crossing midnight is legal: the end DAY is later, so the clock may go backwards.
    const overnight = { ...base, end: civilToDay(2026, 9, 3), startMin: 23 * 60, endMin: 60 }
    if (validate(overnight) !== null) return `an overnight event was rejected: ${validate(overnight)}`
    // All-day ignores the clock entirely; the end day is INCLUSIVE in the form.
    const allDay: EventDraft = { ...base, allDay: true, startMin: 0, endMin: 0 }
    if (validate(allDay) !== null) return `a one-day all-day event was rejected: ${validate(allDay)}`
    if (validate({ ...allDay, end: civilToDay(2026, 9, 5) }) !== null) return 'a multi-day all-day event was rejected'
    // Out-of-range minutes cannot reach the wire.
    if (validate({ ...base, startMin: -1 }) === null) return 'a negative start minute was accepted'
    if (validate({ ...base, endMin: 1440 }) === null) return 'minute 1440 was accepted'
    return null
  }],
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/admin/_git/want/bramwell && npm run selftest 2>&1 | tail -5
```
Expected: FAIL — `does not provide an export named 'validate'`.

- [ ] **Step 3: Implement `validate`**

In `src/day.ts`, after `contentHeight()`:

```ts
/** Pure, and exported so the selftest pins the exact rules the form runs rather
 *  than a copy of them (CONVENTIONS). Returns the message to show, or null. */
export function validate(d: EventDraft): string | null {
  if (d.title.trim() === '') return 'A title is required.'
  if (d.end < d.start) return 'The end date is before the start date.'
  if (d.allDay) return null
  const s = d.startMin ?? 0
  const e = d.endMin ?? 0
  if (s < 0 || s > 1439 || e < 0 || e > 1439) return 'Times must be between 00:00 and 23:59.'
  // Only a same-day event constrains the clock: crossing midnight legitimately runs backwards.
  if (d.end === d.start && e <= s) return 'The end time is not after the start time.'
  return null
}
```

Add `EventDraft`, `RepeatRule` and `WriteScope` to `day.ts`'s `import type` line, and
`civilToDay` to its `dates.ts` import.

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd /Users/admin/_git/want/bramwell && npm run selftest 2>&1 | tail -3
```
Expected: PASS.

- [ ] **Step 5: Replace the Task 6 placeholders with the real form**

Delete the ENTIRE `// --- replaced in Task 7 ---` block — note it holds FOUR placeholders, not three: `isFormOpen`, `openForm`, `dropForm` and `closeForm` (the fourth was added in Task 6 because the Escape handler calls it). Leaving any of them behind is a duplicate-export build error and append this to `day.ts`:

```ts
// ---------- the form ----------

let form: HTMLFormElement | null = null
/** The event being edited; null means a new event. */
let editing: CalendarEvent | null = null
let picked = ''

export function isFormOpen(): boolean { return form !== null && form.isConnected }

const ymd = (d: DayNumber): string => {
  const { y, m, d: dd } = dayToCivil(d)
  return `${y}-${String(m).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
}
const parseYmd = (v: string): DayNumber | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v)
  return m === null ? null : civilToDay(Number(m[1]), Number(m[2]), Number(m[3]))
}
const parseHm = (v: string): number | null => {
  const m = /^(\d{2}):(\d{2})$/.exec(v)
  return m === null ? null : Number(m[1]) * 60 + Number(m[2])
}

function field<T extends HTMLElement>(sel: string): T | null {
  return form?.querySelector<T>(sel) ?? null
}

function buildForm(d: DayNumber, ev: CalendarEvent | null): HTMLFormElement {
  const f = document.createElement('form')
  f.className = 'dp-form'
  f.addEventListener('submit', e => { e.preventDefault(); void save() })

  const title = document.createElement('input')
  title.className = 'dp-title'
  title.placeholder = 'Title'
  title.value = ev?.title ?? ''
  f.append(title)

  // Category chips carry the user's LABELS, never the stable names (SPEC "Event form").
  const cats = el('div', 'dp-cats')
  picked = ev?.category ?? (allCategories()[0]?.name ?? '')
  for (const c of allCategories()) {
    const chip = el('button', 'dp-chip', c.label) as HTMLButtonElement
    chip.type = 'button'
    chip.dataset['cat'] = c.name
    chip.setAttribute('aria-pressed', String(c.name === picked))
    chip.addEventListener('click', () => {
      picked = c.name
      for (const other of cats.querySelectorAll('.dp-chip')) {
        other.setAttribute('aria-pressed', String(other === chip))
      }
    })
    cats.append(chip)
  }
  f.append(cats)

  const allDayLine = el('label', 'dp-line')
  const allDay = document.createElement('input')
  allDay.type = 'checkbox'
  allDay.className = 'dp-allday'
  allDay.checked = ev?.allDay ?? false
  allDayLine.append(allDay, document.createTextNode('All day'))
  f.append(allDayLine)

  const when = el('div', 'dp-when')
  const start = document.createElement('input'); start.type = 'date'; start.className = 'dp-start'
  const startT = document.createElement('input'); startT.type = 'time'; startT.className = 'dp-startt'
  const end = document.createElement('input'); end.type = 'date'; end.className = 'dp-end'
  const endT = document.createElement('input'); endT.type = 'time'; endT.className = 'dp-endt'
  start.value = ymd(ev?.start ?? d)
  end.value = ymd(ev?.end ?? d)
  startT.value = hhmm(ev !== null && !ev.allDay ? ev.startMin : 9 * 60)
  endT.value = hhmm(ev !== null && !ev.allDay ? ev.endMin : 10 * 60)
  when.append(start, startT, end, endT)
  f.append(when)
  // All-day keeps the times in the DOM so toggling back does not lose them
  // (types.ts: EventDraft is deliberately flat for exactly this).
  const syncAllDay = (): void => { startT.hidden = allDay.checked; endT.hidden = allDay.checked }
  allDay.addEventListener('change', syncAllDay)
  syncAllDay()

  const repeat = document.createElement('select')
  repeat.className = 'dp-repeat'
  for (const [value, text] of [['none', 'Does not repeat'], ['daily', 'Daily'], ['weekly', 'Weekly'],
    ['monthly', 'Monthly'], ['yearly', 'Yearly']]) {
    const o = document.createElement('option')
    o.value = value!; o.textContent = text!
    repeat.append(o)
  }
  // Disabled when editing: Google rejects an RRULE PATCHed against an instance id
  // (DECISIONS "In force — auth and wire").
  repeat.disabled = ev !== null
  f.append(repeat)

  const notes = document.createElement('textarea')
  notes.className = 'dp-notes'
  notes.placeholder = 'Notes'
  notes.value = ev?.notes ?? ''
  f.append(notes)

  // Scope picker ONLY for a recurring event; default "this occurrence" (SPEC).
  if (ev?.recurringEventId !== undefined) {
    const scope = el('div', 'dp-scope')
    for (const [value, text] of [['instance', 'This occurrence'], ['series', 'Whole series']]) {
      const line = el('label', 'dp-line')
      const radio = document.createElement('input')
      radio.type = 'radio'; radio.name = 'dp-scope'; radio.value = value!
      radio.checked = value === 'instance'
      radio.addEventListener('change', resetDeleteConfirm)
      line.append(radio, document.createTextNode(text!))
      scope.append(line)
    }
    f.append(scope)
  }

  const err = el('p', 'dp-err')
  err.hidden = true
  f.append(err)

  const actions = el('div', 'dp-actions')
  const save_ = el('button', 'dp-save', 'Save') as HTMLButtonElement
  save_.type = 'submit'
  const cancel = el('button', 'dp-cancel', 'Cancel') as HTMLButtonElement
  cancel.type = 'button'
  cancel.addEventListener('click', () => closeForm())
  actions.append(save_, cancel)
  if (ev !== null) {
    const del = el('button', 'dp-del', 'Delete') as HTMLButtonElement
    del.type = 'button'
    del.addEventListener('click', () => { void remove() })
    actions.append(del)
  }
  f.append(actions)
  return f
}

function scopeValue(): WriteScope {
  return field<HTMLInputElement>('input[name="dp-scope"][value="series"]')?.checked === true
    ? 'series' : 'instance'
}

function resetDeleteConfirm(): void {
  const del = field<HTMLButtonElement>('.dp-del')
  if (del === null) return
  del.removeAttribute('data-confirm')
  del.textContent = 'Delete'
}

function readDraft(): EventDraft {
  const allDay = field<HTMLInputElement>('.dp-allday')?.checked ?? false
  // `shown` is never null while a form is open; today() is a fallback that keeps
  // the function total rather than a case that happens.
  const start = parseYmd(field<HTMLInputElement>('.dp-start')?.value ?? '') ?? shown ?? state.today()
  const end = parseYmd(field<HTMLInputElement>('.dp-end')?.value ?? '') ?? start
  const draft: EventDraft = {
    title: field<HTMLInputElement>('.dp-title')?.value ?? '',
    category: picked,
    allDay,
    start,
    end,
    repeat: (field<HTMLSelectElement>('.dp-repeat')?.value ?? 'none') as RepeatRule,
  }
  const notes = field<HTMLTextAreaElement>('.dp-notes')?.value ?? ''
  if (notes !== '') draft.notes = notes
  if (!allDay) {
    draft.startMin = parseHm(field<HTMLInputElement>('.dp-startt')?.value ?? '') ?? 0
    draft.endMin = parseHm(field<HTMLInputElement>('.dp-endt')?.value ?? '') ?? 0
  }
  return draft
}

function showError(message: string | null): void {
  const err = field<HTMLElement>('.dp-err')
  if (err === null) return
  err.textContent = message ?? ''
  err.hidden = message === null
}

function busy(on: boolean): void {
  if (form === null) return
  if (on) { form.dataset['busy'] = '' } else { form.removeAttribute('data-busy') }
}

/** day.ts never imports gcal.ts, so an error is read as an Error, not as a GcalError. */
function messageFor(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e)
  return raw.startsWith('Google Calendar API 401') ? 'Google rejected the session. Reconnect and try again.'
    : raw.startsWith('Google Calendar API') ? `${raw} — the change was not saved.`
    : raw
}

async function save(): Promise<void> {
  const draft = readDraft()
  const bad = validate(draft)
  if (bad !== null) { showError(bad); return }
  showError(null)
  busy(true)
  try {
    if (editing === null) { await state.createEvent(draft) }
    else { await state.updateEvent(editing.id, draft, scopeValue()) }
    closeForm()
  } catch (e) {
    // Both surfaces, every time (SPEC "Event form").
    const msg = messageFor(e)
    showError(msg)
    host.toast(msg)
  } finally { busy(false) }
}

async function remove(): Promise<void> {
  if (editing === null) return
  const scope = scopeValue()
  const del = field<HTMLButtonElement>('.dp-del')
  // A series delete confirms first (SPEC). Two-step inline, never confirm() —
  // a modal for this was rejected at stage 08 of v3 (DECISIONS "Rejected").
  if (scope === 'series' && del !== null && del.dataset['confirm'] === undefined) {
    del.dataset['confirm'] = ''
    del.textContent = 'Delete every occurrence?'
    host.onHeightChange()
    return
  }
  busy(true)
  try {
    await state.deleteEvent(editing.id, scope)
    closeForm()
  } catch (e) {
    const msg = messageFor(e)
    showError(msg)
    host.toast(msg)
  } finally { busy(false) }
}

function openForm(d: DayNumber, ev: CalendarEvent | null): void {
  if (panel === null) return
  dropForm()
  editing = ev
  form = buildForm(d, ev)
  form.classList.add('enter')
  form.style.setProperty('--i', '0')
  panel.append(form)
  void form.offsetWidth                     // commit the hidden state before entering
  form.dataset['in'] = ''
  host.onHeightChange()
  field<HTMLInputElement>('.dp-title')?.focus()
}

/** Silent teardown, used when the form is being replaced or the panel is going away. */
function dropForm(): void {
  form?.remove()
  form = null
  editing = null
}

/** The public close: the DAY stays open and the list repaints, because after
 *  saving an event the thing you want to see is the day you just changed.
 *  Releasing the held background repaint is the last step, not the first —
 *  the form is already gone by then, so nothing it repaints can be wiped. */
export function closeForm(): void {
  if (!isFormOpen()) return
  dropForm()
  renderList()
  host.onHeightChange()
  host.onFormClosed()
}

/** The FAB entry point (stage 05 calls it): expand the day and open a blank form. */
export function openAdd(d: DayNumber): void {
  if (shown !== d || panel === null) return
  openForm(d, null)
}
```

Note what `closeForm()` deliberately does NOT do: collapse the day. Saving an event leaves you
looking at the day you just changed, with the list repainted to include it. Collapsing is a
separate gesture — Escape again, or tapping another day.

- [ ] **Step 6: Run the whole suite and the build**

```bash
cd /Users/admin/_git/want/bramwell && npm run build && npm run selftest 2>&1 | tail -3
```
Expected: build PASSES; every selftest case passes.

- [ ] **Step 7: Commit**

```bash
cd /Users/admin/_git/want/bramwell
git add src/day.ts src/selftest.ts
git commit -m "stage 04: event form — validation, chips, scope picker, series delete"
```

---

### Task 8: Evidence — extend `scripts/shot.mjs`

Extend the existing harness. Do not write a second one.

**Files:**
- Modify: `scripts/shot.mjs`

**Interfaces:**
- Consumes: `window.bramwell.ctl` / `.day` (Task 6 Step 6); the `dp-` DOM from Tasks 6–7.
- Produces: the JSON rows Task 9's `verification.md` quotes.

- [ ] **Step 1: Add a reduced-motion pass to the run matrix**

Replace the `SCHEMES` constant and the run loop's media call:

```js
const SCHEMES = ['light', 'dark']
// One extra pass: reduced motion is a gate criterion, not a variant of colour.
const MOTION = ['no-preference', 'reduce']
```

```js
for (const [w, h] of VIEWPORTS) {
  for (const scheme of SCHEMES) {
    for (const motion of MOTION) {
      if (motion === 'reduce' && scheme === 'light') continue   // one reduced pass per viewport
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 500 })
      await send('Emulation.setEmulatedMedia', { features: [
        { name: 'prefers-color-scheme', value: scheme },
        { name: 'prefers-reduced-motion', value: motion },
      ] })
      loaded = false
      await send('Page.navigate', { url: URL_ })
      for (let i = 0; i < 100 && !loaded; i++) await sleep(100)
      await sleep(800)
      try { results.push({ viewport: `${w}x${h}`, scheme, motion, ...(await evalJs(PROBE)) }) }
      catch (e) {
        const body = await evalJs("document.body.innerHTML.replace(/<div class=\"week\"[\\s\\S]*?<\\/div><\\/div>/g, '[week]').slice(0, 400)").catch(String)
        const ls = await evalJs("(() => { try { return Object.keys(localStorage).join() } catch (e) { return String(e) } })()").catch(String)
        results.push({ viewport: `${w}x${h}`, scheme, motion, error: String(e), body, ls })
      }
    }
  }
}
```

- [ ] **Step 2: Add the expansion probes to `PROBE`**

Insert this block into `PROBE` immediately before its `return {` statement, and add a `tap`
helper beside the existing `centre`/`hits` helpers at the top of `PROBE`:

```js
  const tap = el => {
    const [x, y] = centre(el)
    const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', isPrimary: true }
    el.dispatchEvent(new PointerEvent('pointerdown', opts))
    el.dispatchEvent(new PointerEvent('pointerup', opts))
  }
```

```js
  // ---- inline day expansion ----
  const cols = n => getComputedStyle(n).gridTemplateColumns
  const pickDay = Date.UTC(2026, 8, 2) / 86400000                    // Wed 2 Sep, has 'sept'
  // The year-view probes above left the app in year view: come back to the calendar first.
  if (!document.querySelector('.yearview').hidden) document.getElementById('btn-mode').click()
  document.getElementById('btn-today').click()
  await sleep(900)
  let target = document.querySelector('.day[data-day="' + pickDay + '"]')
  if (target === null) { target = document.querySelector('.day:not([data-today])') }
  const targetRow = target.closest('.week')
  const restRowH = Math.round(targetRow.getBoundingClientRect().height)
  const restCellW = target.getBoundingClientRect().width
  const restCols = cols(targetRow)
  const barsMatchAtRest = cols(targetRow.querySelector('.bars')) === restCols
  const dayHitBeforeOpen = hits(target)

  // The duration motion.css actually applied — the bound on the click-during-
  // animation tradeoff, reported rather than assumed.
  tap(target)
  const animAttr = document.querySelector('.scroller').dataset.anim ?? null
  const animDurMs = Math.round((parseFloat(getComputedStyle(targetRow).transitionDuration) +
                                parseFloat(getComputedStyle(targetRow).transitionDelay)) * 1000)
  // Mid-flight: the column width must be strictly between its start and end, which
  // is what distinguishes interpolation from a snap.
  await sleep(Math.max(20, Math.round(animDurMs / 2)))
  const openCellNow = document.querySelector('.day[data-open]')
  const midW = openCellNow === null ? 0 : openCellNow.getBoundingClientRect().width
  await sleep(animDurMs + 200)

  const openCell = document.querySelector('.day[data-open]')
  const openRow = openCell === null ? null : openCell.closest('.week')
  const openRowH = openRow === null ? 0 : Math.round(openRow.getBoundingClientRect().height)
  const panel = document.querySelector('.dp')
  const endW = openCell === null ? 0 : openCell.getBoundingClientRect().width
  // Strictly between the resting width and the open width is what separates
  // interpolation from a snap — measured, not assumed from the browser version.
  const columnsInterpolated = midW > Math.min(restCellW, endW) + 1 && midW < Math.max(restCellW, endW) - 1
  const barsTrackColumns = openRow !== null && cols(openRow.querySelector('.bars')) === cols(openRow)
  const neighbours = openRow === null ? [] : [...openRow.querySelectorAll('.day')]
    .filter(d => d !== openCell).map(d => Math.round(d.getBoundingClientRect().width))
  const rowsBelow = [...document.querySelectorAll('.week')]
    .filter(r => r !== openRow && rowTop(r) > rowTop(openRow))
    .sort((a, b) => rowTop(a) - rowTop(b))[0] ?? null
  const gapBelow = rowsBelow === null ? 0 : Math.round(rowTop(rowsBelow) - rowTop(openRow))
  const expandedRowFitsViewport = openRow === null ? false
    : openRow.getBoundingClientRect().bottom <= sr.bottom + 1
  // The guard must not leak: a steady-state refill never carries data-jump.
  const jumpDuringSteadyState = (() => {
    for (let i = 0; i < 6; i++) scroller.dispatchEvent(new WheelEvent('wheel', { deltaY: 60, bubbles: true, cancelable: true }))
    return document.querySelectorAll('.week[data-jump]').length
  })()
  await sleep(140 + 760 + 100)
  const stillOpenAfterScroll = document.querySelector('.day[data-open]') !== null
  const jumpAfterSettle = document.querySelectorAll('.week[data-jump]').length
  const animAttrAfterScroll = document.querySelector('.scroller').dataset.anim ?? null

  // ---- the form: every control hit-tested at its centre ----
  document.querySelector('.dp-add').scrollIntoView({ block: 'center' })
  // hits() is the evidence the control is reachable; click() is what opens the form.
  // The panel stops pointerdown from reaching the scroller, so tap() would not fire it.
  const addHit = hits(document.querySelector('.dp-add'))
  document.querySelector('.dp-add').click()
  await sleep(animDurMs + 300)
  const form = document.querySelector('.dp-form')
  const controlSel = ['.dp-title', '.dp-allday', '.dp-start', '.dp-end', '.dp-repeat', '.dp-notes', '.dp-save', '.dp-cancel']
  const controlHits = {}
  for (const sel of controlSel) {
    const c = form === null ? null : form.querySelector(sel)
    controlHits[sel] = c === null ? 'missing' : (c.offsetParent === null ? 'hidden' : hits(c))
  }
  const chipCount = form === null ? 0 : form.querySelectorAll('.dp-chip').length
  const chipHit = form === null ? false : hits(form.querySelector('.dp-chip'))
  const chipsAreLabels = form === null ? false
    : [...form.querySelectorAll('.dp-chip')].every(c => c.textContent !== c.dataset.cat)
  const repeatEnabledOnAdd = form === null ? null : !form.querySelector('.dp-repeat').disabled

  // Validation surfaces in the form.
  form.querySelector('.dp-title').value = ''
  form.querySelector('.dp-save').click()
  await sleep(100)
  const emptyTitleBlocked = !form.querySelector('.dp-err').hidden

  // ---- the transient-UI rule: a full refill must not touch typed text ----
  const typed = 'half-written title'
  form.querySelector('.dp-title').value = typed
  form.querySelector('.dp-notes').value = 'and some notes'
  const formOpenSeen = window.bramwell.day.isFormOpen()
  window.bramwell.ctl.invalidate()                      // harsher than a real cache change
  window.dispatchEvent(new Event('resize'))
  await sleep(200)
  const survivor = document.querySelector('.dp-title')
  const typedTextSurvives = survivor !== null && survivor.value === typed
  const notesSurvive = document.querySelector('.dp-notes')?.value === 'and some notes'

  // ---- Escape collapses ----
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await sleep(animDurMs + 400)
  const collapsedByEscape = document.querySelector('.day[data-open]') === null
  const panelDetached = document.querySelector('.dp') === null
  const rowBackToRest = Math.abs(Math.round(targetRow.getBoundingClientRect().height) - restRowH) <= 1
  const colsBackToRest = cols(targetRow) === restCols
```

And add these keys to the returned object:

```js
    dayHitBeforeOpen, animAttr, animDurMs, restRowH, openRowH, restCellW: Math.round(restCellW),
    expandedGrew: openRowH > restRowH, panelPresent: panel !== null,
    columnsInterpolated, barsMatchAtRest, barsTrackColumns,
    neighbourWidths: [...new Set(neighbours)], gapBelowEqualsOpenRow: gapBelow === openRowH,
    expandedRowFitsViewport, stillOpenAfterScroll, animAttrAfterScroll,
    jumpDuringSteadyState, jumpAfterSettle,
    addHit, chipCount, chipHit, chipsAreLabels, repeatEnabledOnAdd, controlHits,
    emptyTitleBlocked, formOpenSeen, typedTextSurvives, notesSurvive,
    collapsedByEscape, panelDetached, rowBackToRest, colsBackToRest,
```

- [ ] **Step 3: Run the harness**

```bash
cd /Users/admin/_git/want/bramwell
npm run dev >/tmp/bramwell-dev.log 2>&1 &
sleep 4
PORT=5173 npm run shot > /tmp/bramwell-shot.json 2>/tmp/bramwell-shot.err; echo "exit=$?"
tail -5 /tmp/bramwell-shot.err
```
Expected: `exit=0` and a JSON array with one row per viewport × scheme × motion pass, no
`error` key on any row.

- [ ] **Step 4: Read the results and fix what they show**

```bash
cd /Users/admin/_git/want/bramwell
node -e "for (const r of require('/tmp/bramwell-shot.json')) console.log(r.viewport, r.scheme, r.motion, JSON.stringify({expandedGrew:r.expandedGrew, columnsInterpolated:r.columnsInterpolated, barsTrackColumns:r.barsTrackColumns, neighbourWidths:r.neighbourWidths, gapBelowEqualsOpenRow:r.gapBelowEqualsOpenRow, stillOpenAfterScroll:r.stillOpenAfterScroll, jumpDuringSteadyState:r.jumpDuringSteadyState, typedTextSurvives:r.typedTextSurvives, collapsedByEscape:r.collapsedByEscape, animDurMs:r.animDurMs, controlHits:r.controlHits}))"
```

Expected, per row:
- `expandedGrew: true`, `panelPresent: true`, `gapBelowEqualsOpenRow: true`
- `barsMatchAtRest: true`, `barsTrackColumns: true`
- `neighbourWidths` at 390px: `[0]`. At 1440/1920: a single non-zero value.
- `jumpDuringSteadyState: 0` and `jumpAfterSettle: 0` — the guard does not leak
- `stillOpenAfterScroll: true`, `animAttrAfterScroll: null`
- every entry in `controlHits` is `true`; `chipHit: true`, `chipsAreLabels: true`
- `repeatEnabledOnAdd: true`, `emptyTitleBlocked: true`
- `typedTextSurvives: true`, `notesSurvive: true`, `formOpenSeen: true`
- `collapsedByEscape: true`, `panelDetached: true`, `rowBackToRest: true`, `colsBackToRest: true`
- `animDurMs` ≈ 380 on the `no-preference` rows and ≈ 80 on the `reduce` rows
- `columnsInterpolated: true` on `no-preference` rows; `false` is EXPECTED on `reduce` rows,
  where the transition is opacity-only by design.

If any check fails, use superpowers:systematic-debugging — find the cause before changing
code, and if the same class of fix happens twice, add the rule to `CONVENTIONS.md`.

- [ ] **Step 5: Prove the grep is clean**

```bash
cd /Users/admin/_git/want/bramwell
grep -rnE 'transition|animation|@keyframes|cubic-bezier' src/ --include='*.css' | grep -v '^src/motion.css'
grep -rnE 'transition|animation|cubic-bezier|[^a-zA-Z-][0-9]+ms' src/ --include='*.ts' | grep -v 'src/selftest.ts'
```
Expected: the first returns nothing. The second returns only `scroll.ts`'s sanctioned physics
constants and comments naming the rule — no CSS transition or animation value, and no
duration literal at a use site.

- [ ] **Step 6: Commit**

```bash
cd /Users/admin/_git/want/bramwell
kill %1 2>/dev/null
git add scripts/shot.mjs
git commit -m "stage 04: evidence — expand/collapse, hit tests, reduced motion, jump guard"
```

---

### Task 9: `verification.md` and the gate

**Files:**
- Create: `04_day/output/verification.md`
- Modify: `04_day/CONTEXT.md` — the Status line

**Interfaces:**
- Consumes: the harness JSON from Task 8, the selftest output, the grep results.
- Produces: the record the human runs the gate against. It is a record, not an input: after
  the gate closes, its rulings are promoted upstream and the next stage reads references only.

- [ ] **Step 1: Write `04_day/output/verification.md`**

Structure it as: **Gate criteria** (one row per criterion, each with the command that produced
its result and the result), **Rulings the spec left open** (what this stage decided and why),
**What was not tested** (honestly, with the reason).

The gate rows, kept separate — no row absorbs another:

| # | Criterion | Evidence |
|---|---|---|
| 1 | 60fps expand/collapse on the MacBook | **Human, on device.** The harness cannot measure this. |
| 2 | 60fps expand/collapse on a mid phone | **Human, on device.** Separate row from 1 — a laptop pass is not a phone pass. |
| 3 | Reduced-motion path | `motion` = `reduce` harness rows: `animDurMs` ≈ 80 |
| 4 | Every form control passes `elementFromPoint()` | `controlHits`, `chipHit`, `addHit` |
| 5 | Create round trip, real account | **Human, on device.** |
| 6 | Edit-occurrence round trip, real account | **Human, on device.** |
| 7 | Delete-series round trip, real account | **Human, on device.** |
| 8 | Typed text survives a background refresh | `typedTextSurvives`, `notesSurvive` — separate row from 1–2 |
| 9 | `grid-template-columns` interpolates on iOS Safari | **Human, on device.** Chrome half: `columnsInterpolated` |
| 10 | No motion literal outside `motion.css` | Task 8 Step 5 greps |
| 11 | One day open, Escape collapses, scroll does not | `collapsedByEscape`, `stillOpenAfterScroll` |
| 13 | Columns animate back on collapse, not just out | `colsBackToRest`, `rowBackToRest` |
| 12 | The jump guard does not leak | `jumpDuringSteadyState: 0`, `jumpAfterSettle: 0` |

Three things the file MUST state plainly:

1. **The click-during-animation tradeoff is sized, not open-ended.** Hit-testing resolves
   against the final layout while the pixels are in flight; the window is exactly the measured
   `animDurMs` — quote the number the harness reported for both the expand
   (`--t-open`) and the collapse (`--t-fast + --t-base`) paths.
2. **The 60fps claim is the human's, not the harness's.** Say what the harness *did* show
   (per-frame JS cost is zero because `place()` runs once per expand; exactly one row animates
   height) and that this is an argument for 60fps, not a measurement of it.
3. **The iOS Safari column-interpolation gate row**, with the named fallback: if it snaps, the
   `0fr` template applies without a transition and that is a recorded degradation, not a
   surprise.

Also record what was not tested: writes against the real account are the human's gate rows;
a real touch device for the two-tap flow inside the panel; the FAB path into `openAdd`
(stage 05 builds the FAB, so only the entry point exists).

- [ ] **Step 2: Flip the contract's Status line**

In `04_day/CONTEXT.md`, replace `**Status: OPEN.** Gate 3 closed 2026-08-29.` with:

```
**Status: AWAITING GATE.** Verification in `output/verification.md`.
```

- [ ] **Step 3: Final full verification**

```bash
cd /Users/admin/_git/want/bramwell && npm run build && npm run selftest 2>&1 | tail -3 && git status --short
```
Expected: build PASSES, all selftest cases pass, working tree contains only the intended files.

- [ ] **Step 4: Commit**

```bash
cd /Users/admin/_git/want/bramwell
git add 04_day/output/verification.md 04_day/CONTEXT.md
git commit -m "stage 04: verification record, awaiting gate"
```

- [ ] **Step 5: Stop**

Do not open stage 05. The human runs the gate. At gate close, in the same session, every
ruling in `verification.md` is promoted into `DECISIONS.md` (or `SPEC.md` where it changes the
contract) and every closed `OPEN.md` item gets its dated line — after which `verification.md`
is a record, not an input.
