/* MMM-OpenSky-Screensaver
 * After `afterMinutes` without a touch the screen turns into a full-screen photo slideshow with the time, date, weather
 * and an "Up next" list of what is coming today (then tomorrow). Any touch (or key) brings the dashboard back; that
 * touch is swallowed so it doesn't also press a button underneath.
 *
 * - Off unless opensky.json → screensaver.enabled is true (config.js builds this module's config).
 * - Idle time comes from the Sidebar (page touches, web-page touches, the screen service); the screensaver does not
 *   start while the screen sleeps (Sleep cover) or a timer runs on the Timer page, and it ends when the screen goes to
 *   sleep or a timer rings (OPENSKY_WAKE).
 * - Photos: the same source as the Home photo card, one photo at a time, via this module's node helper
 *   (/opensky-saver-photo/<id>). No photos → a dark background; the clock and Up next still show.
 * - Events: any calendar source that broadcasts CALENDAR_EVENTS, ranked by lib/client/day-agenda.js like Home's Today tile.
 * - Weather: the Header's OPENSKY_WEATHER.
 */
Module.register("MMM-OpenSky-Screensaver", {
  defaults: {
    afterMinutes: 10,
    upNext: true,
    showClock: true,
    showWeather: true,
    maxCards: 3,
    hour12: true,
    eventColors: null,
    photos: { enabled: true, provider: "folder", folder: null, usb: true, url: null, intervalSeconds: 20 }
  },

  getStyles() { return ["MMM-OpenSky-Screensaver.css"]; },
  getScripts() { return ["modules/opensky-lib/client/opensky-client.js", "modules/opensky-lib/client/day-agenda.js"]; },

  start() {
    this.pools = new Map();   // sender identifier → events
    this.weather = null;
    this.visible = false;
    this.photoPending = 0;
    if (this.config.afterMinutes > 0) setInterval(() => this.checkIdle(), 5 * 1000);
  },

  // The one clock (scenarios pin it: saver.nowMs = () => …)
  nowMs() { return Date.now(); },
  locale() { return (typeof config !== "undefined" && config.locale) || "en-US"; },
  sidebar() { return MM.getModules().withClass("MMM-OpenSky-Sidebar")[0]; },

  notificationReceived(n, payload, sender) {
    if (n === "DOM_OBJECTS_CREATED") {
      if (window.OpenSkyEventColors) window.OpenSkyEventColors.configure(this.config.eventColors);
      const p = this.config.photos;
      if (p && p.enabled !== false) this.sendSocketNotification("PHOTO_INIT", { provider: p.provider, folder: p.folder, usb: p.usb, url: p.url });
    } else if (n === "CALENDAR_EVENTS" && Array.isArray(payload) && sender) {
      this.pools.set(sender.identifier, payload);
      if (this.visible) this.renderInfo();
    } else if (n === "OPENSKY_WEATHER" && payload) {
      this.weather = payload.current || null;
      if (this.visible) this.renderInfo();
    } else if (n === "OPENSKY_WAKE" || n === "OPENSKY_SLEEP" || (n === "OPENSKY_SCREEN_SLEEP" && payload === true)) {
      this.close(true);
    }
  },

  /* ---------------- when to start ---------------- */
  timerBusy() {
    const t = MM.getModules().withClass("MMM-OpenSky-Timer")[0];
    return !!(t && Array.isArray(t.timers) && t.timers.length);
  },

  checkIdle() {
    if (this.visible || !(this.config.afterMinutes > 0)) return;
    const sb = this.sidebar();
    if (!sb || (sb.isAsleep && sb.isAsleep())) return;
    if (sb.idleSeconds() < this.config.afterMinutes * 60) return;
    const timerPage = (sb.config.pages || []).find((p) => p.key === "timer");
    if (timerPage && sb.activeIndex === timerPage.index && this.timerBusy()) return;
    this.open();
  },

  /* ---------------- show / hide ---------------- */
  open() {
    if (this.visible) return;
    this.visible = true;
    this.sendNotification("HIDE_KEYBOARD");
    this.ensureRoot();
    this.root.hidden = false;
    this.renderInfo();
    requestAnimationFrame(() => requestAnimationFrame(() => this.root.classList.add("on")));
    clearInterval(this.photoTimer);
    this.nextPhoto();
    this.photoTimer = setInterval(() => this.nextPhoto(), Math.max(5, (this.config.photos && this.config.photos.intervalSeconds) || 20) * 1000);
    clearTimeout(this.clockTimer);
    const tick = () => { this.renderInfo(); this.clockTimer = setTimeout(tick, 60000 - (Date.now() % 60000) + 250); };
    this.clockTimer = setTimeout(tick, 60000 - (Date.now() % 60000) + 250);
  },

  // fast: no fade (the screen is going to sleep)
  close(fast) {
    if (!this.visible) return;
    this.visible = false;
    clearInterval(this.photoTimer); clearTimeout(this.clockTimer);
    const sb = this.sidebar();
    if (sb) sb.lastActivity = Date.now();   // the dashboard gets a full idle period again
    const root = this.root;
    root.classList.remove("on");
    if (fast) { root.hidden = true; return; }
    // keep the cover while it fades so the tail of the touch is swallowed too
    setTimeout(() => { if (!this.visible) root.hidden = true; }, 450);
  },

  ensureRoot() {
    if (this.root) return;
    const r = document.createElement("div");
    r.className = "ss-root";
    r.hidden = true;
    r.innerHTML = `<div class="ss-photos"></div><div class="ss-scrim"></div><div class="ss-info"></div>`;
    const swallow = (e) => { e.preventDefault(); e.stopPropagation(); };
    ["pointerdown", "pointerup", "click", "touchstart", "touchend", "mousedown", "mouseup"].forEach((ev) => r.addEventListener(ev, swallow, true));
    r.addEventListener("pointerdown", () => this.close(), true);
    document.addEventListener("keydown", () => { if (this.visible) this.close(); }, true);
    document.body.appendChild(r);
    this.root = r;
  },

  /* ---------------- photos ---------------- */
  nextPhoto() {
    const p = this.config.photos;
    if (!p || p.enabled === false) return;
    if (this.photoPending && Date.now() - this.photoPending < 20000) return;   // one request at a time
    this.photoPending = Date.now();
    this.sendSocketNotification("PHOTO_NEXT", {});
  },

  socketNotificationReceived(n, p) {
    if (n === "PHOTO") this.showPhoto(p);
    else if (n === "PHOTO_ERROR") this.photoPending = 0;
  },

  // Preload, then crossfade. A photo close to the screen's shape fills it; any other is shown whole on a blurred copy
  // of itself (no cropped heads).
  showPhoto(p) {
    const ph = ((p && p.photos) || []).find((x) => x && x.id);
    if (!ph || !this.root) { this.photoPending = 0; return; }
    const url = `/opensky-saver-photo/${encodeURIComponent(ph.id)}`;
    const img = new Image();
    img.onload = () => {
      this.photoPending = 0;
      if (!this.visible) return;
      const box = this.root.getBoundingClientRect();
      const ir = img.naturalWidth / img.naturalHeight, fr = box.width / box.height;
      const kept = ir < fr ? ir / fr : fr / ir;   // crop at most 20% of the height (heads) or 30% of the width
      const cover = box.height > 0 && kept >= (ir < fr ? 0.8 : 0.7);
      const layer = document.createElement("div");
      layer.className = "ss-layer" + (cover ? " cover" : "");
      layer.innerHTML = `<div class="ss-blur"></div><img class="ss-img" alt="">`;
      layer.querySelector(".ss-blur").style.backgroundImage = `url("${url}")`;
      layer.querySelector(".ss-img").src = url;
      const stack = this.root.querySelector(".ss-photos");
      stack.appendChild(layer);
      this.root.classList.add("has-photo");
      this.nudge();
      requestAnimationFrame(() => requestAnimationFrame(() => layer.classList.add("shown")));
      setTimeout(() => [...stack.children].slice(0, -1).forEach((l) => l.remove()), 1800);
    };
    img.onerror = () => { this.photoPending = 0; };
    img.src = url;
  },

  // The text drifts a few pixels with every photo, so a screen left on for months doesn't burn the same pixels
  nudge() {
    const info = this.root.querySelector(".ss-info");
    info.style.setProperty("--ss-dx", `${Math.round(Math.random() * 24 - 12)}px`);
    info.style.setProperty("--ss-dy", `${Math.round(Math.random() * 24 - 12)}px`);
  },

  /* ---------------- events ---------------- */
  normalize(ev) {
    const clean = (v) => (v && v !== "undefined" && v !== "false" ? String(v) : "");
    const start = Number(ev.startDate), end = Number(ev.endDate);
    return {
      title: String(ev.title || "").trim(), calendarName: clean(ev.calendarName),
      startDate: start, endDate: Number.isFinite(end) && end > 0 ? end : start,
      allDay: ev.fullDayEvent === true || ev.fullDayEvent === "true",
      colorName: ev.colorName || null, color: ev.color || "", colors: Array.isArray(ev.colors) ? ev.colors : null
    };
  },

  allEvents() {
    const seen = new Set(), out = [];
    for (const list of this.pools.values()) {
      for (const raw of list) {
        const ev = this.normalize(raw);
        const key = `${ev.title}|${ev.startDate}|${ev.calendarName}`;
        if (ev.title && Number.isFinite(ev.startDate) && !seen.has(key)) { seen.add(key); out.push(ev); }
      }
    }
    return out;
  },

  // "7pm", "7:30pm" (12 h) or "19:30" (24 h)
  timeText(ms) {
    const d = new Date(ms);
    if (!this.config.hour12) return d.toLocaleTimeString(this.locale(), { hour: "2-digit", minute: "2-digit", hour12: false });
    const h = d.getHours() % 12 || 12, m = d.getMinutes();
    return `${h}${m ? ":" + String(m).padStart(2, "0") : ""}${d.getHours() >= 12 ? "pm" : "am"}`;
  },

  // What the "Up next" list shows: [{ title, sub, ev }] and how many more events there are today
  upNext(now) {
    const max = Math.max(1, this.config.maxCards || 3), A = window.OpenSkyDayAgenda;
    const d = new Date(now);
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(), dayEnd = dayStart + 24 * 3600 * 1000;
    const end = (e) => (e.endDate > e.startDate ? e.endDate : e.startDate);
    const all = this.allEvents();
    const today = all.filter((e) => e.startDate < dayEnd && end(e) >= dayStart && !(end(e) === dayStart && e.endDate > e.startDate));
    const a = A.rank(today, now, { cap: max, maxStrips: 1, graceMin: 0 });
    const cards = [];
    for (const ev of a.strips) cards.push({ ev, title: ev.title, sub: "All day" });
    for (const r of a.rows) {
      if (r.kind === "recent") continue;
      cards.push(r.kind === "live"
        ? { ev: r.ev, live: true, title: r.ev.title, sub: `Now · until ${this.timeText(r.ev.endDate)}` }
        : { ev: r.ev, title: r.ev.title, sub: this.timeText(r.ev.startDate) + (r.relText ? ` · ${r.relText}` : "") });
    }
    let more = a.more + Math.max(0, cards.length - max);
    cards.length = Math.min(cards.length, max);
    // room left: the start of tomorrow
    if (cards.length < max && !more) {
      const tom = all.filter((e) => e.startDate >= dayEnd && e.startDate < dayEnd + 24 * 3600 * 1000)
        .sort((x, y) => (y.allDay ? 0 : 1) - (x.allDay ? 0 : 1) || x.startDate - y.startDate);
      for (const ev of tom) {
        if (cards.length >= max) break;
        cards.push({ ev, title: ev.title, sub: `Tomorrow, ${ev.allDay ? "all day" : this.timeText(ev.startDate)}` });
      }
    }
    return { cards, more };
  },

  /* ---------------- drawing ---------------- */
  renderInfo() {
    const info = this.root && this.root.querySelector(".ss-info");
    if (!info) return;
    const now = this.nowMs(), d = new Date(now), c = this.config;
    const frag = document.createDocumentFragment();
    const add = (cls, text) => { const el = document.createElement("div"); el.className = cls; el.textContent = text; frag.appendChild(el); return el; };

    if (c.showWeather && this.weather && this.weather.temp != null) {
      const w = document.createElement("div");
      w.className = "ss-weather";
      const hdr = MM.getModules().withClass("MMM-OpenSky-Header")[0];
      const ico = document.createElement("span");
      ico.className = "ss-wx-ico";
      if (hdr && hdr._svgForWeatherId && this.weather.id != null) ico.innerHTML = hdr._svgForWeatherId(this.weather.id);   // (our own inline SVG)
      w.append(ico, document.createTextNode(`${Math.round(this.weather.temp)}°`));
      frag.appendChild(w);
    }
    add("ss-date", d.toLocaleDateString(this.locale(), { weekday: "short", month: "short", day: "numeric" }));
    if (c.showClock) {
      const h = c.hour12 ? d.getHours() % 12 || 12 : String(d.getHours()).padStart(2, "0");
      add("ss-clock", `${h}:${String(d.getMinutes()).padStart(2, "0")}`);
    }

    if (c.upNext) {
      const { cards, more } = this.upNext(now);
      const box = document.createElement("div");
      box.className = "ss-next";
      const head = document.createElement("div"); head.className = "ss-next-head"; head.textContent = "Up next"; box.appendChild(head);
      const EC = window.OpenSkyEventColors;
      if (!cards.length) {
        const empty = document.createElement("div"); empty.className = "ss-card ss-card-empty";
        empty.textContent = "Nothing else on the calendar today"; box.appendChild(empty);
      }
      cards.forEach((k) => {
        const card = document.createElement("div");
        card.className = "ss-card";
        if (EC) card.setAttribute("style", EC.vars(k.ev));   // the dashboard's pale calendar color (--evc-bg / --evc-bar)
        if (k.live) card.classList.add("live");
        const main = document.createElement("div"); main.className = "ss-card-main";
        const t = document.createElement("div"); t.className = "ss-card-title"; t.textContent = k.title;
        const s = document.createElement("div"); s.className = "ss-card-sub"; s.textContent = k.sub;
        main.append(t, s); card.appendChild(main);
        if (k.ev.calendarName) {
          const who = document.createElement("span"); who.className = "ss-badge";
          who.textContent = Array.from(k.ev.calendarName)[0].toUpperCase();
          who.setAttribute("aria-hidden", "true");
          card.appendChild(who);
        }
        box.appendChild(card);
      });
      if (more > 0) { const m = document.createElement("div"); m.className = "ss-more"; m.textContent = `+${more} more event${more === 1 ? "" : "s"} today`; box.appendChild(m); }
      frag.appendChild(box);
    }
    info.replaceChildren(frag);
  }
});
