/* OpenSky badges for events that belong to more than one calendar — works in the browser (window.OpenSkyBadges)
 * and in Node (require) for tests. Pure functions, no DOM.
 *
 *   labels(["Quinn", "Reese", "Ryan", "Sam"])  → { Quinn: "Q", Reese: "Re", Ryan: "Ry", Sam: "S" }
 *   badges(people, labelMap, max = 4)          → { shown: [{ …person, label }], extra: N }
 *
 * labels(): a calendar's badge text is its first letter, or — when another calendar starts with the same letter(s) —
 *   the shortest start that is unique (case-insensitive). Compute it ONCE from the family's whole list of calendar
 *   names (opensky.json → calendar.sources + colors.calendars), so "Reese" is "Re" on every event, not only the shared ones.
 *   The same name listed twice counts as one person. Labels can be longer than two characters when names share a long
 *   start (Sam / Samantha → "Sam", "Sama"): the renderer shrinks the badge text for those (see the spec).
 * badges(): `people` must already be in the calendars' settings order (so a pill never reshuffles). Up to `max` people
 *   show as badges; with more, the first `max - 1` show and `extra` = how many are left over (render a "+N" badge).
 *   Each `shown` item is the person object you passed in, plus `label`.
 */
(function (root) {
  // the first n characters (code points, so an emoji or an accented letter is never cut in half)
  const head = (s, n) => Array.from(String(s)).slice(0, n).join("");

  /** names → { name: badge text } */
  function labels(names) {
    const uniq = [...new Set((names || []).map(String).filter(Boolean))];   // the same name twice is one person
    const out = {};
    for (const name of uniq) {
      const len = Array.from(name).length;
      let n = 1;
      while (n < len && uniq.some((o) => o !== name && head(o, n).toLowerCase() === head(name, n).toLowerCase())) n++;
      out[name] = head(name, n);
    }
    return out;
  }

  /** people: [{ name, … }] → { shown: [{ …person, label }], extra } */
  function badges(people, labelMap, max = 4) {
    const list = people || [];
    const keep = list.length > max ? max - 1 : list.length;
    return {
      shown: list.slice(0, keep).map((p) => ({ ...p, label: (labelMap && labelMap[p.name]) || Array.from(String(p.name || "?"))[0].toUpperCase() })),
      extra: list.length - keep
    };
  }

  const api = { labels, badges };
  // MagicMirror's window has Node integration (so `module` exists there too): always attach to window
  if (typeof window !== "undefined") window.OpenSkyBadges = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : this);
