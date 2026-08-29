# Open items

Things v3 never confirmed, plus questions the rebuild has to answer. Close
each with a dated line and move the ruling to `DECISIONS.md`.

## Never verified on the real wire (open since stage 02)
- Category colours: no event created through the form has been opened in
  the Google Calendar app to confirm its colorId renders as expected.
- All-day exclusive-end conversion: stub-proven (a 3-day event goes out as
  `20 → 23`) but never watched end to end. If wrong, every multi-day event
  is one day short or long.
- Instance-vs-series edit and delete round trips.
- A user-chosen colorId arriving in the Google app in Google's colour.

The rebuild's first real-account gate closes all four in one sitting.

## Never verified on a device
- Service-worker runtime behaviour (registration, offline open, a deploy
  reaching an installed client without a cache bump).
- Settings sheet with 11 categories on a small phone; native `<select>`
  and `<input type="color">` in an installed iOS PWA (iOS ignores
  `<option>` colouring, hence the colour *names*).
- Arm's-length legibility of a pale user-chosen hue in light mode. No
  guard was added by decision.
- Year view on a phone: 7 columns is a long scroll; 14 may be better.

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
