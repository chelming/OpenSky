/* MMM-OpenSky-WeatherPage - the full-screen Weather page: the next 24 hours, weather alerts and a rain radar map.
 * Each part is its own setting (opensky.json -> weather.hourly / .alerts / .radar, all on unless set to false; phone setup -> Weather).
 * Data comes from this module's node helper (OS_WX_DATA); only the map pictures are loaded by the page itself, and when they
 * can't be (no internet) the map says so instead of showing a blank box. Everything from outside goes in as text, never HTML.
 */
Module.register("MMM-OpenSky-WeatherPage", {
  defaults: {
    latitude: null, longitude: null, units: "imperial", placeName: "",
    hourly: true, alerts: true, radar: true,
    hour12: true, refreshMinutes: 10
  },

  getStyles() { return ["MMM-OpenSky-WeatherPage.css"]; },
  getScripts() { return ["modules/opensky-lib/client/opensky-client.js"]; },

  start() {
    this.state = {};            // the last OS_WX_DATA of each part (a part that fails later keeps showing its last good data)
    this.zoom = 6;
    this.playing = true;
    this.frame = 0;
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

  getDom() {
    if (!this.root) {
      this.root = this.el("div", "wp-root");
      this.root.innerHTML = `
        <header class="wp-head">
          <span class="wp-title">${this.icon("cloud")}Weather</span>
          <span class="wp-place"></span>
        </header>
        <div class="wp-msg" hidden></div>
        <section class="wp-hourly" hidden>
          <h3 class="wp-h">Next 24 hours</h3>
          <div class="wp-hours"></div>
          <p class="wp-note" hidden></p>
        </section>
        <div class="wp-lower">
          <section class="wp-alerts" hidden>
            <h3 class="wp-h">Weather alerts</h3>
            <div class="wp-alert-list"></div>
          </section>
          <section class="wp-radar" hidden>
            <h3 class="wp-h">Rain radar <span class="wp-stamp"></span></h3>
            <div class="wp-map">
              <div class="wp-tiles"></div>
              <div class="wp-pin"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="rgba(255,255,255,.55)"/><circle cx="12" cy="12" r="5.5" fill="var(--os-accent)" stroke="#fff" stroke-width="2.5"/></svg></div>
              <div class="wp-map-msg" hidden></div>
              <div class="wp-map-ctl">
                <button type="button" class="wp-btn wp-play"></button>
                <button type="button" class="wp-btn wp-zout" aria-label="Zoom out"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M5 12h14"/></svg></button>
                <button type="button" class="wp-btn wp-zin" aria-label="Zoom in"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></button>
              </div>
              <div class="wp-credit">Map &copy; Esri, HERE, Garmin, OpenStreetMap contributors &middot; radar RainViewer</div>
            </div>
          </section>
        </div>`;
      const q = (s) => this.root.querySelector(s);
      q(".wp-place").textContent = this.config.placeName || "";
      q(".wp-zin").onclick = () => this.setZoom(this.zoom + 1);
      q(".wp-zout").onclick = () => this.setZoom(this.zoom - 1);
      q(".wp-play").onclick = () => { this.playing = !this.playing; this.drawPlay(); if (this.playing) this.startLoop(); else clearTimeout(this.loop); };
      this.drawPlay();
      if (window.ResizeObserver) new ResizeObserver(() => { clearTimeout(this.rz); this.rz = setTimeout(() => this.buildMap(), 200); }).observe(q(".wp-map"));
    }
    this.render();
    return this.root;
  },

  notificationReceived(n) {
    if (n === "DOM_OBJECTS_CREATED" && !this.hidden) this.sendSocketNotification("OS_WX_REFRESH");
  },
  socketNotificationReceived(n, p) {
    if (n !== "OS_WX_DATA" || !p) return;
    for (const k of ["hourly", "alerts", "radar"]) {
      if (!p[k]) continue;
      const old = this.state[k];
      this.state[k] = p[k].ok || !old || !old.ok ? p[k] : { ...old, stale: p[k].error };   // keep the last good data, note the failure
    }
    this.render();
    if (p.radar && p.radar.ok) this.buildMap();
  },
  resume() { this.sendSocketNotification("OS_WX_REFRESH"); this.render(); this.buildMap(); },
  suspend() { clearTimeout(this.loop); this.loop = null; },

  render() {
    if (!this.root) return;
    const c = this.config, q = (s) => this.root.querySelector(s), st = this.state;
    const msg = q(".wp-msg");
    const none = !c.hourly && !c.alerts && !c.radar;
    msg.hidden = this.located && !none;
    msg.textContent = !this.located ? "Set your town to see the weather: Settings → Set up from your phone → Family."
      : none ? "All the weather extras are switched off. Turn them on from your phone: Settings → Set up from your phone → Weather." : "";
    q(".wp-hourly").hidden = !(this.located && c.hourly);
    q(".wp-alerts").hidden = !(this.located && c.alerts);
    q(".wp-radar").hidden = !(this.located && c.radar);
    q(".wp-lower").hidden = q(".wp-alerts").hidden && q(".wp-radar").hidden;
    this.root.classList.toggle("wp-no-alerts", q(".wp-alerts").hidden);
    this.root.classList.toggle("wp-no-radar", q(".wp-radar").hidden);
    if (this.located && c.hourly) this.renderHourly(st.hourly);
    if (this.located && c.alerts) this.renderAlerts(st.alerts);
    if (this.located && c.radar) this.renderRadarMsg();
  },

  /* ---------------- hourly ---------------- */
  hourLabel(h, i) {
    if (i === 0) return "Now";
    if (!this.config.hour12) return `${String(h).padStart(2, "0")}:00`;
    return `${h % 12 || 12} ${h < 12 ? "AM" : "PM"}`;
  },
  renderHourly(d) {
    const box = this.root.querySelector(".wp-hours"), note = this.root.querySelector(".wp-hourly .wp-note");
    box.replaceChildren();
    note.hidden = true;
    if (!d) { note.textContent = "Loading the forecast…"; note.hidden = false; return; }
    if (!d.ok) { note.textContent = `The hourly forecast can't be loaded right now (${d.error}). It tries again in a few minutes.`; note.hidden = false; return; }
    if (d.stale) { note.textContent = `Showing the last forecast we got. ${d.stale}`; note.hidden = false; }
    d.hours.forEach((h, i) => {
      const cell = this.el("div", `wp-hour${i === 0 ? " wp-now" : ""}`);
      const ic = this.el("span", "wp-hour-ico"); ic.innerHTML = this.wxIcon(h.id);   // (our own inline SVG, chosen by a number)
      cell.append(this.el("span", "wp-hour-time", this.hourLabel(h.hour, i)), ic, this.el("b", "wp-hour-temp", `${h.temp}°`),
        this.el("small", "wp-hour-rain", h.rain != null && h.rain >= 10 ? `${h.rain}%` : ""));
      box.append(cell);
    });
  },

  /* ---------------- alerts ---------------- */
  renderAlerts(d) {
    const box = this.root.querySelector(".wp-alert-list");
    box.replaceChildren();
    const say = (t, cls) => box.append(this.el("p", `wp-note ${cls || ""}`, t));
    if (!d) return say("Checking for alerts…");
    if (!d.ok) return say(`Weather alerts can't be checked right now (${d.error}). They are checked again in a few minutes.`);
    if (d.supported === false) return say("Weather alerts come from the US National Weather Service, so there are none to show for this location.");
    if (d.stale) say(`Showing the last alerts we got. ${d.stale}`);
    if (!d.alerts.length) return say("No weather alerts for your area.", "wp-calm");
    d.alerts.forEach((a) => {
      const card = this.el("button", `wp-alert wp-sev-${a.severity}`);
      card.type = "button";
      card.setAttribute("aria-expanded", "false");
      const top = this.el("span", "wp-alert-top");
      top.append(this.el("b", "wp-alert-event", a.event), this.el("small", "wp-alert-sev", a.severity));
      const body = this.el("span", "wp-alert-body");
      if (a.headline) body.append(this.el("span", "wp-alert-head", a.headline));
      if (a.ends) {
        const t = new Date(a.ends);
        if (!isNaN(t)) body.append(this.el("small", "wp-alert-until", `Until ${t.toLocaleString(this.locale(), { weekday: "short", hour: "numeric", minute: "2-digit", hour12: this.config.hour12 })}`));
      }
      const more = this.el("span", "wp-alert-more", a.text); more.hidden = true;
      card.append(top, body, more);
      card.onclick = () => { more.hidden = !more.hidden; card.setAttribute("aria-expanded", String(!more.hidden)); card.classList.toggle("wp-open", !more.hidden); };
      box.append(card);
    });
  },

  /* ---------------- radar ---------------- */
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
    const map = this.root.querySelector(".wp-map"), tiles = this.root.querySelector(".wp-tiles");
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
    const m = this.root.querySelector(".wp-map-msg"), d = this.state.radar;
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
    const f = d.frames[this.frame];
    this.root.querySelector(".wp-stamp").textContent = f ? new Date(f.time * 1000).toLocaleTimeString(this.locale(), { hour: "numeric", minute: "2-digit", hour12: this.config.hour12 }) : "";
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
