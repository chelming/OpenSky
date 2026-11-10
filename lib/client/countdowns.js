/* OpenSky countdowns — which ones show today, and how many days to go. Works in the browser (window.OpenSkyCountdowns)
 * and in Node (require) for tests.
 *
 * An item (cleaned by config/config.js from opensky.json → countdowns.items):
 *   { id, title, date: "YYYY-MM-DD", yearly: bool, photo: bool, color, home: bool }
 * visible(items, now, keepDays) → [{ ...item, days }] soonest first. `days` = calendar days from today (0 = today).
 *   A yearly one (birthday, anniversary) always counts to its next day. Any other one stays for `keepDays` days after its
 *   date (0 = gone the day after), then it is hidden (the settings keep it; change the date to use it again).
 * label(days) → "Today!" · "Tomorrow" · "in 12 days" · "Yesterday" · "3 days ago"
 */
(function (root) {
  const DAY = 86400000;
  const midnight = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const parse = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || "")); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
  const diff = (a, b) => Math.round((midnight(a) - midnight(b)) / DAY);   // (Math.round: a daylight-saving day isn't 24 hours)
  // that month and day in a year (29 Feb in a common year → 28 Feb)
  const inYear = (t, y) => { const d = new Date(y, t.getMonth(), t.getDate()); return d.getMonth() === t.getMonth() ? d : new Date(y, t.getMonth() + 1, 0); };

  function daysTo(item, now) {
    const t = parse(item.date);
    if (!t || isNaN(t)) return null;
    if (!item.yearly) return diff(t, now);
    const this_year = inYear(t, now.getFullYear());
    return diff(diff(this_year, now) < 0 ? inYear(t, now.getFullYear() + 1) : this_year, now);
  }

  function visible(items, now, keepDays) {
    const keep = Math.max(0, Number(keepDays) || 0);
    return (Array.isArray(items) ? items : [])
      .map((it) => ({ ...it, days: daysTo(it, now) }))
      .filter((it) => it.days !== null && it.days >= -keep)
      .sort((a, b) => (a.days < 0) - (b.days < 0) || Math.abs(a.days) - Math.abs(b.days) || String(a.title).localeCompare(String(b.title)));
  }

  function label(days) {
    if (days === 0) return "Today!";
    if (days === 1) return "Tomorrow";
    if (days === -1) return "Yesterday";
    return days > 0 ? `in ${days} days` : `${-days} days ago`;
  }

  const api = { visible, label, daysTo };
  if (typeof window !== "undefined") window.OpenSkyCountdowns = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : this);
