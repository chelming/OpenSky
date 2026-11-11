/* MMM-OpenSky-Settings
 * The Settings panel (sidebar → Settings): Screen (brightness, evening dim), Sleep schedule, Sound, System.
 * Opens on OPENSKY_SETTINGS_OPEN; closes on OPENSKY_IDLE_RESET / PAGE_CHANGED or its × . Lives on <body> like the popups.
 * The hardware side (backlight / DDC/CI / volume / restart / update / power) is the node helper's.
 *
 * Sleep schedule: at the "off" time the screen sleeps (unless a timer is running). A touch wakes it; after a few
 * idle minutes in the night it sleeps again. At the "on" time it wakes. While asleep the hardware brightness goes to 0.
 *
 * In Docker there is no screen hardware: every browser showing the dashboard is "a screen", so brightness, evening dim and the
 * sleep schedule are kept per browser (localStorage "opensky.screen"), like the text size, and applied by the page itself.
 * On a Pi they stay in device.json (the hardware is one thing).
 */
Module.register("MMM-OpenSky-Settings", {
  defaults: {
    resleepMinutes: 3     // at night, back to sleep after this long without a touch
  },

  getStyles() { return ["MMM-OpenSky-Settings.css"]; },
  getScripts() { return ["modules/opensky-lib/client/opensky-client.js"]; },

  start() {
    this.state = null;
    this.status = null;
    this.confirming = null;
    this.sendSocketNotification("OS_SET_INIT");
    setInterval(() => this.checkSchedule(), 30 * 1000);
  },

  getDom() { return document.createElement("div"); },

  notificationReceived(n, p) {
    if (n === "OPENSKY_SETTINGS_OPEN") this.open();
    else if ((n === "OPENSKY_IDLE_RESET" || n === "PAGE_CHANGED") && this.isOpen()) this.close();
    else if (n === "OPENSKY_SCREEN_SLEEP") {
      this.sendSocketNotification("OS_SET_ASLEEP", !!p);
      if (this.state && this.state.docker) this.applyLocalDim(!!p);   // this browser's own cover
    }
    // another page's volume slider (Music): the volume lives here, so both always agree
    else if (n === "OPENSKY_VOLUME_GET" && this.state) this.sendNotification("OPENSKY_VOLUME", this.state.audio ? { volume: this.state.audio.volume, name: this.state.audio.name } : null);
    else if (n === "OPENSKY_VOLUME_SET" && typeof p === "number" && this.state && this.state.audio) {
      this.inflight++;
      this.sendSocketNotification("OS_SET_CHANGE", { volume: p });
    }
  },

  socketNotificationReceived(n, p) {
    if (n === "OS_SET_STATE") {
      if (p.docker) { p.settings = this.localSettings(p.settings); p.audio = null; }   // per browser, not the one shared device.json
      this.state = p;
      if (p.docker) this.applyLocalDim();
      this.sendNotification("OPENSKY_VOLUME", p.audio ? { volume: p.audio.volume, name: p.audio.name } : null);
      // Every change gets one reply. While some are still on their way, the controls already show what was picked;
      // once all are back the state includes every tap: redraw if the layout changed (a switch), else sync values.
      if (this.inflight > 0) this.inflight--;
      if (this.isOpen() && !this.inflight) {
        if (this.shape(p) !== this.drawnShape) this.render();
        else this.syncControls();
      }
    } else if (n === "OS_LOOK") {   // the saved look, after a page refresh (the screen's config is from the last restart)
      const sb = MM.getModules().withClass("MMM-OpenSky-Sidebar")[0];
      if (sb && p) { sb.setDefaultTextSize(p.textSize); sb.setDefaultAccent(p.accent); sb.setDefaultTheme(p.theme, p.lightSensor); }
    } else if (n === "OS_SET_STATUS") {
      this.status = p;
      if (this.isOpen()) this.renderStatus();
    } else if (n === "OS_SET_PREFS") {
      this.prefs = p;
      if (p.restartNeeded) this.restartNeeded = true;
      if (this.isOpen()) this.renderPrefs();
    } else if (n === "OS_SET_BACKUP") {
      if (this.prefs) this.prefs.status = p.status;
      window.OpenSkyToast(p.status.ok ? "Backed up ✓" : `Backup failed: ${p.status.error}`, p.status.ok ? "success" : "error");
      if (this.isOpen()) this.renderPrefs();
    } else if (n === "OS_SET_WAKE") {
      this.sendNotification("OPENSKY_WAKE");
    } else if (n === "OS_SET_SLEEP_NOW") {
      this.close();
      this.sendNotification("OPENSKY_SLEEP");
    } else if (n === "OS_SET_NOTICE" && p) {
      window.OpenSkyToast(p.message, p.type || "info");
    } else if (n === "OS_SET_SOFT_DIM") {
      if (!(this.state && this.state.docker)) this.softDim(p);
    } else if (n === "OS_SET_SYSTEM_RESULT" && p) {
      window.OpenSkyToast(p.message, p.ok ? "success" : "error");
    }
  },

  /* ---------------- per-browser screen settings (Docker) ---------------- */
  localSettings(base) {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem("opensky.screen") || "{}") || {}; } catch (e) { saved = this._localFallback || {}; }
    const time = (t, d) => (typeof t === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(t) ? t : d);
    const num = (v, d) => (Number.isFinite(Number(v)) ? Math.min(100, Math.max(10, Math.round(Number(v)))) : d);
    const e = saved.eveningDim || {}, z = saved.sleep || {};
    return {
      ...base,
      brightness: num(saved.brightness, 100),
      eveningDim: { enabled: !!e.enabled, from: time(e.from, "19:00"), level: num(e.level, 50) },
      sleep: { enabled: !!z.enabled, off: time(z.off, "22:00"), on: time(z.on, "06:30") }
    };
  },
  // a change from the panel, in Docker: kept in this browser only
  changeLocal(c) {
    const cur = this.state.settings, next = { ...cur };
    if ("brightness" in c) next.brightness = c.brightness;
    if (c.eveningDim) next.eveningDim = { ...cur.eveningDim, ...c.eveningDim };
    if (c.sleep) next.sleep = { ...cur.sleep, ...c.sleep };
    const keep = { brightness: next.brightness, eveningDim: next.eveningDim, sleep: next.sleep };
    try { localStorage.setItem("opensky.screen", JSON.stringify(keep)); } catch (e) { this._localFallback = keep; /* private window: this visit only */ }
    this.state = { ...this.state, settings: this.localSettings(next) };
    this.applyLocalDim();
    this.checkSchedule();
    if (this.isOpen()) { if (this.shape(this.state) !== this.drawnShape) this.render(); else this.syncControls(); }
  },
  // the page dims itself (there is no backlight to turn down): the same rule the node helper uses on a Pi
  applyLocalDim(asleep) {
    const { brightness, eveningDim, sleep } = this.state.settings, sb = this.sidebar();
    let level = brightness;
    if (eveningDim.enabled) {
      const m = (t) => { const [h, mm] = t.split(":").map(Number); return h * 60 + mm; };
      const now = new Date(), mins = now.getHours() * 60 + now.getMinutes(), from = m(eveningDim.from), until = m(sleep.enabled ? sleep.on : "06:00");
      if (from > until ? mins >= from || mins < until : mins >= from && mins < until) level = Math.min(brightness, eveningDim.level);
    }
    this.softDim((asleep === undefined ? sb && sb.isAsleep() : asleep) ? 100 : level);
  },

  /* ---------------- sleep schedule ---------------- */
  sidebar() { return MM.getModules().withClass("MMM-OpenSky-Sidebar")[0]; },
  timerBusy() { const t = MM.getModules().withClass("MMM-OpenSky-Timer")[0]; return !!(t && Array.isArray(t.timers) && t.timers.length); },
  nightNow(now = new Date()) {
    const z = this.state && this.state.settings.sleep;
    if (!z || !z.enabled) return false;
    const m = (t) => { const [h, mm] = t.split(":").map(Number); return h * 60 + mm; };
    const mins = now.getHours() * 60 + now.getMinutes(), off = m(z.off), on = m(z.on);
    return off > on ? mins >= off || mins < on : mins >= off && mins < on;
  },

  checkSchedule(now = new Date()) {
    const night = this.nightNow(now), sb = this.sidebar();
    if (!sb || !this.state) return;
    if (this.state.docker) this.applyLocalDim();
    const wasNight = this.wasNight;
    this.wasNight = night;
    if (wasNight === undefined) return;   // first check after start: just learn where we are
    if (night && !wasNight && !this.timerBusy()) this.sendNotification("OPENSKY_SLEEP");
    else if (!night && wasNight) this.sendNotification("OPENSKY_WAKE");
    else if (night && !sb.isAsleep() && !this.isOpen() && !this.timerBusy() && sb.idleSeconds() >= this.config.resleepMinutes * 60) this.sendNotification("OPENSKY_SLEEP");
  },

  // Software brightness (no hardware control): a see-through black layer over everything, ignoring touches
  softDim(level) {
    if (!this.dim) {
      this.dim = document.createElement("div");
      this.dim.className = "ost-dim";
      document.body.appendChild(this.dim);
    }
    this.dim.style.opacity = String(Math.max(0, Math.min(0.8, (100 - level) / 100)));
  },

  shape(st) {
    return st ? JSON.stringify([st.settings.eveningDim.enabled, st.settings.sleep.enabled, st.brightness.method, !!st.audio, st.canRestart, st.docker, st.screen && st.screen.method]) : "";
  },

  /* ---------------- panel ---------------- */
  isOpen() { return !!(this.panel && !this.panel.hidden); },

  open() {
    if (!this.panel) {
      this.panel = document.createElement("div");
      this.panel.className = "ost-overlay";
      this.panel.hidden = true;
      // a tap outside closes it — only when the press started outside too
      let pressedOutside = false;
      this.panel.addEventListener("pointerdown", (e) => { pressedOutside = e.target === this.panel; });
      this.panel.addEventListener("click", (e) => { if (e.target === this.panel && pressedOutside) this.close(); });
      document.body.appendChild(this.panel);
    }
    this.confirming = null;
    this.inflight = 0;
    this.hexDraft = null;   // the color-code box starts from the saved color
    this.panel.hidden = false;
    this.render();
    this.sendSocketNotification("OS_SET_STATUS");
    this.sendSocketNotification("OS_SET_PREFS");
  },

  close() { if (this.panel) this.panel.hidden = true; this.confirming = null; },

  change(c) {
    if (this.state && this.state.docker) return this.changeLocal(c);
    this.inflight = (this.inflight || 0) + 1; this.sendSocketNotification("OS_SET_CHANGE", c);
  },

  // Put the saved values into the controls without rebuilding them
  syncControls() {
    const s = this.state.settings, q = (sel) => this.panel.querySelector(sel);
    const vals = { brightness: s.brightness, dimLevel: s.eveningDim.level, volume: this.state.audio && this.state.audio.volume };
    for (const [id, v] of Object.entries(vals)) {
      const el = q(`.ost-slider[data-id="${id}"]`);
      if (el && v != null) { el.value = v; q(`.ost-value[data-for="${id}"]`).textContent = `${v}%`; }
    }
    for (const [id, t] of Object.entries({ dimFrom: s.eveningDim.from, sleepOff: s.sleep.off, sleepOn: s.sleep.on })) {
      const el = q(`.ost-stepper[data-id="${id}"]`);
      if (el) { el.dataset.time = t; el.querySelector(".ost-time").textContent = this.fmt(t); }
    }
  },

  render() {
    if (!this.panel) return;
    const st = this.state;
    if (!st) { this.panel.innerHTML = `<div class="ost-panel"><div class="ost-loading">Loading…</div></div>`; return; }
    const s = st.settings;
    this.drawnShape = this.shape(st);
    const methodNote = { backlight: "The display's own backlight", ddc: "The monitor's brightness (over HDMI)", software: "Dims the picture (this screen doesn't take brightness commands)" }[st.brightness.method] || "";
    const docker = !!st.docker;   // a browser, not a Pi: brightness, dimming and sleep are this browser's own
    const methodText = docker ? "Dims the picture on this screen only; other screens keep their own." : methodNote;
    this.panel.innerHTML = `
      <div class="ost-panel" role="dialog" aria-label="Settings">
        <div class="ost-head"><span class="ost-title">Settings</span><button class="ost-x" aria-label="Close">×</button></div>
        <div class="ost-body">
          <section class="ost-section">
            <h3>Screen</h3>
            <div class="ost-row"><span class="ost-label">Brightness</span>${this.slider("brightness", s.brightness, 10, 100)}</div>
            <div class="ost-note">${methodText}</div>
            ${docker ? "" : `<div class="ost-row"><span class="ost-label">Sleep turns off by</span><select class="ost-select ost-wide" data-screenoff>${Object.entries(st.screen.labels).map(([m, l]) => `<option value="${m}" ${m === st.screen.method ? "selected" : ""} ${st.screen.available[m] ? "" : "disabled"}>${l}${st.screen.available[m] ? "" : " — not found on this Pi"}</option>`).join("")}</select><button class="ost-btn ost-test-screen">Test</button></div>
            <div class="ost-note">Every screen is different: try the options with Test (it comes back after 10 seconds, or at a touch). If one doesn't suit your screen, use Black screen + dim.${st.screen.method === "auto" ? ` Now: ${st.screen.labels[st.screen.resolved].replace(/ \(.*/, "")}.` : ""}</div>`}
            <div class="ost-row">${this.toggle("dim", s.eveningDim.enabled)}<span class="ost-label">Dim in the evening</span></div>
            <div class="ost-sub" ${s.eveningDim.enabled ? "" : "hidden"}>
              <div class="ost-row"><span class="ost-label">From</span>${this.stepper("dimFrom", s.eveningDim.from)}</div>
              <div class="ost-row"><span class="ost-label">Level</span>${this.slider("dimLevel", s.eveningDim.level, 10, 100)}</div>
            </div>
          </section>
          <section class="ost-section">
            <h3>Sleep at night</h3>
            <div class="ost-row">${this.toggle("sleep", s.sleep.enabled)}<span class="ost-label">Turn the screen off at night</span></div>
            <div class="ost-sub" ${s.sleep.enabled ? "" : "hidden"}>
              <div class="ost-row"><span class="ost-label">Off at</span>${this.stepper("sleepOff", s.sleep.off)}</div>
              <div class="ost-row"><span class="ost-label">On at</span>${this.stepper("sleepOn", s.sleep.on)}</div>
              <div class="ost-note">A touch wakes it; it goes back to sleep after ${this.config.resleepMinutes} quiet minutes. A running timer keeps it on.</div>
            </div>
          </section>
          ${st.docker ? "" : `<section class="ost-section ost-sound">
            <h3>Sound</h3>
            ${st.audio ? `
              <div class="ost-row"><span class="ost-label">Volume</span>${this.slider("volume", st.audio.volume, 0, 100)}<button class="ost-btn ost-test">Test</button></div>
              <div class="ost-note"></div>` : `<div class="ost-note">No speaker found. Plug one in (USB, HDMI or the headphone socket) and restart OpenSky.</div>`}
          </section>`}
          <div class="ost-prefs"></div>
          <section class="ost-section">
            <h3>System</h3>
            <div class="ost-status"></div>
            <div class="ost-buttons">
              <button class="ost-btn ost-phone" data-act="phone">Set up from your phone</button>
              <button class="ost-btn" data-act="reload">Reload screen</button>
              ${st.canRestart ? `<button class="ost-btn" data-act="restart-app">Restart OpenSky</button>` : ""}
              <button class="ost-btn ost-update" data-act="update" hidden>Update</button>
              ${st.docker ? "" : `<button class="ost-btn" data-act="reboot">Restart Pi</button>
              <button class="ost-btn ost-danger" data-act="shutdown">Shut down</button>`}
            </div>
          </section>
        </div>
      </div>`;
    const q = (sel) => this.panel.querySelector(sel);
    if (st.audio) q(".ost-sound .ost-note").textContent = st.audio.name;
    q(".ost-x").onclick = () => this.close();
    this.bindSlider("brightness", (v) => this.change({ brightness: v }));
    this.bindSlider("dimLevel", (v) => this.change({ eveningDim: { level: v } }));
    this.bindSlider("volume", (v) => this.change({ volume: v }));
    this.bindToggle("dim", (on) => this.change({ eveningDim: { enabled: on } }));
    this.bindToggle("sleep", (on) => this.change({ sleep: { enabled: on } }));
    this.bindStepper("dimFrom", (t) => this.change({ eveningDim: { from: t } }));
    this.bindStepper("sleepOff", (t) => this.change({ sleep: { off: t } }));
    this.bindStepper("sleepOn", (t) => this.change({ sleep: { on: t } }));
    const sel = q("[data-screenoff]");
    if (sel) {
      sel.onchange = () => this.change({ screenOff: sel.value });
      q(".ost-test-screen").onclick = () => this.sendSocketNotification("OS_SET_SCREEN_TEST", { method: sel.value });
    }
    const test = q(".ost-test");
    if (test) test.onclick = () => this.sendNotification("TIMER_TEST_CHIME");
    this.panel.querySelectorAll("[data-act]").forEach((b) => { b.onclick = () => this.system(b); });
    this.renderStatus();
    this.renderPrefs();
  },

  /* ---------------- pages, look & extras, backups (also on the phone page) ---------------- */
  // this screen's own text size ("small"…"xlarge") or null when it follows the default
  deviceSize() { const sb = MM.getModules().withClass("MMM-OpenSky-Sidebar")[0]; return sb ? sb.deviceTextSize() : null; },
  deviceTheme() { const sb = MM.getModules().withClass("MMM-OpenSky-Sidebar")[0]; return sb ? sb.deviceTheme() : null; },

  savePrefs(patch) { this.sendSocketNotification("OS_SET_PREFS_SAVE", { patch }); },

  // Home's right-hand cards (opensky.json → home.cards): turn on / off, drag by the grip (or the arrows); needs a restart like Pages
  homeCardsList(P) {
    const H = P.homeCards || { order: [], names: {} };
    const shown = (k) => H.order.includes(k) && (k !== "photos" || !H.photosOff);
    return { H, shown, all: [...H.order.filter((k) => H.names[k]), ...Object.keys(H.names).filter((k) => !H.order.includes(k))] };
  },

  homeCardsHtml(P, esc) {
    if (!P.homeCards) return "";
    const { H, shown, all } = this.homeCardsList(P);
    return `<section class="ost-section ost-homecards">
        <h3>Home cards</h3>
        <div class="ost-note">The cards on the right of the Home page, top to bottom. The week stays on the left.</div>
        ${all.map((k) => { const on = shown(k), i = H.order.indexOf(k); return `
          <div class="ost-row ost-hc${on ? "" : " off"}" data-card="${esc(k)}">
            ${on ? `<span class="ost-grip" aria-label="Drag to reorder" title="Drag to reorder"><svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.8"/><circle cx="15" cy="6" r="1.8"/><circle cx="9" cy="12" r="1.8"/><circle cx="15" cy="12" r="1.8"/><circle cx="9" cy="18" r="1.8"/><circle cx="15" cy="18" r="1.8"/></svg></span>` : ""}
            <span class="ost-label">${esc(H.names[k])}</span>
            <span class="ost-order">${on ? `<button class="ost-mini" data-move="-1" ${i <= 0 ? "disabled" : ""} aria-label="Up">▲</button><button class="ost-mini" data-move="1" ${i < 0 || i === H.order.length - 1 ? "disabled" : ""} aria-label="Down">▼</button>` : ""}</span>
            ${this.toggle(`card-${k}`, on)}
          </div>`; }).join("")}
      </section>`;
  },

  bindHomeCards(box, P) {
    if (!P.homeCards) return;
    const { H } = this.homeCardsList(P);
    const save = (order) => this.savePrefs({ homeCards: order });
    box.querySelectorAll(".ost-hc").forEach((row) => {
      const k = row.dataset.card;
      row.querySelector(".ost-toggle").onclick = () => save(H.order.includes(k) && !(k === "photos" && H.photosOff) ? H.order.filter((x) => x !== k) : [...H.order.filter((x) => x !== k), k]);
      row.querySelectorAll("[data-move]").forEach((b) => { b.onclick = () => { const o = [...H.order], i = o.indexOf(k), j = i + Number(b.dataset.move); [o[i], o[j]] = [o[j], o[i]]; save(o); }; });
    });
    box.querySelectorAll(".ost-hc .ost-grip").forEach((grip) => {
      grip.onpointerdown = (ev) => {
        const row = grip.closest(".ost-hc"), rows = () => [...box.querySelectorAll(".ost-hc:not(.off)")];
        ev.preventDefault();
        grip.setPointerCapture(ev.pointerId);
        row.classList.add("ost-dragging");
        const mid = (r) => { const b = r.getBoundingClientRect(); return b.top + b.height / 2; };
        const place = (y) => {
          for (let q; (q = row.previousElementSibling) && q.classList.contains("ost-hc") && y < mid(q);) row.after(q);
          for (let q; (q = row.nextElementSibling) && q.classList.contains("ost-hc") && !q.classList.contains("off") && y > mid(q);) row.before(q);
        };
        grip.onpointermove = (e) => place(e.clientY);
        grip.onpointerup = grip.onpointercancel = (e) => {
          if (e.type === "pointerup") place(e.clientY);
          grip.onpointermove = grip.onpointerup = grip.onpointercancel = null;
          row.classList.remove("ost-dragging");
          const order = rows().map((r) => r.dataset.card);
          if (order.join() !== H.order.join()) save([...order, ...H.order.filter((c) => !order.includes(c))]);
        };
      };
    });
  },

  renderPrefs() {
    const box = this.panel && this.panel.querySelector(".ost-prefs");
    if (!box) return;
    const P = this.prefs;
    if (!P) { box.innerHTML = ""; return; }
    const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
    const sbar = this.sidebar(), hidden = sbar && sbar.effectiveHiddenPages ? sbar.effectiveHiddenPages() : [];   // pages hidden on this screen only (its own list, or its screen profile's)
    const profiles = (sbar && sbar.config.screens) || [], curProfile = sbar && sbar.screenPreset ? sbar.screenPreset() : null;
    const all = [...P.pages, ...Object.keys(P.names).filter((k) => !P.pages.includes(k))];
    const pal = (window.OpenSkyEventColors && window.OpenSkyEventColors.PALETTE) || {};
    const accents = ["peach", ...Object.keys(pal).filter((c) => c !== "gray")];
    const A = window.OpenSkyAccent;
    const mine = sbar && sbar.deviceAccent ? sbar.deviceAccent() : null;   // this screen's own accent; null = follows the phone setting
    const custom = /^#/.test(mine || "") ? mine : null;   // a color code ("#rrggbb")
    if (this.hexDraft == null) this.hexDraft = custom || "";
    const placeOpts = [["", "Off"], ...P.places.map((x) => [x.path, x.label + (x.freeMB != null ? ` · ${x.freeMB >= 1024 ? Math.round(x.freeMB / 1024) + " GB" : x.freeMB + " MB"} free` : "")])];
    if (P.backup.destination && !P.places.some((x) => x.path === P.backup.destination)) placeOpts.push([P.backup.destination, `${P.backup.destination} (not available now)`]);
    const st = P.status || {};
    const last = st.last ? `${st.ok ? "Last backup" : "Last try"}: ${new Date(st.last).toLocaleString(config.locale || "en-US", { dateStyle: "medium", timeStyle: "short" })}${st.ok ? " ✓" : " — " + esc(st.error || "")}` : "No automatic backup yet.";
    box.innerHTML = `
      ${this.restartNeeded ? `<div class="ost-restart"><span>Some changes show after a restart.</span><button class="ost-btn ost-primary" data-act="${(this.state && this.state.canRestart) ? "restart-app" : "reload"}">Restart now</button></div>` : ""}
      ${this.webForm ? this.webFormHtml(P, esc) : ""}
      <section class="ost-section">
        <h3>Pages</h3>
        <div class="ost-note">The buttons down the left side, top to bottom, on every screen. <b>Hide here</b> hides a button on this screen only.</div>
        ${all.map((k) => { const on = P.pages.includes(k), i = P.pages.indexOf(k); return `
          <div class="ost-row ost-page${on ? "" : " off"}" data-page="${esc(k)}">
            ${on ? `<span class="ost-grip" aria-label="Drag to reorder" title="Drag to reorder"><svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.8"/><circle cx="15" cy="6" r="1.8"/><circle cx="9" cy="12" r="1.8"/><circle cx="15" cy="12" r="1.8"/><circle cx="9" cy="18" r="1.8"/><circle cx="15" cy="18" r="1.8"/></svg></span>` : ""}
            <span class="ost-label">${(P.embeds || []).some((e) => e.key === k) ? `<span class="ost-page-ic">${window.OpenSkyIcons.svg(P.embeds.find((e) => e.key === k).icon)}</span>` : ""}${esc(P.names[k])}</span>
            ${(P.embeds || []).some((e) => e.key === k) ? `<button class="ost-btn ost-small ost-edit-web" data-key="${esc(k)}">Edit</button>` : ""}
            <span class="ost-order">${on ? `<button class="ost-mini" data-move="-1" ${i === 0 ? "disabled" : ""} aria-label="Up">▲</button><button class="ost-mini" data-move="1" ${i === P.pages.length - 1 ? "disabled" : ""} aria-label="Down">▼</button>` : ""}</span>
            ${on && P.pages.length > 1 ? `<button class="ost-btn ost-small ost-here" data-here="${esc(k)}">${hidden.includes(k) ? "Hidden here" : "Hide here"}</button>` : ""}
            ${this.toggle(`page-${k}`, on)}
          </div>`; }).join("")}
        <div class="ost-buttons"><button class="ost-btn ost-add-web">+ Add a web page</button></div>
        <div class="ost-note">A web page gets its own button down the side — a Home Assistant dashboard, a camera, a school portal, any website.</div>
      </section>
      ${this.homeCardsHtml(P, esc)}
      <section class="ost-section">
        <h3>Look &amp; extras</h3>
        <div class="ost-row"><span class="ost-label">Screen profile</span>${profiles.length ? `<span class="ost-seg ost-profiles" data-seg="screenProfile"><button data-v="" class="${curProfile ? "" : "on"}">None</button>${profiles.map((x) => `<button data-v="${esc(x.name)}" class="${curProfile && curProfile.name === x.name ? "on" : ""}">${esc(x.name)}</button>`).join("")}</span>` : `<span class="ost-note">None made yet</span>`}</div>
        <div class="ost-note">${profiles.length ? "A saved set of pages, person, text size and color for this screen. Choosing one drops this screen's own page, text size and color choices below." : "A screen profile is a saved set of pages, person, text size and color (a kitchen screen, a bedroom screen). Make them from your phone: Set up from your phone, Screens."}</div>
        <div class="ost-row"><span class="ost-label">Accent color</span><span class="ost-chips"><button class="ost-btn ost-small ost-accent-default${mine ? "" : " on"}" data-accent-default="1">Default</button>${[...accents, ...(custom ? [custom] : [])].map((c) => `<button class="ost-chip${c === mine ? " on" : ""}" data-accent="${c}" aria-label="${c}"></button>`).join("")}</span></div>
        <div class="ost-note">This screen only; other screens keep their own. Default follows ${curProfile && curProfile.accent ? `the screen profile (${esc(curProfile.accent)})` : `the phone setting (now ${esc(P.prefs.accent)})`}.</div>
        <div class="ost-row"><span class="ost-label">Or a color code</span><span class="ost-swatch"></span><input class="ost-input ost-hex" maxlength="7" data-okb-caps="off" autocomplete="off" spellcheck="false" placeholder="#3b82f6" value="${esc(this.hexDraft)}"><button class="ost-btn ost-hex-use">Use</button></div>
        <div class="ost-note ost-hex-note">Any color as a code, e.g. your team's color (the # is optional).</div>
        <div class="ost-row"><span class="ost-label">Text size</span><span class="ost-seg" data-seg="textSize">${[["default", "Default"], ...Object.entries(window.OpenSkyTextSize.LABELS)].map(([v, l]) => `<button data-v="${v}" class="${(this.deviceSize() || "default") === v ? "on" : ""}">${l}</button>`).join("")}</span></div>
        <div class="ost-note">This screen only; other screens keep their own. Default follows ${curProfile && curProfile.textSize ? `the screen profile (${window.OpenSkyTextSize.LABELS[curProfile.textSize]})` : `the setting from the phone page (now ${window.OpenSkyTextSize.LABELS[P.prefs.textSize] || "Normal"})`}.</div>
        <div class="ost-row"><span class="ost-label">Dark mode</span><span class="ost-seg" data-seg="theme">${[["default", "Default"], ...Object.entries(window.OpenSkyTheme.LABELS)].map(([v, l]) => `<button data-v="${v}" class="${(this.deviceTheme() || "default") === v ? "on" : ""}">${l}</button>`).join("")}</span></div>
        <div class="ost-note">This screen only. Auto is dark from sunset to sunrise (19:00 to 07:00 if no location is set). System follows this device's own light/dark setting. Default follows the setting from the phone page (now ${window.OpenSkyTheme.LABELS[P.prefs.theme] || "Light"}).</div>
        <div class="ost-row"><span class="ost-label">Word game</span><span class="ost-seg" data-seg="wordgame"><button data-v="nyt" class="${P.prefs.wordgame === "nyt" ? "on" : ""}">NYT's daily word</button><button data-v="opensky" class="${P.prefs.wordgame === "opensky" ? "on" : ""}">OpenSky's words</button></span></div>
        <div class="ost-row">${this.toggle("photos", P.prefs.photos)}<span class="ost-label">Photo slideshow on Home</span></div>
        <div class="ost-row"><span class="ost-label">Trash day</span><select class="ost-select" data-pref="trashDay">${[["", "No pickup icons"], ["monday", "Monday"], ["tuesday", "Tuesday"], ["wednesday", "Wednesday"], ["thursday", "Thursday"], ["friday", "Friday"]].map(([v, l]) => `<option value="${v}" ${v === P.prefs.trashDay ? "selected" : ""}>${l}</option>`).join("")}</select></div>
        <div class="ost-row"><span class="ost-label">Event reminders</span><select class="ost-select" data-pref="reminders">${[[0, "Off"], [5, "5 minutes before"], [10, "10 minutes before"], [15, "15 minutes before"], [30, "30 minutes before"]].concat([0, 5, 10, 15, 30].includes(P.prefs.reminders) ? [] : [[P.prefs.reminders, `${P.prefs.reminders} minutes before`]]).map(([v, l]) => `<option value="${v}" ${v === P.prefs.reminders ? "selected" : ""}>${l}</option>`).join("")}</select>${P.prefs.reminders && !this.restartNeeded ? `<button class="ost-btn ost-test-rem">Test</button>` : ""}</div>
        <div class="ost-note">A chime and a banner before an event starts. Which calendars, the chime and the banner: Set up from your phone.</div>
        <div class="ost-note">People, calendars, lists and passwords: Set up from your phone (below), which has the keyboard-friendly forms.</div>
      </section>
      <section class="ost-section">
        <h3>Backups</h3>
        <div class="ost-row"><span class="ost-label">Every night to</span><select class="ost-select ost-wide" data-backup="destination">${placeOpts.map(([v, l]) => `<option value="${esc(v)}" ${v === (P.backup.destination || "") ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></div>
        <div class="ost-row"><span class="ost-label">At</span><select class="ost-select" data-backup="time">${["01:00", "02:00", "03:00", "04:00", "05:00"].map((t) => `<option value="${t}" ${t === P.backup.time ? "selected" : ""}>${this.fmt(t)}</option>`).join("")}</select>
          <span class="ost-label ost-gap">Keep</span><select class="ost-select" data-backup="keep">${[7, 14, 30, 90].map((n) => `<option value="${n}" ${n === P.backup.keep ? "selected" : ""}>${n}</option>`).join("")}</select></div>
        <div class="ost-row">${this.toggle("secrets", P.backup.includeSecrets)}<span class="ost-label">Include passwords &amp; keys</span></div>
        <div class="ost-note${st.ok === false ? " ost-bad" : ""}">${last}</div>
        <div class="ost-note">${this.state && this.state.docker ? "Mount a folder into the container (e.g. <code>/backups</code> in the compose file) and it shows up in the list." : "Plug in a USB stick, or open a network folder on the Pi, and it shows up in the list."}</div>
        <div class="ost-buttons"><button class="ost-btn ost-backup-now">Back up now</button></div>
      </section>`;
    // pages
    box.querySelectorAll(".ost-page").forEach((row) => {
      const k = row.dataset.page;
      row.querySelector(".ost-toggle").onclick = () => {
        const pages = P.pages.includes(k) ? P.pages.filter((x) => x !== k) : [...P.pages, k];
        if (!pages.length) return window.OpenSkyToast("Keep at least one page", "error");
        this.savePrefs({ pages });
      };
      const here = row.querySelector("[data-here]");
      if (here) here.onclick = () => {
        const sb = this.sidebar(), now = sb.effectiveHiddenPages();
        const next = now.includes(k) ? now.filter((x) => x !== k) : [...now, k];
        if (P.pages.every((x) => next.includes(x))) return window.OpenSkyToast("Keep at least one page on this screen", "error");
        sb.setHiddenPages(next);
        this.renderPrefs();
      };
      row.querySelectorAll("[data-move]").forEach((b) => { b.onclick = () => { const pages = [...P.pages], i = pages.indexOf(k), j = i + Number(b.dataset.move); [pages[i], pages[j]] = [pages[j], pages[i]]; this.savePrefs({ pages }); }; });
    });
    // drag a page by its grip to a new place (only turned-on pages have one); the rows move as you drag, the order is saved on release
    box.querySelectorAll(".ost-grip").forEach((grip) => {
      grip.onpointerdown = (ev) => {
        const row = grip.closest(".ost-page"), rows = () => [...box.querySelectorAll(".ost-page:not(.off)")];
        ev.preventDefault();
        grip.setPointerCapture(ev.pointerId);
        row.classList.add("ost-dragging");
        // put the row where the finger is by moving its NEIGHBOURS past it (moving the dragged row itself would drop the pointer capture)
        const mid = (r) => { const b = r.getBoundingClientRect(); return b.top + b.height / 2; };
        const place = (y) => {
          for (let q; (q = row.previousElementSibling) && q.classList.contains("ost-page") && y < mid(q);) row.after(q);
          for (let q; (q = row.nextElementSibling) && q.classList.contains("ost-page") && !q.classList.contains("off") && y > mid(q);) row.before(q);
        };
        grip.onpointermove = (e) => place(e.clientY);
        grip.onpointerup = grip.onpointercancel = (e) => {
          if (e.type === "pointerup") place(e.clientY);
          grip.onpointermove = grip.onpointerup = grip.onpointercancel = null;
          row.classList.remove("ost-dragging");
          const pages = rows().map((r) => r.dataset.page);
          if (pages.join() !== P.pages.join()) this.savePrefs({ pages });
        };
      };
    });
    this.bindHomeCards(box, P);
    box.querySelector(".ost-add-web").onclick =() => { this.webForm = { title: "", url: "", icon: "globe", pin: "" }; this.renderPrefs(); this.focusWebForm(); };
    box.querySelectorAll(".ost-edit-web").forEach((b) => { b.onclick = () => { const e = P.embeds.find((x) => x.key === b.dataset.key); this.webForm = { key: e.key, title: e.title, url: e.url || "", icon: e.icon, locked: e.locked, pin: null }; this.renderPrefs(); this.focusWebForm(); }; });
    if (this.webForm) this.bindWebForm(box);
    const pickAccent = (c) => { const sb = this.sidebar(); if (sb) sb.setAccent(c); this.renderPrefs(); };   // this screen only: nothing is saved on the Pi
    const dflt = box.querySelector("[data-accent-default]");
    if (dflt) dflt.onclick = () => { this.hexDraft = ""; const sb = this.sidebar(); if (sb) sb.setAccent(null); this.renderPrefs(); };
    box.querySelectorAll("[data-accent]").forEach((b) => {
      b.style.setProperty("--c", A.hex(b.dataset.accent));
      b.onclick = () => { this.hexDraft = /^#/.test(b.dataset.accent) ? b.dataset.accent : ""; pickAccent(b.dataset.accent); };
    });
    // a color code: previewed while typing (and a word when it's too light for white button text), used with Use / return
    const hexIn = box.querySelector(".ost-hex"), swatch = box.querySelector(".ost-swatch"), hexNote = box.querySelector(".ost-hex-note");
    const hexNoteText = hexNote.textContent;
    const preview = () => {
      const c = A.code(hexIn.value);
      swatch.classList.toggle("empty", !c);
      if (c) swatch.style.setProperty("--c", c);
      hexNote.classList.toggle("ost-bad", !!(c && A.light(c)));
      hexNote.textContent = c && A.light(c) ? "That color is very light: white text on buttons will be hard to read." : hexNoteText;
    };
    const useHex = () => {
      const c = A.code(hexIn.value);
      if (!c) return window.OpenSkyToast("Type a color code like #3b82f6", "error");
      this.hexDraft = c;
      this.sendNotification("HIDE_KEYBOARD");
      pickAccent(c);
    };
    hexIn.oninput = () => { this.hexDraft = hexIn.value; preview(); };
    hexIn.onkeydown = (e) => { if (e.key === "Enter") useHex(); };
    box.querySelector(".ost-hex-use").onclick = useHex;
    preview();
    box.querySelectorAll('[data-seg="screenProfile"] button').forEach((b) => {
      b.onclick = () => { const sb = this.sidebar(); if (sb) sb.setScreenProfile(b.dataset.v); this.hexDraft = null; this.renderPrefs(); };   // this screen only
    });
    box.querySelectorAll('[data-seg="textSize"] button').forEach((b) => {
      b.onclick = () => { const sb = MM.getModules().withClass("MMM-OpenSky-Sidebar")[0]; if (sb) sb.setTextSize(b.dataset.v); this.renderPrefs(); };   // this screen only: nothing is saved on the Pi
    });
    box.querySelectorAll('[data-seg="theme"] button').forEach((b) => {
      b.onclick = () => { const sb = MM.getModules().withClass("MMM-OpenSky-Sidebar")[0]; if (sb) sb.setTheme(b.dataset.v); this.renderPrefs(); };   // this screen only
    });
    box.querySelectorAll('[data-seg="wordgame"] button').forEach((b) => { b.onclick = () => this.savePrefs({ wordgame: b.dataset.v }); });
    box.querySelector('.ost-toggle[data-id="photos"]').onclick = () => this.savePrefs({ photos: !P.prefs.photos });
    box.querySelector('[data-pref="reminders"]').onchange = (e) => this.savePrefs({ reminders: Number(e.target.value) });
    const remTest = box.querySelector(".ost-test-rem");
    if (remTest) remTest.onclick = () => this.sendNotification("REMINDERS_TEST");
    box.querySelector('[data-pref="trashDay"]').onchange = (e) => this.savePrefs({ trashDay: e.target.value });
    box.querySelectorAll("[data-backup]").forEach((el) => { el.onchange = (e) => this.savePrefs({ backup: { [el.dataset.backup]: el.dataset.backup === "keep" ? Number(e.target.value) : e.target.value } }); });
    box.querySelector('.ost-toggle[data-id="secrets"]').onclick = () => this.savePrefs({ backup: { includeSecrets: !P.backup.includeSecrets } });
    box.querySelector(".ost-backup-now").onclick = (e) => { e.currentTarget.disabled = true; e.currentTarget.textContent = "Backing up…"; this.sendSocketNotification("OS_SET_BACKUP_RUN"); };
    const rb = box.querySelector(".ost-restart [data-act]");
    if (rb) rb.onclick = () => this.system(rb);
  },

  /* ---------------- add / edit a web page ---------------- */
  webFormHtml(P, esc) {
    const f = this.webForm;
    return `
      <section class="ost-section ost-webform">
        <h3>${f.key ? "Edit web page" : "Add a web page"}</h3>
        <div class="ost-row"><span class="ost-label">Name</span><input class="ost-input" data-wf="title" maxlength="24" placeholder="e.g. Smart Home, Cameras, School" value="${esc(f.title)}"></div>
        <div class="ost-row"><span class="ost-label">Address</span><input class="ost-input" data-wf="url" inputmode="url" data-okb-caps="off" placeholder="${f.locked && !f.url ? "Kept private — type to change" : "https://… or http://192.168.1.20:8123"}" value="${esc(f.url)}"></div>
        <div class="ost-row ost-top"><span class="ost-label">Icon</span><span class="ost-icons">${window.OpenSkyIcons.webPage.map((i) => `<button class="ost-icon${i === f.icon ? " on" : ""}" data-icon="${i}" aria-label="${i}">${window.OpenSkyIcons.svg(i)}</button>`).join("")}</span></div>
        <div class="ost-row">${this.toggle("wf-lock", f.locked || !!f.pin)}<span class="ost-label">Lock with a PIN</span>
          <input class="ost-input ost-pin" data-wf="pin" inputmode="numeric" maxlength="8" placeholder="${f.locked ? "PIN set — type a new one" : "4–8 digits"}" ${f.locked || f.pin ? "" : "hidden"}></div>
        <div class="ost-note">With a PIN, the page asks for it every time it opens. Logins inside the page (e.g. Home Assistant) are remembered.</div>
        <div class="ost-err" hidden></div>
        <div class="ost-buttons">
          ${f.key ? `<button class="ost-btn ost-danger ost-wf-remove">Remove</button>` : ""}
          <button class="ost-btn ost-wf-cancel">Cancel</button>
          <button class="ost-btn ost-primary ost-wf-save">${f.key ? "Save" : "Add page"}</button>
        </div>
      </section>`;
  },

  focusWebForm() { setTimeout(() => { const b = this.panel && this.panel.querySelector(".ost-webform"); if (b) { b.scrollIntoView({ block: "start" }); } }, 50); },

  bindWebForm(box) {
    const f = this.webForm, q = (sel) => box.querySelector(sel);
    box.querySelectorAll("[data-wf]").forEach((el) => { el.oninput = () => { f[el.dataset.wf] = el.value; }; });
    box.querySelectorAll("[data-icon]").forEach((b) => { b.onclick = () => { f.icon = b.dataset.icon; box.querySelectorAll("[data-icon]").forEach((x) => x.classList.toggle("on", x === b)); }; });
    const lock = q('.ost-toggle[data-id="wf-lock"]'), pin = q(".ost-pin");
    lock.onclick = () => {
      const on = !lock.classList.contains("on");
      lock.classList.toggle("on", on); pin.hidden = !on;
      if (on) { f.pin = f.pin || ""; pin.focus(); } else { f.pin = f.locked ? "" : null; }   // "" = take the PIN off
      f.lockOn = on;
    };
    const err = (m) => { const e = q(".ost-err"); e.textContent = m; e.hidden = !m; };
    q(".ost-wf-cancel").onclick = () => { this.webForm = null; this.renderPrefs(); };
    const rm = q(".ost-wf-remove");
    if (rm) rm.onclick = () => {
      if (!rm.classList.contains("ost-confirm")) { rm.classList.add("ost-confirm"); rm.textContent = "Tap again to remove"; return; }
      this.savePrefs({ webPage: { remove: f.key } }); this.webForm = null;
    };
    q(".ost-wf-save").onclick = () => {
      const title = String(f.title || "").trim(), url = String(f.url || "").trim();
      if (!title) return err("Please give it a name");
      if (!f.key && !url) return err("Please type the page's address");
      if (url && !/^https?:\/\/\S+$/i.test(url)) return err("The address starts with http:// or https:// (e.g. http://homeassistant.local:8123)");
      const lockOn = f.lockOn !== undefined ? f.lockOn : !!f.locked;
      if (lockOn && !f.locked && !/^\d{4,8}$/.test(String(f.pin || ""))) return err("A PIN is 4 to 8 digits");
      if (lockOn && f.pin && !/^\d{4,8}$/.test(String(f.pin))) return err("A PIN is 4 to 8 digits");
      const pinOut = lockOn ? (f.pin ? String(f.pin) : null) : (f.locked ? "" : null);
      this.savePrefs({ webPage: { key: f.key, title, url, icon: f.icon, pin: pinOut } });
      this.webForm = null;
      window.OpenSkyToast(f.key ? "Saved — restart to see the change" : `“${title}” added — restart to see it in the sidebar`, "success");
    };
  },

  renderStatus() {
    const box = this.panel && this.panel.querySelector(".ost-status");
    if (!box) return;
    const s = this.status;
    if (!s) { box.textContent = "Checking…"; return; }
    const rows = [
      ["Internet", s.internet ? "Connected" : "Not connected"],
      ["Address", s.ip ? `${s.ip}` : "—"],
      ["OpenSky", (s.version || "—") + (s.updates ? ` · ${s.updateTo || "an update"} available` : s.updates === 0 ? " · up to date" : "")]
    ];
    box.innerHTML = rows.map(() => `<div class="ost-stat"><span></span><b></b></div>`).join("");
    box.querySelectorAll(".ost-stat").forEach((el, i) => { el.children[0].textContent = rows[i][0]; el.children[1].textContent = rows[i][1]; });
    const up = this.panel.querySelector(".ost-update");
    if (up) up.hidden = !(s.updates > 0);
  },

  // Restart Pi / Shut down / Update ask once more: the button changes to "Tap again to …" for a few seconds
  system(btn) {
    const act = btn.dataset.act;
    if (act === "reload") { window.location.reload(); return; }
    if (act === "phone") { this.close(); this.sendNotification("OPENSKY_SETUP_OPEN"); return; }
    const confirmText = { "restart-app": null, update: "Tap again to update", reboot: "Tap again to restart", shutdown: "Tap again to shut down" }[act];
    if (confirmText && this.confirming !== act) {
      this.confirming = act;
      const label = btn.textContent;
      btn.textContent = confirmText;
      btn.classList.add("ost-confirm");
      setTimeout(() => { if (this.confirming === act) { this.confirming = null; btn.textContent = label; btn.classList.remove("ost-confirm"); } }, 4000);
      return;
    }
    this.confirming = null;
    this.sendSocketNotification("OS_SET_SYSTEM", { action: act });
    btn.disabled = true;
  },

  /* ---------------- controls ---------------- */
  slider(id, value, min, max) {
    return `<input type="range" class="ost-slider" data-id="${id}" min="${min}" max="${max}" step="5" value="${value}"><span class="ost-value" data-for="${id}">${value}%</span>`;
  },
  toggle(id, on) { return `<button class="ost-toggle${on ? " on" : ""}" data-id="${id}" role="switch" aria-checked="${on}"><span></span></button>`; },
  stepper(id, time) {
    return `<span class="ost-stepper" data-id="${id}" data-time="${time}"><button class="ost-step" data-d="-15" aria-label="Earlier">−</button><span class="ost-time">${this.fmt(time)}</span><button class="ost-step" data-d="15" aria-label="Later">+</button></span>`;
  },
  fmt(t) {
    const [h, m] = t.split(":").map(Number);
    return new Date(2000, 0, 1, h, m).toLocaleTimeString(config.locale || "en-US", { hour: "numeric", minute: "2-digit", hour12: config.timeFormat !== 24 });
  },

  bindSlider(id, send) {
    const el = this.panel.querySelector(`.ost-slider[data-id="${id}"]`);
    if (!el) return;
    const out = this.panel.querySelector(`.ost-value[data-for="${id}"]`);
    let timer = null;
    el.addEventListener("input", () => {
      out.textContent = `${el.value}%`;
      clearTimeout(timer);
      timer = setTimeout(() => send(Number(el.value)), 150);   // follow the finger without flooding the hardware
    });
    el.addEventListener("change", () => { clearTimeout(timer); send(Number(el.value)); });
  },
  bindToggle(id, send) {
    const el = this.panel.querySelector(`.ost-toggle[data-id="${id}"]`);
    el.onclick = () => send(!el.classList.contains("on"));
  },
  bindStepper(id, send) {
    const el = this.panel.querySelector(`.ost-stepper[data-id="${id}"]`);
    el.querySelectorAll(".ost-step").forEach((b) => {
      b.onclick = () => {
        const [h, m] = el.dataset.time.split(":").map(Number);
        const mins = (((h * 60 + m + Number(b.dataset.d)) % 1440) + 1440) % 1440;
        const t = `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
        el.dataset.time = t;
        el.querySelector(".ost-time").textContent = this.fmt(t);
        send(t);
      };
    });
  }
});
