# Stage 01 — verification

## Gate criteria
| Criterion | Result | Evidence |
|---|---|---|
| `npm run dev` serves without errors | PASS | `VITE v6.4.3  ready in 104 ms`, `➜  Local:   http://localhost:5173/` — no error output on start or on subsequent `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5173/` → `200` |
| `tsc --noEmit` clean | PASS | `npx tsc --noEmit && echo TSC_CLEAN` → `TSC_CLEAN` (no diagnostics printed) |
| `npm run build` clean | PASS | ```\nvite v6.4.3 building for production...\ntransforming...\n✓ 10 modules transformed.\nrendering chunks...\ncomputing gzip size...\ndist/index.html                   1.34 kB │ gzip: 0.67 kB\ndist/assets/index-tn0RQdqM.css    0.00 kB │ gzip: 0.02 kB\ndist/assets/index-B5sA6vUk.js     2.36 kB │ gzip: 1.22 kB\ndist/assets/selftest-BeEyxkOt.js  3.33 kB │ gzip: 1.49 kB\n✓ built in 71ms\n``` `dist/` listing: `_headers`, `assets/` (`index-B5sA6vUk.js`, `index-tn0RQdqM.css`, `selftest-BeEyxkOt.js`), `icon-192.png`, `icon-512.png`, `index.html`, `manifest.webmanifest` — confirms `manifest.webmanifest` reaches `dist/` from `public/` (see ruling 8) |
| `/?selftest` 9/9 in the browser | PASS | `npm run selftest` (Node, via `--experimental-strip-types`): ```\nPASS  civil round-trip incl. leap day\nPASS  epoch anchoring\nPASS  801-day weekday oracle\nPASS  month keys across a boundary\nPASS  Monday start\nPASS  year boundary in one row\nPASS  DST-safe stepping across two local years\nPASS  weekOf/dayAt round-trip\nPASS  week 0 contains today\n9/9\n``` Headless Chrome (`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --headless=new --disable-gpu --dump-dom --virtual-time-budget=3000 "http://localhost:5173/?selftest"`), `grep -o 'data-selftest="[a-z]*"'` → `data-selftest="pass"` (single root attribute, one match); the dumped `<pre data-selftest="pass">` block contains all nine `PASS` lines and the trailing `9/9`, identical to the Node run. |
| `types.ts` reviewed against SPEC API + HABITS schema | HUMAN | |

### Browser-render checks (light/dark, both headless)
- Light: `--blink-settings=preferredColorScheme=1` against `http://localhost:5173/`, `grep -c 'Bramwell — stage 01'` → `1` (rendered body: `<div id="app">Bramwell — stage 01</div>`)
- Dark: `--blink-settings=preferredColorScheme=2` against `http://localhost:5173/`, `grep -c 'Bramwell — stage 01'` → `1` (same rendered body; the seed `--surface`/`--ink` tokens differ under `@media (prefers-color-scheme: dark)` in `index.html` but the app div content is scheme-independent at this stage)
- `npm run dev` was started backgrounded, both Chrome invocations and the selftest check ran against it, then the server was killed (`lsof -ti:5173 | xargs kill`); confirmed down via a follow-up `curl` returning no response (`000`).

## Rulings the spec left open (made here, recorded in DECISIONS.md)
1. `selftest.ts` added to the file layout; dynamically imported so it is not in the main chunk.
2. `_setAnchorForTest` is a test-only export of `state.ts`; the spec's "exports exactly" rule applies to `auth.ts` only.
3. `sw.ts` is an empty module, not a throwing stub (an installed throwing SW wedges every load).
4. Seed `--surface`/`--ink` in `index.html` are placeholders; stage 03 replaces them from "Visual direction".
5. `public/_headers` is a two-line placeholder; stage 05 owns it.
6. Stub signatures for scroll/render/year/day/chrome are minimal (`mount`, `renderWeek`, `expand`, `toast`); the owning stage adds the interface to SPEC.md before widening.
7. `CalendarEvent` all-day arm carries `startMin?: never; endMin?: never` so a spread of a flat `EventDraft` cannot smuggle a time into an all-day event (excess-property checks only catch literals).
8. `manifest.webmanifest` lives in `public/` (served at `/manifest.webmanifest`); a root file never reaches `dist/` under Vite. SPEC "File layout" already updated.
9. The selftest does not pin `TZ`: pinning to UTC would neuter the DST case. The local-time-constructor guard therefore only bites in a DST zone — listed under "Not tested".
10. Selftest case 3's 801-day span crosses one leap day (2024-02-29) and three year boundaries, not the two leap days the plan first claimed.

## Not tested
- Nothing touches the network; auth, gcal, habits are throwing stubs.
- SW registration (none yet).
- The selftest ran in this machine's time zone only; the DST case is meaningful only where the local zone observes DST.
- Icons are solid squares; maskable safe-zone not checked.
- The `week 0 contains today` case compares against a fresh `new Date()`, so re-running `/?selftest` in a tab left open across midnight reports a spurious FAIL (by design of the anchor).
- Interactive browser view of `/?selftest`: not opened by hand here; the human's gate run is that check.
