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
- Year view on a phone: 7 columns is a long scroll; 14 may be better.

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
- Phone expansion: inline full-width or bottom sheet (leaning inline).
- Whether the virtualizer's one variable-height row can be done without
  an overlay. The stage-09 contract says stop and revise if not.
- Whether v3's cached `daynote` events (in the user's Google Calendar
  from stage 07) should be migrated into the vault by a one-off script or
  left as ordinary all-day events. See `JOURNAL.md`.
- Journal presence marker in the day cell: link-out only, or a Supabase
  `journal_days` index maintained from the vault. See `JOURNAL.md`.
- Habit streak semantics across the local-day boundary and time zones.
  See `HABITS.md`.
