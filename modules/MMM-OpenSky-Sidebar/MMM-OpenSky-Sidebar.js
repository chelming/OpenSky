/* MMM-OpenSky-Sidebar — the full-height navigation strip on the left.
 *
 * - One tile per page, in the order of `pages` in opensky.json (config.js builds `config.pages`).
 *   The Home tile shows the family's initial as a badge.
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
    textSize: "normal",          // opensky.json → look.textSize: "small" | "normal" | "large" | "xlarge" (on top of scale)
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
    if (this.config.idleReturnMinutes > 0) setInterval(() => this.checkIdle(), 10 * 1000);
    this.applyAccent(this.config.accent);
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
    const W = window.innerWidth, H = window.innerHeight;
    const fixed = Number(this.config.scale);
    const portrait = H > W * 1.1;
    const full = Math.min(W / 1920, H / 1080);
    const [dw, dh] = portrait ? [1080, 1920] : full < 0.8 ? [1280, 720] : [1920, 1080];
    const fit = fixed > 0 ? fixed : Math.max(0.5, Math.min(2.5, Math.min(W / dw, H / dh)));
    const text = (window.OpenSkyTextSize || {}).factor ? window.OpenSkyTextSize.factor(this.config.textSize) : 1;
    const z = fit * text;
    const root = document.documentElement;
    document.body.style.zoom = Math.abs(z - 1) < 0.01 ? "" : String(z);
    root.style.setProperty("--os-zoom", String(z));
    root.dataset.layout = portrait ? "portrait" : (W / z < 1600 || H / z < 880) ? "compact" : "full";
    root.dataset.orient = portrait ? "portrait" : "landscape";
    this.applySizes(root.dataset.layout, H / z, W / z);
  },

  // The sidebar's sizes (and with them where the pages start) for the current layout; see ui in the defaults
  applySizes(layout, pageHeight, pageWidth) {
    const ui = this.config.ui, st = document.documentElement.style;
    if (layout === "portrait") {
      // the sidebar becomes a bar along the bottom (css: html[data-layout="portrait"]); the pages keep 40 px at the sides
      st.setProperty("--os-nav-height", "112px");
      st.setProperty("--os-content-left", "40px");
      const n = this.config.pages.length + 1 + (this.config.showSettings ? 1 : 0);
      st.setProperty("--tile-size", "96px");
      st.setProperty("--tile-gap", "0px");
      st.setProperty("--icon-size", "34px");
      st.setProperty("--label-size", `${pageWidth / n < 120 ? 15 : 17}px`);
      return;
    }
    const compact = layout === "compact", k = compact ? 0.82 : 1, px = (n) => `${Math.round(n * k)}px`;
    st.setProperty("--os-nav-height", "0px");
    const side = Math.round(ui.width * (compact ? 0.87 : 1));
    const gap = compact ? 4 : ui.gap, n = this.config.pages.length + 1 + (this.config.showSettings ? 1 : 0);   // pages + Sleep (+ Settings)
    // every tile still fits when the page is short (big text on a small screen, or many pages): shrink them, down to 44 px
    const tile = Math.max(44, Math.min(Math.round(ui.tile * k), Math.floor((pageHeight - 26 - (n - 1) * gap) / n)));
    const squeeze = tile < Math.round(ui.tile * k);
    st.setProperty("--os-side-width", `${side}px`);
    st.setProperty("--os-content-left", `${side + (compact ? 14 : 20)}px`);
    st.setProperty("--tile-size", `${tile}px`);
    st.setProperty("--tile-gap", `${gap}px`);
    st.setProperty("--icon-size", squeeze ? `${Math.max(20, Math.round(ui.icon * k * tile / (ui.tile * k)))}px` : px(ui.icon));
    st.setProperty("--label-size", compact ? "11px" : `${ui.font}px`);
  },

  // Settings → Text size: apply at once (the choice is saved separately)
  setTextSize(size) { this.config.textSize = size; this.applyScale(); },

  // The accent color for every module (css/opensky.css defines the default peach tones)
  applyAccent(accent) {
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
    if (n === "PAGE_CHANGED" && Number.isInteger(payload)) {
      this.activeIndex = payload;
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
    this.sendNotification("OPENSKY_IDLE_RESET");
    this.sendNotification("HIDE_KEYBOARD");
    if (this.activeIndex !== 0) this.goPage(0);
  },

  /* ---------------- DOM ---------------- */
  getDom() {
    const wrap = document.createElement("div");
    wrap.className = "os-side-wrap";
    wrap.innerHTML = `<div class="os-side-track"></div><div class="os-side-col"></div>`;
    const col = wrap.querySelector(".os-side-col");

    this.config.pages.forEach((p) => {
      const icon = p.key === "home" ? `<span class="os-badge">${this.escape(this.config.familyInitial)}</span>` : this.icon(p.icon || p.key);
      col.appendChild(this.tile(`page-${p.key}`, icon, p.label, () => this.goPage(p.index)));
    });
    const spacer = document.createElement("div");
    spacer.className = "os-side-spacer";
    col.appendChild(spacer);
    col.appendChild(this.tile("sleep", this.icon("sleep"), "Sleep", () => this.sleep(), true));
    if (this.config.showSettings) col.appendChild(this.tile("settings", this.icon("settings"), "Settings", () => this.sendNotification("OPENSKY_SETTINGS_OPEN"), true));
    this.col = col;
    this.syncActive();
    return wrap;
  },

  tile(key, iconHtml, label, handler, utility = false) {
    const b = document.createElement("button");
    b.className = `os-tile os-${key}` + (utility ? " os-utility" : "");
    b.dataset.key = key;
    b.innerHTML = `<div class="os-icon">${iconHtml}</div><div class="os-label">${this.escape(label)}</div>`;
    b.onclick = handler;
    return b;
  },

  syncActive() {
    if (!this.col) return;
    const page = this.config.pages.find((p) => p.index === this.activeIndex);
    this.col.querySelectorAll(".os-tile").forEach((el) => el.classList.toggle("active", !!page && el.dataset.key === `page-${page.key}`));
  },

  goPage(index) {
    this.activeIndex = index;
    this.sendNotification("PAGE_CHANGED", index);
    this.syncActive();
  },

  /* ---------------- sleep / wake ---------------- */
  async sleep() {
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
    if (on) { this.cover.hidden = false; this.sendNotification("OPENSKY_SCREEN_SLEEP", true); }
  },

  isAsleep() { return !!(this.cover && !this.cover.hidden); },
  idleSeconds() { return (Date.now() - this.lastActivity) / 1000; },

  wake() {
    if (!this.cover || this.cover.hidden) return;
    // keep the cover a moment so the tail of the waking touch is swallowed too
    setTimeout(() => { this.cover.hidden = true; }, 400);
    this.lastActivity = Date.now();
    this.sendNotification("OPENSKY_SCREEN_SLEEP", false);
  },

  /* ---------------- helpers ---------------- */
  escape(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]); },

  // One consistent icon set: 24×24, 2 px round strokes (Lucide-style), colored by CSS
  // the shared icon set (lib/client/opensky-client.js → OpenSkyIcons): pages, web pages, Sleep, Settings
  icon(name) { return window.OpenSkyIcons.svg(name); }
});
