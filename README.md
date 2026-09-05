# Bramwell

A perpetual calendar over your Google Calendar, built to be read the way a
wall-sized year planner is read: one surface, every day visible, marked by
hand. Weeks stack vertically forever with no month walls and no paging; the
year view lays all 365 days out in one grid so what is planned and what is
still open are seen in one glance. Events live only in Google Calendar —
Bramwell keeps no store of its own — so anything you write here is already
in your calendar everywhere else. It installs as a PWA, works offline from
its cache, and runs on a phone or a desktop.

Live at <https://bramwell.no.fail>. Try it without signing in at
<https://bramwell.no.fail/?demo>.

## Demo

`/?demo`, or "Try the demo" on the first-run screen, seeds seventeen months of
deterministic events into memory and shows the whole calendar without a Google
account. Nothing is written to your browser and nothing is sent to Google;
every save is refused with "Demo — connect your Google Calendar to save."
The **Demo · Connect** pill in the header leaves the demo and starts a real
sign-in. Reloading leaves the demo too.

## Beta testers — read this first

- **Start with the demo** (`/?demo`) — it needs no account and shows everything.
- **Sign-in is gated by Google.** The OAuth consent screen is in *Testing*, so
  your Gmail address must be added as a test user before Connect will work
  (Google allows 100). Send the address you'll use.
- **You will see Google's "unverified app" screen.** That is expected while the
  app is in Testing: click *Continue* (it may be behind *Advanced*).
- **Consent expires periodically.** If the calendar goes read-only and a
  *Reconnect* pill appears, click it — one click, not a bug.
- The only scope requested is `calendar.events`: Bramwell can read and write
  events in your primary calendar and nothing else. No profile, no contacts.

## Run it

```
npm install
echo 'VITE_GOOGLE_CLIENT_ID=<your client id>' > .env.local
npm run dev                        # note the port Vite prints; several may be in use
```

- `npm run selftest` — the in-repo suite under bare Node (dates, categories,
  the Google wire mapping, auth, the cache and writes, demo).
- `npm run build` — typecheck, bundle, and emit the service worker at
  `dist/sw.js`.
- `npm run preview` — serve the production build (port 4173 must be a
  registered OAuth origin, see below).
- `PORT=<port> npm run shot` / `PORT=<port> npm run shot:demo` — headless
  Chrome evidence harnesses (need Google Chrome installed).

Node version is pinned in `.node-version`. There are no runtime dependencies.
The demo needs no client ID at all.

## Deploy your own

Bramwell is a static site plus one OAuth client. You need a Google Cloud
project and somewhere to host `dist/`; Cloudflare Pages is what
bramwell.no.fail uses.

### 1. Google Cloud Console

1. Create a project and enable the **Google Calendar API**.
2. **OAuth consent screen** → External → add the scope
   `https://www.googleapis.com/auth/calendar.events` → add yourself (and any
   testers) as test users → leave the app in **Testing**. Testing allows up to
   100 named users with no verification review; consent expires periodically,
   and re-clicking Connect fixes it.
3. **Credentials** → OAuth client ID → *Web application*. Authorized
   JavaScript origins: `http://localhost:5173` (dev), `http://localhost:4173`
   (`vite preview`), and your deployed origin. **No redirect URIs.**
   Origins are exact-match, **and the port is part of the match**: `example.com`
   does not cover `app.example.com`, and 5173 does not cover 4173 — a production
   build served by `npm run preview` fails with `origin_mismatch` until its own
   port is registered. Origin changes take a few minutes to propagate; retry in
   a fresh tab, since the Google client caches the rejection.
4. Put the client ID in `.env.local` as `VITE_GOOGLE_CLIENT_ID=`.

### 2. Hosting (Cloudflare Pages, git-connected)

- Build command `npm run build`, output directory `dist`, Node from
  `.node-version`. Set `VITE_GOOGLE_CLIENT_ID` in the project's environment
  variables — Vite inlines it at build time (`.env.local` is gitignored). A
  client ID is public by design; the origin allowlist is the security boundary.
- The site must be served from a **domain root** over **HTTPS**: the service
  worker precaches `/`, the manifest declares `start_url` and `scope` `/`, and
  Google's sign-in refuses insecure origins. A subpath will not work.
- Preview deployments cannot sign in (Google rejects wildcard origins). Test
  auth on the real origin only.
- **If the zone is proxied through Cloudflare**, its Browser Cache TTL silently
  overrides `public/_headers` for any path whose TTL is *lower* than the
  zone's. `/sw.js` must be `no-cache` or a new deploy takes hours to reach
  installed clients. Add a Cache Rule for `<your host>/sw.js` with Browser TTL
  *Respect origin*, then verify on the wire — the file being correct proves
  nothing about what the browser receives:

  ```
  curl -sI https://<your host>/sw.js | grep -i cache-control
  #  expect: cache-control: no-cache
  ```

## How it is built

The repository is a staged build: one contract per stage, one human gate
between stages. `_references/SPEC.md` is the product contract; `DECISIONS.md`
records what was ruled and what was rejected; `CONVENTIONS.md` the code and
verification rules; each `NN_*/output/verification.md` the evidence a gate
was judged on.

| Stage | Scope | Status |
|---|---|---|
| 01_scaffold | Repo skeleton, types, date core | closed 2026-08-29 |
| 02_data | Auth, Calendar API, categories, cache, writes | closed 2026-08-29 |
| 03_engine | Virtualizer, snap, rendering, year view | closed 2026-08-29 |
| 04_day | Motion system, inline day, event form | closed 2026-08-30 |
| 05_shell | First-run, settings, FAB, PWA, deploy | built and deployed 2026-08-30; gate in progress |
| 06_demo | Demo mode, README, licence | built 2026-09-05 (this iteration) |
| 07_habits | Habit tracker on Supabase | on hold |
| 08_journal | Journal link, legacy note migration | on hold |

Alongside the stages, three iterations run from one amended spec on separate
branches: the planning layer (`planning-layer`), this demo and beta on-ramp
(`demo`), and beta polish (`polish`). See `CONTEXT.md` for the routing.

```
src/
  main.ts        bootstrapping and wiring; owns the theme <style>
  auth.ts        Google Identity Services token client — the only file that knows auth
  gcal.ts        Calendar API — the only file that calls googleapis.com
  state.ts       event cache, today() anchor, persistence, writes, demo
  scroll.ts      the virtualizer and snap physics
  render.ts      week rows, bars, chips, lane packing
  year.ts        the year view
  day.ts         inline day expansion and the event form
  categories.ts  category resolution, Google colour table, moods
  chrome.ts      first-run, settings sheet, FAB, toasts
  sw.ts          service worker
  style.css      token consumption only
  motion.css     every transition and animation in the app
scripts/         node-only tooling: selftest runner, headless evidence harnesses, SW build
```

## Licence

MIT — see `LICENSE`. © 2026 Studio Relativity.
