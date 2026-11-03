# Day tile: events on more than one calendar (gradient + initial badges)

Addendum to `day-tile-whats-left.md`. **Supersedes §9 item 3** ("shared events out of scope").

## Decision

An event that belongs to 2+ family calendars keeps the soft gradient OpenSky already draws (each person's pastel, left → right) and gains **initial badges** at the right of the title row. The badges replace the "dot + calendar name" label, which is what was truncating ("Quinn, R…"). Single-person events are unchanged (fill + dot + name).

- Badge text = shortest unique prefix across *all* family calendar names (`Q`, `Re`, `Ry`). Compute once from settings, not per event: `OpenSkyBadges.labels(allNames)`.
- Up to 4 badges. 5+ people → first 3 + a gray `+N` badge.
- Order = calendar order in settings (a pill never reshuffles).
- **Placement rule: the calendar identity is always top-right of the title row** — dot + name for one calendar, badges for several. The time line sits below, alone. Never let the label wrap onto the time line (give it `flex: none; white-space: nowrap`).
- Titles may wrap to 2 lines (existing `fitTitles` / `mf-two`); badges stay top-right (`align-items: flex-start`).
- Full names live in the day popup, and in `aria-label` on the badge group.
- Merging: same `iCalUID` across calendars, else title + start + end. Never title alone.

## Badge CSS

```css
/* title row: title grows, badges don't shrink */
.hd-ev-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
.hd-ev-top .hd-ev-title { flex: 1 1 auto; min-width: 0; }

.hd-badges { flex: none; display: flex; }

.hd-badge {
  --b-bg: #e5e7eb;            /* the person's pastel fill   */
  --b-bar: #6b7280;           /* the person's saturated bar */
  box-sizing: border-box;
  width: 24px; height: 24px;
  margin-left: -6px;          /* overlap */
  border-radius: 50%;
  background: var(--b-bg);
  border: 2px solid var(--b-bar);
  box-shadow: 0 0 0 2px #fff; /* white ring separates overlaps */
  display: flex; align-items: center; justify-content: center;
  font: inherit;              /* keep the tile's font stack */
  font-size: 11px; font-weight: 800; line-height: 1;
  color: #1f2937;
  overflow: hidden;
}
.hd-badge:first-child { margin-left: 0; }
.hd-badge-long { font-size: 9px; letter-spacing: -0.2px; }   /* labels longer than 2 chars (Sam / Sama) */
.hd-badge-more { --b-bg: #e5e7eb; --b-bar: #6b7280; }        /* the "+N" badge */
```

On a gray "done" row the badges keep their colors (they are identity, not state); only the row background and text gray out.

## Render code (sketch)

```js
// once, when settings load
const LABELS = OpenSkyBadges.labels(allCalendarNames);

function badgeGroup(people) {               // people: [{ name, … }] in settings order
  const { shown, extra } = OpenSkyBadges.badges(people, LABELS, 4);
  const wrap = document.createElement("div");
  wrap.className = "hd-badges";
  wrap.setAttribute("role", "img");
  wrap.setAttribute("aria-label", people.map((p) => p.name).join(", "));
  for (const p of shown) {
    const pair = OpenSkyEventColors.pair(OpenSkyEventColors.colorOf(p.name)); // { bg, bar }
    const b = document.createElement("span");
    b.className = "hd-badge" + (Array.from(p.label).length > 2 ? " hd-badge-long" : "");
    b.style.setProperty("--b-bg", pair.bg);
    b.style.setProperty("--b-bar", pair.bar);
    b.textContent = p.label;
    wrap.appendChild(b);
  }
  if (extra) {
    const m = document.createElement("span");
    m.className = "hd-badge hd-badge-more";
    m.textContent = "+" + extra;
    wrap.appendChild(m);
  }
  return wrap;
}

// pill background for a shared event
const fills = people.map((p) => OpenSkyEventColors.pair(OpenSkyEventColors.colorOf(p.name)).bg);
pill.style.background = "linear-gradient(90deg, " + fills.join(", ") + ")";
```

Adjust the `pair()` field names to whatever `OpenSkyEventColors` actually returns. Hide the dot + name label when the event is shared.

## Type scale (the tile's existing styles, with one contrast fix)

| Element | Size / weight | Color | Notes |
|---|---|---|---|
| Event title | 17px / 700, line-height 1.25 | `#1f2937` | 2 lines max (`fitTitles`) |
| Time / range | 14px / 600 | **`#374151`** (was `#4b5563`) | `#4b5563` on purple `#cdb4ff` is ~4.2:1; `#374151` clears 4.5:1 on every pastel |
| Calendar label (dot + name) | 12px / 700 | `#374151` | single-person events only |
| Badge text | 11px / 800 (9px for 3+ chars) | `#1f2937` | |
| Done-row text (title / time) | same sizes | `#4b5563` on `#eff1f4` (~6.7:1) | not `#6b7280` (~4.3:1) |

Font family: inherit the tile's stack, `"Segoe UI","Helvetica Neue",Arial,sans-serif`. The mockups were drawn in Inter, which is slightly wider — **measure on the Pi** before trusting the 2-letter badge fit.

Pill padding stays `8px 10px 8px 12px`, radius 12px, gap 8px. The 24px badge row fits inside the ~246px pill beside a title with room for 4 badges (≈ 24 + 3 × 18 = 78px).

## Tests

Unit (`tools/test-shared-badges.js`, 23 pass): `labels` (unique letters, shared prefixes, case, accents, emoji, dedupe) and `badges` (max, `+N`, order kept, input not mutated).

Scenario additions:
1. Shared event (Quinn + Reese) renders two badges `Q`, `Re`; no dot + name label; gradient background.
2. Five-person event renders 3 badges + `+2`.
3. Two calendars named `Reese` / `Ryan` render `Re` / `Ry` on every event, shared or not.
4. A long title wraps to 2 lines without pushing badges out of the pill.
5. Badge group has `role="img"` with the full names in `aria-label`.
