# Iteration C: Beta polish (2026-09-05)

**Session type: iteration.** Visual and interaction polish before beta
testers see the app. No new features: A builds the planning layer, B builds
demo. Read `SPEC.md` "Visual direction — Night Depth", "Motion", "First-run
and connection state", "Settings"; `CONVENTIONS.md` whole; `DECISIONS.md`
"Planning layer rulings" (the session split — your files are listed there).

Run on a worktree: `git worktree add ../bramwell-C -b polish`. Your files:
`src/style.css` (everything except the `.plan*` block A appends at the end),
`src/motion.css`, `src/chrome.ts` first-run copy/layout and the settings
sheet (**not** `buildColors()`'s row internals — A adds two controls there —
and **not** the demo button/pill — B), `index.html` seed paint if needed,
`public/` icons. `main.ts` only for the view-switch motion (step 3). Merge
order is A, B, C: rebase on both before your final verification pass.

You can SEE the app: `npm run dev`, then `scripts/shot.mjs` drives local
Chrome at 390/1440/1920 in both schemes with a seeded cache (read its header
for the PORT rule). Take before/after screenshots for every ticket; a
polish claim without a screenshot pair is not verified.

## Tickets, in priority order

1. **First-run copy: pitch the year, not the scroll.** The three lines
   currently sell the perpetual scroll. New framing (SPEC "Planning layer"):
   a year on one screen; paint vacations, blackouts and commitments; counts
   against a budget; events live in Google Calendar. Keep the structure
   (mark, name, one-liner, three lines, Connect, demo, privacy, support).
   Remove nothing B owns. Draft the lines in verification for the human to
   approve; ship your best version.
2. **Month ↔ Year switch has no motion.** `showYear()` flips `hidden`. Use
   the shared enter utility: the incoming view gets `.enter` → reflow →
   `[data-in]` (`--t-base`, no stagger). Nothing new in `motion.css` unless
   the utility cannot express it; if it cannot, the addition goes in
   `motion.css` and nowhere else. Reduced motion must still switch.
3. **Year view says nothing about months it has not loaded.** Signed out
   with a partial cache (seen 2026-09-05), Jan–Jun were simply empty. Add a
   quiet line under the grid (`.yrnote`, `--ink-dim`, 12px) when any
   displayed month is `absent`/`error` and none is `loading`: "January –
   June not loaded". `monthState()` is exported for exactly this. Never
   `--today`, never `--past`.
4. **Keyboard focus.** `:focus-visible` on header buttons, FAB, chips,
   sheet controls, form fields: the existing `--ring` 1px inset, nothing
   new. Tab through first-run → header → sheet and screenshot the ring.
5. **Settings sheet on a phone with 11 categories** (OPEN.md, never
   verified). Seed 11 in prefs, 390×844, both schemes: no clipped row, the
   Remove button reachable, the sheet scrolls inside itself. Fix what
   breaks. Leave the row's internals to A — layout only.
6. **Light mode pass.** Three widths, both views, sheet open, toast showing.
   Fix contrast or hierarchy regressions only; do not redesign. Every
   colour is a token.
7. **Toast placement on the notched phone** — must not sit under the FAB or
   the home indicator. `env(safe-area-inset-bottom)` like the FAB.
8. **Header buttons under emulated pointer input** (OPEN.md): in a real
   browser, click Year/Today/Reconnect with a trackpad and a touch screen.
   If they work, close the item with a dated line. If they do not, that is
   a bug in how `.hdr` buttons receive pointer sequences — find it with
   `elementsFromPoint` and the event log, not by guessing.
9. **Press feedback on buttons** (header, FAB, sheet, chips): `:active`
   `translateY(1px)` or opacity, compositor-only, declared in `motion.css`
   with `--t-fast`. Skip if it already exists.

## Not yours
Year-view stretch (A retuned it). Hover panel restyle (done, per the
style.css comment). Anything that adds a colour, a font, or a shadow level —
Night Depth has exactly three elevations and two reserved hues.

## Verification
`_iteration/output/polish.verification.md`: per ticket, before/after
screenshot paths, the probe used, and reduced-motion status for 2 and 9.
`grep -n 'transition\|animation' src/style.css` must return nothing.
