/* MMM-OpenSky-WeatherPage - the full-screen Weather page, laid out for reading across a room:
 *   Right now (sky card + one sentence) · Next 24 hours (curve, rain chance) · Plan around it (4 periods + a clothing tip) ·
 *   This week (shared-scale bars) · a rain radar inset that opens a full-screen radar (back button, zoom, play/pause, scrubber).
 * Each part is its own setting (opensky.json -> weather.hourly / .alerts / .radar, all on unless set to false; phone setup -> Weather).
 * Data: this module's node helper (OS_WX_DATA: hourly + current detail, alerts, radar frames); the week's highs, lows and icons are the
 * header's shared forecast (OPENSKY_WEATHER), the very same the Home calendar shows, so the two screens never disagree.
 * Alerts are summarised for the header's pill (OPENSKY_WX_ALERTS); the pill opens the full text here (OPENSKY_WX_ALERTS_OPEN).
 * All words are computed in lib/client/weather-copy.js. Everything from outside goes in as text, never HTML. A refresh only redraws
 * a part whose data changed, so nothing jumps.
 */
Module.register("MMM-OpenSky-WeatherPage", {
  defaults: {
    latitude: null, longitude: null, units: "imperial", placeName: "",
    hourly: true, alerts: true, radar: true,
    hour12: true, refreshMinutes: 10
  },

  getStyles() { return ["MMM-OpenSky-WeatherPage.css"]; },
  getScripts() { return ["modules/opensky-lib/client/opensky-client.js", "modules/opensky-lib/client/weather-copy.js"]; },

  start() {
    this.state = {};            // the last OS_WX_DATA of each part (a part that fails later keeps showing its last good data)
    this.shared = null;         // the header's OPENSKY_WEATHER { current, daily, units }
    this.sig = {};              // what each part last drew, so an unchanged refresh draws nothing
    this.zoom = 6;
    this.playing = true;
    this.frame = 0;
    this.fullOpen = false;
    this.located = Number.isFinite(this.config.latitude) && Number.isFinite(this.config.longitude);
    if (this.located && (this.config.hourly || this.config.alerts || this.config.radar)) this.sendSocketNotification("OS_WX_INIT", this.config);
  },

  el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; },
  icon(name) { return window.OpenSkyIcons ? window.OpenSkyIcons.svg(name) : ""; },
  locale() { return (typeof config !== "undefined" && config.locale) || "en-US"; },
  wxIcon(id) {
    const hd = MM.getModules().withClass("MMM-OpenSky-Header")[0];
    return hd && typeof hd._svgForWeatherId === "function" && id != null ? hd._svgForWeatherId(id) : "";
  },
  fmtTime(ms) { return new Date(ms).toLocaleTimeString(this.locale(), { hour: "numeric", minute: "2-digit", hour12: this.config.hour12 }); },
  imperial() { return this.config.units !== "metric"; },
  copy() { return window.OpenSkyWeatherCopy; },

  getDom() {
    if (!this.root) {
      this.root = this.el("div", "wp-root");
      this.root.innerHTML = `
        <div class="wp-msg" hidden></div>
        <div class="wp-main">
          <div class="wp-row">
            <section class="wp-hero" aria-label="Right now" data-sky="clear-day">
              <div>
                <div class="wp-hero-place"></div>
                <div class="wp-hero-temp"><span class="wp-big">--°</span><span class="wp-hero-ico" aria-hidden="true"></span></div>
                <div class="wp-hero-cond"></div>
              </div>
              <div>
                <p class="wp-hero-text"></p>
                <div class="wp-stats"></div>
              </div>
            </section>
            <section class="wp-day wp-card" aria-label="Next 24 hours">
              <div class="wp-day-head"><h2 class="wp-h2">Next 24 hours</h2><span class="wp-sub"></span></div>
              <p class="wp-note" hidden></p>
              <div class="wp-chart" aria-hidden="true">
                <svg viewBox="0 0 1000 260" preserveAspectRatio="none"></svg>
                <div class="wp-marks"></div>
              </div>
              <div class="wp-ticks" aria-hidden="true"></div>
              <div class="wp-rain" hidden>
                <span class="wp-rain-l">Rain chance</span>
                <div class="wp-rain-bar" aria-hidden="true"><i></i></div>
                <b class="wp-rain-t"></b>
              </div>
            </section>
          </div>
          <section class="wp-plan" aria-label="Plan around the weather">
            <h2 class="wp-h2">Plan around it</h2>
            <div class="wp-plans"></div>
          </section>
          <div class="wp-row wp-row-c">
            <section class="wp-week wp-card" aria-label="This week">
              <h2 class="wp-h2">This week</h2>
              <div class="wp-cap">Bars share one scale, so you can compare days at a glance.</div>
              <div class="wp-days"></div>
            </section>
            <section class="wp-radar wp-card" aria-label="Rain radar">
              <div class="wp-radar-head"><h2 class="wp-h2">Radar</h2><span class="wp-stamp"></span><span class="wp-hint">Tap to expand</span></div>
              <div class="wp-inset"><div class="wp-slot"></div><button type="button" class="wp-open-full" aria-label="Open full radar"></button></div>
              <div class="wp-radar-status"></div>
              <div class="wp-credit">Map &copy; Esri, HERE, Garmin, OpenStreetMap contributors &middot; radar RainViewer</div>
            </section>
          </div>
        </div>
        <div class="wp-full" hidden>
          <header class="wp-full-head">
            <button type="button" class="wp-back">${'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>'}<span>Weather</span></button>
            <h1 class="wp-full-title">Rain radar</h1>
            <span class="wp-stamp wp-stamp-full"></span>
            <span class="wp-dry"></span>
          </header>
          <div class="wp-stage">
            <div class="wp-map-ctl">
              <button type="button" class="wp-btn wp-zin" aria-label="Zoom in"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></button>
              <button type="button" class="wp-btn wp-zout" aria-label="Zoom out"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M5 12h14"/></svg></button>
            </div>
            <div class="wp-bar">
              <button type="button" class="wp-btn wp-play"></button>
              <div class="wp-scrub">
                <div class="wp-scrub-l"><span class="wp-t0"></span><span>Past hour</span><span class="wp-t1"></span></div>
                <input type="range" class="wp-range" min="0" max="0" step="1" value="0" aria-label="Radar time">
              </div>
              <div class="wp-legend"><span>Light</span><i aria-hidden="true"></i><span>Heavy</span></div>
            </div>
          </div>
          <div class="wp-credit wp-credit-full">Map &copy; Esri, HERE, Garmin, OpenStreetMap contributors &middot; radar RainViewer</div>
        </div>
        <div class="wp-modal" hidden>
          <div class="wp-modal-card" role="dialog" aria-label="Weather alerts">
            <div class="wp-modal-head"><h2 class="wp-h2">Weather alerts</h2><button type="button" class="wp-modal-x">Close</button></div>
            <div class="wp-alert-list"></div>
          </div>
        </div>`;
      const q = (s) => this.root.querySelector(s);
      // the map lives in the inset; the full view borrows it
      this.map = this.el("div", "wp-map");
      this.map.innerHTML = `<div class="wp-tiles"></div>
        <div class="wp-pin"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="rgba(255,255,255,.55)"/><circle cx="12" cy="12" r="5.5" fill="#c93a19" stroke="#fff" stroke-width="2.5"/></svg></div>
        <div class="wp-map-msg" hidden></div>`;
      q(".wp-slot").append(this.map);
      q(".wp-open-full").onclick = () => this.openFull();
      q(".wp-back").onclick = () => this.closeFull();
      q(".wp-zin").onclick = () => this.setZoom(this.zoom + 1);
      q(".wp-zout").onclick = () => this.setZoom(this.zoom - 1);
      q(".wp-play").onclick = () => { this.playing = !this.playing; this.drawPlay(); if (this.playing) this.startLoop(); else clearTimeout(this.loop); };
      q(".wp-range").oninput = (e) => { this.playing = false; this.drawPlay(); clearTimeout(this.loop); this.frame = Number(e.target.value) || 0; this.showFrame(); };
      q(".wp-modal-x").onclick = () => { q(".wp-modal").hidden = true; };
      q(".wp-modal").onclick = (e) => { if (e.target === q(".wp-modal")) q(".wp-modal").hidden = true; };
      this.drawPlay();
      if (window.ResizeObserver) new ResizeObserver(() => { clearTimeout(this.rz); this.rz = setTimeout(() => this.buildMap(), 200); }).observe(this.map);
    }
    this.render();
    return this.root;
  },

  notificationReceived(n, p) {
    if (n === "DOM_OBJECTS_CREATED" && !this.hidden) this.sendSocketNotification("OS_WX_REFRESH");
    else if (n === "OPENSKY_WEATHER" && p) { this.shared = p; this.render(); }
    else if (n === "OPENSKY_WX_ALERTS_OPEN") this.openAlerts();
  },
  socketNotificationReceived(n, p) {
    if (n !== "OS_WX_DATA" || !p) return;
    for (const k of ["hourly", "alerts", "radar"]) {
      if (!p[k]) continue;
      const old = this.state[k];
      this.state[k] = p[k].ok || !old || !old.ok ? p[k] : { ...old, stale: p[k].error };   // keep the last good data, note the failure
    }
    this.render();
    if (p.alerts) this.broadcastAlerts();
    if (p.radar && p.radar.ok) this.buildMap();
  },
  resume() { this.sendSocketNotification("OS_WX_REFRESH"); this.render(); this.buildMap(); },
  suspend() { clearTimeout(this.loop); this.loop = null; if (this.fullOpen) this.closeFull(true); },

  // the header's pill: nothing known / none / the alerts
  broadcastAlerts() {
    const d = this.state.alerts;
    let out = { state: "unknown", alerts: [] };
    if (d && d.ok && d.supported !== false) out = d.alerts.length ? { state: "alerts", alerts: d.alerts.map((a) => ({ event: a.event, severity: a.severity })) } : { state: "none", alerts: [] };
    const key = JSON.stringify(out);
    if (key === this.sentAlerts) return;
    this.sentAlerts = key;
    this.sendNotification("OPENSKY_WX_ALERTS", out);
  },

  render() {
    if (!this.root) return;
    const c = this.config, q = (s) => this.root.querySelector(s), st = this.state;
    const msg = q(".wp-msg");
    const none = !c.hourly && !c.alerts && !c.radar;
    msg.hidden = this.located && !none;
    msg.textContent = !this.located ? "Set your town to see the weather: Settings → Set up from your phone → Family."
      : none ? "All the weather extras are switched off. Turn them on from your phone: Settings → Set up from your phone → Weather." : "";
    q(".wp-main").hidden = !this.located;
    if (!this.located) return;
    q(".wp-day").hidden = !c.hourly;
    q(".wp-plan").hidden = !c.hourly;
    q(".wp-radar").hidden = !c.radar;
    this.root.classList.toggle("wp-no-radar", !c.radar);
    this.root.classList.toggle("wp-no-hourly", !c.hourly);
    this.once("hero", [st.hourly, this.shared], () => this.renderHero());
    if (c.hourly) {
      this.once("day", [st.hourly], () => this.renderDay(st.hourly));
      this.once("plan", [st.hourly, this.shared], () => this.renderPlan());
    }
    this.once("week", [st.hourly, this.shared], () => this.renderWeek());
    if (c.alerts && this.root.querySelector(".wp-modal:not([hidden])")) this.renderAlerts(st.alerts);
    if (c.radar) { this.once("rstatus", [st.hourly, st.radar, this.shared], () => this.renderRadarStatus()); this.renderRadarMsg(); }
  },
  // draw a part only when what it shows changed (a refresh must not make the page jump)
  once(key, inputs, draw) {
    const sig = JSON.stringify(inputs);
    if (this.sig[key] === sig) return;
    this.sig[key] = sig;
    draw();
  },

  /* ---------------- helpers over the data ---------------- */
  hours() { const h = this.state.hourly; return h && h.ok && Array.isArray(h.hours) && h.hours.length ? h.hours : null; },
  current() {
    const h = this.state.hourly, s = this.shared && this.shared.current;
    const c = h && h.ok && h.current ? h.current : null;
    if (c && c.temp != null) return c;
    return s ? { temp: s.temp, id: s.id, feels: null, wind: null, humidity: null, isDay: true } : null;
  },
  isDayNow() {
    const c = this.current(); if (c && c.isDay === false) return false;
    return true;
  },
  localKey(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; },
  tomorrow() {
    const d = new Date(); d.setDate(d.getDate() + 1);
    const k = this.localKey(d), day = this.shared && this.shared.daily && this.shared.daily[k], h = this.state.hourly;
    if (!day) return null;
    return { high: day.high, low: day.low, id: day.id, rain: h && h.ok && h.rainDays && h.rainDays[k] != null ? h.rainDays[k] : null };
  },

  /* ---------------- right now ---------------- */
  renderHero() {
    const W = this.copy(), q = (s) => this.root.querySelector(s), c = this.current(), hrs = this.hours();
    q(".wp-hero-place").textContent = `${this.config.placeName ? this.config.placeName + " · " : ""}Now`;
    q(".wp-big").textContent = c && c.temp != null ? `${c.temp}°` : "--°";
    q(".wp-hero-ico").innerHTML = c ? this.wxIcon(c.id) : "";
    const day = this.isDayNow();
    q(".wp-hero-cond").textContent = c ? W.condLabel(c.id, c.temp, day, this.config.units) : "";
    q(".wp-hero").dataset.sky = c ? W.skyKind(c.id, day) : "clear-day";
    q(".wp-hero-text").textContent = hrs ? W.sentence(hrs, { units: this.config.units, hour12: this.config.hour12 }) : (this.config.hourly && !this.state.hourly ? "Loading the forecast…" : "");
    const stats = q(".wp-stats");
    stats.replaceChildren();
    const unit = this.imperial() ? "mph" : "km/h";
    [["Feels like", c && c.feels != null ? `${c.feels}°` : null], ["Wind", c && c.wind != null ? `${c.wind} ${unit}` : null], ["Humidity", c && c.humidity != null ? `${c.humidity}%` : null]]
      .filter((s) => s[1] != null).forEach(([l, v]) => { const d = this.el("div", "wp-stat"); d.append(this.el("div", "wp-stat-l", l), this.el("div", "wp-stat-v", v)); stats.append(d); });
  },

  /* ---------------- next 24 hours ---------------- */
  renderDay(d) {
    const W = this.copy(), q = (s) => this.root.querySelector(s), note = q(".wp-day .wp-note");
    const hrs = this.hours();
    note.hidden = true;
    if (!d) { note.textContent = "Loading the forecast…"; note.hidden = false; }
    else if (!d.ok) { note.textContent = `The hourly forecast can't be loaded right now (${d.error}). It tries again in a few minutes.`; note.hidden = false; }
    else if (d.stale) { note.textContent = `Showing the last forecast we got. ${d.stale}`; note.hidden = false; }
    const svg = q(".wp-chart svg"), marks = q(".wp-marks"), ticks = q(".wp-ticks");
    marks.replaceChildren(); ticks.replaceChildren();
    q(".wp-rain").hidden = true;
    if (!hrs) { svg.innerHTML = ""; q(".wp-sub").textContent = ""; return; }
    const e = W.extremes(hrs), cv = W.curve(hrs), h12 = this.config.hour12;
    q(".wp-sub").textContent = `High ${e.high}° at ${W.hourLabel(e.highHour, h12)} · Low ${e.low}° at ${W.hourLabel(e.lowHour, h12)}`;
    svg.innerHTML = `<defs><linearGradient id="wpfill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="var(--os-accent)" stop-opacity=".28"/><stop offset="100%" stop-color="var(--os-accent)" stop-opacity="0"/></linearGradient></defs>` +
      [65, 130, 195].map((y) => `<line x1="0" y1="${y}" x2="1000" y2="${y}" stroke="#ece8f1" stroke-width="1" vector-effect="non-scaling-stroke"/>`).join("") +
      `<path d="${cv.area}" fill="url(#wpfill)"/><path class="wp-line" d="${cv.line}" fill="none" stroke="var(--os-accent)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`;
    // Now / High / Low; a High or Low right next to Now only gets its dot (the line above says it)
    const spots = [{ i: 0, label: `Now ${hrs[0].temp}°`, now: true }];
    if (e.highIdx !== 0) spots.push({ i: e.highIdx, label: `High ${e.high}°` });
    if (e.lowIdx !== 0 && e.lowIdx !== e.highIdx) spots.push({ i: e.lowIdx, label: `Low ${e.low}°` });
    spots.forEach((s) => {
      const p = cv.pts[s.i], m = this.el("div", "wp-mark");
      m.style.left = `${p.x}%`; m.style.top = `${p.y}%`;
      if (!s.now && s.i <= 2) m.append(this.el("i", "wp-dot"));
      else m.append(this.el("span", "wp-mark-l", s.label), this.el("i", `wp-dot${s.now ? " wp-dot-now" : ""}`));
      marks.append(m);
    });
    for (let i = 0; i < hrs.length; i += 3) { const t = this.el("span", "wp-tick", i === 0 ? "Now" : W.hourLabel(hrs[i].hour, h12)); t.style.left = `${cv.pts[i].x}%`; ticks.append(t); }
    const rs = W.rainStrip(hrs, { hour12: h12 });
    if (rs) {
      q(".wp-rain").hidden = false;
      q(".wp-rain-bar i").style.width = `${Math.max(3, rs.max)}%`;
      q(".wp-rain-t").textContent = rs.text;
      q(".wp-rain-bar").title = `Highest chance of rain ${rs.max}%`;
    }
  },

  /* ---------------- plan around it ---------------- */
  renderPlan() {
    const W = this.copy(), box = this.root.querySelector(".wp-plans");
    box.replaceChildren();
    const hrs = this.hours();
    if (!hrs && !this.tomorrow()) { this.root.querySelector(".wp-plan").hidden = true; return; }
    this.root.querySelector(".wp-plan").hidden = !this.config.hourly;
    W.plans(hrs || [], this.tomorrow(), { units: this.config.units, hour12: this.config.hour12 }).forEach((p) => {
      const card = this.el("div", "wp-pcard");
      card.append(this.el("div", "wp-pwhen", p.when), this.el("div", "wp-prange", p.range), this.el("div", "wp-ptext", p.text), this.el("div", `wp-chip wp-chip-${p.chip.key}`, p.chip.label));
      box.append(card);
    });
  },

  /* ---------------- this week ---------------- */
  renderWeek() {
    const W = this.copy(), box = this.root.querySelector(".wp-days"), daily = this.shared && this.shared.daily;
    box.replaceChildren();
    if (!daily) { box.append(this.el("p", "wp-note", "Loading the forecast…")); return; }
    const today = this.localKey(new Date());
    const keys = Object.keys(daily).filter((k) => k > today).sort().slice(0, 6);
    if (!keys.length) { box.append(this.el("p", "wp-note", "No forecast for the coming days yet.")); return; }
    const rainDays = (this.state.hourly && this.state.hourly.ok && this.state.hourly.rainDays) || {};
    const bars = W.weekBars(keys.map((k) => daily[k]));
    keys.forEach((k, i) => {
      const d = daily[k], dt = new Date(`${k}T12:00:00`), rain = rainDays[k];
      const row = this.el("div", "wp-day-row");
      const name = this.el("div", "wp-wk-day", dt.toLocaleDateString(this.locale(), { weekday: "short" }));
      name.append(" ", this.el("span", "", String(dt.getDate())));
      const ico = this.el("div", "wp-wk-ico"); ico.setAttribute("aria-hidden", "true"); ico.innerHTML = this.wxIcon(d.id);   // (our own inline SVG, chosen by a number)
      const pill = this.el("div", "wp-wk-rain", rain != null && rain >= 30 ? `${rain}%` : "");
      if (pill.textContent) pill.setAttribute("aria-label", `${rain}% chance of rain`);
      const bar = this.el("div", "wp-wk-bar"); bar.setAttribute("aria-hidden", "true");
      const fill = this.el("i"); fill.style.left = `${bars[i].left}%`; fill.style.width = `${bars[i].span}%`; bar.append(fill);
      row.append(name, ico, this.el("div", "wp-wk-note", W.condLabel(d.id, d.high, true, this.config.units)), pill, this.el("div", "wp-wk-lo", `${d.low}°`), bar, this.el("div", "wp-wk-hi", `${d.high}°`));
      box.append(row);
    });
  },

  /* ---------------- alerts (the header's pill opens this) ---------------- */
  openAlerts() {
    if (!this.root) return;
    this.root.querySelector(".wp-modal").hidden = false;
    this.renderAlerts(this.state.alerts);
  },
  renderAlerts(d) {
    const box = this.root.querySelector(".wp-alert-list");
    box.replaceChildren();
    const say = (t) => box.append(this.el("p", "wp-note", t));
    if (!d) return say("Checking for alerts…");
    if (!d.ok) return say(`Weather alerts can't be checked right now (${d.error}). They are checked again in a few minutes.`);
    if (d.supported === false) return say("Weather alerts come from the US National Weather Service, so there are none to show for this location.");
    if (!d.alerts.length) return say("No weather alerts for your area.");
    d.alerts.forEach((a) => {
      const card = this.el("div", `wp-alert wp-sev-${a.severity}`);
      const top = this.el("div", "wp-alert-top");
      top.append(this.el("b", "wp-alert-event", a.event), this.el("small", "wp-alert-sev", a.severity));
      card.append(top);
      if (a.headline) card.append(this.el("div", "wp-alert-head", a.headline));
      if (a.ends) {
        const t = new Date(a.ends);
        if (!isNaN(t)) card.append(this.el("small", "wp-alert-until", `Until ${t.toLocaleString(this.locale(), { weekday: "short", hour: "numeric", minute: "2-digit", hour12: this.config.hour12 })}`));
      }
      if (a.text) card.append(this.el("div", "wp-alert-more", a.text));
      box.append(card);
    });
  },

  /* ---------------- radar ---------------- */
  openFull() {
    const q = (s) => this.root.querySelector(s);
    this.fullOpen = true; this.zoom = 6;
    q(".wp-stage").prepend(this.map);
    q(".wp-full").hidden = false;
    this.setZoom(6);
    this.renderRadarStatus();
    q(".wp-back").focus({ preventScroll: true });
    setTimeout(() => this.buildMap(), 60);
  },
  closeFull(quiet) {
    const q = (s) => this.root.querySelector(s);
    this.fullOpen = false; this.zoom = 6;
    q(".wp-full").hidden = true;
    q(".wp-slot").append(this.map);
    if (!quiet) setTimeout(() => this.buildMap(), 60);
  },
  renderRadarStatus() {
    const W = this.copy(), q = (s) => this.root.querySelector(s), hrs = this.hours(), c = this.current();
    if (!hrs && !c) { q(".wp-radar-status").textContent = ""; q(".wp-dry").hidden = true; return; }
    const s = W.radarStatus(hrs || [], c && c.id), town = (this.config.placeName || "").split(",")[0].trim() || "you";
    q(".wp-radar-status").textContent = s.text;
    const dry = q(".wp-dry");
    dry.hidden = false;
    dry.classList.toggle("wp-wet", !s.dry);
    dry.textContent = !s.dry ? `Rain near ${town}` : s.hours >= 24 ? `Dry near ${town} for the next 24 hours` : `Dry near ${town} for the next ${s.hours} hour${s.hours === 1 ? "" : "s"}`;
  },
  drawPlay() {
    const b = this.root && this.root.querySelector(".wp-play");
    if (!b) return;
    b.innerHTML = this.playing ? '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
    b.setAttribute("aria-label", this.playing ? "Pause the radar" : "Play the radar");
  },
  setZoom(z) {
    this.zoom = Math.max(4, Math.min(7, z));
    this.root.querySelector(".wp-zin").disabled = this.zoom >= 7;
    this.root.querySelector(".wp-zout").disabled = this.zoom <= 4;
    this.buildMap();
  },

  // the world pixel of a place at a zoom level (the usual web-map projection)
  project(lat, lon, z) {
    const n = 256 * Math.pow(2, z), s = Math.sin(lat * Math.PI / 180);
    return { x: (lon + 180) / 360 * n, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n };
  },

  buildMap() {
    const d = this.state.radar;
    if (!this.root || !this.located || !this.config.radar || !d || !d.ok) return;
    const map = this.map, tiles = map.querySelector(".wp-tiles");
    const W = map.clientWidth, H = map.clientHeight;
    if (!W || !H) return;   // (hidden or not laid out yet: the resize observer and resume() call again)
    clearTimeout(this.loop); clearTimeout(this.giveUp);
    tiles.replaceChildren();
    this.tally = { baseOk: 0, baseBad: 0, radarOk: 0, radarBad: 0 };
    this.mapBroken = false;
    const z = this.zoom, c = this.project(this.config.latitude, this.config.longitude, z), T = 256;
    const left = c.x - W / 2, top = c.y - H / 2, maxIdx = Math.pow(2, z);
    const layers = [this.el("div", "wp-layer wp-base"), ...d.frames.map(() => this.el("div", "wp-layer wp-frame"))];
    layers.forEach((l) => tiles.append(l));
    this.frames = layers.slice(1);
    const fill = (tpl, layer, k) => {
      for (let ty = Math.floor(top / T); ty <= Math.floor((top + H) / T); ty++) {
        if (ty < 0 || ty >= maxIdx) continue;
        for (let tx = Math.floor(left / T); tx <= Math.floor((left + W) / T); tx++) {
          const img = document.createElement("img");
          img.alt = ""; img.draggable = false;
          img.style.left = `${Math.round(tx * T - left)}px`; img.style.top = `${Math.round(ty * T - top)}px`;
          img.onload = () => { this.tally[k + "Ok"]++; this.checkMap(false); };
          img.onerror = () => { img.remove(); this.tally[k + "Bad"]++; this.checkMap(false); };
          img.src = tpl.replace("{z}", z).replace("{x}", ((tx % maxIdx) + maxIdx) % maxIdx).replace("{y}", ty);
          layer.append(img);
        }
      }
    };
    fill(d.base, layers[0], "base");
    d.frames.forEach((f, i) => fill(f.url, this.frames[i], "radar"));
    this.frame = d.frames.length - 1;
    const r = this.root.querySelector(".wp-range");
    r.max = String(d.frames.length - 1);
    this.root.querySelector(".wp-t0").textContent = this.fmtTime(d.frames[0].time * 1000);
    this.root.querySelector(".wp-t1").textContent = this.fmtTime(d.frames[d.frames.length - 1].time * 1000);
    this.showFrame();
    this.giveUp = setTimeout(() => this.checkMap(true), 8000);
    if (this.playing) this.startLoop();
  },
  // nothing at all loaded (no internet, or the map service is down): say so instead of a blank box
  checkMap(final) {
    const t = this.tally || {};
    this.mapBroken = t.radarOk === 0 && t.baseOk === 0 && (t.radarBad + t.baseBad >= 6 || (final && t.radarBad + t.baseBad > 0));
    this.renderRadarMsg();
  },
  renderRadarMsg() {
    const m = this.map && this.map.querySelector(".wp-map-msg"), d = this.state.radar;
    if (!m) return;
    let text = "";
    if (!d) text = "Loading the radar…";
    else if (!d.ok) text = `The radar can't be loaded right now (${d.error}). It tries again in a few minutes.`;
    else if (this.mapBroken) text = "The radar map can't be reached right now. Is the internet connected? It tries again in a few minutes.";
    m.textContent = text; m.hidden = !text;
  },
  showFrame() {
    const d = this.state.radar;
    if (!d || !d.ok || !this.frames) return;
    this.frames.forEach((f, i) => f.classList.toggle("on", i === this.frame));
    const f = d.frames[this.frame], t = f ? this.fmtTime(f.time * 1000) : "";
    this.root.querySelectorAll(".wp-stamp").forEach((e) => { e.textContent = t; });
    this.root.querySelector(".wp-range").value = String(this.frame);
  },
  startLoop() {
    clearTimeout(this.loop);
    const d = this.state.radar;
    if (!d || !d.ok || this.hidden || d.frames.length < 2) return;
    const step = () => {
      this.frame = (this.frame + 1) % d.frames.length;
      this.showFrame();
      this.loop = setTimeout(step, this.frame === d.frames.length - 1 ? 1800 : 600);
    };
    this.loop = setTimeout(step, 600);
  }
});
