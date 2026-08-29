# Habits — scope spec

Habit tracking is a separate product with a separate store. It shows up in
the calendar as per-day state; it never touches Google Calendar.

## Store: Supabase

Postgres with row-level security, accessed from the PWA through
`@supabase/supabase-js` in `src/habits.ts` — the only file that talks to
Supabase. Anon key and project URL ship in the bundle (public by design);
RLS is the security boundary.

### Auth

Supabase Auth with the Google provider, so the identity is the same Google
account the calendar uses. Two token clients, one identity:

- `auth.ts` keeps the GIS token client for the Calendar API scope.
- `habits.ts` holds the Supabase session (Supabase manages refresh).

Why not one sign-in: Supabase can return Google's `provider_token` at
sign-in but does not refresh it, so the calendar token would die after an
hour. Two clients is the honest shape. The first-run Connect button runs
both in sequence; a Supabase sign-in failure degrades to "habits
unavailable" and never blocks the calendar. Sign-out signs out of both.

### Schema

```sql
create table habits (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users,
  name        text not null,
  cadence     jsonb not null,        -- {"kind":"daily"} | {"kind":"weekdays","days":[0,1,2,3,4]} | {"kind":"per_week","n":3}
  target      integer not null default 1,   -- completions per day that count as done
  color       text,                   -- optional hex; null -> neutral
  sort        integer not null default 0,
  archived_at timestamptz,
  created_at  timestamptz not null default now()
);

create table habit_logs (
  habit_id    uuid not null references habits on delete cascade,
  user_id     uuid not null default auth.uid() references auth.users,
  day         date not null,          -- local civil day at the time of logging
  value       integer not null default 1,
  note        text,
  logged_at   timestamptz not null default now(),
  primary key (habit_id, day)
);

alter table habits     enable row level security;
alter table habit_logs enable row level security;
create policy own_habits on habits     for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_logs   on habit_logs for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create index on habit_logs (user_id, day);
```

- `cadence.days` uses the app's `DayOffset` numbering, 0=Mon … 6=Sun —
  the same vocabulary as layout. Not ISO 8601; `[0,1,2,3,4]` is Mon–Fri.
- `day` is a civil date, not a timestamp. It is the same `DayNumber` the
  calendar uses, serialized as ISO date at the wire boundary. No time zone
  math on the server.
- One row per habit per day (`value` counts completions; `target` says how
  many make it done). Toggling a done habit deletes the row; that keeps
  "did it" and "no record" distinct from "0".
- Habits are never hard-deleted while logs exist; `archived_at` hides them.
- Streaks, weekly counts, and completion ratios are computed on the client
  from logs; no server functions in v1.

## In the calendar

- **Day cell**: a compact completion indicator bottom-right — done/total
  for that day's due habits (e.g. a small ring that fills, or `3/5`).
  Neutral colour; it is state, not a commitment, and must not compete with
  event bars. Absent when no habit is due.
- **Expanded day**: a checklist of the habits due that day, tap to toggle,
  optimistic. Habits with `target > 1` show a counter. Archived habits
  never appear. Today's checklist is the primary use; any past day can be
  edited (backfill is allowed, dated by `day`).
- **Year view**: no habit rendering in v1. Open item.
- **Settings**: a Habits section — add, rename, cadence, target, colour,
  reorder, archive. Same sheet rules (a background refresh never resets
  it).
- **Demo**: a seeded in-memory habit set with ~90 days of plausible logs;
  writes reject with the demo message; nothing persisted.

## Client architecture

- `habits.ts`: Supabase client, session, `listHabits()`, `logsForRange()`,
  `upsertLog()`, `deleteLog()`, `saveHabit()`, `archiveHabit()`. DOM-free,
  never imports `state.ts`.
- `state.ts` owns the habit cache (`bramwell.habits.v1` in localStorage,
  keyed by month like events) and the optimistic write path — same
  pattern as events: apply pending → call → reconcile or roll back +
  toast. Offline: read-only from cache, writes fail visibly.
- `onCacheChange` carries habit months too, so the render pipeline does
  not know which store changed.

## Definition of done

- Sign in once → calendar and habits both connected; a Supabase failure
  leaves the calendar working with habits marked unavailable.
- Add a daily habit and a weekdays-only habit in Settings; the indicator
  appears only on due days.
- Toggle a habit in the expanded day: instant, survives reload, visible in
  the Supabase table; toggle again deletes the row.
- Kill the network, toggle: visible failure, rollback.
- Streak count for a daily habit is right across a month boundary and
  across a DST change.
- `?demo` shows seeded habits and rejects writes.
- No file other than `habits.ts` imports `@supabase/supabase-js`.

## Manual setup (human-only)

1. Supabase project → Authentication → Providers → Google: client ID and
   secret from a **Web application** OAuth client in the same Google Cloud
   project as the calendar client (a second client, or the same one with
   Supabase's callback URL added as an authorized redirect URI).
2. Authentication → URL configuration: site URL `https://cal.no.fail`,
   redirect URLs for localhost and the deployed origin.
3. Run the schema above in the SQL editor.
4. `.env.local`: `VITE_SUPABASE_URL=`, `VITE_SUPABASE_ANON_KEY=`. Same two
   in the Cloudflare dashboard.
