/* MMM-OpenSky-Sidebar — the full-height navigation strip on the left.
 *
 * - One tile per page, in the order of `pages` in opensky.json (config.js builds `config.pages`).
 *   The Home tile shows the family's initial as a badge.
 * - `nav` (opensky.json → nav, built by config.js) cuts the rail down: a group is one button that opens a small flyout of its pages,
 *   and `more` pages (plus Sleep and Settings) live in a "More" grid behind one last button. No `nav` = the plain rail above.
 * - Sleep: asks the OpenSky screen service to turn the screen off when one is configured (`screenServiceUrl`);
 *   otherwise it shows a black "soft sleep" cover that the next touch removes. Works on any screen.
 * - Auto-return: after `idleReturnMinutes` without a touch, popups close, views reset and it goes back to the
 *   first page (not while a timer is running or ringing on the Timer page). 0 = off.
 *
 * Notifications sent: PAGE_CHANGED (MMM-pages), OPENSKY_IDLE_RESET, OPENSKY_SCREEN_SLEEP (true/false),
 * OPENSKY_SETTINGS_OPEN, HIDE_KEYBOARD.   Received: PAGE_CHANGED, OPENSKY_WAKE (e.g. a timer finished),
 * OPENSKY_SLEEP (e.g. the Settings sleep schedule), OPENSKY_ACTIVITY (a touch inside an embedded page),
 * OPENSKY_TOAST { message, type: "error" | "success" | "info" } (the shared toast; the sidebar is always on screen).
 */
Module.register("MMM-OpenSky-Sidebar", {
  defaults: {
    pages: [],                   // [{ key, label, icon, index }] — built by config.js from opensky.json
    familyInitial: "H",
    screenServiceUrl: null,      // e.g. "http://127.0.0.1:5000" when the OpenSky screen service is installed
    idleReturnMinutes: 5,
    showSettings: false,         // true once a settings page/module is installed
    accent: null,                // opensky.json → look.accent: a palette color name ("teal") or "#rrggbb"; null = peach
    scale: "auto",               // opensky.json → look.scale: "auto" fits the 1920×1080 design to the screen; or a number (e.g. 1.2)
    nav: { groups: [], more: [] },   // opensky.json → nav: groups = [{ key, label, icon, pages }] (a flyout each), more = [page keys] (the More grid)
    screens: [],                 // opensky.json → screens: [{ name, pages?, person?, textSize?, accent? }] — "screen profiles" a screen can pick (Settings)
    textSize: "normal",          // opensky.json → look.textSize: the default for every screen; a screen can pick its own (deviceTextSize)
    mat: { enabled: false, color: "#f4f1ea", size: "medium", shadow: true },   // opensky.json → look.mat: a picture-frame mat board; the UI shrinks to its opening
    theme: "light",              // opensky.json → look.theme: "light" | "dark" | "auto" (by sun): the default for every screen; a screen can pick its own (deviceTheme)
    lightSensor: false,          // look.lightSensor: let an ambient light sensor, if the screen has one, overrule the sun in Auto
    latitude: null, longitude: null,   // opensky.json → location, for sunrise and sunset
    ui: { width: 92, gap: 8, tile: 76, icon: 28, font: 12 }
  },

  getStyles() { return ["MMM-OpenSky-Sidebar.css"]; },
  getScripts() { return ["modules/opensky-lib/client/opensky-client.js"]; },

  start() {
    this.activeIndex = 0;        // MMM-pages starts on its first page
    this.lastActivity = Date.now();
    this.idleHandled = false;
    const touch = () => { this.lastActivity = Date.now(); this.idleHandled = false; };
    ["pointerdown", "touchstart", "keydown", "wheel"].forEach((ev) => document.addEventListener(ev, touch, { capture: true, passive: true }));
    // Escape closes a flyout / the More grid (a tap elsewhere closes it through the scrim / the dimmed layer: taps inside an embedded page never reach this page)
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") this.closeMenus(); }, true);
    if (this.config.idleReturnMinutes > 0) setInterval(() => this.checkIdle(), 10 * 1000);
    this.applyAccent(this.effectiveAccent());
    this.applyTheme();
    this.applyScale();
    window.addEventListener("resize", () => this.applyScale());
  },

  // OpenSky has two layouts, both scaled to fit the screen (body zoom), so nothing is cut off:
  //  - "full", designed for 1920×1080: used on screens of about 1536×864 and up;
  //  - "compact", designed for 1280×720: smaller screens (a 1024×600 or 1280×720 monitor, the Pi touch display) get
  //    this denser layout at a readable size instead of the big one shrunk to 53 %.
  // look.textSize multiplies the zoom (bigger text = less room), and the layout follows the room that is left: whenever
  // the page is narrower than 1600 or shorter than 880 CSS px, <html data-layout="compact"> switches the compact rules on
  // (css/layout.css and each module's CSS). look.scale (a number) overrides the fitted zoom.
  // <html data-orient> is "landscape" or "portrait" (a screen taller than wide).
  applyScale() {
    const mat = this.matGeometry();
    const W = mat ? mat.w : window.innerWidth, H = mat ? mat.h : window.innerHeight;   // matted: the opening is the screen
    const fixed = Number(this.config.scale);
    const portrait = H > W * 1.1;
    const full = Math.min(W / 1920, H / 1080);
    const [dw, dh] = portrait ? [1080, 1920] : full < 0.8 ? [1280, 720] : [1920, 1080];
    const fit = fixed > 0 ? fixed : Math.max(0.5, Math.min(2.5, Math.min(W / dw, H / dh)));
    const text = (window.OpenSkyTextSize || {}).factor ? window.OpenSkyTextSize.factor(this.effectiveTextSize()) : 1;
    const z = fit * text;
    const root = document.documentElement;
    document.body.style.zoom = Math.abs(z - 1) < 0.01 ? "" : String(z);
    root.style.setProperty("--os-zoom", String(z));
    root.dataset.layout = portrait ? "portrait" : (W / z < 1600 || H / z < 880) ? "compact" : "full";
    root.dataset.orient = portrait ? "portrait" : "landscape";
    root.dataset.text = window.OpenSkyTextSize ? (window.OpenSkyTextSize.normalize(this.effectiveTextSize()) || "normal") : "normal";   // the text size in effect (css/modules can make room for "xlarge")
    this.applyMat(mat, z);
    this.applySizes(root.dataset.layout, H / z, W / z);
    const key = `${z.toFixed(3)} ${root.dataset.layout} ${mat ? `${mat.w}x${mat.h}` : ""}`;
    if (this.layoutKey && key !== this.layoutKey) this.sendNotification("OPENSKY_LAYOUT_CHANGED");   // Home re-fits its day tiles
    this.layoutKey = key;
  },

  // look.mat: where the mat board's opening is, in screen px: { edge (the wall showing around a floating board), l, t, r, b, w, h }.
  // The mat is a share of the screen's short side; the bottom is a little wider, like a real mat.
  matGeometry() {
    const m = this.config.mat;
    if (!m || m.enabled !== true) return null;
    const W = window.innerWidth, H = window.innerHeight, s = Math.min(W, H);
    const edge = m.shadow !== false ? Math.round(s * 0.03) : 0;
    const side = Math.round(s * ({ small: 0.035, medium: 0.07, large: 0.11 }[m.size] || 0.07));
    const l = edge + side, t = edge + side, r = edge + side, b = edge + Math.round(side * 1.2);
    return { edge, l, t, r, b, w: Math.max(200, W - l - r), h: Math.max(150, H - t - b) };
  },

  // Draw the mat board behind the UI and shrink the page (body) into the opening. `contain: layout paint` makes the body the
  // containing block of every fixed element (sidebar, pages, popups), so they all fit the opening, and clips them to it.
  applyMat(mat, z) {
    const root = document.documentElement, st = document.body.style;
    if (!mat) {
      ["position", "left", "top", "width", "height", "contain", "zIndex"].forEach((k) => { st[k] = ""; });
      ["--vh", "--vw"].forEach((k) => root.style.removeProperty(k));
      delete root.dataset.mat;
      document.querySelectorAll(".os-mat, .os-mat-lip").forEach((e) => e.remove());
      this.matEl = null;
      return;
    }
    const c = this.config.mat;
    if (!this.matEl) {
      this.matEl = document.createElement("div");
      this.matEl.className = "os-mat";
      this.matEl.innerHTML = `<div class="os-mat-board"></div>`;
      this.lipEl = document.createElement("div");
      this.lipEl.className = "os-mat-lip";
    }
    if (!this.matEl.isConnected) root.append(this.matEl, this.lipEl);
    root.dataset.mat = "on";
    this.matEl.classList.toggle("shadow", c.shadow !== false);
    this.matEl.style.setProperty("--mat", c.color);
    this.lipEl.style.setProperty("--mat", c.color);
    this.matEl.querySelector(".os-mat-board").style.inset = `${mat.edge}px`;
    Object.assign(this.lipEl.style, { left: `${mat.l}px`, top: `${mat.t}px`, width: `${mat.w}px`, height: `${mat.h}px` });
    // the body's own lengths are scaled by its zoom, so they are given divided by it
    Object.assign(st, { position: "absolute", left: `${mat.l / z}px`, top: `${mat.t / z}px`, width: `${mat.w / z}px`, height: `${mat.h / z}px`, contain: "layout paint", zIndex: "1" });
    root.style.setProperty("--vh", `${mat.h / 100 / z}px`);   // 1vh / 1vw inside the opening (css/opensky.css has the unmatted values)
    root.style.setProperty("--vw", `${mat.w / 100 / z}px`);
  },

  // The sidebar's sizes (and with them where the pages start) for the current layout; see ui in the defaults
  applySizes(layout, pageHeight, pageWidth) {
    const ui = this.config.ui, st = document.documentElement.style;
    if (layout === "portrait") {
      // the sidebar becomes a bar along the bottom (css: html[data-layout="portrait"]); the pages keep 40 px at the sides
      st.setProperty("--os-nav-height", "112px");
      st.setProperty("--os-content-left", "40px");
      const n = this.railCount();
      st.setProperty("--tile-size", "96px");
      st.setProperty("--tile-gap", "0px");
      st.setProperty("--icon-size", "34px");
      st.setProperty("--label-size", `${pageWidth / n < 120 ? 15 : 17}px`);
      document.documentElement.dataset.nav = "labels";
      return;
    }
    const compact = layout === "compact", k = compact ? 0.82 : 1, px = (n) => `${Math.round(n * k)}px`;
    st.setProperty("--os-nav-height", "0px");
    const side = Math.round(ui.width * (compact ? 0.87 : 1));
    const gap = compact ? 4 : ui.gap, n = this.railCount();   // buttons on the rail (pages, groups, More; or Sleep and Settings)
    // every tile still fits when the page is short (big text on a small screen, or many pages): shrink them, down to 44 px
    const tile = Math.max(44, Math.min(Math.round(ui.tile * k), Math.floor((pageHeight - 26 - (n - 1) * gap) / n)));
    const squeeze = tile < Math.round(ui.tile * k);
    st.setProperty("--os-side-width", `${side}px`);
    st.setProperty("--os-content-left", `${side + (compact ? 14 : 20)}px`);
    st.setProperty("--tile-size", `${tile}px`);
    st.setProperty("--tile-gap", `${gap}px`);
    st.setProperty("--icon-size", squeeze ? `${Math.max(20, Math.round(ui.icon * k * tile / (ui.tile * k)))}px` : px(ui.icon));
    st.setProperty("--label-size", compact ? "11px" : `${ui.font}px`);
    document.documentElement.dataset.nav = tile < 52 ? "icons" : "labels";   // too squeezed for a label under the icon: icons only
  },

  // What the rail shows on this screen: { items: [{ page } | { group }], hasMore, morePages, groups }. `visiblePages()` already left out
  // what is hidden here. A group sits where its first page is in `pages`; a group left with one visible page is just that page's button.
  navLayout() {
    const vis = this.visiblePages(), keys = new Set(vis.map((p) => p.key)), nav = this.config.nav || {};
    const byKey = (k) => this.config.pages.find((p) => p.key === k);
    const groups = (nav.groups || []).map((g) => ({ ...g, members: g.pages.filter((k) => keys.has(k)).map(byKey) }));
    const groupOf = {}; groups.forEach((g) => g.pages.forEach((k) => { groupOf[k] = g; }));
    const more = new Set(nav.more || []), seen = new Set(), items = [];
    vis.forEach((p) => {
      const g = groupOf[p.key];
      if (g) {
        if (seen.has(g.key)) return;
        seen.add(g.key);
        items.push(g.members.length > 1 ? { group: g } : { page: g.members[0] });
      } else if (!more.has(p.key)) items.push({ page: p });
    });
    return { items, groups, hasMore: more.size > 0, morePages: (nav.more || []).filter((k) => keys.has(k)).map(byKey) };
  },
  // How many buttons the rail has: the pages / groups, then More, or (no More) Sleep and Settings
  railCount() {
    const L = this.navLayout();
    return L.items.length + (L.hasMore ? 1 : 1 + (this.config.showSettings ? 1 : 0));
  },

  // Pages hidden on THIS screen only (Settings → Pages → "Hide here"): this browser remembers its own list (localStorage, never
  // sent anywhere); the page list in opensky.json stays the same for every screen. At least one page always stays.
  deviceHiddenPages() {
    try { const v = JSON.parse(localStorage.getItem("opensky.hiddenPages") || "[]"); return Array.isArray(v) ? v.map(String) : []; } catch (e) { return this._hiddenFallback || []; }
  },
  // What is hidden on this screen: its own list if it has one, else everything the screen profile doesn't list
  effectiveHiddenPages() {
    const own = this.deviceHiddenPages(), pr = this.screenPreset();
    if (own.length || !pr || !pr.pages.length) return own;
    return this.config.pages.map((p) => p.key).filter((k) => !pr.pages.includes(k));
  },
  visiblePages() {
    const hidden = this.effectiveHiddenPages(), shown = this.config.pages.filter((p) => !hidden.includes(p.key));
    return shown.length ? shown : this.config.pages;
  },
  setHiddenPages(keys) {
    const list = [...new Set(keys.map(String))];
    try { if (list.length) localStorage.setItem("opensky.hiddenPages", JSON.stringify(list)); else localStorage.removeItem("opensky.hiddenPages"); } catch (e) { this._hiddenFallback = list; /* private window: this visit only */ }
    const cur = this.config.pages.find((p) => p.index === this.activeIndex);
    if (cur && !this.visiblePages().includes(cur)) this.goPage(this.visiblePages()[0].index);   // standing on a page that's now hidden here
    this.updateDom(0);
    this.applyScale();
  },

  /* ---------- screen profiles ----------
   * opensky.json → screens: named presets (which pages, which person's calendars, text size, accent) managed from phone setup. A screen
   * picks one in Settings; the choice is this browser's localStorage["opensky.screenProfile"] only. Order of precedence per setting:
   * this screen's own choice (Settings) > its screen profile > the default from opensky.json. */
  screenPreset() {
    let name = null;
    try { name = localStorage.getItem("opensky.screenProfile"); } catch (e) { name = this._profileFallback || null; }
    return (this.config.screens || []).find((x) => x.name === name) || null;
  },
  // Pick a screen profile ("" / null = none). Picking one applies it as it is: this screen's own page, text size and accent choices are dropped.
  setScreenProfile(name) {
    const v = (this.config.screens || []).some((x) => x.name === name) ? name : null;
    try {
      if (v) localStorage.setItem("opensky.screenProfile", v); else localStorage.removeItem("opensky.screenProfile");
      ["opensky.hiddenPages", "opensky.textSize", "opensky.accent"].forEach((k) => localStorage.removeItem(k));
    } catch (e) { this._profileFallback = v; this._hiddenFallback = []; this._textSizeFallback = null; this._accentFallback = null; }
    this.applyAccent(this.effectiveAccent());
    this.setHiddenPages([]);   // redraws the buttons, moves off a page that is hidden now, re-fits
    this.applyPresetPerson();
  },
  effectiveTextSize() { const pr = this.screenPreset(); return this.deviceTextSize() || (pr && pr.textSize) || this.config.textSize; },
  effectiveAccent() { const pr = this.screenPreset(); return this.deviceAccent() || (pr && pr.accent) || this.config.accent || "peach"; },
  // the profile's person → the top bar's circle (calendars and lists follow)
  applyPresetPerson() {
    const pr = this.screenPreset(), hd = MM.getModules().withClass("MMM-OpenSky-Header")[0];
    if (hd && hd.pickPerson) hd.pickPerson(pr && pr.person ? [pr.person] : []);
  },
  // standing on a page this screen doesn't show (a screen profile that leaves out the first page): go to the first one it does
  ensureVisiblePage() {
    const cur = this.config.pages.find((p) => p.index === this.activeIndex);
    const first = this.visiblePages()[0];
    if (cur && first && !this.visiblePages().includes(cur)) this.goPage(first.index);
  },

  // Settings → Text size: apply at once (the choice is saved separately)
  // The text size is per screen: this browser remembers its own choice (localStorage, never sent anywhere), and a screen that
  // hasn't chosen follows the default from opensky.json (look.textSize).
  deviceTextSize() {
    try { return window.OpenSkyTextSize.normalize(localStorage.getItem("opensky.textSize")); } catch (e) { return this._textSizeFallback || null; }
  },
  // Settings → Text size on this screen: "small" | "normal" | "large" | "xlarge", or null / "default" = follow the default
  setTextSize(size) {
    const v = window.OpenSkyTextSize.normalize(size);
    try { if (v) localStorage.setItem("opensky.textSize", v); else localStorage.removeItem("opensky.textSize"); } catch (e) { /* private window: this visit only */ this._textSizeFallback = v; }
    this.applyScale();
  },
  setDefaultMat(mat) { this.config.mat = { ...this.config.mat, ...mat }; this.applyScale(); },
  setDefaultTextSize(size) { this.config.textSize = size; this.applyScale(); },

  // ----- Dark mode (look.theme): css/opensky.css turns the whole page dark when <html data-os-theme="dark">. Per screen like the
  // text size: this browser's own pick lives in localStorage["opensky.theme"]; a screen that hasn't chosen follows look.theme.
  deviceTheme() {
    try { return window.OpenSkyTheme.normalize(localStorage.getItem("opensky.theme")); } catch (e) { return this._themeFallback || null; }
  },
  setTheme(mode) {   // "light" | "dark" | "auto" | "system", or null / "default" = follow the default
    const v = window.OpenSkyTheme.normalize(mode);
    try { if (v) localStorage.setItem("opensky.theme", v); else localStorage.removeItem("opensky.theme"); } catch (e) { this._themeFallback = v; }
    this.applyTheme();
  },
  setDefaultTheme(mode, sensor) { this.config.theme = window.OpenSkyTheme.normalize(mode) || "light"; if (typeof sensor === "boolean") this.config.lightSensor = sensor; this.applyTheme(); },
  isDark() { return document.documentElement.dataset.osTheme === "dark"; },
  applyTheme() {
    const T = window.OpenSkyTheme, mode = this.deviceTheme() || this.config.theme;
    const fresh = this._lux && Date.now() - this._lux.at < 15 * 60000 ? this._lux.v : null;   // a sensor reading from the last quarter hour
    const dark = T.isDark(mode, new Date(), this.config.latitude, this.config.longitude, this.config.lightSensor ? fresh : null, this.isDark(), this.systemDark());
    const was = document.documentElement.dataset.osTheme;
    document.documentElement.dataset.osTheme = dark ? "dark" : "light";
    if (was !== document.documentElement.dataset.osTheme && this.config.accent !== undefined) this.applyAccent(this.effectiveAccent());   // the default accent differs per look
    if (!this._themeTimer) this._themeTimer = setInterval(() => this.applyTheme(), 60000);   // the sun moves on
    if (this.config.lightSensor && !this._sensorTried) this.startLightSensor();
  },
  // "System": the browser's own light/dark setting. The listener re-applies the theme the moment the device flips it.
  systemDark() {
    try {
      if (!this._systemMq && window.matchMedia) {
        this._systemMq = window.matchMedia("(prefers-color-scheme: dark)");
        const again = () => this.applyTheme();
        if (this._systemMq.addEventListener) this._systemMq.addEventListener("change", again); else if (this._systemMq.addListener) this._systemMq.addListener(again);
      }
      return !!(this._systemMq && this._systemMq.matches);
    } catch (e) { return false; }
  },
  // Optional ambient light sensor (Chromium's AmbientLightSensor, only where the screen/browser has one and allows it).
  // Anything missing or refused is ignored: Auto then simply follows the sun.
  startLightSensor() {
    this._sensorTried = true;
    try {
      if (typeof window.AmbientLightSensor !== "function") return;
      const s = new window.AmbientLightSensor({ frequency: 0.2 });
      s.onreading = () => { this._lux = { v: s.illuminance, at: Date.now() }; this.applyTheme(); };
      s.onerror = () => { this._lux = null; };
      s.start();
    } catch (e) { /* no sensor, no permission: sun only */ }
  },
  // The accent is per screen too: this browser remembers its own pick (localStorage["opensky.accent"], never sent anywhere); a screen
  // that hasn't chosen follows look.accent from opensky.json (the phone setting).
  deviceAccent() {
    try { return window.OpenSkyAccent.normalize(localStorage.getItem("opensky.accent")); } catch (e) { return this._accentFallback || null; }
  },
  // Settings → Accent color on this screen: a palette name / "#rrggbb", or null = follow the default
  setAccent(accent) {
    const v = window.OpenSkyAccent.normalize(accent);
    try { if (v) localStorage.setItem("opensky.accent", v); else localStorage.removeItem("opensky.accent"); } catch (e) { this._accentFallback = v; /* private window: this visit only */ }
    this.applyAccent(this.effectiveAccent());
  },
  setDefaultAccent(accent) { this.config.accent = accent; this.applyAccent(this.effectiveAccent()); },

  // The accent color for every module (css/opensky.css defines the default peach tones)
  applyAccent(accent) {
    if (accent === "peach" && this.isDark()) accent = "blue";   // dark mode: no orange/brown by default (a chosen accent is kept)
    if (accent === "peach") { ["", "-mid", "-light", "-soft", "-tint", "-dark"].forEach((k) => document.documentElement.style.removeProperty(`--os-accent${k}`)); return; }   // back to the css defaults
    const pal = window.OpenSkyEventColors && window.OpenSkyEventColors.PALETTE;
    const a = /^#[0-9a-f]{6}$/i.test(accent || "") ? accent : (pal && pal[accent] ? pal[accent][1] : null);
    if (!a) return;
    const root = document.documentElement.style, mix = (pct, other) => `color-mix(in srgb, ${a} ${pct}%, ${other})`;
    root.setProperty("--os-accent", a);
    root.setProperty("--os-accent-mid", mix(70, "white"));
    root.setProperty("--os-accent-light", mix(60, "white"));
    root.setProperty("--os-accent-soft", mix(28, "white"));
    root.setProperty("--os-accent-tint", mix(9, "white"));
    root.setProperty("--os-accent-dark", mix(78, "black"));
  },

  notificationReceived(n, payload) {
    if (n === "ALL_MODULES_STARTED") {   // a screen profile: start on a page this screen shows, with its person's calendars
      setTimeout(() => { this.ensureVisiblePage(); this.applyPresetPerson(); }, 800);
    } else if (n === "PAGE_CHANGED" && Number.isInteger(payload)) {
      this.activeIndex = payload;
      this.closeMenus();
      this.syncActive();
    } else if (n === "OPENSKY_WAKE") {
      this.wake();
    } else if (n === "OPENSKY_ACTIVITY") {   // a touch inside an embedded page (MMM-OpenSky-Embed)
      this.lastActivity = Date.now(); this.idleHandled = false;
    } else if (n === "OPENSKY_SLEEP") {
      if (!this.isAsleep()) this.sleep();
    } else if (n === "OPENSKY_TOAST" && payload && payload.message) {
      window.OpenSkyToast(payload.message, payload.type || "info");
    }
  },

  /* ---------------- auto-return ---------------- */
  timerBusy() {
    const t = MM.getModules().withClass("MMM-OpenSky-Timer")[0];
    return !!(t && Array.isArray(t.timers) && t.timers.length);
  },

  async checkIdle() {
    const limit = this.config.idleReturnMinutes * 60 * 1000;
    if (this.idleHandled || Date.now() - this.lastActivity < limit) return;
    // Touches inside embedded pages (<webview>) never reach this page; the screen service sees every input device
    if (this.config.screenServiceUrl) {
      try {
        const r = await fetch(`${this.config.screenServiceUrl}/idle`, { signal: AbortSignal.timeout(3000) });
        const secs = (await r.json()).idle_seconds;
        if (typeof secs === "number") this.lastActivity = Math.max(this.lastActivity, Date.now() - secs * 1000);
      } catch (e) { /* not available: page events only */ }
    }
    if (this.idleHandled || Date.now() - this.lastActivity < limit) return;
    this.idleHandled = true;
    const timerPage = this.config.pages.find((p) => p.key === "timer");
    if (timerPage && this.activeIndex === timerPage.index && this.timerBusy()) return;
    Log.info(`${this.name}: idle, returning to the first page`);
    this.closeMenus();
    this.sendNotification("OPENSKY_IDLE_RESET");
    this.sendNotification("HIDE_KEYBOARD");
    const first = this.visiblePages()[0].index;
    if (this.activeIndex !== first) this.goPage(first);
  },

  /* ---------------- DOM ---------------- */
  getDom() {
    const wrap = document.createElement("div");
    wrap.className = "os-side-wrap";
    wrap.innerHTML = `<div class="os-side-track"></div><div class="os-side-col"></div>`;
    const col = wrap.querySelector(".os-side-col");
    this.wrap = wrap; this.moreEl = null;
    // a see-through layer behind an open flyout: a tap anywhere else closes it, and (over an embedded page) doesn't also hit the page
    const scrim = this.scrim = document.createElement("div");
    scrim.className = "os-scrim";
    scrim.hidden = true;
    scrim.onclick = () => this.closeMenus();
    wrap.appendChild(scrim);
    const L = this.layout = this.navLayout();

    L.items.forEach((it) => col.appendChild(it.group ? this.groupSlot(it.group) : this.pageTile(it.page)));
    const spacer = document.createElement("div");
    spacer.className = "os-side-spacer";
    col.appendChild(spacer);
    if (L.hasMore) {
      col.appendChild(this.tile("more", this.icon("grid"), "More", () => this.toggleMore()));
    } else {
      col.appendChild(this.tile("sleep", this.icon("sleep"), "Sleep", () => this.sleep(), true));
      if (this.config.showSettings) col.appendChild(this.tile("settings", this.icon("settings"), "Settings", () => this.sendNotification("OPENSKY_SETTINGS_OPEN"), true));
    }
    this.col = col;
    this.syncActive();
    return wrap;
  },

  pageTile(p) {
    const icon = p.key === "home" ? `<span class="os-badge">${this.escape(this.config.familyInitial)}</span>` : this.icon(p.icon || p.key);
    return this.tile(`page-${p.key}`, icon, p.label, () => this.goPage(p.index));
  },

  tile(key, iconHtml, label, handler, utility = false) {
    const b = document.createElement("button");
    b.className = `os-tile os-${key}` + (utility ? " os-utility" : "");
    b.dataset.key = key;
    b.innerHTML = `<div class="os-icon">${iconHtml}</div><div class="os-label">${this.escape(label)}</div>`;
    b.onclick = handler;
    return b;
  },

  // A group: one rail button, and beside it (above it in portrait) a small flyout with the group's pages
  groupSlot(g) {
    const slot = document.createElement("div");
    slot.className = "os-slot";
    slot.dataset.group = g.key;
    const fly = document.createElement("div");
    fly.className = "os-flyout";
    fly.hidden = true;
    g.members.forEach((p) => {
      const b = document.createElement("button");
      b.className = "os-fly-item";
      b.dataset.page = p.key;
      b.innerHTML = `<span class="os-fly-icon">${this.icon(p.icon || p.key)}</span><span class="os-fly-label">${this.escape(p.label)}</span>`;
      b.onclick = () => { this.closeMenus(); this.goPage(p.index); };
      fly.appendChild(b);
    });
    slot.appendChild(this.tile(`group-${g.key}`, this.icon(g.icon), g.label, () => this.toggleFlyout(slot)));
    slot.appendChild(fly);
    return slot;
  },

  toggleFlyout(slot) {
    const wasOpen = slot.classList.contains("open");
    this.closeMenus();
    if (wasOpen) return;
    slot.classList.add("open");
    slot.querySelector(".os-flyout").hidden = false;
    if (this.scrim) this.scrim.hidden = false;
    // low on the rail: grow upward so the flyout never runs off the bottom of the screen
    slot.classList.toggle("up", !!this.col && slot.offsetTop > this.col.clientHeight / 2);
  },

  // The More grid: a dimmed layer beside the rail with a compact card of small icon + label buttons (the More pages, then Sleep and Settings)
  toggleMore() {
    if (this.moreEl && !this.moreEl.hidden) return this.closeMenus();
    this.closeMenus();
    if (!this.moreEl) {
      const el = document.createElement("div");
      el.className = "os-moremenu";
      el.innerHTML = `<div class="os-more-panel" role="dialog" aria-label="More"><div class="os-more-head"><span>More</span><button class="os-more-x" aria-label="Close">${this.icon("close")}</button></div><div class="os-more-grid"></div></div>`;
      const grid = el.querySelector(".os-more-grid");
      const item = (icon, label, handler, extra) => {
        const b = document.createElement("button");
        b.className = "os-more-item" + (extra ? ` ${extra.cls}` : "");
        if (extra && extra.page) b.dataset.page = extra.page;
        b.innerHTML = `<span class="os-more-chip">${icon}</span><span class="os-more-label">${this.escape(label)}</span>`;
        b.onclick = handler;
        grid.appendChild(b);
      };
      this.layout.morePages.forEach((p) => item(this.icon(p.icon || p.key), p.label, () => { this.closeMenus(); this.goPage(p.index); }, { page: p.key, cls: "" }));
      if (this.config.showSettings) item(this.icon("settings"), "Settings", () => { this.closeMenus(); this.sendNotification("OPENSKY_SETTINGS_OPEN"); }, { cls: "util" });
      item(this.icon("sleep"), "Sleep", () => { this.closeMenus(); this.sleep(); }, { cls: "util" });
      el.onclick = (e) => { if (e.target === el || e.target.closest(".os-more-x")) this.closeMenus(); };   // the dimmed area or the × closes it
      el.querySelector(".os-more-grid").style.setProperty("--cols", String(Math.max(1, Math.min(4, grid.children.length))));
      this.wrap.appendChild(el);
      this.moreEl = el;
    }
    this.moreEl.hidden = false;
    this.syncActive();
  },

  closeMenus() {
    if (!this.wrap) return;
    this.wrap.querySelectorAll(".os-slot.open").forEach((s) => { s.classList.remove("open", "up"); s.querySelector(".os-flyout").hidden = true; });
    if (this.scrim) this.scrim.hidden = true;
    if (this.moreEl) this.moreEl.hidden = true;
  },

  // The tile that stands for the current page: its own button, else its group's, else More
  syncActive() {
    if (!this.col) return;
    const page = this.config.pages.find((p) => p.index === this.activeIndex), L = this.layout || this.navLayout();
    let key = null;
    if (page) {
      const g = L.groups.find((x) => x.members.length > 1 && x.pages.includes(page.key));
      key = this.col.querySelector(`.os-tile[data-key="page-${page.key}"]`) ? `page-${page.key}`
        : g ? `group-${g.key}` : (L.hasMore && L.morePages.includes(page)) ? "more" : null;
    }
    this.col.querySelectorAll(".os-tile").forEach((el) => el.classList.toggle("active", el.dataset.key === key));
    this.wrap.querySelectorAll(".os-fly-item, .os-more-item[data-page]").forEach((el) => el.classList.toggle("active", !!page && el.dataset.page === page.key));
  },

  goPage(index) {
    this.activeIndex = index;
    this.closeMenus();
    this.sendNotification("PAGE_CHANGED", index);
    this.syncActive();
  },

  /* ---------------- sleep / wake ---------------- */
  async sleep() {
    this.closeMenus();
    this.sendNotification("HIDE_KEYBOARD");
    if (this.config.screenServiceUrl) {
      try {
        // the screen service has no CORS headers; a no-cors request still runs it
        await fetch(`${this.config.screenServiceUrl}/monitor/off`, { mode: "no-cors", signal: AbortSignal.timeout(3000) });
        this.sendNotification("OPENSKY_SCREEN_SLEEP", true);
        return;
      } catch (e) { /* fall back to the soft-sleep cover */ }
    }
    this.softSleep(true);
  },

  // Black cover over everything; the waking touch is swallowed so it doesn't also press a button
  softSleep(on) {
    if (!this.cover) {
      const c = document.createElement("div");
      c.className = "os-sleep-cover";
      c.hidden = true;
      const swallow = (e) => { e.preventDefault(); e.stopPropagation(); };
      ["pointerdown", "pointerup", "click", "touchstart", "touchend", "mousedown", "mouseup"].forEach((ev) => c.addEventListener(ev, swallow, true));
      c.addEventListener("pointerup", () => this.wake(), true);
      document.addEventListener("keydown", () => { if (!c.hidden) this.wake(); }, true);
      document.body.appendChild(c);
      this.cover = c;
    }
    if (on) { document.documentElement.classList.add("os-asleep"); this.cover.hidden = false; this.sendNotification("OPENSKY_SCREEN_SLEEP", true); }
  },

  isAsleep() { return !!(this.cover && !this.cover.hidden); },
  idleSeconds() { return (Date.now() - this.lastActivity) / 1000; },

  wake() {
    if (!this.cover || this.cover.hidden) return;
    // keep the cover a moment so the tail of the waking touch is swallowed too
    setTimeout(() => { this.cover.hidden = true; document.documentElement.classList.remove("os-asleep"); }, 400);
    this.lastActivity = Date.now();
    this.sendNotification("OPENSKY_SCREEN_SLEEP", false);
  },

  /* ---------------- helpers ---------------- */
  escape(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]); },

  // One consistent icon set: 24×24, 2 px round strokes (Lucide-style), colored by CSS
  // the shared icon set (lib/client/opensky-client.js → OpenSkyIcons): pages, web pages, Sleep, Settings
  icon(name) { return window.OpenSkyIcons.svg(name); }
});
