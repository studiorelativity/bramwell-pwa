# Bramwell — Build Spec (consolidated 2026-08-29)

This is the single contract for the rebuild. It is the last-known-good state
of every decision made across the v3 build (stages 01–08) plus the approved
stage 09 direction, with everything rejected or superseded removed. History
lives in `DECISIONS.md`; this file only says what to build.

Three products, three stores, one shell:

| Concern | Store | Spec |
|---|---|---|
| Calendar and appointments | Google Calendar (only) | this file |
| Habit tracker | Supabase | `HABITS.md` |
| Journal | Markdown files in the Obsidian vault | `JOURNAL.md` |

The calendar never stores anything of its own beyond a localStorage cache
and prefs. Nothing about a habit or a journal entry is ever written to
Google Calendar. (v3 stored day notes as Google Calendar events; that is
retired — see `JOURNAL.md`.)

---

## What this is

A single-user PWA (desktop + mobile, one codebase): a perpetual calendar that
scrolls vertically through time. Rows are weeks — seven columns, Monday to
Sunday — stacking downward forever in both directions. There is no year
boundary and no month container: months are labels, not walls.

Backed by the user's real Google Calendar. Full create/edit/delete.
User-defined categories map to Google colorIds.

## The core interaction: the rolling month

Every week row is the same height, always at full detail. There is no zoom
and no lens (built, tried, rejected — do not retry).

- Week rows are uniform, sized so roughly **6.5 weeks fill the viewport**,
  proportional to viewport height within clamps (74–190px).
- Scrolling **snaps to half-month anchors** — the 1st and the 16th. A
  15 / 30 / 45 setting (in Settings, persisted) controls how many anchors
  are skipped: every anchor, every other (the 1st of each month), every
  third. Anchors are real dates, never a rolling day count (a day count
  drifts ~5 days/year against the calendar).
- The anchor comes to rest at the **vertical centre** of the viewport
  (`SNAP_ALIGN = 0.5`). At 30 a stop straddles a month boundary; at 15 a
  stop on the 16th frames a whole month.
- Momentum settles into the detent softly; it does not hard-stop. Haptics
  and sound are off; the detent is visual.
- On first load the view rests on the anchor nearest today, today marked.
  `prefs.lastDockedDay` is written but not read at launch.

## Year view

Toggled from the header. One calendar year at once, no scrolling on desktop.

- A continuous **week-aligned grid, 28 day columns per row** (four weeks),
  first row indented by the weekday of 1 January so every column is the
  same weekday all year. Narrow viewports fall back to 14 or 7 columns.
- Each cell: weekday abbreviation, day number, a month badge on the 1st,
  the month band and weekend shade, and up to **3 thin category-coloured
  bars** for that day's events, longest-first so a multi-day event holds
  one lane across the row. More than 3 are dropped in the grid; the panel
  lists them all.
- **Hover raises a panel** showing previous / hovered / next day with every
  event in full (title, meridiem start time for timed events). Panel is
  `pointer-events: none`, flips above the cell when there is no room
  below, and **survives background repaints** (rebuilt in place, never
  hidden, unless the displayed year changes).
- **Touch**: first tap raises the panel, second tap on the same day opens
  that day in the calendar view, a tap elsewhere dismisses.
- `<` `>` step the year. Clicking a day returns to the calendar view on
  that day. Opening a year calls `ensureMonthsFor` for its months.
- No virtualization: 365 cells rebuild in one pass. `onCacheChange`
  filters by year before repainting.

## Layout details

- 7 equal columns; weekend columns get a subtle shade layered over the
  month band.
- Months alternate a neutral background band **per day column** (keyed on
  `month % 2`, so Dec/Jan differ). A week straddling a boundary shows both.
- Sticky header, left to right: the month(s) or year in view (heavier
  weight; "Aug – Sep 2026" when the view straddles, which at rest it does;
  cross-fades on change), year steppers (year view only), the Cal/Year
  toggle, a Today button, the account avatar.
- **Today button** goes to today without changing the view: calendar
  scrolls and re-snaps; year view pages back to the current year. The
  Cal/Year toggle is the only control that switches views.
- A floating add button, bottom-right, safe-area aware, both views. Opens
  the event form pre-filled with the date nearest viewport centre
  (calendar: mid-week day of the docked week; year: today). `n` on desktop
  does the same, ignored inside inputs or with a day open. It must not
  cover the last row's Sunday events on a notched phone.
- A thin rule + month badge marks each month boundary inline, from the 1st
  to the end of that week row. Badge treatment is identical in both views.
- **All-day and multi-day events render as bars** spanning their days
  within each week row, wrapping across consecutive rows. Longest-first
  lane packing. Title once, on the true start; continuations carry no
  title, keep a flat edge on the broken side, and drop the spine.
- **Timed events render as chips only** (no thin bars), sorted by start,
  with a category dot, muted tabular start time, and title.
- Day numbers **top-right**; inline month badge **top-left**; "+N" overflow
  **bottom-left**; habit/journal markers bottom-right (see their specs).
- Tap/click a day → **inline day expansion** (below). No overlay drawer.

## Visual direction — Night Depth

Approved 2026-08-29 (reference: the "Bramwell Calendar" design canvas,
week-view + motion-primitives artboards; the canvas fixes token values).
Where v3's "warm neutral, hairlines, no elevation" direction conflicts,
this section wins; v3 clauses it does not address still govern (type,
bar treatment, restraint).

- Layered, dark-first. Day cells are rounded (12px) raised tiles on a
  near-black ground, not hairline-ruled grid cells. Month structure reads
  through tile surface value (in-month vs out-month, weekend shade).
- Exactly three elevation levels: resting cell, hovered cell, open day.
  Nothing else casts a shadow.
- Hover: cell lifts `translateY(-2px)`, shadow deepens, a 1px accent ring
  fades in (compositor properties only).
- Today: accent inset ring on the cell plus accent day number. `--today`
  is the one reserved hue outside the categories and is used for nothing
  else. Today is distinguished by **form** so a red category can never
  read as today.
- Light mode gets the same structure with inverted surface logic; dark is
  the design-lead mode. `prefers-color-scheme` is honored.
- Event bars: category colour at ~16% as fill, full colour for text and a
  3px left spine, 5px radius. Dark mode uses brightened category variants
  (light hues fail contrast on tinted dark fills).
- Restraint rule: the user's commitments are the only strong colour on
  screen. Mood tints only move the quiet ground beneath them.

## Inline day expansion

Replaces the overlay drawer. Click a day and it grows in place inside its
week row — row height and the row's `grid-template-columns` animate
together, neighbours compress. The expanded day carries: the event list,
the add/edit form, the habit checklist (`HABITS.md`), and the journal link
(`JOURNAL.md`).

- One day open at a time; opening another collapses the first; Escape
  collapses; scrolling does not force-collapse.
- The virtualizer must support **exactly one variable-height row**: rows
  below the expanded one shift by an animated delta. If this cannot be
  done cleanly, stop and revise — do not fake it with an overlay.
- Phone (≤560px): the day expands to full row width inline (leaning; rule
  at plan time and record it in `DECISIONS.md`).
- Transient-UI rule: a background month refresh must never close the
  expanded day, reset the form, or wipe text being typed. `refresh()` is
  a no-op while the form is open.

## Motion

- Tokens in `:root` beside colour tokens: `--t-fast: 140ms`,
  `--t-base: 240ms`, `--t-open: 380ms`,
  `--ease-out: cubic-bezier(0.22, 1, 0.36, 1)`,
  `--ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1)`. **No transition or
  animation value may appear outside the token layer.**
- Hover enters `--t-fast --ease-out`, leaves `--t-base`. Expand runs
  `--t-open --ease-spring`; content staggers in 40ms apart (fade + 6px
  rise). Collapse runs `--t-base --ease-out`, content fades first, no
  stagger.
- One shared enter/exit utility solves display:none-vs-animation once
  (`@starting-style` + `transition-behavior: allow-discrete` on enter,
  `transitionend` on exit). Components never write their own transitions.
- `prefers-reduced-motion`: everything collapses to 80ms opacity-only.
- Performance: hover animates compositor properties only. The expand
  row-height animation is the one permitted layout animation, contained
  to the scroller. 60fps on a mid phone is a gate criterion.

## Event form

Ported behaviour (content contract unchanged from the drawer):

- Fields: title (required), category chips (the user's list, labels not
  names), all-day toggle, start/end (all-day end is **inclusive** in the
  form), repeat (RRULE; **disabled when editing**), notes → `description`.
- Recurring events show a scope picker (this occurrence / whole series),
  default "this occurrence". Series delete confirms first.
- Validation and write errors surface in the form and as a toast.

## First-run and connection state

- Cold start, no auth, no cached months: first-run screen — app mark,
  name, one-line description, three plain lines of what to expect,
  Connect Google Calendar (wraps `auth.signIn`), "Try the demo", a note
  that events live only in Google Calendar, and a low-emphasis support
  mailto. `place-items: safe center` + `overflow-y: auto` so Connect is
  reachable on the shortest phone.
- Cached months but stale auth: calendar renders read-only from cache
  with a reconnect pill in the header (after a 2.5s grace so quiet renewal
  does not cry wolf). The first-run screen never covers a warm cache.
- Signed in: a generic avatar with a connection dot bound to auth state
  (no profile scope — `calendar.events` carries no name). Avatar opens
  Settings.

## Settings

A sheet from the avatar: account row ("Google Calendar · Connected") with
sign-out; snap 15/30/45; default view (Cal/Year); a **Colors** section
(below); Mood; sound row is a labelled stub. All prefs; no new storage. A
background refresh must not close or reset the sheet.

## Categories and customization

Categories are the user's own list, prefs-backed:

```
StoredCategory         = { name, label, colorId, displayHex? }
prefs.categories       — StoredCategory[]   (absent -> seed)
prefs.fallbackCategory — name               (absent -> "other")
prefs.mood             — mood id            (absent -> "warm")
```

- `name` is the stable key (`CalendarEvent.category`, `data-cat`). Never
  changes; **renaming edits `label` only.** New names are a slug of the
  label, uniquified against the current set.
- **Seed** (frozen — existing events carry these colorIds):

  | name | label | colorId | displayHex | dark twin |
  |---|---|---|---|---|
  | work | Work | 9 | #3056D3 | #7B96FF |
  | personal | Personal | 10 | #17925A | #4FC48D |
  | financial | Financial | 5 | #D97706 | #F0A13C |
  | other | Other | 8 | #64748B | #94A3B8 |

  Display hexes are explicit overrides — Google's own hexes for 9/10/5/8
  are different colours. Dark twins are hand-picked for the seed; every
  other colour is derived (`brighten()`: HSL, lightness floor 0.62,
  saturation cap 0.72).
- Add, rename, remove. **Ceiling 11** (Google has 11 event colorIds; the
  colorId is the only channel by which a read resolves to a category).
- **INVARIANT: no two categories share a colorId.** Enforced in the UI
  (taken colorIds disabled in other rows) and in the loader (`sanitize()`
  treats the stored blob as untrusted: drops missing name/label, unknown
  colorId, duplicate name or colorId; caps at 11; first writer wins).
- One category is always the **fallback**: unknown/absent colorId resolves
  to it; it cannot be deleted. Role lives in `prefs.fallbackCategory`.
- **Deleting a category never touches Google.** Its events keep their
  colorId and resolve to the fallback on the next read/render.
- **Two colour layers.** Layer 1: the Google colorId (dropdown of the 11
  with Google's names — Lavender, Sage, Grape, Flamingo, Banana,
  Tangerine, Peacock, Graphite, Blueberry, Basil, Tomato). **Changing it
  affects new writes only; never mass-PATCH history.** Layer 2: optional
  display hex overriding on-screen rendering everywhere. When they
  disagree the settings row shows both swatches — divergence is a
  feature, never a surprise.
- **Mood**: fixed list — Warm (default), Paper, Cool, Sage, Dusk. Each
  sets `--surface` and the four band tokens only, light and dark, on the
  default's luminance ladder (band contrast is a property of the set).
  Never `--ink*`, `--rule*`, `--today`, or category colours.
- Settings UI: one row per category (label editable in place, colorId
  dropdown, display swatch with clear, delete on every row but the
  fallback's — two-step "Remove?" button, not `confirm()`), add row
  disabled at 11 with the reason, Mood selector. Label edits do not
  rebuild the row; structural edits do.
- `categories.ts` stays DOM-free and never imports `state.ts`; `main.ts`
  pushes prefs in via `configure(...)`. Runtime colours are emitted by
  `main.ts` into one `<style>` element from `categories.themeCss()`
  (`[data-cat]` rules plus `--cat-<name>` properties plus mood tokens).
  `:root` values in `index.html` are seed paint only. `render.ts` sets
  `data-cat` and nothing else per frame.

## Demo mode

Entry: "Try the demo" on first-run, or `?demo`.

- Seeds ~17 months of deterministic events (mulberry32, fixed seed,
  anchored to today) into the in-memory cache only. Seed exercises every
  render path: a 21-day span across three rows, weekly recurring timed
  chips with `recurringEventId`, monthly/quarterly financial all-days,
  weekend spans, one day that overflows the year cell's 3 bars, all seed
  categories.
- localStorage is never written in demo. `ensureMonthsFor` and every
  network path are inert; unseeded months stay empty. Zero requests to
  googleapis.com.
- Writes reject with `DemoError` ("Demo — connect your Google Calendar to
  save.") **before** the optimistic apply. Customization works in memory
  and persists nothing; leaving demo re-runs `configure()` from prefs.
- Header shows a "Demo · Connect" pill in the avatar's slot; clicking it
  (or Connect anywhere) exits demo and starts sign-in. Demo never survives
  a reload.

## Perpetual scroll mechanics

- Virtualized: only the rows the viewport needs plus a buffer (14 rows at
  every viewport), nodes recycled, transform-positioned
  (`placeRow(node, y, height)`, two style writes per row per frame).
  Week index is the layout coordinate (week 0 = the week containing today,
  captured at anchor time, not read live).
- Load events lazily by month as weeks come within ~8 weeks of the
  viewport, both directions. Cache per `year-month` in localStorage;
  render from cache instantly, background-refresh visible months.
- 60fps on a mid-range phone: no layout thrash in the scroll handler.
- Touch: `touch-action: manipulation` on `html, body`, `touch-action: none`
  on rows, `preventDefault` on `dblclick` and Safari's
  `gesturestart/change/end`. (`user-scalable=no` alone does nothing on
  iOS; the meta stays for installed-PWA and Android.)
- Tuned constants live at the top of `scroll.ts`: `VISIBLE_WEEKS 6.5`,
  `MIN/MAX_ROW_H 74/190`, `SNAP_ALIGN 0.5`, `PROJECT_MS 300`,
  `SETTLE_BASE/PER_WEEK/MAX_MS 280/42/760`, `WHEEL_GAIN 0.6`,
  `WHEEL_IDLE_MS 140`, `HAPTIC_ON_SNAP false`. Easing `easeOutCubic`,
  velocity smoothed 0.7/0.3, drag 1:1 with row height.

## PWA

- `manifest.webmanifest`: name, icons (B mark, graphite theme), display
  `standalone`, `start_url: "/"`, `scope: "/"`. Both
  `mobile-web-app-capable` and the Apple meta.
- Service worker (`sw.ts`, emitted at the site root as a classic script,
  registered in production only):

  | Path | Strategy |
  |---|---|
  | `/assets/*` (hashed) | cache-first |
  | everything else | network-first, cache as offline fallback |

  Offline navigation falls back to `/` (not `/index.html`, which the host
  307s). Never cache a response with `response.redirected`. Never cache
  Calendar API responses in the SW. Precache only paths the build really
  emits. `public/_headers` must keep `/sw.js` uncacheable.
- Offline: opens read-only from cache (from the second launch onward —
  hashed assets are runtime-cached on first online load); writes fail
  visibly and roll back; background refresh on reconnect.

## Stack

- Vite + vanilla TypeScript, strict. No framework, no runtime dependency
  except the Supabase client (`HABITS.md`).
- localStorage for the event cache (`bramwell.cache.v1`, versioned,
  discarded on mismatch, quota failures swallowed) and prefs
  (`bramwell.prefs.v1`).

## File layout

```
/index.html               — seed tokens, GIS <script>, viewport meta
/public/manifest.webmanifest — served at /manifest.webmanifest; Vite copies public/ to dist/ root
/public/                  — icons, _headers
/src/main.ts              — bootstrapping and wiring; owns the theme <style>
/src/auth.ts              — GIS token client; the ONLY file that knows about Google auth
/src/gcal.ts              — Calendar API; the ONLY file calling googleapis.com
/src/habits.ts            — Supabase client; the ONLY file calling Supabase (HABITS.md)
/src/journal.ts           — journal link/index resolution, no network of its own (JOURNAL.md)
/src/dates.ts             — anchorless civil-date core: brands, civilToDay/dayToCivil, monthKey; imports no runtime code
/src/selftest.ts          — pure selfTest() over dates.ts and state.ts; loaded only by main.ts under ?selftest
/src/state.ts             — event cache, today() anchor, DayNumber<->WeekIndex math, persistence, write orchestration, demo
/src/scroll.ts            — virtualizer, snap physics, the one variable-height row
/src/render.ts            — week rows, bars, chips, lane packing, month badges, header
/src/year.ts              — year view
/src/day.ts               — inline day expansion content: event list, form, habits, journal
/src/categories.ts        — category resolution, Google colour table, moods, themeCss()
/src/chrome.ts            — first-run, settings sheet, FAB, toasts
/src/sw.ts                — service worker
/src/types.ts
/src/style.css            — token consumption only
/src/motion.css           — motion tokens, elevation scale, enter/exit utility, reduced-motion
/.env.local               — VITE_GOOGLE_CLIENT_ID, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY (gitignored)
```

Module boundaries are hard. Leaf modules (`categories`, `gcal`, `habits`)
stay DOM-free and never import `state.ts`; `main.ts` pushes data in.
Anything may import `dates.ts`; it has no anchor and no state.
A file the layout lacks is added **here first**, then created.

## Auth (`src/auth.ts`)

Google Identity Services token model (`initTokenClient`). Script tag in
`index.html`; `auth.ts` polls for `window.google`.

- Scope: `https://www.googleapis.com/auth/calendar.events` only.
- Token in memory only. `getToken(forceRefresh = false)`: cached if valid,
  else `requestAccessToken({prompt: ''})` for quiet renewal. A failed quiet
  renewal leaves `isSignedIn()` false and surfaces the reconnect pill; the
  user's click is the gesture (browsers block the popup otherwise). Any
  401 → `getToken(true)` once, then clear and surface. Never a dead state.
- `signOut()` revokes via `google.accounts.oauth2.revoke` (a local-only
  clear would quiet-renew straight back in).
- Exports exactly `getToken`, `signIn`, `signOut`, `isSignedIn`.

## Calendar API (`src/gcal.ts`)

Base `https://www.googleapis.com/calendar/v3`, bearer token, calendar
`primary`.

- **List month:** `GET /calendars/primary/events`, `timeMin`/`timeMax`
  RFC3339 with local offset, `singleEvents=true`, `orderBy=startTime`,
  `maxResults=250`, follow `nextPageToken` to exhaustion. Cancelled
  events dropped. Events carrying `extendedProperties.private.bramwell =
  "daynote"` (v3 legacy notes) are read as ordinary all-day events —
  no special handling in the rebuild.
- **Create:** `POST`. Timed: `start/end.dateTime` + timezone; a timed
  event carries start and end DayNumbers (may cross midnight; renders on
  its start day). All-day: `start/end.date`, API end **exclusive**,
  internal end **inclusive**; convert at this boundary only. `colorId`
  from the category, `description` from notes, `recurrence` from repeat
  (`RepeatRule` = `none | daily | weekly | monthly | yearly`, mapped to
  one RRULE).
- **Update:** `PATCH`, changed fields only. Instance id = this occurrence;
  `recurringEventId` = whole series.
- **Delete:** same instance/series choice (`WriteScope` = `instance |
  series`).
- 403 rate-limit / 5xx: one retry with backoff, then surface.
- `MAX_RESULTS` is a module constant; lower it to force pagination during
  a gate, restore to 250.

## Write orchestration (`src/state.ts`)

UI → `state.ts` → `gcal.ts`; the day module never imports `gcal.ts`.
`createEvent` / `updateEvent` / `deleteEvent`: apply locally as pending →
API call → reconcile from the server's answer (refetch the touched months;
a series write marks every resident month stale) → or roll back, toast,
rethrow. The offline check sits inside the try block after the optimistic
apply so the rollback path really runs. `onCacheChange(fn)` notifies
listeners with changed month keys. Optimistic creates are built field by
field, not by spreading the draft.

## Dates

`DayNumber` (absolute civil-date integer, `Date.UTC` on y/m/d, DST-immune)
is what events and prefs store. `WeekIndex`/`DayOffset` (0 = Mon … 6 =
Sun) are layout coordinates relative to today, never persisted, converted
in `state.ts` only. All three are branded numbers; the constructors live
in `dates.ts` with the anchorless civil math, so leaves can brand a wire
date without touching `state.ts`. `gcal.ts` and `habits.ts` own wire ↔
DayNumber; `Date` objects appear only at API and display boundaries.

`CalendarEvent` is a discriminated union on `allDay`; timed events carry
`startMin`/`endMin` (minutes from local midnight). `category` is derived
from `colorId` at read time and never serialized. `EventSpan` (one per
week row an event touches) is built in `state.ts`; `render.ts` adds the
lane. `StoredEvent` is the persisted form of `CalendarEvent` with `category` stripped.

## Definition of done

Calendar (carried forward, all still binding):

- Sign in → a full month visible at once, today marked, month(s) named in
  the header, month structure legible from tile values alone.
- Flick three months: 60fps, settles softly onto a centred anchor at the
  chosen 15/30/45; header updates.
- Double-tapping a day on a phone never zooms the page.
- Year view: all 365 days on a desktop window, week-aligned, badges, today;
  hover (tap on phone) shows three days with events in full; clicking a
  day returns to it.
- Scroll a year into the past: months load as approached, no jank, `.week`
  node count stays at 14.
- A 3-week all-day commitment renders as a wrapping bar across three rows
  and arrives in the Google Calendar app with the right colour and the
  right end date.
- Edit one occurrence of a weekly event; delete the series with
  confirmation.
- Install as PWA; kill the network; opens read-only from cache; a write
  fails visibly and rolls back; a deploy reaches an installed client on
  the next online open without a manual cache bump.
- A full month fits a notched phone and a 27" monitor; day numbers never
  clipped.
- Cold start signed out → first-run screen; Connect lands on today. Stale
  token over a warm cache → read-only calendar with a reconnect pill.
- FAB and `n` open the form on the centred date from anywhere in time.
- Settings (snap, default view, colours, mood) persist; sign-out returns
  to first-run.
- `?demo`: populated, zero googleapis.com requests, saves reject with the
  demo message, Connect exits into real sign-in, nothing persisted.
- Category rules: fresh install renders the four seed categories in the
  seed colours; two categories can never share a colorId; add is dead at
  11; delete leaves Google untouched and renders the fallback; rename
  keeps the key; display hex overrides on screen while Google shows the
  colorId's colour.
- Every mood keeps month structure readable on a phone at arm's length,
  light and dark.

Redesign:

- No transition/animation value outside the token layer.
- No overlay drawer; every former drawer capability reachable inline.
- 60fps expand/collapse on the MacBook and a mid phone; reduced-motion
  path verified.
- Every "this control works" claim is backed by `elementFromPoint()` at
  the control's centre resolving to the control (see `CONVENTIONS.md`).

Habits and journal: see `HABITS.md` and `JOURNAL.md`.

---

## MANUAL SETUP (human-only)

Google Cloud Console — the v3 client carries over:

1. Project → enable **Google Calendar API**.
2. OAuth consent screen → External → scope `.../auth/calendar.events` →
   add yourself as test user → leave in **Testing** (up to 100 named
   users, no review; consent expires periodically — re-clicking sign-in
   fixes it, not a bug).
3. Credentials → OAuth client ID → Web application → authorized
   JavaScript origins `http://localhost:5173` and the deployed origin.
   No redirect URIs. Exact-match: `no.fail` and `www.no.fail` do not cover
   `cal.no.fail`.
4. `.env.local`: `VITE_GOOGLE_CLIENT_ID=`.

Supabase: see `HABITS.md`.

## DEPLOY (Cloudflare → https://cal.no.fail)

- The origin must be a **domain root**: `sw.ts` precaches `/`, the
  manifest declares `start_url`/`scope` `/`, icons link at `/`. HTTPS is
  required (GIS refuses insecure origins; SWs will not register).
- `cal.no.fail` is a dedicated subdomain in the `no.fail` zone; the apex
  is an unrelated Astro site. A subpath under the apex is not an option.
- Build `npm run build`, output `dist`, Node pinned by `.node-version`,
  env vars `VITE_GOOGLE_CLIENT_ID`, `VITE_SUPABASE_URL`,
  `VITE_SUPABASE_ANON_KEY` set in the dashboard (Vite inlines them;
  `.env.local` is gitignored). Client IDs and the anon key are public by
  design; the origin allowlist and RLS are the security boundaries.
- Preview deployments cannot sign in (Google rejects wildcard origins).
  Anything touching auth or the API is tested on `cal.no.fail`.
- Deploying is a prerequisite for PWA/offline gate items, not a step after
  them: a phone reaching `http://<lan-ip>:4173` is not a secure context.
