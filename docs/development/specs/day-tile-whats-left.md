# Spec: "What's left today" — Home day tile (design option A)

**For:** an AI coding assistant (and the maintainer) working in the OpenSky repo.
**Read first:** `AGENTS.md`, then `docs/development/architecture.md` and `docs/development/testing.md`. This spec follows
their rules (no emoji, no secrets in config.js, test off-screen, `tools/test-all.sh` must pass, docs in step with code).

**Files in this hand-off**
| File | What it is |
|---|---|
| `docs/development/specs/day-tile-whats-left.md` | this spec |
| `lib/client/day-agenda.js` | the ranking logic, **finished and unit-tested** (pure functions, no DOM). Drop in as-is. |
| `tools/test-day-agenda.js` | its unit test (36 checks, passes in 4 time zones). Drop in as-is. |

---

## 1. What and why

Today's tile on Home lists events chronologically, so by 5 PM the morning's finished events fill the tile and the
evening's are hidden behind "+N more". The family wants the tile to answer **"what's still ahead?"** at a glance.

**Change:** on the *today* tile only, rank events by relevance to *now* instead of start time, and drop the colored left
border from event pills (calendar identity comes from the pill's fill and a small calendar label instead).

Other days stay chronological. Nothing else on the page changes.

**Not in scope** (see §9): events shared by several calendars, a not-today variant of the card, the month view, the
Next Week tile, new settings.

## 2. What exists today (verified in the repo)

All in `modules/MMM-OpenSky-Home/` unless noted.

- `renderCalendar()` builds 7 day tiles + a "Next Week" tile; tile *i* = today + `weekOffset*7` + *i*. **Today's tile
  exists only when `weekOffset === 0`**, and `dayTile(day, events, isToday)` receives `isToday`.
- `dayTile()`: header (weekday, date, weather), `.hd-day-count` ("N events" + pickup icons), `.hd-day-events`.
  `maxEventsPerDay` (config.js:147, `4`) → if more events, shows `max - 1` pills + a "+N more" button.
- `eventPill()`: a `<button class="hd-event">`; colors from `OpenSkyEventColors.vars(ev)` → CSS vars `--evc-bg` (pale
  fill) and `--evc-bar` (solid). CSS gives it `border-left: 5px solid var(--evc-bar)`. Finished events get `.passed`
  (`opacity: .6`). Title is `.hd-event-title`, time is `.hd-event-time`.
- `eventsBetween()` sorts all-day first, then by start. `allEvents()` dedupes on `title|startDate|calendarName`
  (so the same event on two calendars shows twice — leave that alone, §9).
- `fitTitles()` lets cut-off titles take two lines while everything still fits (measures `.hd-day-events`'s last child
  against the tile's inner bottom). Run after every `renderCalendar()` and on `PAGE_CHANGED`.
- A 60 s `setInterval` in `start()` only handles the midnight rollover. **Nothing re-renders as time passes**, so
  "what's left" needs a clock tick (§5.4).
- Taps: a pill → `CALENDAR_EVENT_CLICKED`; the tile (not a pill) → `CALENDAR_DAY_CLICKED`.

Estimated tile size on the reference 1920×1080 panel: roughly **250 × 340 px** (derived from the CSS: root top 92 /
bottom 22, columns 1.62fr : 1fr, 4×2 grid, 14 px gaps). **This is an estimate: measure it** with `h.shot` on the headless
run. It matters because the design was drawn on a taller 360 px card; the tile fits fewer rows, which is why §5.2 fits
by measuring rather than by a fixed count.

## 3. Behavior (all implemented in `lib/client/day-agenda.js`)

`OpenSkyDayAgenda.rank(events, nowMs, { cap })` → an agenda; read the header comment of the file for the exact shape.

| Rule | Detail |
|---|---|
| **Classes** | *Live*: start ≤ now < end. *Upcoming*: start > now. *Done*: end ≤ now. An event with no end is a point in time (done once its time has passed). |
| **All-day** | `allDay`, or covering the whole local day (a multi-day event mid-run). Not "left"; drawn as slim strips, max 2; extras count toward "+N more". |
| **Order of rows** | optional *recent* row, then *live* (start order), then *upcoming* (soonest first). At most `cap` rows (cap = `maxEventsPerDay`, default 4). |
| **Recent row** | The single most recently finished timed event, **only if** it ended ≤ 60 min ago **and** there are fewer than `cap` live/upcoming rows (a free slot). It is the first thing dropped when space is short. |
| **Done chip** | Every other finished event collapses into one "✓ N done" chip; tapping it lists them inline. |
| **"+N more"** | Live/upcoming events that did not fit. |
| **Counter** | `.hd-day-count` text for today: `"N left"` (live + upcoming timed events), `"All done"` when timed events exist but none are left, otherwise `""` → keep the usual "N events" / blank text (an all-day-only day). |
| **Relative labels** | Upcoming within 3 h: `in 20 min`, `in 1 hr 45 min`. Further away: no label (the time range is enough). Live: `15 min left` (< 1 h) or `until 3 PM`. Recent: `ended 11 min ago` / `just now` / `1 hr ago`. |
| **Fitting** | `shrink(agenda)` removes the lowest-priority row (recent first, then the last upcoming row; **never a live row, never the last row**) → renderer loops until the tile fits. |
| **Re-render only on change** | `signature(agenda)` changes when anything visible would change (every minute while something is live or within 3 h of starting). |

Constants (`DEFAULTS` in the file): `cap 4`, `graceMin 60`, `relMin 180`, `maxStrips 2`.

## 4. Visual spec

Keep Home's existing type sizes and radii (pill title 17 px, time 14 px, radius 12 px, gap 8 px). **Do not copy the
design prototype's absolute pixel sizes** — it was drawn at a different scale. Copy the *structure* and the *tokens*.
No emoji anywhere: the check mark is an inline SVG (see `icon()` in the Home module for the style).

### 4.1 Calendar identity without the left border
- Remove `border-left: 5px solid var(--evc-bar …)` from `.hd-event`. Fill stays `var(--evc-bg)`.
- Add a **calendar label** at the right end of each pill's time row: an 8 px dot (`background: var(--evc-bar)`) + the
  calendar name (`ev.calendarName`), 12 px / 700 / `#374151`. It must never push the time off the row: `min-width: 0`,
  name ellipsizes first, down to **dot only** (the dot carries `aria-label`/`title` = the full calendar name).
  Do **not** wrap the label to a third line (costs a row per pill on a small tile). *(Open question §9.)*
- Applies to **every** pill in the Home day tiles (so the week looks consistent), not just today's. If only today's should
  change, scope the CSS under `.hd-is-today`. Month view and the Next Week dots are unchanged.

### 4.2 Today's tile, top to bottom
```
Fri 30  [weather]
3 left   [pickup icons]                      ← counter (§3); icons stay
┌ Dad - no school        All day  ● Dad ┐    ← all-day strip: slim, 1 row, max 2
┌─────────────────────────────────────────┐
│ Swim lessons                            │  ← LIVE: dark 2 px ring, NOW badge, progress bar
│ [NOW] 15 min left                ● Mom  │
│ ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬░░░░░             │
└─────────────────────────────────────────┘
┌─────────────────────────────────────────┐
│ Piano                                   │  ← NEXT: normal pill
│ in 1 hr 45 min · 3:30 – 4 PM    ● Kids  │
└─────────────────────────────────────────┘
  … more NEXT pills …
[+2 more]                                      ← existing .hd-more look
[✓ 2 done]                                     ← same look + check icon; tap = expand
```
A just-ended event (when there is room) sits **above** the live/next rows as a slim gray row:
`✓ PT` / `ended 11 min ago · ● Kids`.

### 4.3 Tokens
| Element | Fill | Text | Other |
|---|---|---|---|
| Live pill | `var(--evc-bg)` | title 17 px / 800 `#1f2937` | `box-shadow: 0 0 0 2px #1f2937` (inside the tile's 12 px padding, so no clipping) |
| NOW badge | `#1f2937` | white, 12 px / 800, letter-spacing .04em | padding 2px 8px, radius 999 px |
| Progress bar | track `rgba(31,41,55,.15)` | — | 5 px high, radius 3 px, fill `#1f2937`, width = `progress` |
| Upcoming pill | `var(--evc-bg)` | title as today; relative label 14 px / 800 `#1f2937`, then `·`, then the time range 14 px / 600 `#374151` | — |
| Recent / done rows | `#eff1f4` | title 15 px / 700 `#4b5563`; meta 13 px / 600 **`#4b5563`** | check icon 14 px; padding ≈ 8 px 10 px; **no `opacity`** |
| All-day strip | `var(--evc-bg)` | title 15 px / 700; "All day" 12 px / 700 `#374151` | one row, radius 12 px |
| Chips | existing `.hd-more` | — | hit area ≥ 40 px tall (nav buttons are 42 px) |
| Empty state | none | "Nothing left today", 15 px / 700 `#4b5563`, check icon | shown when `state === "allDone"`, above the done chip |

**Contrast:** meta text on the gray done rows must be `#4b5563` (≈ 6.7 : 1), not `#6b7280` (≈ 4.3 : 1, fails AA).
"Live" is shown by ring + badge + bar, **never by a fill color** (fill = calendar).

## 5. Implementation plan

### 5.1 Files to touch
1. **Add** `lib/client/day-agenda.js` and `tools/test-day-agenda.js` (provided).
2. `modules/MMM-OpenSky-Home/MMM-OpenSky-Home.js`
   - `getScripts()`: add `"modules/opensky-lib/client/day-agenda.js"`.
   - Add `nowMs() { return Date.now(); }` and use it for **all** new "now" logic and for the `.passed` check in
     `eventPill()`. This is the single clock the tests pin (§7). Don't name any new field `data`, `config`, `name`, `show`,
     `hide` (AGENTS.md).
   - `dayTile(day, events, isToday)`: when `isToday && this.weekOffset === 0`, build the body with `todayBody()`
     (below); otherwise unchanged.
   - New `todayBody(tile, events, day)`, `renderToday(tile)` and a re-render helper (§5.2–5.4).
3. `modules/MMM-OpenSky-Home/MMM-OpenSky-Home.css`: remove the left border, add the new classes (§5.5).
4. `tools/scenarios/home.js` (update) + new `tools/scenarios/home-today.js` (§7).
5. Docs: one sentence in the `home` row of `docs/configure.md`'s pages table; a `CHANGELOG.md` entry (next version heading —
   maintainer's call); no new setting.

### 5.2 Rendering today's tile
```
agenda = OpenSkyDayAgenda.rank(events, this.nowMs(), { cap: this.config.maxEventsPerDay, dayStart, dayEnd })
```
(`dayStart`/`dayEnd` = the tile's day bounds from `day`, so the rule holds even if `day` isn't `nowMs()`'s date.)

Draw, in order: counter text into `.hd-day-count`'s first `<span>` (leave the pickup icons); strips; rows (`recent` →
`.hd-event.recent`, `live` → `.hd-event.live`, `next` → `.hd-event`); `+N more` (`agenda.more`, existing `.hd-more`);
empty-state row if `agenda.state === "allDone"`; done chip (`agenda.doneCount`, `<button class="hd-more hd-done-chip"
aria-expanded>`) and, when open, one `.hd-event.done` row per `agenda.done` item.

**Fit loop** (reuse the measure from `fitTitles()`): after the tile is in the DOM and visible, while the last child's
bottom exceeds the tile's inner bottom → `agenda = OpenSkyDayAgenda.shrink(agenda)`; stop when it returns `null`; redraw the
body each step. Run it **before** `fitTitles()` so two-line titles only use leftover space. If the tile has zero height
(another page is showing), draw at `cap` and let the existing `PAGE_CHANGED` → 150 ms hook fit it (extend that hook to
call the today-fit too). While the done list is **open**, skip the fit loop and make `.hd-day-events` scroll (§5.5).

Taps are unchanged: pills (including recent/done rows) → `CALENDAR_EVENT_CLICKED`; "+N more" bubbles to the tile →
`CALENDAR_DAY_CLICKED` as it does now. The done chip toggles `this.doneOpen` and must **not** open the day popup:
change the tile handler to ignore `e.target.closest(".hd-event, .hd-done-chip")`.

### 5.3 State
`this.doneOpen` (boolean, default false). Reset it at midnight, on `OPENSKY_IDLE_RESET`, and in `resume()`, so the wall
display always returns to the tidy view.

### 5.4 Clock tick
Replace the 60 s midnight check with a tick aligned to the minute (`setTimeout(…, 60000 - (Date.now() % 60000) + 250)`
re-armed each time). Each tick: handle the midnight rollover as now; else if `weekOffset === 0`, recompute today's agenda
and **re-render today's tile only if `signature()` changed** (keep `doneOpen`). `resume()` already calls `render()`, which
covers waking from sleep.

### 5.5 CSS (all `hd-` prefixed, in the Home module's CSS)
- `.hd-event { border-left: none; }` (keep the existing padding so text doesn't move).
- `.hd-ev-meta` (row: `display:flex; align-items:center; gap:6px; width:100%; min-width:0`), `.hd-event-rel`,
  `.hd-cal` (label: `margin-left:auto; display:flex; align-items:center; gap:5px; min-width:0`) with `.hd-cal-dot`
  and `.hd-cal-name` (`overflow:hidden; text-overflow:ellipsis; white-space:nowrap`).
- `.hd-event.live`, `.hd-live-row` (badge + text), `.hd-progress` / `.hd-progress > i`.
- `.hd-event.recent, .hd-event.done` (§4.3), `.hd-strip`, `.hd-done-chip` (+ check icon), `.hd-empty`.
- `.hd-day.hd-done-open .hd-day-events { flex: 1 1 auto; min-height: 0; overflow-y: auto; }` — verify touch-scroll on the
  real panel; that's the one behavior the headless run can't prove.
- Keep `.hd-event.passed` (it still applies to past weeks when you page back).

## 6. Edge cases to keep working
- **No events / all-day only:** counter blank or the usual "1 event"; no done chip, no placeholder.
- **Before the day starts:** every row is "next"; no recent row, no chips except "+N more".
- **After the last event:** "All done" + "Nothing left today" + done chip.
- **Two events live at once:** both are live rows (each with a ring and bar).
- **Event runs past midnight:** stays live/next until it ends tomorrow; never "done" today.
- **Long titles / long calendar names:** title wraps to 2 lines only if it fits (existing `fitTitles`); the calendar
  name truncates first.
- **DST days (23/25 h):** use the local calendar-day bounds (the helper does; covered by test 8).
- **Day popup / editor:** unchanged; event objects passed to `CALENDAR_EVENT_CLICKED` are the same `ev`.

## 7. Tests (required by AGENTS.md)
1. `node tools/test-day-agenda.js` must end `pass=N fail=0` (it is picked up by `tools/test-all.sh`).
2. **Update `tools/scenarios/home.js`.** It currently asserts a pill's left border color
   (`getComputedStyle(p).borderLeftColor`), which will no longer exist: read the `--evc-bar` custom property (or the
   `.hd-cal-dot` background) instead. It also assumes today's pills show a fixed time, which now depends on the time of
   day → pin the clock (next point) before adding the test events.
3. **Pin the clock without touching globals:** in scenarios, `page.evaluate` sets
   `home.nowMs = () => <today at HH:MM local>` and calls `home.renderCalendar()`. Build events relative to *today at
   that time*, like the existing scenario's `at(dd, hh, mm)`.
4. **New `tools/scenarios/home-today.js`** (no `tools/test-config.js` line: this adds no setting). Checks:
   - 12:41 PM, ordinary day (OT 10–11, PT 11:30–12:30, Swim 1–2, Soccer 4:30–6, Dinner 6:30–7:30; Dad all-day):
     counter `3 left`; first row is `recent` "PT" / `ended 11 min ago`; Swim says `in 19 min`; done chip `1 done`.
   - 1:45 PM, busy day (+ Piano 3:30–4, Call with Grandma 8–8:30, Book club 8:30–10): Swim is `.live` with a NOW badge and
     a progress bar at 75 %; shown rows + `+N more` = 6; done chip says `2 done`; no `.recent` row.
   - Tap the done chip: `aria-expanded="true"`, OT and PT appear as `.hd-event.done`, and **no** `CALENDAR_DAY_CLICKED`
     is sent; tap again: collapses.
   - 9:00 PM: counter `All done`, "Nothing left today" visible, done chip present.
   - Tomorrow's tile is unchanged: pills in start order, no `.live` / `.recent` / `.done`.
   - Colors: a pill's `--evc-bar` matches its calendar's palette color; `.hd-cal-dot` has the same color; `.hd-cal-name`
     equals `calendarName` (or the dot has the full name as `aria-label`); **no pill has a left border**
     (`border-left-width === "0px"`).
   - Fit: for every tile, the last child's bottom ≤ the tile's inner bottom (nothing clipped), in both states.
   - Tick: advance `nowMs` by one minute, call the tick; Swim's `in 19 min` becomes `in 18 min` without a full re-render of
     other tiles.
   - Screenshots: `h.shot("home-today-1241")`, `…-1345`, `…-2100`, `…-done-open`.
5. `tools/test-all.sh` passes. Off-screen only; don't restart the real display.

## 8. Acceptance checklist
- [ ] Today's tile: live → upcoming (soonest first); one fresh just-ended row only when a slot is free; the rest in "✓ N done".
- [ ] Counter reads "N left" / "All done"; pickup icons still there.
- [ ] No left border on Home pills; calendar identity = fill + dot + name (name truncates before time).
- [ ] "Live" is ring + NOW + bar; never a fill color. Meta text on gray rows is `#4b5563`.
- [ ] Tile never overflows (fit loop); live row never dropped.
- [ ] Rolls forward by itself every minute; correct after the screen wakes; midnight still resets.
- [ ] Done list expands/collapses without opening the day popup; closes on idle reset.
- [ ] Other days, Next Week, month view, lists, photos unchanged.
- [ ] Unit test + scenarios + `tools/test-all.sh` pass; docs + CHANGELOG updated; `git pull --rebase` before pushing.

## 9. Decisions made here, and what's deliberately left out
**Defaults I chose — change in `DEFAULTS` if the family disagrees:** 60-minute just-ended window; relative labels within
3 h; at most 4 rows; at most 2 all-day strips. Per AGENTS.md's "prefer configuration over code", these could become
`opensky.json` settings later; not done here to keep the change small.

**Open questions for the maintainer**
1. *Left-border removal scope* — all Home pills (recommended, consistent) or only today's.
2. *Calendar label* — dot + ellipsized name on the time row (specified), or always a full name on a third line (clearer, but
   costs about one pill of height per three).
3. *Shared events:* kids' calendars sharing an event (e.g. roller derby) currently show as two pills, one per calendar,
   because `allEvents()` dedupes per calendar. The preferred future treatment is one merged event keyed on the
   event UID (else title + start + end), with the pill's fill striped in each person's color. **Out of scope here.** Don't merge
   on title alone. Design it separately.
4. *A neutral "not today" tile* (no peach background, plain date) — design exists only for today's tile.
