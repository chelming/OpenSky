/* OpenSky shared screen-side helpers (loaded by modules via getScripts: "modules/opensky-lib/client/opensky-client.js").
 * Defines window.OpenSkyEventColors and window.OpenSkyFit. Safe to load more than once.
 */
(function () {
  if (window.OpenSkyEventColors) return;

  /* ---------- Event colors ----------
   * Every event gets a pale background + a solid side bar from a named palette. Choose colors in opensky.json:
   *   calendar.colors.calendars: { "<calendar name>": "blue" }       — all events of one calendar
   *   calendar.colors.rules: [{ "match": "dentist", "color": "indigo" }] — title keywords (case-insensitive)
   *   calendar.sources[].color                                         — a source's own color
   * Anything else gets a palette color picked from its title, so the same title always has the same color. */
  const PALETTE = {
    pink: ["#ffc2e2", "#dd4f98"], green: ["#d7f199", "#78b014"], blue: ["#b9ddff", "#2e8bd6"],
    orange: ["#ffc9a3", "#ec7a2c"], yellow: ["#ffe882", "#cfa000"], emerald: ["#b5edc4", "#2e9e57"],
    purple: ["#cdb4ff", "#7b4ae2"], red: ["#ffb3b3", "#e04848"], teal: ["#95e8d6", "#11998e"],
    indigo: ["#b8c2ff", "#4a5bd8"], tan: ["#efd9b5", "#b8864b"], gray: ["#e5e7eb", "#9ca3af"]
  };
  const AUTO = ["pink", "green", "blue", "orange", "yellow", "emerald"];

  // a color code (#rgb / #rrggbb, any case) → "#rrggbb", else null
  const hexCode = (v) => { const m = String(v == null ? "" : v).trim().toLowerCase().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/); return m ? `#${m[1].length === 3 ? m[1].replace(/./g, "$&$&") : m[1]}` : null; };
  // a palette name or a color code → the name / "#rrggbb", else null
  const colorOf = (v) => (PALETTE[v] ? v : hexCode(v));
  // the pale background that goes with a color code (the palette's pairs are about this light)
  const paleOf = (hex) => `color-mix(in srgb, ${hex} 32%, white)`;

  window.OpenSkyEventColors = {
    PALETTE,
    calendars: {},
    rules: [],
    colorOf,

    /** Called by modules with calendar.colors from the settings (any module may call it; last call wins). */
    configure(colors) {
      if (!colors) return;
      if (colors.calendars && typeof colors.calendars === "object") this.calendars = colors.calendars;
      if (Array.isArray(colors.rules)) {
        this.rules = colors.rules.filter((r) => r && r.match && colorOf(r.color))
          .map((r) => ({ re: new RegExp(String(r.match).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), color: colorOf(r.color) }));
      }
    },

    // Priority: keyword rule → calendar color in settings → the source's own color → a stable palette color.
    // A palette name, or a color code ("#rrggbb") where one was set.
    name(ev) {
      const title = String(ev.title || "").toLowerCase().replace(/\s+/g, " ").trim();
      const rule = this.rules.find((r) => r.re.test(title));
      if (rule) return rule.color;
      const cal = colorOf(this.calendars[ev.calendarName]);
      if (cal) return cal;
      const own = colorOf(ev.colorName);
      if (own) return own;
      let hash = 0;
      for (const ch of title) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
      return AUTO[hash % AUTO.length];
    },

    /** CSS custom properties for an event element: `style="${vars(ev)}"` */
    vars(ev) { const [bg, bar] = this.pair(this.name(ev)), st = this.multi(ev); return `--evc-bg:${bg};--evc-bar:${bar}` + (st ? `;--evc-multi:${st}` : ""); },
    /** An event shared by several calendars (calendar.mergeShared) has ev.colors: a soft gradient of their pale tints
     *  (each color holds a plateau, then blends into the next), else null. The family calendar isn't in ev.colors. */
    multi(ev) {
      const cs = (Array.isArray(ev.colors) ? ev.colors : []).map(hexCode).filter(Boolean);
      if (cs.length < 2) return null;
      const n = cs.length, stops = cs.map((c, i) => `${paleOf(c)} ${Math.round((i + .25) * 100 / n)}%, ${paleOf(c)} ${Math.round((i + .75) * 100 / n)}%`);
      return `linear-gradient(100deg, ${stops.join(", ")})`;
    },
    bar(ev) { return this.pair(this.name(ev))[1]; },
    /** [pale background, solid bar] for a palette name or a color code */
    pair(c) { const h = hexCode(c); return h ? [paleOf(h), h] : (PALETTE[c] || PALETTE.blue); }
  };

  /* ---------- Accent color ----------
   * opensky.json → look.accent: "peach" (the default), a palette color name, or a color code (#rgb / #rrggbb).
   * The same rule as lib/accent.js (the Pi's side). Used by Settings on the screen and the phone setup page. */
  window.OpenSkyAccent = {
    PEACH: "#e8663f",
    /** A palette name, "#rrggbb" (from #rgb or #rrggbb, any case), or null when it's neither. */
    normalize(v) {
      const s = String(v == null ? "" : v).trim().toLowerCase();
      if (s === "peach" || PALETTE[s]) return s;
      const m = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
      return m ? `#${m[1].length === 3 ? m[1].replace(/./g, "$&$&") : m[1]}` : null;
    },
    /** What someone typed into a color-code box ("3b82f6", "#3B82F6", " #abc ") → "#rrggbb", or null. */
    code(v) { const s = String(v || "").trim(); const n = this.normalize(s.startsWith("#") ? s : `#${s}`); return n && n.startsWith("#") ? n : null; },
    /** The color itself: "#rrggbb" for a name or a code. */
    hex(v) { const n = this.normalize(v); return !n || n === "peach" ? this.PEACH : n.startsWith("#") ? n : PALETTE[n][1]; },
    /** Too light for the white text on buttons (contrast below about 3:1)? */
    light(v) {
      const h = this.hex(v), c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
      return 1.05 / (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] + 0.05) < 3;
    }
  };

  /* ---------- Text size ----------
   * opensky.json → look.textSize: the same rule as lib/text-size.js. Used by the Sidebar (scaling), Settings and the phone page. */
  window.OpenSkyTextSize = {
    FACTORS: { small: 0.9, normal: 1, large: 1.15, xlarge: 1.3 },
    LABELS: { small: "Small", normal: "Normal", large: "Large", xlarge: "Extra large" },
    normalize(v) {
      const s = String(v == null ? "" : v).trim().toLowerCase().replace(/[\s_-]/g, "");
      const k = s === "extralarge" ? "xlarge" : s;
      return this.FACTORS[k] ? k : null;
    },
    /** How much bigger (or smaller) than the fitted size; 1 for anything unknown. */
    factor(v) { return this.FACTORS[this.normalize(v)] || 1; }
  };

  /* ---------- Dark mode ----------
   * opensky.json → look.theme: "light" (the default), "dark", "auto" (dark from sunset to sunrise at the configured location,
   * or 19:00 to 07:00 without one) or "system" (the browser's own prefers-color-scheme). look.lightSensor: true lets an ambient light sensor, where the screen has one, overrule the sun.
   * The same rule as lib/theme.js (the Pi side) and config/config.js. Used by the Sidebar (applies it), Settings and the phone page. */
  window.OpenSkyTheme = {
    LABELS: { light: "Light", dark: "Dark", auto: "Auto (by sun)", system: "System" },
    normalize(v) { const s = String(v == null ? "" : v).trim().toLowerCase().replace(/[\s_()-]/g, ""); return s === "light" || s === "dark" || s === "system" ? s : (s === "auto" || s === "autobysun" ? "auto" : null); },
    /** { rise, set } as Dates for the local day of `date` at latitude / longitude (east positive); null without a usable
     *  location; { polar: "day" | "night" } where the sun never sets / rises. NOAA's sunrise equation, good to a few minutes. */
    sunTimes(date, lat, lon) {
      if (typeof lat !== "number" || typeof lon !== "number" || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
      const rad = Math.PI / 180, noon = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
      const n = Math.round(noon.getTime() / 86400000 + 2440587.5 - 2451545 + 0.0008), js = n - lon / 360;
      const M = (357.5291 + 0.98560028 * js) % 360, C = 1.9148 * Math.sin(M * rad) + 0.02 * Math.sin(2 * M * rad) + 0.0003 * Math.sin(3 * M * rad);
      const L = (M + C + 180 + 102.9372) % 360, jt = 2451545 + js + 0.0053 * Math.sin(M * rad) - 0.0069 * Math.sin(2 * L * rad);
      const sd = Math.sin(L * rad) * Math.sin(23.4397 * rad), cd = Math.cos(Math.asin(sd));
      const cw = (Math.sin(-0.833 * rad) - Math.sin(lat * rad) * sd) / (Math.cos(lat * rad) * cd);
      if (cw > 1) return { polar: "night" };
      if (cw < -1) return { polar: "day" };
      const w = Math.acos(cw) / rad, at = (j) => new Date((j - 2440587.5) * 86400000);
      return { rise: at(jt - w / 360), set: at(jt + w / 360) };
    },
    /** Is it dark now by the sun? Without a location: 19:00 to 07:00. */
    darkBySun(now, lat, lon) {
      const t = this.sunTimes(now, lat, lon);
      if (t && t.polar) return t.polar === "night";
      if (t) {
        // The browser's calendar day isn't always the place's day (a UTC container, a location far east or west), so look at the
        // sunrises and sunsets of the days around now and go by the latest one that has passed.
        const ev = [];
        for (const d of [-1, 0, 1]) {
          const x = this.sunTimes(new Date(now.getTime() + d * 86400000), lat, lon);
          if (x && x.rise) ev.push([x.rise.getTime(), false], [x.set.getTime(), true]);
        }
        const past = ev.filter((e) => e[0] <= now.getTime()).sort((a, b) => b[0] - a[0])[0];
        if (past) return past[1];   // last event was a sunset → dark; a sunrise → light
        return now < t.rise || now >= t.set;
      }
      return now.getHours() >= 19 || now.getHours() < 7;
    },
    /** The look to show: mode "light" | "dark" | "auto" | "system"; lux = a fresh light-sensor reading or null; was = the look shown now (hysteresis). */
    isDark(mode, now, lat, lon, lux, was, systemDark) {
      const m = this.normalize(mode) || "light";
      if (m === "system") return !!systemDark;   // the browser's own light/dark setting (Sidebar passes matchMedia's answer)
      if (m !== "auto") return m === "dark";
      if (typeof lux === "number" && Number.isFinite(lux)) return lux < 5 ? true : lux > 30 ? false : !!was;   // dim room = dark, bright = light, between = unchanged
      return this.darkBySun(now, lat, lon);
    }
  };

  /* ---------- Two-line event names, only where there's room ----------
   * A cut-off title may wrap to a second line, but only if that can't push another event out of view. */
  window.OpenSkyFit = {
    truncated(el) { return !!el && el.scrollWidth > el.clientWidth + 1; },

    // Widen cut-off titles one at a time while `fits()` stays true (Home day tiles)
    grow(pills, titleSel, fits) {
      for (const pill of pills) {
        if (!this.truncated(pill.querySelector(titleSel))) continue;
        pill.classList.add("mf-two");
        if (!fits()) { pill.classList.remove("mf-two"); break; }
      }
    },

    // Month view: one week's event layer. CalendarExt3 places events in a grid of --maxeventlines rows
    // (grid-auto-flow: column dense); a single-day event may span 2 rows if its day has a free row.
    cx3Week(layer) {
      const evs = [...layer.querySelectorAll(":scope > .event")];
      const reset = (e) => { e.classList.remove("mf-two"); e.style.gridRow = ""; };
      evs.forEach(reset);
      const cx3 = layer.closest(".CX3");
      const lines = parseInt(getComputedStyle(cx3).getPropertyValue("--maxeventlines"), 10) || 3;
      const cols = (e) => { const m = (e.style.gridColumn || "").match(/(\d+)\s*\/\s*(\d+)/); return m ? [+m[1], +m[2]] : null; };
      const used = {};
      evs.forEach((e) => { const c = cols(e); if (c) for (let i = c[0]; i < c[1]; i++) used[i] = (used[i] || 0) + 1; });
      const shown = () => evs.filter((e) => e.getBoundingClientRect().height > 1).length;
      const before = shown();
      const changed = [];
      evs.forEach((e) => {
        const c = cols(e);
        if (!c || c[1] - c[0] !== 1 || used[c[0]] + 1 > lines) return;
        if (!this.truncated(e.querySelector(".title"))) return;
        used[c[0]]++;
        e.classList.add("mf-two");
        e.style.gridRow = "span 2";
        changed.push(e);
      });
      if (!changed.length) return;
      // Safety net: if anything got hidden or clipped, undo this week
      const box = layer.getBoundingClientRect();
      if (shown() < before || evs.some((e) => { const r = e.getBoundingClientRect(); return r.height > 1 && r.bottom > box.bottom + 1; })) changed.forEach(reset);
    },

    cx3All() {
      document.querySelectorAll(".CX3 .week .eventContainer").forEach((layer) => {
        if (layer.getBoundingClientRect().width > 0) this.cx3Week(layer);   // only while the page is visible
      });
    }
  };

  /* Shared toast: OpenSkyToast("Saved", "success" | "error" | "info"). Styles: css/opensky.css (.os-toast). */
  let toastTimer = null;
  window.OpenSkyToast = function (message, type = "info") {
    let toast = document.querySelector(".os-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.className = "os-toast";
      toast.setAttribute("role", "status");
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.dataset.type = type;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), type === "error" ? 5000 : 2500);
  };

  /* One list as a column (Home's lists card, the Lists page). Styles: lib/client/list-columns.css.
   * list = { id, title, color, items: [{ id, text, done? }], loaded, error }
   * on = { add(), check(item, row), edit(item) } — the caller sends OPENSKY_LIST_ADD / _CHECK / _EDIT. */
  const svg = (paths, w = 2.4) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
  window.OpenSkyListColumn = {
    render(list, on, { alt = false } = {}) {
      const col = document.createElement("div");
      col.className = "lc-list" + (alt ? " alt" : "");   // default colors alternate blue, peach, blue…
      const EC = window.OpenSkyEventColors, c = EC && EC.colorOf(list.color);
      if (c) {                                             // a palette name or a color code → accent, pale tint, dark text
        const solid = EC.pair(c)[1];
        col.style.setProperty("--list-accent", solid);
        col.style.setProperty("--list-tint", `color-mix(in srgb, ${solid} 7%, white)`);
        col.style.setProperty("--list-dark", `color-mix(in srgb, ${solid} 78%, black)`);
      }
      const items = list.items || [];
      col.innerHTML = `
        <div class="lc-list-head"><span class="lc-list-title"></span><span class="lc-badge">${items.filter((it) => !it.done).length}</span><button class="lc-add-item" aria-label="Add item">${svg(`<path d="M12 5v14M5 12h14"/>`, 2.6)}</button></div>
        <div class="lc-items"></div>`;
      col.querySelector(".lc-list-title").textContent = list.title || "List";
      col.querySelector(".lc-add-item").onclick = () => on.add();
      const box = col.querySelector(".lc-items");
      if (list.loaded === false) box.innerHTML = `<div class="lc-empty">Loading…</div>`;
      else if (list.error && !items.length) {
        box.innerHTML = `<div class="lc-empty lc-list-error"></div>`;
        box.firstChild.textContent = list.error;
      } else if (!items.length) {
        // (no emoji: Raspberry Pi OS has no color-emoji font)
        box.innerHTML = `<div class="lc-empty lc-all-done">${svg(`<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.8 2.8L16.5 9.5"/>`)}All done!</div>`;
      }
      items.forEach((item) => {
        const row = document.createElement("div");
        row.className = "lc-item" + (item.done ? " is-done" : "");
        row.innerHTML = `<button class="lc-check" aria-label="Check off"></button><span class="lc-item-text"></span>`;
        row.querySelector(".lc-item-text").textContent = item.text;
        row.querySelector(".lc-check").onclick = () => { if (!item.done) on.check(item, row); };
        row.querySelector(".lc-item-text").onclick = () => { if (!item.done) on.edit(item); };
        box.appendChild(row);
      });
      return col;
    }
  };

  /* One icon set for the sidebar, Settings and the phone page: 24×24, 2 px round strokes (Lucide-style).
   * OpenSkyIcons.svg(name) → an <svg>; OpenSkyIcons.webPage = the icons a family can pick for a web page. */
  const ICONS = {
    calendar: '<rect x="3" y="4.5" width="18" height="16.5" rx="3"/><path d="M8 2.5v4M16 2.5v4M3 9.5h18"/><path d="M8 13.5h.01M12 13.5h.01M16 13.5h.01M8 17.5h.01M12 17.5h.01"/>',
    lists: '<path d="M3.5 6.5l1.5 1.5 3-3M3.5 12.5l1.5 1.5 3-3M3.5 18.5l1.5 1.5 3-3"/><path d="M12 7h8.5M12 13h8.5M12 19h8.5"/>',
    countdowns: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M5 12v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8M7.5 8a2.5 2.5 0 0 1 0-5C10 3 12 8 12 8s2-5 4.5-5a2.5 2.5 0 0 1 0 5"/>',
    food: '<path d="M5 3v7a2 2 0 0 0 2 2h1v9M10 3v7M7.5 3v6"/><path d="M18 21V3c-2.2 0-4 2.2-4 6v4h4"/>',
    wordgame: '<rect x="3" y="3" width="5" height="5" rx="1.2"/><rect x="9.5" y="3" width="5" height="5" rx="1.2"/><rect x="16" y="3" width="5" height="5" rx="1.2"/><rect x="3" y="9.5" width="5" height="5" rx="1.2"/><rect x="9.5" y="9.5" width="5" height="5" rx="1.2"/><rect x="16" y="9.5" width="5" height="5" rx="1.2"/><path d="M3 18.5h18"/>',
    smarthome: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9v10.5A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V9"/><path d="M8.8 14.2a4.5 4.5 0 0 1 6.4 0M10.4 16.3a2.2 2.2 0 0 1 3.2 0"/><path d="M12 18.4h.01"/>',
    embed: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 9h18M7 6.5h.01M10 6.5h.01"/>',
    chores: '<rect x="5" y="4" width="14" height="17" rx="2.5"/><path d="M9 4V3h6v1M8.5 12.5l2.2 2.2 4-4.4"/>',
    timer: '<path d="M10 2h4M12 14l3-3"/><circle cx="12" cy="14" r="8"/>',
    sleep: '<path d="M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a6.5 6.5 0 0 0 11 11z"/>',
    settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    camera: '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/>',
    play: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M10 9l5 3-5 3z"/>',
    music: '<path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
    cart: '<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2.5 3.5h3l2.4 11.2a1.5 1.5 0 0 0 1.5 1.2h8.2a1.5 1.5 0 0 0 1.5-1.1l1.6-6.3H6.4"/>',
    school: '<path d="M2 9.5 12 5l10 4.5-10 4.5z"/><path d="M6 11.5V16c0 1.5 2.7 3 6 3s6-1.5 6-3v-4.5"/><path d="M22 9.5v5"/>',
    briefcase: '<rect x="3" y="7" width="18" height="13" rx="2.5"/><path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M3 12.5h18"/>',
    heart: '<path d="M12 20s-7.5-4.6-9.2-9.3C1.7 7.6 3.9 4.5 7 4.5c2 0 3.5 1.1 5 3 1.5-1.9 3-3 5-3 3.1 0 5.3 3.1 4.2 6.2C19.5 15.4 12 20 12 20z"/>',
    chart: '<path d="M4 20h16"/><rect x="5.5" y="11" width="3" height="6.5" rx="1"/><rect x="10.5" y="6.5" width="3" height="11" rx="1"/><rect x="15.5" y="9" width="3" height="8.5" rx="1"/>',
    cloud: '<path d="M7 18.5h10a4.5 4.5 0 0 0 .6-9 6 6 0 0 0-11.4 1.6A3.8 3.8 0 0 0 7 18.5z"/>',
    car: '<path d="M5 16.5V12l2-5h10l2 5v4.5"/><path d="M3.5 16.5h17v2.5h-3v-2.5M6.5 19v-2.5"/><circle cx="7.5" cy="13.5" r=".9"/><circle cx="16.5" cy="13.5" r=".9"/><path d="M5 12h14"/>',
    paw: '<circle cx="7" cy="10" r="1.8"/><circle cx="10.5" cy="6.5" r="1.8"/><circle cx="14.5" cy="6.5" r="1.8"/><circle cx="18" cy="10" r="1.8"/><path d="M12 12c-2.8 0-5 2.9-5 5.2 0 1.6 1.3 2.3 2.7 2.3 1 0 1.6-.5 2.3-.5s1.3.5 2.3.5c1.4 0 2.7-.7 2.7-2.3C17 14.9 14.8 12 12 12z"/>',
    devices: '<path d="M9 18h6M10 21.5h4"/><path d="M12 2.5a6.5 6.5 0 0 0-3.8 11.8c.5.4.8 1 .8 1.7V16.5h6V16c0-.7.3-1.3.8-1.7A6.5 6.5 0 0 0 12 2.5z"/>',
    plug: '<path d="M9 2.5v5M15 2.5v5"/><path d="M6 7.5h12v4a6 6 0 0 1-12 0z"/><path d="M12 17.5v4"/>',
    padlock: '<rect x="4.5" y="10.5" width="15" height="10.5" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/><path d="M12 15v2"/>',
    padlockOpen: '<rect x="4.5" y="10.5" width="15" height="10.5" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 7.6-1.7"/><path d="M12 15v2"/>',
    gauge: '<path d="M4.5 18a8.5 8.5 0 1 1 15 0"/><path d="M12 14l3.5-5"/><circle cx="12" cy="14.5" r="1"/>',
    book: '<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v15H5.5A1.5 1.5 0 0 0 4 20.5zM20 5.5A1.5 1.5 0 0 0 18.5 4H13v15h5.5a1.5 1.5 0 0 1 1.5 1.5z"/>',
    // Tabler Icons (outline, MIT licence, https://tabler.io/icons), more choices for web pages
    video: '<path d="M15 10l4.553 -2.276a1 1 0 0 1 1.447 .894v6.764a1 1 0 0 1 -1.447 .894l-4.553 -2.276v-4z" /> <path d="M3 6m0 2a2 2 0 0 1 2 -2h8a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-8a2 2 0 0 1 -2 -2z" />',
    bulb: '<path d="M3 12h1m8 -9v1m8 8h1m-15.4 -6.4l.7 .7m12.1 -.7l-.7 .7" /> <path d="M9 16a5 5 0 1 1 6 0a3.5 3.5 0 0 0 -1 3a2 2 0 0 1 -4 0a3.5 3.5 0 0 0 -1 -3" /> <path d="M9.7 17l4.6 0" />',
    flame: '<path d="M12 10.941c2.333 -3.308 .167 -7.823 -1 -8.941c0 3.395 -2.235 5.299 -3.667 6.706c-1.43 1.408 -2.333 3.621 -2.333 5.588c0 3.704 3.134 6.706 7 6.706s7 -3.002 7 -6.706c0 -1.712 -1.232 -4.403 -2.333 -5.588c-2.084 3.353 -3.257 3.353 -4.667 2.235" />',
    thermometer: '<path d="M19 5a2.828 2.828 0 0 1 0 4l-8 8h-4v-4l8 -8a2.828 2.828 0 0 1 4 0z" /> <path d="M16 7l-1.5 -1.5" /> <path d="M13 10l-1.5 -1.5" /> <path d="M10 13l-1.5 -1.5" /> <path d="M7 17l-3 3" />',
    wifi: '<path d="M12 18l.01 0" /> <path d="M9.172 15.172a4 4 0 0 1 5.656 0" /> <path d="M6.343 12.343a8 8 0 0 1 11.314 0" /> <path d="M3.515 9.515c4.686 -4.687 12.284 -4.687 17 0" />',
    router: '<path d="M3 13m0 2a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v4a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2z" /> <path d="M17 17l0 .01" /> <path d="M13 17l0 .01" /> <path d="M15 13l0 -2" /> <path d="M11.75 8.75a4 4 0 0 1 6.5 0" /> <path d="M8.5 6.5a8 8 0 0 1 13 0" />',
    server: '<path d="M3 4m0 3a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v2a3 3 0 0 1 -3 3h-12a3 3 0 0 1 -3 -3z" /> <path d="M3 12m0 3a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v2a3 3 0 0 1 -3 3h-12a3 3 0 0 1 -3 -3z" /> <path d="M7 8l0 .01" /> <path d="M7 16l0 .01" />',
    database: '<path d="M12 6m-8 0a8 3 0 1 0 16 0a8 3 0 1 0 -16 0" /> <path d="M4 6v6a8 3 0 0 0 16 0v-6" /> <path d="M4 12v6a8 3 0 0 0 16 0v-6" />',
    terminal: '<path d="M8 9l3 3l-3 3" /> <path d="M13 15l3 0" /> <path d="M3 4m0 2a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2z" />',
    shield: '<path d="M11.46 20.846a12 12 0 0 1 -7.96 -14.846a12 12 0 0 0 8.5 -3a12 12 0 0 0 8.5 3a12 12 0 0 1 -.09 7.06" /> <path d="M15 19l2 2l4 -4" />',
    key: '<path d="M16.555 3.843l3.602 3.602a2.877 2.877 0 0 1 0 4.069l-2.643 2.643a2.877 2.877 0 0 1 -4.069 0l-.301 -.301l-6.558 6.558a2 2 0 0 1 -1.239 .578l-.175 .008h-1.172a1 1 0 0 1 -.993 -.883l-.007 -.117v-1.172a2 2 0 0 1 .467 -1.284l.119 -.13l.414 -.414h2v-2h2v-2l2.144 -2.144l-.301 -.301a2.877 2.877 0 0 1 0 -4.069l2.643 -2.643a2.877 2.877 0 0 1 4.069 0z" /> <path d="M15 9h.01" />',
    cpu: '<path d="M5 5m0 1a1 1 0 0 1 1 -1h12a1 1 0 0 1 1 1v12a1 1 0 0 1 -1 1h-12a1 1 0 0 1 -1 -1z" /> <path d="M9 9h6v6h-6z" /> <path d="M3 10h2" /> <path d="M3 14h2" /> <path d="M10 3v2" /> <path d="M14 3v2" /> <path d="M21 10h-2" /> <path d="M21 14h-2" /> <path d="M14 21v-2" /> <path d="M10 21v-2" />',
    tv: '<path d="M3 7m0 2a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v9a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2z" /> <path d="M16 3l-4 4l-4 -4" />',
    desktop: '<path d="M3 5a1 1 0 0 1 1 -1h16a1 1 0 0 1 1 1v10a1 1 0 0 1 -1 1h-16a1 1 0 0 1 -1 -1v-10z" /> <path d="M7 20h10" /> <path d="M9 16v4" /> <path d="M15 16v4" />',
    gamepad: '<path d="M12 5h3.5a5 5 0 0 1 0 10h-5.5l-4.015 4.227a2.3 2.3 0 0 1 -3.923 -2.035l1.634 -8.173a5 5 0 0 1 4.904 -4.019h3.4z" /> <path d="M14 15l4.07 4.284a2.3 2.3 0 0 0 3.925 -2.023l-1.6 -8.232" /> <path d="M8 9v2" /> <path d="M7 10h2" /> <path d="M14 10h2" />',
    headphones: '<path d="M4 13m0 2a2 2 0 0 1 2 -2h1a2 2 0 0 1 2 2v3a2 2 0 0 1 -2 2h-1a2 2 0 0 1 -2 -2z" /> <path d="M15 13m0 2a2 2 0 0 1 2 -2h1a2 2 0 0 1 2 2v3a2 2 0 0 1 -2 2h-1a2 2 0 0 1 -2 -2z" /> <path d="M4 15v-3a8 8 0 0 1 16 0v3" />',
    microphone: '<path d="M9 2m0 3a3 3 0 0 1 3 -3h0a3 3 0 0 1 3 3v5a3 3 0 0 1 -3 3h0a3 3 0 0 1 -3 -3z" /> <path d="M5 10a7 7 0 0 0 14 0" /> <path d="M8 21l8 0" /> <path d="M12 17l0 4" />',
    speaker: '<path d="M18 8a3 3 0 0 1 0 6" /> <path d="M10 8v11a1 1 0 0 1 -1 1h-1a1 1 0 0 1 -1 -1v-5" /> <path d="M12 8h0l4.524 -3.77a.9 .9 0 0 1 1.476 .692v12.156a.9 .9 0 0 1 -1.476 .692l-4.524 -3.77h-8a1 1 0 0 1 -1 -1v-4a1 1 0 0 1 1 -1h8" />',
    photo: '<path d="M15 8h.01" /> <path d="M3 6a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v12a3 3 0 0 1 -3 3h-12a3 3 0 0 1 -3 -3v-12z" /> <path d="M3 16l5 -5c.928 -.893 2.072 -.893 3 0l5 5" /> <path d="M14 14l1 -1c.928 -.893 2.072 -.893 3 0l3 3" />',
    movie: '<path d="M4 4m0 2a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2z" /> <path d="M8 4l0 16" /> <path d="M16 4l0 16" /> <path d="M4 8l4 0" /> <path d="M4 16l4 0" /> <path d="M4 12l16 0" /> <path d="M16 8l4 0" /> <path d="M16 16l4 0" />',
    map: '<path d="M3 7l6 -3l6 3l6 -3v13l-6 3l-6 -3l-6 3v-13" /> <path d="M9 4v13" /> <path d="M15 7v13" />',
    pin: '<path d="M9 11a3 3 0 1 0 6 0a3 3 0 0 0 -6 0" /> <path d="M17.657 16.657l-4.243 4.243a2 2 0 0 1 -2.827 0l-4.244 -4.243a8 8 0 1 1 11.314 0z" />',
    plane: '<path d="M16 10h4a2 2 0 0 1 0 4h-4l-4 7h-3l2 -7h-4l-2 2h-3l2 -4l-2 -4h3l2 2h4l-2 -7h3z" />',
    bike: '<path d="M5 18m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0" /> <path d="M19 18m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0" /> <path d="M12 19l0 -4l-3 -3l5 -4l2 3l3 0" /> <path d="M17 5m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" />',
    run: '<path d="M13 4m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" /> <path d="M4 17l5 1l.75 -1.5" /> <path d="M15 21l0 -4l-4 -3l1 -6" /> <path d="M7 12l0 -3l5 -1l3 3l3 1" />',
    barbell: '<path d="M2 12h1" /> <path d="M6 8h-2a1 1 0 0 0 -1 1v6a1 1 0 0 0 1 1h2" /> <path d="M6 7v10a1 1 0 0 0 1 1h1a1 1 0 0 0 1 -1v-10a1 1 0 0 0 -1 -1h-1a1 1 0 0 0 -1 1z" /> <path d="M9 12h6" /> <path d="M15 7v10a1 1 0 0 0 1 1h1a1 1 0 0 0 1 -1v-10a1 1 0 0 0 -1 -1h-1a1 1 0 0 0 -1 1z" /> <path d="M18 8h2a1 1 0 0 1 1 1v6a1 1 0 0 1 -1 1h-2" /> <path d="M22 12h-1" />',
    pulse: '<path d="M19.5 13.572l-7.5 7.428l-2.896 -2.868m-6.117 -8.104a5 5 0 0 1 9.013 -3.022a5 5 0 1 1 7.5 6.572" /> <path d="M3 13h2l2 3l2 -6l1 3h3" />',
    pill: '<path d="M4.5 12.5l8 -8a4.94 4.94 0 0 1 7 7l-8 8a4.94 4.94 0 0 1 -7 -7" /> <path d="M8.5 8.5l7 7" />',
    tools: '<path d="M3 21h4l13 -13a1.5 1.5 0 0 0 -4 -4l-13 13v4" /> <path d="M14.5 5.5l4 4" /> <path d="M12 8l-5 -5l-4 4l5 5" /> <path d="M7 8l-1.5 1.5" /> <path d="M16 12l5 5l-4 4l-5 -5" /> <path d="M16 17l-1.5 1.5" />',
    bolt: '<path d="M13 3l0 7l6 0l-8 11l0 -7l-6 0l8 -11" />',
    solar: '<path d="M4.28 14h15.44a1 1 0 0 0 .97 -1.243l-1.5 -6a1 1 0 0 0 -.97 -.757h-12.44a1 1 0 0 0 -.97 .757l-1.5 6a1 1 0 0 0 .97 1.243z" /> <path d="M4 10h16" /> <path d="M10 6l-1 8" /> <path d="M14 6l1 8" /> <path d="M12 14v4" /> <path d="M7 18h10" />',
    sun: '<path d="M12 12m-4 0a4 4 0 1 0 8 0a4 4 0 1 0 -8 0" /> <path d="M3 12h1m8 -9v1m8 8h1m-9 8v1m-6.4 -15.4l.7 .7m12.1 -.7l-.7 .7m0 11.4l.7 .7m-12.1 -.7l-.7 .7" />',
    moon: '<path d="M12 3c.132 0 .263 0 .393 0a7.5 7.5 0 0 0 7.92 12.446a9 9 0 1 1 -8.313 -12.454z" />',
    plant: '<path d="M7 15h10v4a2 2 0 0 1 -2 2h-6a2 2 0 0 1 -2 -2v-4z" /> <path d="M12 9a6 6 0 0 0 -6 -6h-3v2a6 6 0 0 0 6 6h3" /> <path d="M12 11a6 6 0 0 1 6 -6h3v1a6 6 0 0 1 -6 6h-3" /> <path d="M12 15l0 -6" />',
    tree: '<path d="M16 5l3 3l-2 1l4 4l-3 1l4 4h-9" /> <path d="M15 21l0 -3" /> <path d="M8 13l-2 -2" /> <path d="M8 12l2 -2" /> <path d="M8 21v-13" /> <path d="M5.824 16a3 3 0 0 1 -2.743 -3.69a3 3 0 0 1 .304 -4.833a3 3 0 0 1 4.615 -3.707a3 3 0 0 1 4.614 3.707a3 3 0 0 1 .305 4.833a3 3 0 0 1 -2.919 3.695h-4z" />',
    droplet: '<path d="M7.502 19.423c2.602 2.105 6.395 2.105 8.996 0c2.602 -2.105 3.262 -5.708 1.566 -8.546l-4.89 -7.26c-.42 -.625 -1.287 -.803 -1.936 -.397a1.376 1.376 0 0 0 -.41 .397l-4.893 7.26c-1.695 2.838 -1.035 6.441 1.567 8.546z" />',
    wind: '<path d="M5 8h8.5a2.5 2.5 0 1 0 -2.34 -3.24" /> <path d="M3 12h15.5a2.5 2.5 0 1 1 -2.34 3.24" /> <path d="M4 16h5.5a2.5 2.5 0 1 1 -2.34 3.24" />',
    snowflake: '<path d="M10 4l2 1l2 -1" /> <path d="M12 2v6.5l3 1.72" /> <path d="M17.928 6.268l.134 2.232l1.866 1.232" /> <path d="M20.66 7l-5.629 3.25l.01 3.458" /> <path d="M19.928 14.268l-1.866 1.232l-.134 2.232" /> <path d="M20.66 17l-5.629 -3.25l-2.99 1.738" /> <path d="M14 20l-2 -1l-2 1" /> <path d="M12 22v-6.5l-3 -1.72" /> <path d="M6.072 17.732l-.134 -2.232l-1.866 -1.232" /> <path d="M3.34 17l5.629 -3.25l-.01 -3.458" /> <path d="M4.072 9.732l1.866 -1.232l.134 -2.232" /> <path d="M3.34 7l5.629 3.25l2.99 -1.738" />',
    bed: '<path d="M7 9m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" /> <path d="M22 17v-3h-20" /> <path d="M2 8v9" /> <path d="M12 14h10v-2a3 3 0 0 0 -3 -3h-7v5z" />',
    bath: '<path d="M4 12h16a1 1 0 0 1 1 1v3a4 4 0 0 1 -4 4h-10a4 4 0 0 1 -4 -4v-3a1 1 0 0 1 1 -1z" /> <path d="M6 12v-7a2 2 0 0 1 2 -2h3v2.25" /> <path d="M4 21l1 -1.5" /> <path d="M20 21l-1 -1.5" />',
    shoppingbag: '<path d="M6.331 8h11.339a2 2 0 0 1 1.977 2.304l-1.255 8.152a3 3 0 0 1 -2.966 2.544h-6.852a3 3 0 0 1 -2.965 -2.544l-1.255 -8.152a2 2 0 0 1 1.977 -2.304z" /> <path d="M9 11v-5a3 3 0 0 1 6 0v5" />',
    wallet: '<path d="M17 8v-3a1 1 0 0 0 -1 -1h-10a2 2 0 0 0 0 4h12a1 1 0 0 1 1 1v3m0 4v3a1 1 0 0 1 -1 1h-12a2 2 0 0 1 -2 -2v-12" /> <path d="M20 12v4h-4a2 2 0 0 1 0 -4h4" />',
    coin: '<path d="M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0" /> <path d="M14.8 9a2 2 0 0 0 -1.8 -1h-2a2 2 0 1 0 0 4h2a2 2 0 1 1 0 4h-2a2 2 0 0 1 -1.8 -1" /> <path d="M12 7v10" />',
    news: '<path d="M16 6h3a1 1 0 0 1 1 1v11a2 2 0 0 1 -4 0v-13a1 1 0 0 0 -1 -1h-10a1 1 0 0 0 -1 1v12a3 3 0 0 0 3 3h11" /> <path d="M8 8l4 0" /> <path d="M8 12l4 0" /> <path d="M8 16l4 0" />',
    mail: '<path d="M3 7a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-10z" /> <path d="M3 7l9 6l9 -6" />',
    message: '<path d="M3 20l1.3 -3.9c-2.324 -3.437 -1.426 -7.872 2.1 -10.374c3.526 -2.501 8.59 -2.296 11.845 .48c3.255 2.777 3.695 7.266 1.029 10.501c-2.666 3.235 -7.615 4.215 -11.574 2.293l-4.7 1" />',
    phone: '<path d="M5 4h4l2 5l-2.5 1.5a11 11 0 0 0 5 5l1.5 -2.5l5 2v4a2 2 0 0 1 -2 2a16 16 0 0 1 -15 -15a2 2 0 0 1 2 -2" />',
    users: '<path d="M9 7m-4 0a4 4 0 1 0 8 0a4 4 0 1 0 -8 0" /> <path d="M3 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2" /> <path d="M16 3.13a4 4 0 0 1 0 7.75" /> <path d="M21 21v-2a4 4 0 0 0 -3 -3.85" />',
    baby: '<path d="M8 19m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" /> <path d="M18 19m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" /> <path d="M2 5h2.5l1.632 4.897a6 6 0 0 0 5.693 4.103h2.675a5.5 5.5 0 0 0 0 -11h-.5v6" /> <path d="M6 9h14" /> <path d="M9 17l1 -3" /> <path d="M16 14l1 3" />',
    dog: '<path d="M11 5h2" /> <path d="M19 12c-.667 5.333 -2.333 8 -5 8h-4c-2.667 0 -4.333 -2.667 -5 -8" /> <path d="M11 16c0 .667 .333 1 1 1s1 -.333 1 -1h-2z" /> <path d="M12 18v2" /> <path d="M10 11v.01" /> <path d="M14 11v.01" /> <path d="M5 4l6 .97l-6.238 6.688a1.021 1.021 0 0 1 -1.41 .111a.953 .953 0 0 1 -.327 -.954l1.975 -6.815z" /> <path d="M19 4l-6 .97l6.238 6.688c.358 .408 .989 .458 1.41 .111a.953 .953 0 0 0 .327 -.954l-1.975 -6.815z" />',
    cat: '<path d="M20 3v10a8 8 0 1 1 -16 0v-10l3.432 3.432a7.963 7.963 0 0 1 4.568 -1.432c1.769 0 3.403 .574 4.728 1.546l3.272 -3.546z" /> <path d="M2 16h5l-4 4" /> <path d="M22 16h-5l4 4" /> <path d="M12 16m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" /> <path d="M9 11v.01" /> <path d="M15 11v.01" />',
    fish: '<path d="M16.69 7.44a6.973 6.973 0 0 0 -1.69 4.56c0 1.747 .64 3.345 1.699 4.571" /> <path d="M2 9.504c7.715 8.647 14.75 10.265 20 2.498c-5.25 -7.761 -12.285 -6.142 -20 2.504" /> <path d="M18 11v.01" /> <path d="M11.5 10.5c-.667 1 -.667 2 0 3" />',
    door: '<path d="M14 12v.01" /> <path d="M3 21h18" /> <path d="M6 21v-16a2 2 0 0 1 2 -2h8a2 2 0 0 1 2 2v16" />',
    window: '<path d="M12 3c-3.866 0 -7 3.272 -7 7v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1 -1v-10c0 -3.728 -3.134 -7 -7 -7z" /> <path d="M5 13l14 0" /> <path d="M12 3l0 18" />',
    washing: '<path d="M5 3m0 2a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2z" /> <path d="M12 14m-4 0a4 4 0 1 0 8 0a4 4 0 1 0 -8 0" /> <path d="M8 6h.01" /> <path d="M11 6h.01" /> <path d="M14 6h2" /> <path d="M8 14c1.333 -.667 2.667 -.667 4 0c1.333 .667 2.667 .667 4 0" />',
    trash: '<path d="M4 7l16 0" /> <path d="M10 11l0 6" /> <path d="M14 11l0 6" /> <path d="M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12" /> <path d="M9 7v-3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3" />',
    pool: '<path d="M2 20a2.4 2.4 0 0 0 2 1a2.4 2.4 0 0 0 2 -1a2.4 2.4 0 0 1 2 -1a2.4 2.4 0 0 1 2 1a2.4 2.4 0 0 0 2 1a2.4 2.4 0 0 0 2 -1a2.4 2.4 0 0 1 2 -1a2.4 2.4 0 0 1 2 1a2.4 2.4 0 0 0 2 1a2.4 2.4 0 0 0 2 -1" /> <path d="M2 16a2.4 2.4 0 0 0 2 1a2.4 2.4 0 0 0 2 -1a2.4 2.4 0 0 1 2 -1a2.4 2.4 0 0 1 2 1a2.4 2.4 0 0 0 2 1a2.4 2.4 0 0 0 2 -1a2.4 2.4 0 0 1 2 -1a2.4 2.4 0 0 1 2 1a2.4 2.4 0 0 0 2 1a2.4 2.4 0 0 0 2 -1" /> <path d="M15 12v-7.5a1.5 1.5 0 0 1 3 0" /> <path d="M9 12v-7.5a1.5 1.5 0 0 0 -3 0" /> <path d="M15 5l-6 0" /> <path d="M9 10l6 0" />',
    music2: '<path d="M14 17m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0" /> <path d="M17 17v-13h4" /> <path d="M13 5h-10" /> <path d="M3 9l10 0" /> <path d="M9 13h-6" />',
    radio: '<path d="M14 3l-9.371 3.749a1 1 0 0 0 -.629 .928v11.323a1 1 0 0 0 1 1h14a1 1 0 0 0 1 -1v-11a1 1 0 0 0 -1 -1h-14.5" /> <path d="M4 12h16" /> <path d="M7 12v-2" /> <path d="M17 16v.01" /> <path d="M13 16v.01" />',
  };
  window.OpenSkyIcons = {
    paths: ICONS,
    webPage: ["embed", "smarthome", "globe", "camera", "play", "music", "cart", "food", "school", "briefcase", "heart", "chart", "cloud", "car", "paw", "book",
      "video", "bulb", "flame", "thermometer", "wifi", "router", "server", "database", "terminal", "shield", "key", "cpu", "tv", "desktop", "gamepad", "headphones", "microphone", "speaker", "photo", "movie", "map", "pin", "plane", "bike", "run", "barbell", "pulse", "pill", "tools", "bolt", "solar", "sun", "moon", "plant", "tree", "droplet", "wind", "snowflake", "bed", "bath", "shoppingbag", "wallet", "coin", "news", "mail", "message", "phone", "users", "baby", "dog", "cat", "fish", "door", "window", "washing", "trash", "pool", "music2", "radio"],
    svg(name) { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ICONS.embed}</svg>`; }
  };

  /* ---------- Come back by itself after a restart ----------
   * "Restart OpenSky" (or saving in Settings) takes the server down for a few seconds. A page that was open then sits on an
   * error / 404 forever. This asks the server for the page every few seconds; once it has seen it fail (down, or a 404 from a
   * server that is still starting) and then answer again, it reloads, so nobody has to pull or press F5.
   * watch({ check, reload, every }): check() → Promise<boolean> (true = the server answers the page properly). Returns stop(). */
  window.OpenSkyReconnect = {
    watch(o) {
      let wasDown = false, busy = false, last = 0;
      const tick = async () => {
        if (busy) return;
        busy = true;
        let up = false;
        try { up = !!(await o.check()); } catch (e) { up = false; }
        busy = false;
        if (!up) { wasDown = true; return; }
        // never twice within 10 seconds
        if (wasDown && Date.now() - last > 10000) { last = Date.now(); wasDown = false; o.reload(); }
      };
      const id = setInterval(tick, o.every || 4000);
      return () => clearInterval(id);
    }
  };
  if (typeof document !== "undefined" && typeof location !== "undefined" && window === window.top && /^https?:$/.test(location.protocol)) {
    window.OpenSkyReconnect.watch({
      check: async () => { const r = await fetch(location.pathname || "/", { method: "HEAD", cache: "no-store" }); return r.ok; },
      reload: () => location.reload()
    });
  }
})();
