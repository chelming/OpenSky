/* OpenSky "what's left today" ranking for a Home day tile — works in the browser (window.OpenSkyDayAgenda) and in
 * Node (require) for tests. Pure functions: no DOM, no clock (the caller passes `now`).
 *
 *   const a = OpenSkyDayAgenda.rank(eventsOfToday, Date.now(), { cap: 4 });
 *
 * Input: the day's events as MMM-OpenSky-Home.normalize() returns them
 *   { title, calendarName, startDate, endDate, allDay, color, colorName, … }   (startDate / endDate in ms)
 * Output:
 *   {
 *     now, left, timedCount,
 *     counter,          // "3 left" | "All done" | ""   ("" → keep the tile's usual "N events" text)
 *     state,            // "empty" (no timed events) | "active" | "allDone"
 *     strips,           // all-day events to draw as slim strips (max opts.maxStrips)
 *     rows,             // in display order; each { kind, ev, … }:
 *                       //   { kind: "recent", endedAgoMin, agoText }          one just-ended event (only if there is room)
 *                       //   { kind: "live",   minutesLeft, progress 0..1 }
 *                       //   { kind: "next",   startsInMin, relText }          relText = "in 20 min" or "" (≥ relMin away)
 *     moreCount,        // live/upcoming events that did not fit in `rows`
 *     stripOverflow,    // all-day events beyond maxStrips
 *     more,             // moreCount + stripOverflow → the "+N more" chip (0 = no chip)
 *     done,             // finished events NOT shown as the recent row, chronological → the "✓ N done" chip
 *     doneCount
 *   }
 * shrink(a) → the same agenda with its lowest-priority row removed (null when nothing more can go): the renderer calls
 *   it while the tile overflows (the recent row goes first, then the last upcoming row; a live row never goes).
 * signature(a) → a string that changes when anything on screen would change (re-render only then).
 */
(function (root) {
  const MIN = 60000;
  const DEFAULTS = {
    cap: 4,         // most rows (recent + live + upcoming) before "+N more"; the renderer may shrink() it further to fit
    graceMin: 60,   // a finished event stays visible (if there is room) for this many minutes
    relMin: 180,    // "in 20 min" labels only for events starting within this many minutes
    maxStrips: 2    // all-day strips
  };

  const endOf = (ev) => (ev.endDate > ev.startDate ? ev.endDate : ev.startDate);   // no end → a point in time
  const byStart = (a, b) => a.startDate - b.startDate || endOf(a) - endOf(b) || String(a.title).localeCompare(String(b.title));
  const keyOf = (ev) => `${ev.title}|${ev.startDate}|${ev.calendarName}`;           // same key as Home's allEvents()

  /** 5 → "5 min", 60 → "1 hr", 105 → "1 hr 45 min" */
  const dur = (m) => {
    m = Math.max(0, Math.round(m));
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60), r = m % 60;
    return r ? `${h} hr ${r} min` : `${h} hr`;
  };
  /** 0 → "just now", 20 → "20 min ago", 60 → "1 hr ago" */
  const agoText = (m) => (m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} hr ago`);

  // derived fields, kept in one place so shrink() stays consistent
  function finish(a) {
    a.more = a.moreCount + a.stripOverflow;
    a.doneCount = a.done.length;
    a.state = a.timedCount === 0 ? "empty" : a.left === 0 ? "allDone" : "active";
    a.counter = a.left > 0 ? `${a.left} left` : a.timedCount > 0 ? "All done" : "";
    return a;
  }

  function rank(events, now, opts = {}) {
    const o = { ...DEFAULTS, ...opts };
    const d = new Date(now);
    const dayStart = o.dayStart != null ? o.dayStart : new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const dayEnd = o.dayEnd != null ? o.dayEnd : new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();

    // all-day = flagged all-day, or covering the whole day (a multi-day event in the middle of its run)
    const allDay = [], timed = [];
    for (const ev of events) (ev.allDay || (ev.startDate <= dayStart && endOf(ev) >= dayEnd) ? allDay : timed).push(ev);
    allDay.sort(byStart); timed.sort(byStart);

    const live = [], upcoming = [], done = [];
    for (const ev of timed) {
      if (ev.startDate > now) upcoming.push(ev);
      else if (now < endOf(ev)) live.push(ev);
      else done.push(ev);                                   // includes point events once their time has passed
    }
    const left = live.length + upcoming.length;
    const main = live.concat(upcoming).slice(0, o.cap);

    // the most recently finished event, if it is fresh enough and there is a free slot
    let recent = null, recentEv = null;
    if (done.length) {
      const last = done.reduce((a, b) => (endOf(b) > endOf(a) || (endOf(b) === endOf(a) && b.startDate > a.startDate) ? b : a));
      const ago = Math.floor((now - endOf(last)) / MIN);
      if (ago <= o.graceMin && main.length < o.cap) { recentEv = last; recent = { kind: "recent", ev: last, endedAgoMin: ago, agoText: agoText(ago) }; }
    }

    const toRow = (ev) => {
      if (ev.startDate <= now) {
        const end = endOf(ev);
        return { kind: "live", ev, minutesLeft: Math.ceil((end - now) / MIN), progress: Math.min(1, Math.max(0, (now - ev.startDate) / (end - ev.startDate))) };
      }
      const m = Math.ceil((ev.startDate - now) / MIN);
      return { kind: "next", ev, startsInMin: m, relText: m < o.relMin ? `in ${dur(m)}` : "" };
    };

    return finish({
      now, left, timedCount: timed.length,
      strips: allDay.slice(0, o.maxStrips), stripOverflow: Math.max(0, allDay.length - o.maxStrips),
      rows: (recent ? [recent] : []).concat(main.map(toRow)),
      moreCount: left - main.length,
      done: done.filter((ev) => ev !== recentEv)
    });
  }

  function shrink(a) {
    const i = a.rows.findIndex((r) => r.kind === "recent");
    if (i >= 0) return finish({ ...a, rows: a.rows.filter((_, k) => k !== i), done: a.done.concat(a.rows[i].ev).sort(byStart) });
    const last = a.rows[a.rows.length - 1];
    if (a.rows.length > 1 && last.kind === "next") return finish({ ...a, rows: a.rows.slice(0, -1), moreCount: a.moreCount + 1 });
    return null;
  }

  function signature(a) {
    return JSON.stringify([a.counter, a.strips.map(keyOf), a.more, a.doneCount,
      a.rows.map((r) => [r.kind, keyOf(r.ev), r.minutesLeft != null ? r.minutesLeft : r.startsInMin != null ? r.startsInMin : r.endedAgoMin, r.relText || r.agoText || ""])]);
  }

  const api = { rank, shrink, signature, dur, agoText, keyOf, DEFAULTS };
  // MagicMirror's window has Node integration (so `module` exists there too): always attach to window
  if (typeof window !== "undefined") window.OpenSkyDayAgenda = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : this);
