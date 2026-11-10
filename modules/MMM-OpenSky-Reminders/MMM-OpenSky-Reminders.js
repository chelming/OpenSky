/* MMM-OpenSky-Reminders
 * A chime and/or a banner shortly before a calendar event starts.
 *
 * - Off unless opensky.json -> reminders.minutes is set (config.js builds this module's config).
 * - Events: any calendar source that broadcasts CALENDAR_EVENTS. `calendars` limits it to some calendars (the ones of the
 *   chosen people); null = all. All-day events are left out unless `allDay` is on; then they remind once at `allDayAt`.
 * - Sound: the Timer's chime (same Web Audio bell, same volume), so it also works in Docker, in the browser showing the
 *   dashboard. Without a Timer page this module plays the same three tones itself.
 * - A sleeping screen (Sleep cover) is not woken and not chimed; the reminder comes when someone wakes it, if the event
 *   hasn't started yet.
 * - Each event reminds once: the ones already reminded are kept in localStorage ("opensky.reminded"), so a page
 *   reload or a restart doesn't repeat them.
 */
Module.register("MMM-OpenSky-Reminders", {
  defaults: {
    minutes: 10,        // how long before the start
    chime: true,
    banner: true,
    allDay: false,      // all-day events too (once, at allDayAt)
    allDayAt: "08:00",
    calendars: null,    // only these calendar names (null = every calendar)
    hour12: true,
    bannerSeconds: 90
  },

  STORAGE_KEY: "opensky.reminded",

  getStyles() { return ["MMM-OpenSky-Reminders.css"]; },

  start() {
    this.pools = new Map();   // sender identifier -> events
    this.reminded = this.loadReminded();
    setInterval(() => this.check(), 15 * 1000);
  },

  nowMs() { return Date.now(); },   // (scenarios pin it)
  sidebar() { return MM.getModules().withClass("MMM-OpenSky-Sidebar")[0]; },
  locale() { return (typeof config !== "undefined" && config.locale) || "en-US"; },

  notificationReceived(n, p, sender) {
    if (n === "CALENDAR_EVENTS" && Array.isArray(p) && sender) {
      this.pools.set(sender.identifier, p);
      this.check();
    } else if (n === "REMINDERS_TEST") {
      // Settings -> Reminders -> Test: the same chime and banner, for a made-up event
      this.announce([{ title: "Your next event", startDate: this.nowMs() + this.config.minutes * 60000, allDay: false }]);
    }
  },

  /* ---------------- what has been reminded ---------------- */
  loadReminded() {
    try {
      const v = JSON.parse(localStorage.getItem(this.STORAGE_KEY) || "{}");
      return v && typeof v === "object" && !Array.isArray(v) ? v : {};
    } catch (e) { return {}; }
  },
  saveReminded() {
    const cut = this.nowMs() - 2 * 24 * 3600 * 1000;
    for (const k of Object.keys(this.reminded)) if (!(this.reminded[k] > cut)) delete this.reminded[k];
    try { localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.reminded)); } catch (e) { /* storage unavailable */ }
  },

  /* ---------------- when ---------------- */
  allDayAtMs(day) {
    const [h, m] = String(this.config.allDayAt).split(":").map(Number);
    return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h || 0, m || 0).getTime();
  },

  // the events due now: [{ key, title, startDate, allDay }]
  due(now) {
    const c = this.config, lead = c.minutes * 60000, out = [], seen = new Set();
    const today = new Date(now), dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    for (const list of this.pools.values()) {
      for (const ev of list) {
        const title = String(ev.title || "").trim(), start = Number(ev.startDate), end = Number(ev.endDate);
        if (!title || !Number.isFinite(start)) continue;
        if (Array.isArray(c.calendars) && !c.calendars.includes(String(ev.calendarName))) continue;
        const allDay = ev.fullDayEvent === true || ev.fullDayEvent === "true";
        let key;
        if (allDay) {
          if (!c.allDay) continue;
          const last = Number.isFinite(end) && end > start ? end : start + 24 * 3600 * 1000;
          if (!(start < dayStart + 24 * 3600 * 1000 && last > dayStart)) continue;   // not today
          const at = this.allDayAtMs(today);
          if (now < at || now > at + 4 * 3600 * 1000) continue;                        // from allDayAt, for four hours
          key = `${title}|${dayStart}|allday|${ev.calendarName}`;
        } else {
          if (start <= now || start - now > lead) continue;
          key = `${title}|${start}|${ev.calendarName}`;
        }
        if (this.reminded[key] || seen.has(key)) continue;
        seen.add(key);
        out.push({ key, title, startDate: allDay ? now : start, allDay });
      }
    }
    return out.sort((a, b) => (a.allDay ? 1 : 0) - (b.allDay ? 1 : 0) || a.startDate - b.startDate);   // timed ones first
  },

  check() {
    if (!(this.config.minutes > 0)) return;
    const sb = this.sidebar();
    if (sb && sb.isAsleep && sb.isAsleep()) return;   // not while the screen sleeps: it comes when someone wakes it
    const now = this.nowMs(), list = this.due(now);
    if (!list.length) return;
    list.forEach((e) => { this.reminded[e.key] = now; });
    this.saveReminded();
    this.announce(list);
  },

  /* ---------------- chime + banner ---------------- */
  announce(list) {
    if (this.config.chime) this.chime();
    if (this.config.banner) this.showBanner(list);
  },

  chime() {
    const t = MM.getModules().withClass("MMM-OpenSky-Timer")[0];
    if (t && t.playChime) return t.playChime();
    try {
      if (!this.audio) this.audio = new (window.AudioContext || window.webkitAudioContext)();
      if (this.audio.state === "suspended") this.audio.resume();
      const ctx = this.audio, now = ctx.currentTime;
      [880, 1109, 1319].forEach((freq, i) => {
        const osc = ctx.createOscillator(), gain = ctx.createGain(), t0 = now + i * 0.22;
        osc.type = "sine"; osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(0.5, t0 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.9);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t0); osc.stop(t0 + 0.95);
      });
    } catch (e) { Log.warn(`${this.name}: audio unavailable: ${e}`); }
  },

  timeText(ms) {
    const d = new Date(ms);
    if (!this.config.hour12) return d.toLocaleTimeString(this.locale(), { hour: "2-digit", minute: "2-digit", hour12: false });
    const h = d.getHours() % 12 || 12, m = d.getMinutes();
    return `${h}${m ? ":" + String(m).padStart(2, "0") : ""}${d.getHours() >= 12 ? "pm" : "am"}`;
  },

  showBanner(list) {
    if (!this.banner) {
      const b = document.createElement("div");
      b.className = "rem-banner";
      b.setAttribute("role", "status");
      b.innerHTML = `<span class="rem-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path></svg></span>
        <span class="rem-text"><span class="rem-title"></span><span class="rem-sub"></span></span>
        <button class="rem-ok">OK</button>`;
      b.querySelector(".rem-ok").onclick = () => this.hideBanner();
      document.body.appendChild(b);
      this.banner = b;
    }
    const first = list[0], more = list.length - 1;
    this.banner.querySelector(".rem-title").textContent = first.title + (more > 0 ? ` and ${more} more` : "");
    const mins = Math.max(1, Math.round((first.startDate - this.nowMs()) / 60000));
    this.banner.querySelector(".rem-sub").textContent = first.allDay ? "All day today" : `${this.timeText(first.startDate)} · in ${mins} minute${mins === 1 ? "" : "s"}`;
    this.banner.hidden = false;
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => this.hideBanner(), this.config.bannerSeconds * 1000);
  },

  hideBanner() {
    clearTimeout(this.bannerTimer);
    if (this.banner) this.banner.hidden = true;
  }
});
