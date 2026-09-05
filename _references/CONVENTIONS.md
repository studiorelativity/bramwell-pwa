# Conventions

Carried over from v3 (`_references/conventions.md`) with the stage-08
regression rules. Grows from friction: when the same kind of fix happens
twice, the rule goes here.

## TypeScript
- Strict mode. No `any` without a `// why:` comment.
- Modules export their spec-defined public interface and nothing else.
- Dates: storage uses `DayNumber`. `WeekIndex`/`DayOffset` are layout-time
  derivations relative to today; never persisted. Conversion in `state.ts`
  only. `Date` objects only at API and display boundaries.

## Style
- Follow `SPEC.md` "Visual direction — Night Depth". When in doubt: less
  chrome. The user's commitments are the only strong colour on screen.
- Colour and motion values are tokens, defined once. CSS `transition`,
  `animation`, and `@keyframes` declarations live only in `motion.css` — not
  merely their numeric values — because that is what makes the rule provable
  by a single grep; a component never carries its own transition, even one
  built from tokens. (Settled at stage 04, when stage 03's token-based hover
  transitions were moved out of `style.css`.) One carve-out: the scroll
  engine's physics constants (`PROJECT_MS`, `SETTLE_*`, `WHEEL_GAIN`,
  `WHEEL_IDLE_MS`, `easeOutCubic`) drive per-frame arithmetic rather than CSS
  and live at the top of `scroll.ts`, as SPEC "Perpetual scroll mechanics"
  requires.

## Module boundaries
- `auth.ts` is the only file that knows about Google auth. `gcal.ts` is
  the only file calling Google; `habits.ts` the only file calling Supabase.
- Leaf modules (`categories`, `gcal`, `habits`, `journal`) are DOM-free and
  never import `state.ts`. If a leaf needs state data, give it a
  `configure(...)` entry point and let `main.ts` push the data in. Leaves
  return strings (`themeCss()`); `main.ts` owns the `<style>` element.
- The file layout in `SPEC.md` is the layout. A file it lacks is added
  **there first**, then created. Do not quietly add one and do not contort
  code to avoid one.
- Any module reachable from `src/selftest.ts` (today: `dates.ts`, `state.ts`,
  and whatever they import) touches browser globals (`window`, `document`,
  `localStorage`) inside functions only, never at module scope — `npm run
  selftest` runs that graph under node.

## Recurring-edit rules
- **Grep the whole `src/` tree for a bare class token before adding a CSS
  class** — not just for a rule with that name. A class with no rule of its
  own is invisible to `grep '\.name' style.css` and is exactly the case
  where a new rule lands on it silently. `cat*` means *category* here and is
  heavily used; prefix new families distinctly. (Stage 08: `.catpick` made
  the event form unclickable.)
- **UI verification must hit-test, not just dispatch.** `element.click()`
  bypasses hit testing and reports success on a control no user can reach.
  Any claim that a control works is backed by
  `document.elementFromPoint()` at its centre resolving to the control.
- **A background refresh must never destroy transient UI** — an open form,
  a hover panel, a settings sheet, text being typed. Invisible to a DOM
  snapshot; only shows up if you look at a later moment. `refresh()` is a
  no-op while a form is open.
- **Any selector that sets `display` re-asserts `[hidden]`.**
- **A state that adds a new rendering to an element must stand the old one
  down — including the layers that are siblings, not children.** Twice now the
  expanded day has shipped with the collapsed rendering still painting under or
  over it: the hover `::after` (stage 04, caught at the gate) and then `.chips`,
  `.more`, `.bars` and `.rule` (stage 05, caught by the human on the deployed
  app — every event rendered twice). The trap is that the leftovers are
  absolutely positioned or in a sibling overlay, so they do not move when the
  cell grows: `.chips` pins to the cell's bottom, `.bars` is a later sibling
  inside `.week` and paints over everything at `z-index: auto`. Enumerate what
  the base state draws, and suppress each piece explicitly.
- **A rectangle-intersection test cannot see paint order.** Two elements that
  legitimately overlap in geometry still overlap after a stacking fix, so a rect
  test reports a clean pass on the broken build. Use `elementsFromPoint`, which
  returns the true stack topmost-first, and re-take the reading with the fix
  toggled off in the same probe — a probe that cannot fail proves nothing.
  (`pointer-events: none` hides a layer from hit testing but not from painting;
  setting it hit-testable inside the probe changes neither stacking nor paint.)
- **Bump nothing by hand for deploys.** The SW strategy (hashed assets
  cache-first, everything else network-first) makes cache-name bumps
  unnecessary; if one becomes necessary again, the strategy is wrong.
- **A stale async write completion must never act on whatever module-level
  state currently points to.** Reading state like `form`/`editing` after an
  `await` with no request identity lets a user close a busy write, start a
  second one, and have the first's completion tear down or corrupt the
  second. Guard with a per-request generation number: a stale success is
  ignored, but a stale *failure* must still surface — the user has to learn
  the write failed even though the UI has moved on. (Stage 04: `day.ts`'s
  `save()`/`remove()`.)
- **A field driven by a "changed" sentinel (e.g. `!== undefined`) must
  always be set explicitly, never omitted for being empty or falsy.**
  Omitting an empty value to avoid "sending nothing" instead sends nothing
  to *clear* it, and the sentinel never notices the field changed. (Stage
  04: a cleared note never reached Google because `readDraft` only set
  `notes` when it was non-empty.)
- **Guard a measurement function against a hidden or zero-sized read at its
  own source, not at every call site.** A resize dispatched while a
  container is hidden otherwise pins derived state permanently, with
  nothing to re-derive it later. If a caller must force a re-measurement by
  synthesizing a browser event, fire it only after the state that makes the
  read valid is restored — firing it one step too early reproduces the same
  bug on the way back. (Stage 04: `measure()` bailing on a heightless root,
  and a first attempt at the synthetic resize that regressed stage 03's own
  gate by firing while `yearRoot` was still hidden.)

## Verification
- Headless Chrome (`--headless=new --dump-dom --virtual-time-budget`)
  against `npm run dev`, driving the real UI in a same-origin iframe, in
  both colour schemes. Chrome may not exit under a virtual-time budget; the
  DOM is written, kill the process.
- **Drive the colour scheme with CDP `Emulation.setEmulatedMedia`.** That is
  the primary method for both schemes. `--blink-settings=preferredColorScheme=2`
  is **no longer sanctioned**: it crashes Chrome 151's renderer reproducibly
  (`VALIDATION_ERROR_UNKNOWN_ENUM_VALUE`, mojo `bad_message` reason 123), and
  the process then hangs past the virtual-time budget. `=1` still works, so a
  light-mode run either way is a useful control that the two mechanisms agree.
  (Stage 02: reproduced independently by two agents on Chrome 151.0.7922.175.)
- **Headless Chrome registers service workers fine — corrected 2026-08-31.**
  The stage-02 note said it hangs, and that shaped every SW claim since into
  "verified statically only". Re-tested against the deployed HTTPS origin with
  `--headless=new`: `navigator.serviceWorker.ready` resolved in **3.3s**,
  `state: "activated"`, one registration, cache `bramwell` holding all 8
  precached paths. Whatever the stage-02 failure was — an older headless mode,
  or the insecure-origin `vite preview` it was run against — it does not
  reproduce. SW behaviour is now testable in the harness: registration,
  precache contents, and whether a new deploy reaches an installed client.
  Static checks (`dist/sw.js` at root, classic script, no ESM, precache list
  matches emitted paths) remain useful and cheap, but they are no longer the
  ceiling. A real device install still answers what a headless profile cannot:
  the installed-PWA launch path, and iOS Safari specifically.
- `curl` against `vite preview` returns 200 for unknown paths (SPA
  fallback) — it proves nothing about a file's existence.
- Every stage ends with a `verification.md`: gate criteria, results,
  rulings the spec left open, and what was not tested.
- **A fix verified only by the method that found the bug is not verified.**
  A defect caught by static trace or reasoning needs a new observational
  probe before it counts as checked; re-running the same reasoning that
  found it just confirms the reasoning again. (Stage 04: a same-week day
  switch that snapped its column template, found by static trace, is why a
  same-week-switch probe was added to the harness rather than trusting the
  trace a second time.)
- **A probe that compares two measurements compares raw floats with an
  epsilon, and never rounds the two sides in opposite directions.** Rounding
  one side up and the other down manufactures a shortfall of up to one unit
  out of two readings that are actually equal. (2026-08-31, the year-view
  spine: `Math.ceil(textHeight) > Math.floor(boxHeight)` reported six of
  twelve month names clipped, every one of them by exactly 1px — the giveaway
  — and a tracking change was written to fix a layout that was never broken.
  Comparing the raw values showed 0 of 12 clipped at every width.)
- **A negative result from a new or modified instrument is not evidence until
  that instrument has passed a known-good case.** Build the failing case and
  the passing case together: an instrument that has only ever reported failure
  has not been shown capable of reporting anything else. This is the general
  form of the rule already stated for sampling points, and it is now the
  second time an instrument's own artifact has been mistaken for a product
  defect:
  - **2026-08-30, stage 04** — the `columnsInterpolated` probe sampled at 50%
    of a transition whose `--ease-spring` overshoots past 1.0 from ~35% to
    ~85%, so a *correct* implementation read as `false`. Five fix rounds
    chased a boolean pinned false by its own instrument. Full account in
    `DECISIONS.md` "A retracted conclusion, and why it matters beyond this
    bug".
  - **2026-08-31, year-view spine** — `scrollHeight` cannot see overflow on
    centred content, so a clipping probe reported zero clipped while a month
    name was visibly cut in a screenshot; the replacement then failed the
    other way through the rounding above.

  Both were caught by something outside the instrument — a screenshot, and a
  suspiciously uniform 1px — not by the instrument itself. Neither is a
  reason to trust screenshots over probes; it is a reason to make every probe
  demonstrate that it can return both answers before its answer is quoted.
- **A "storage untouched" claim carries a cold-visit control beside it.** The
  app writes `lastDockedDay` on its own at boot; without a control run that
  key reads as a leak (it did, for one demo run, 2026-09-05).
- **Coarse-pointer emulation is touch emulation, not a media feature.**
  `(hover: none)` / `(pointer: coarse)` are not honoured by
  `Emulation.setEmulatedMedia`; `Emulation.setTouchEmulationEnabled` is what
  flips them. A first attempt failed silently with hover still `hover`.
- **Derive the port after EVERY dev-server restart, and prove the served
  tree.** A vite that dies leaves its port to whichever vite starts next;
  twice on 2026-09-05 a probe ran against another worktree's tree (5173
  answered from B's, 5174 from A's) and read a stale build as a regression.
  Before trusting a run, check the served `main.ts` carries a marker of the
  tree under test.
- **WebDriver's iOS touch actions do not deliver a finger-up until the next
  touch, and the automation window blocks real fingers.** Real-device touch
  evidence comes from an instrumented build on a Pages preview branch and
  the human's finger (the `evlog` method, 2026-09-05), not from safaridriver.
