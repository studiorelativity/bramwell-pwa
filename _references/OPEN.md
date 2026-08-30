# Open items

Things v3 never confirmed, plus questions the rebuild has to answer. Close
each with a dated line and move the ruling to `DECISIONS.md`.

## Closed on the real wire (stage 02 gate, 2026-08-29)

All four closed in one sitting against the real account, as planned. Rulings
promoted to `DECISIONS.md` "Stage 02 gate close"; evidence in
`02_data/output/verification.md`.

- **2026-08-29 — Category colours: CLOSED.** One all-day event created per
  seed category through `state.createEvent`. Google stored colorIds 9, 10, 5
  and 8 exactly as the seed table specifies, and the human confirmed all four
  render as expected in the Google Calendar app (blue-indigo, green,
  yellow-amber, grey). The transcribed hex table stands.
- **2026-08-29 — All-day exclusive-end conversion: CLOSED, both directions.**
  Write: a 3-day event (internal end inclusive) went out as
  `start.date 2026-08-29` / `end.date 2026-09-01`. Read: Google's
  `2026-08-19 → 2026-08-22` came back as Aug 19 → Aug 21 inclusive, and a
  single-day `2026-08-21 → 2026-08-22` came back as one day, not two. The
  failure mode this item warned about — every multi-day event one day short
  or long — does not occur.
- **2026-08-29 — Instance-vs-series edit and delete round trips: CLOSED.**
  An instance-scope edit changed only the Aug 29 occurrence; Sep 5, 12 and 19
  were untouched, and Google recorded the edit as a proper series exception
  (`recurringEventId` and `originalStartTime` retained). A series-scope
  delete, given an INSTANCE id, resolved to `recurringEventId` and removed
  all four occurrences with zero collateral damage.
- **2026-08-29 — A user-chosen colorId arriving in Google's colour: CLOSED**
  by the same evidence as the first item — the colorId written is the
  colorId Google stores, and Google paints it in its own palette.

## Never verified on a device
- Service-worker runtime behaviour (registration, offline open, a deploy
  reaching an installed client without a cache bump).
- Settings sheet with 11 categories on a small phone; native `<select>`
  and `<input type="color">` in an installed iOS PWA (iOS ignores
  `<option>` colouring, hence the colour *names*).
- Arm's-length legibility of a pale user-chosen hue in light mode. No
  guard was added by decision.
- **2026-08-29 — Year view on a phone: CLOSED at the stage-03 gate.** 14
  columns shipped as the phone default (27 rows at 390px, scrolls about one
  row); approved on device. Ruling in `DECISIONS.md` "Stage 03 gate close".
- **`grid-template-columns` interpolation on iOS Safari.** The expansion animates
  the column template. Chrome interpolates it; if iOS Safari snaps instead, the
  degradation is a hard column jump with the height still animating. Gate row at
  stage 04; the fallback if it snaps is to accept the snap and record it.

## Opened at the stage-03 gate close
- **Signed-out refetch pressure.** Stage 02's rule refetches an `error`
  month on every `ensureMonthsFor` call; stage 03 limits that to once per
  range move, but a long signed-out scroll still makes a token attempt per
  month per move. Stage 05 owns connection state and decides whether
  `error` becomes sticky while signed out.
- **The 15/45 snap steps in a browser.** `nearestAnchor` is unit-tested for
  all three moduli, but only 30 is wired; the step control is stage 05's
  Settings, and the device check happens at that gate.

## Never verified on the real wire (opened at the stage-02 gate close)
- **GIS response ordering.** `auth.ts` pairs concurrent token requests with
  their responses FIFO, because the GIS callback carries no correlation id.
  If GIS ever resolves two concurrent `requestAccessToken()` calls out of
  request order, the earlier settler receives the wrong response and the
  later one hangs. Shown by probe to be non-self-correcting. It narrows a
  strictly worse prior design (a single settler slot could not survive
  concurrency at all), so it was accepted rather than blocked. Serialising
  the two paths would reintroduce the swallowed-gesture bug, so any fix
  needs a different idea.
- **Offline write rollback on a real device.** Verified out of band with a
  stubbed `navigator` (rejects with the offline message, zero network calls,
  overlay rolled back), never on a device with the network actually killed.
  Stage 05's PWA gate is the right place.

## Rebuild questions
- **2026-08-29 — Phone expansion: CLOSED at the stage-04 plan.** Inline full
  width: the six neighbours go to `0fr` and the column gap to zero, so it is the
  desktop mechanism with different numbers rather than a second shell. The sheet
  was already in `DECISIONS.md` "Rejected — do not retry" and no new reason was
  found to retry it. Ruling in `DECISIONS.md` "Stage 04 rulings".
- **2026-08-29 — Variable-height row without an overlay: CLOSED with
  evidence at the stage-03 gate.** The pure maths take `expanded` and the
  round-trip test fails at exactly the expanded row when `posOf` is broken;
  the synthetic scroller makes it one O(1) conditional offset. Stage 04 sets
  `expanded` and animates `delta`. `DECISIONS.md` "Stage 03 gate close".
- Whether v3's cached `daynote` events (in the user's Google Calendar
  from stage 07) should be migrated into the vault by a one-off script or
  left as ordinary all-day events. See `JOURNAL.md`.
- Journal presence marker in the day cell: link-out only, or a Supabase
  `journal_days` index maintained from the vault. See `JOURNAL.md`.
- Habit streak semantics across the local-day boundary and time zones.
  See `HABITS.md`.
