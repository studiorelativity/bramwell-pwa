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
- Colour and motion values are tokens, defined once. No transition or
  animation literal outside `motion.css`.

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
- **Bump nothing by hand for deploys.** The SW strategy (hashed assets
  cache-first, everything else network-first) makes cache-name bumps
  unnecessary; if one becomes necessary again, the strategy is wrong.

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
- Headless Chrome hangs on service-worker registration. SW behaviour is
  verified statically (`dist/sw.js` at root, classic script, no ESM,
  precache list matches emitted paths) and then on a real install.
- `curl` against `vite preview` returns 200 for unknown paths (SPA
  fallback) — it proves nothing about a file's existence.
- Every stage ends with a `verification.md`: gate criteria, results,
  rulings the spec left open, and what was not tested.
