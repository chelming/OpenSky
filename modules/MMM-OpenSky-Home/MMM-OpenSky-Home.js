/* MMM-OpenSky-Home
 * The Home page: the week ahead (left), the family's lists and a photo card (right).
 *
 * Calendar card: today + the next 6 days as tiles, plus a "Next Week" tile.
 *   - events: any calendar source that broadcasts CALENDAR_EVENTS (MagicMirror's standard)
 *   - colors: window.OpenSkyEventColors (calendar.colors in opensky.json)
 *   - tap an event → CALENDAR_EVENT_CLICKED, a day → CALENDAR_DAY_CLICKED, "Add Event" → CALENDAR_ADD_EVENT
 *     (the event editor module answers these; "Add Event" only shows when one is installed)
 *   - daily high + icon from the header's shared forecast (OPENSKY_WEATHER)
 *   - curbside pickup icons next to the "N events" counter (pickup in opensky.json, lib/client/pickup.js)
 * Lists card: whatever list providers broadcast as OPENSKY_LISTS { source, lists: [{ id, title, color, items, loaded, error }] }
 *   (an item with done: true is shown checked — e.g. while its Undo is offered).
 *   "Add item" → OPENSKY_LIST_ADD {source, listId}; circle → OPENSKY_LIST_CHECK {source, listId, item, el};
 *   text → OPENSKY_LIST_EDIT {source, listId, item}. No lists → the photo card takes the whole right side.
 * Photo card: a folder / USB stick (default) or Immich, via the node helper (/opensky-photo/<id>).
 *   Crossfades every photos.intervalSeconds, tap = next, pauses while another page is shown.
 */
Module.register("MMM-OpenSky-Home", {
  defaults: {
    listsPage: null,
    calendarAlertAfter: 2 * 60 * 1000,   // show "<calendar> isn't loading" after this long             // MMM-pages index of the Lists page ("See all"); null = no button
    canAddEvents: false,         // true when an event editor module is installed
    maxEventsPerDay: 4,
    eventColors: null,           // calendar.colors from opensky.json
    photos: { enabled: true, provider: "folder", folder: null, usb: true, url: null, intervalSeconds: 30 },
    pickup: null                 // resolved pickup schedule (see lib/client/pickup.js); null = no icons
  },

  getStyles() { return ["modules/opensky-lib/client/list-columns.css", "MMM-OpenSky-Home.css"]; },
  getScripts() { return ["modules/opensky-lib/client/opensky-client.js", "modules/opensky-lib/client/pickup.js", "modules/opensky-lib/client/day-agenda.js"]; },

  start() {
    this.pools = new Map();      // sender identifier → events
    this.lists = new Map();      // list provider → lists
    this.weekOffset = 0;
    this.forecast = {};          // "YYYY-MM-DD" → { high, id }
    this.doneOpen = false;       // today's "N done" list is expanded (always back to tidy at midnight / idle / wake)
    this.lastDay = new Date(this.nowMs()).toDateString();
    this.armTick();
  },

  // The one clock for "what's left today" (scenarios pin it: home.nowMs = () => …)
  nowMs() { return Date.now(); },

  // A tick aligned to the minute: midnight rolls over; otherwise today's tile is redrawn only if something on it changed
  armTick() {
    clearTimeout(this._tick);
    this._tick = setTimeout(() => { this.tick(); this.armTick(); }, 60000 - (Date.now() % 60000) + 250);
  },

  tick() {
    const today = new Date(this.nowMs()).toDateString();
    if (today !== this.lastDay) { this.lastDay = today; this.weekOffset = 0; this.doneOpen = false; this.render(); return; }
    const tile = this.todayTile;
    if (this.weekOffset !== 0 || !tile || !tile.isConnected) return;
    const sig = window.OpenSkyDayAgenda.signature(this.todayAgenda(tile, this.config.maxEventsPerDay));
    if (sig !== tile._sig) this.renderToday(tile);
  },

  locale() { return (typeof config !== "undefined" && config.locale) || "en-US"; },

  resume() { this.doneOpen = false; this.startPhotos(); this.sendNotification("OPENSKY_LISTS_REFRESH"); this.render(); },
  suspend() { clearInterval(this.photoTimer); this.photoTimer = null; },

  notificationReceived(n, payload, sender) {
    // a calendar that keeps failing (wrong link, expired password…) gets a small notice — after 2 minutes, so a
    // Wi-Fi blip at start-up doesn't flash one
    if (n === "OPENSKY_CALENDAR_STATUS" && payload && typeof payload === "object") {
      this.calProblems = this.calProblems || {};
      const now = Date.now();
      for (const [name, st] of Object.entries(payload)) {
        if (st === "ok") delete this.calProblems[name];
        else if (!this.calProblems[name]) this.calProblems[name] = { since: now, message: String(st) };
        else this.calProblems[name].message = String(st);
      }
      this.renderCalAlert();
      clearTimeout(this._alertTimer);
      if (Object.keys(this.calProblems).length) this._alertTimer = setTimeout(() => this.renderCalAlert(), this.config.calendarAlertAfter + 1000);
      return;
    }
    if (n === "OPENSKY_PICKUP_EVENTS" && Array.isArray(payload)) {
      const key = JSON.stringify(payload);
      if (key !== this._pickupKey) { this._pickupKey = key; this.pickupEvents = payload; this.renderCalendar(); }
      return;
    }
    if (n === "CALENDAR_EVENTS" && Array.isArray(payload) && sender) {
      this.pools.set(sender.identifier, payload);
      this.renderCalendar();
    } else if (n === "OPENSKY_WEATHER" && payload) {
      this.forecast = payload.daily || {};
      this.renderCalendar();
    } else if (n === "OPENSKY_LISTS" && payload && payload.source) {
      this.lists.set(payload.source, Array.isArray(payload.lists) ? payload.lists : []);
      this.renderLists();
    } else if (n === "DOM_OBJECTS_CREATED") {
      if (window.OpenSkyEventColors) window.OpenSkyEventColors.configure(this.config.eventColors);
      this.render();
      this.startPhotos();
      this.sendNotification("OPENSKY_LISTS_REFRESH");
    } else if (n === "OPENSKY_IDLE_RESET") {
      if (this.weekOffset !== 0 || this.doneOpen) { this.weekOffset = 0; this.doneOpen = false; this.renderCalendar(); }
    } else if (n === "PAGE_CHANGED") {
      setTimeout(() => { this.fitToday(); this.fitTitles(); }, 150);   // sizes are only measurable while the page is visible
    }
  },

  // Cut-off event names get a second line, but only while every pill (and "+N more") still fits
  fitTitles() {
    if (!this.root || !window.OpenSkyFit) return;
    this.root.querySelectorAll(".hd-day:not(.hd-nextweek)").forEach((tile) => {
      const pills = [...tile.querySelectorAll(".hd-event")];
      pills.forEach((p) => p.classList.remove("mf-two"));
      if (!pills.length || tile.getBoundingClientRect().height === 0) return;
      const inner = () => tile.getBoundingClientRect().bottom - parseFloat(getComputedStyle(tile).paddingBottom);
      const fits = () => { const last = tile.querySelector(".hd-day-events").lastElementChild; return last.getBoundingClientRect().bottom <= inner() + 0.5; };
      window.OpenSkyFit.grow(pills, ".hd-event-title", fits);
    });
  },

  getDom() {
    const root = document.createElement("div");
    root.className = "hd-root";
    root.innerHTML = `
      <section class="hd-card hd-calendar">
        <header class="hd-card-head">
          <span class="hd-card-label">${this.icon("calendar")} Calendar</span>
          <span class="hd-week-range"></span>
          <button class="hd-cal-alert" hidden></button>
          <span class="hd-nav">
            ${this.config.canAddEvents ? `<button class="hd-nav-btn hd-add">${this.icon("plus")} Add Event</button>` : ""}
            <button class="hd-nav-btn hd-prev" aria-label="Previous week">${this.icon("left")}</button>
            <button class="hd-nav-btn hd-today">Today</button>
            <button class="hd-nav-btn hd-next" aria-label="Next week">${this.icon("right")}</button>
          </span>
        </header>
        <div class="hd-week"></div>
      </section>
      <div class="hd-right">
        <section class="hd-card hd-lists" hidden>
          <header class="hd-card-head">
            <span class="hd-card-label">${this.icon("list")} Lists</span>
            ${Number.isInteger(this.config.listsPage) ? `<button class="hd-see-all">See all ${this.icon("right")}</button>` : ""}
          </header>
          <div class="hd-list-columns"></div>
        </section>
        ${this.photosOn() ? `<section class="hd-photo" aria-label="Family photos">
          <div class="hd-photo-empty">${this.icon("image")}<span class="hd-photo-msg">Photos will appear here</span></div>
        </section>` : ""}
      </div>`;
    root.querySelector(".hd-prev").onclick = () => { this.weekOffset--; this.renderCalendar(); };
    root.querySelector(".hd-next").onclick = () => { this.weekOffset++; this.renderCalendar(); };
    root.querySelector(".hd-today").onclick = () => { this.weekOffset = 0; this.renderCalendar(); };
    const add = root.querySelector(".hd-add");
    if (add) add.onclick = () => this.sendNotification("CALENDAR_ADD_EVENT", { date: new Date() });
    const seeAll = root.querySelector(".hd-see-all");
    if (seeAll) seeAll.onclick = () => this.sendNotification("PAGE_CHANGED", this.config.listsPage);
    const photo = root.querySelector(".hd-photo");
    if (photo) photo.onclick = () => { this.nextPhoto(); this.startPhotos(true); };   // tap = next (restarts the interval)
    this.root = root;
    setTimeout(() => this.render(), 0);
    return root;
  },

  render() { this.renderCalendar(); this.renderLists(); },

  /* ======================= photos ======================= */
  photosOn() { return !!(this.config.photos && this.config.photos.enabled !== false); },

  startPhotos(restart = false) {
    if (!this.photosOn()) return;
    if (!this.photoInit) {
      this.photoInit = true;
      const p = this.config.photos;
      this.sendSocketNotification("PHOTO_INIT", { provider: p.provider, folder: p.folder, usb: p.usb, url: p.url });
    }
    if (this.photoTimer && !restart) return;
    clearInterval(this.photoTimer);
    if (!restart) this.nextPhoto();
    this.photoTimer = setInterval(() => this.nextPhoto(), Math.max(5, this.config.photos.intervalSeconds || 30) * 1000);
  },

  nextPhoto() {
    if (this.photoPending && Date.now() - this.photoPending < 20000) return;   // one request at a time
    this.photoPending = Date.now();
    this.sendSocketNotification("PHOTO_NEXT");
  },

  socketNotificationReceived(n, p) {
    if (n === "PHOTO") this.showPhoto(p);
    else if (n === "PHOTO_ERROR") {
      this.photoPending = 0;
      const msg = this.root && this.root.querySelector(".hd-photo-msg");
      if (msg && p && p.message) msg.textContent = p.message;   // e.g. "Add photos to ~/Pictures …"
    }
  },

  // Preload, then crossfade. Two portrait photos → side by side, each filling its half. A single photo close to the
  // card's shape fills the card; any other single photo is shown whole on a blurred copy of itself (no cropped heads).
  showPhoto(p) {
    const card = this.root && this.root.querySelector(".hd-photo");
    const photos = ((p && p.photos) || []).filter((ph) => ph && ph.id).slice(0, 2);
    if (!card || !photos.length) { this.photoPending = 0; return; }
    const url = (ph) => `/opensky-photo/${encodeURIComponent(ph.id)}`;
    const load = (ph) => new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = url(ph); });
    Promise.all(photos.map(load)).then((imgs) => {
      this.photoPending = 0;
      const box = card.getBoundingClientRect();
      const layer = document.createElement("div");
      layer.className = "hd-ph-layer" + (photos.length === 2 ? " pair" : "");
      photos.forEach((ph, k) => {
        const img = imgs[k];
        const cellRatio = photos.length === 2 ? (box.width / 2) / box.height : box.width / box.height;
        const cover = box.height > 0 && Math.abs(img.naturalWidth / img.naturalHeight - cellRatio) < 0.45;
        const cell = document.createElement("div");
        cell.className = "hd-ph-cell" + (cover ? " cover" : "");
        cell.innerHTML = `<div class="hd-ph-blur"></div><img class="hd-ph-img" alt="">`;
        cell.querySelector(".hd-ph-blur").style.backgroundImage = `url("${url(ph)}")`;
        cell.querySelector(".hd-ph-img").src = url(ph);
        const caption = this.photoCaption(ph);
        if (caption) { const c = document.createElement("div"); c.className = "hd-ph-caption"; c.textContent = caption; cell.appendChild(c); }
        layer.appendChild(cell);
      });
      card.appendChild(layer);
      requestAnimationFrame(() => requestAnimationFrame(() => layer.classList.add("shown")));
      setTimeout(() => { [...card.querySelectorAll(".hd-ph-layer")].slice(0, -1).forEach((l) => l.remove()); card.querySelector(".hd-photo-empty")?.remove(); }, 1200);
    }).catch(() => { this.photoPending = 0; });
  },

  photoCaption(p) {
    const d = p.date ? new Date(p.date) : null;
    const date = d && !isNaN(d) ? d.toLocaleDateString(this.locale(), { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "";
    return [date, p.place].filter(Boolean).join(" · ");
  },

  /* ======================= calendar ======================= */
  allEvents() {
    const seen = new Set(), out = [];
    for (const list of this.pools.values()) {
      for (const raw of list) {
        const ev = this.normalize(raw);
        const key = `${ev.title}|${ev.startDate}|${ev.calendarName}`;
        if (!seen.has(key)) { seen.add(key); out.push(ev); }
      }
    }
    return out;
  },

  normalize(ev) {
    const clean = (v) => (v && v !== "undefined" && v !== "false" ? String(v) : "");
    const start = Number(ev.startDate), end = Number(ev.endDate);
    return {
      title: String(ev.title || "").trim(), calendarName: ev.calendarName || "",
      startDate: start, endDate: Number.isFinite(end) && end > 0 ? end : start,
      allDay: ev.fullDayEvent === true || ev.fullDayEvent === "true",
      location: clean(ev.location), description: clean(ev.description), color: ev.color || "", colorName: ev.colorName || null,
      colors: Array.isArray(ev.colors) ? ev.colors : null, calendarNames: Array.isArray(ev.calendarNames) ? ev.calendarNames : null
    };
  },

  dayStart(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); },

  eventsBetween(events, from, to) {
    return events
      .filter((ev) => { const end = ev.endDate > ev.startDate ? ev.endDate : ev.startDate + 1; return ev.startDate < to.getTime() && end > from.getTime(); })
      .sort((a, b) => (b.allDay - a.allDay) || (a.startDate - b.startDate));
  },

  renderCalAlert() {
    const el = this.root && this.root.querySelector(".hd-cal-alert");
    if (!el) return;
    const now = Date.now(), bad = Object.entries(this.calProblems || {}).filter(([, p]) => now - p.since >= this.config.calendarAlertAfter);
    el.hidden = !bad.length;
    if (!bad.length) return;
    el.textContent = bad.length === 1 ? `${bad[0][0]} isn't loading` : `${bad.length} calendars aren't loading`;
    el.onclick = () => window.OpenSkyToast(`${bad.map(([n, p]) => `${n}: ${p.message}`).join(" · ")} — fix it in Settings → Set up from your phone → Calendars`, "error");
  },

  renderCalendar() {
    if (!this.root) return;
    const week = this.root.querySelector(".hd-week");
    const events = this.allEvents();
    const first = this.dayStart(new Date(this.nowMs()));
    first.setDate(first.getDate() + this.weekOffset * 7);
    const todayKey = this.dayStart(new Date(this.nowMs())).getTime();
    const last = new Date(first); last.setDate(last.getDate() + 6);
    const fmt = (d, o) => d.toLocaleDateString(this.locale(), o);
    this.root.querySelector(".hd-week-range").textContent =
      `${fmt(first, { month: "short", day: "numeric" })} – ${fmt(last, { month: first.getMonth() === last.getMonth() ? undefined : "short", day: "numeric" })}`;
    this.root.querySelector(".hd-today").classList.toggle("active", this.weekOffset === 0);
    week.innerHTML = "";
    this.todayTile = null;
    for (let i = 0; i < 7; i++) {
      const day = new Date(first); day.setDate(first.getDate() + i);
      const next = new Date(day); next.setDate(day.getDate() + 1);
      week.appendChild(this.dayTile(day, this.eventsBetween(events, day, next), day.getTime() === todayKey));
    }
    const nwStart = new Date(first); nwStart.setDate(first.getDate() + 7);
    const nwEnd = new Date(nwStart); nwEnd.setDate(nwStart.getDate() + 7);
    week.appendChild(this.nextWeekTile(nwStart, nwEnd, this.eventsBetween(events, nwStart, nwEnd)));
    this.fitToday();
    this.fitTitles();
  },

  dayTile(day, events, isToday) {
    const tile = document.createElement("div");
    tile.className = "hd-day" + (isToday ? " hd-is-today" : "");
    const weather = this.forecast[this.dateKey(day)];
    tile.innerHTML = `
      <div class="hd-day-head">
        <span class="hd-day-name">${day.toLocaleDateString(this.locale(), { weekday: "short" })}</span>
        <span class="hd-day-num">${day.getDate()}</span>
        <span class="hd-day-wx">${weather ? `${this.weatherIcon(weather.id)}<span>${weather.high}°</span>` : ""}</span>
      </div>
      <div class="hd-day-count"><span>${events.length ? `${events.length} event${events.length > 1 ? "s" : ""}` : ""}</span>${this.pickupIcons(day)}</div>
      <div class="hd-day-events"></div>`;
    tile.onclick = (e) => { if (!e.target.closest(".hd-event, .hd-done-chip")) this.sendNotification("CALENDAR_DAY_CLICKED", { date: day.getTime(), events }); };
    if (isToday && this.weekOffset === 0 && window.OpenSkyDayAgenda) return this.todayBody(tile, events, day);
    const list = tile.querySelector(".hd-day-events");
    const max = this.config.maxEventsPerDay;
    const shown = events.length > max ? events.slice(0, max - 1) : events;
    shown.forEach((ev) => list.appendChild(this.eventPill(ev, day)));
    if (events.length > shown.length) {
      const more = document.createElement("button");
      more.className = "hd-more";
      more.textContent = `+${events.length - shown.length} more`;
      list.appendChild(more);
    }
    return tile;
  },

  /* ---------- today's tile: "what's left" (lib/client/day-agenda.js ranks, this draws) ---------- */
  todayBody(tile, events, day) {
    const next = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
    tile._today = { events, day, dayStart: new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime(), dayEnd: next.getTime() };
    tile._plainCount = tile.querySelector(".hd-day-count > span").textContent;
    this.todayTile = tile;
    this.drawToday(tile, this.todayAgenda(tile, this.config.maxEventsPerDay));
    return tile;
  },

  todayAgenda(tile, cap) {
    const t = tile._today;
    return window.OpenSkyDayAgenda.rank(t.events, this.nowMs(), { cap, dayStart: t.dayStart, dayEnd: t.dayEnd });
  },

  // redraw today's tile from scratch (full cap, then shrink until it fits)
  renderToday(tile) {
    this.drawToday(tile, this.todayAgenda(tile, this.config.maxEventsPerDay));
    this.fitToday();
    this.fitTitles();
  },

  // Shrink today's agenda until nothing is clipped. While the done list is open the tile scrolls instead.
  fitToday() {
    const tile = this.todayTile;
    if (!tile || !tile.isConnected || !window.OpenSkyDayAgenda || this.doneOpen) return;
    if (tile.getBoundingClientRect().height === 0) return;   // another page is showing: PAGE_CHANGED fits it later
    const inner = () => tile.getBoundingClientRect().bottom - parseFloat(getComputedStyle(tile).paddingBottom);
    const fits = () => { const last = tile.querySelector(".hd-day-events").lastElementChild; return !last || last.getBoundingClientRect().bottom <= inner() + 0.5; };
    let a = this.todayAgenda(tile, this.config.maxEventsPerDay);   // start from the full agenda: a shrunk one may have room now
    this.drawToday(tile, a);
    while (!fits()) {
      const s = window.OpenSkyDayAgenda.shrink(a);
      if (!s) break;
      a = s;
      this.drawToday(tile, a);
    }
  },

  drawToday(tile, a) {
    const { day } = tile._today;
    // what's on screen is judged by the full-cap agenda, so a fit-shrunk tile isn't redrawn every minute for nothing
    tile._sig = window.OpenSkyDayAgenda.signature(this.todayAgenda(tile, this.config.maxEventsPerDay));
    tile.classList.toggle("hd-done-open", this.doneOpen && a.doneCount > 0);
    tile.querySelector(".hd-day-count > span").textContent = a.counter || tile._plainCount;
    const list = tile.querySelector(".hd-day-events");
    list.innerHTML = "";
    a.strips.forEach((ev) => list.appendChild(this.stripPill(ev)));
    a.rows.forEach((r) => list.appendChild(r.kind === "live" ? this.livePill(r) : r.kind === "recent"
      ? this.quietPill(r.ev, r.agoText === "just now" ? "just now" : `ended ${r.agoText}`, "recent") : this.eventPill(r.ev, day, r.relText)));
    if (a.more) {
      const more = document.createElement("button");
      more.className = "hd-more";
      more.textContent = `+${a.more} more`;
      list.appendChild(more);
    }
    if (a.state === "allDone") {
      const empty = document.createElement("div");
      empty.className = "hd-empty";
      empty.innerHTML = `${this.icon("check")}<span>Nothing left today</span>`;
      list.appendChild(empty);
    }
    if (a.doneCount) {
      const open = this.doneOpen;
      const chip = document.createElement("button");
      chip.className = "hd-more hd-done-chip";
      chip.setAttribute("aria-expanded", open ? "true" : "false");
      chip.innerHTML = `${this.icon("check")}<span>${a.doneCount} done</span>`;
      chip.onclick = () => { this.doneOpen = !this.doneOpen; this.renderToday(tile); };
      list.appendChild(chip);
      if (open) {
        a.done.forEach((ev) => list.appendChild(this.quietPill(ev, this.when(ev, day), "done")));
        chip.scrollIntoView({ block: "nearest" });   // the redraw resets the scroll: keep the chip (to close the list) in sight
      }
    }
  },

  // The calendar's dot + name at the end of a pill's meta row (the name gives way first, down to just the dot).
  // An event shared by several calendars (calendar.mergeShared) gets one dot per calendar and all their names.
  calLabel(ev) {
    const names = ev.calendarNames && ev.calendarNames.length ? ev.calendarNames : ev.calendarName ? [ev.calendarName] : [];
    const el = document.createElement("span");
    el.className = "hd-cal";
    if (!names.length) return el;
    const name = names.join(", ");
    el.title = name;
    const shared = (ev.colors || []).filter((c) => /^#[0-9a-f]{3,8}$/i.test(c));
    const dots = shared.length > 1 ? shared.map((c) => `<i class="hd-cal-dot" style="background:${c}"></i>`).join("") : `<i class="hd-cal-dot"></i>`;
    el.style.minWidth = `${Math.max(1, shared.length > 1 ? shared.length : 1) * 8 + (shared.length > 1 ? shared.length - 1 : 0) * 3}px`;   // never less than the dots
    el.innerHTML = `<span class="hd-cal-dots">${dots}</span><span class="hd-cal-name"></span>`;
    el.querySelector(".hd-cal-dots").setAttribute("aria-label", name);
    el.querySelector(".hd-cal-name").textContent = name;
    return el;
  },

  colored(el, ev) { if (window.OpenSkyEventColors) el.setAttribute("style", window.OpenSkyEventColors.vars(ev)); },

  // an all-day event on today's tile: one slim row
  stripPill(ev) {
    const pill = document.createElement("button");
    pill.className = "hd-event hd-strip";
    this.colored(pill, ev);
    pill.innerHTML = `<span class="hd-event-title"></span><span class="hd-strip-tag">All day</span>`;
    pill.querySelector(".hd-event-title").textContent = ev.title;
    pill.appendChild(this.calLabel(ev));
    pill.onclick = () => this.sendNotification("CALENDAR_EVENT_CLICKED", ev);
    return pill;
  },

  // happening now: dark ring, NOW badge, progress bar (never a fill color: the fill is the calendar's)
  livePill(r) {
    const ev = r.ev, pill = document.createElement("button");
    pill.className = "hd-event live";
    this.colored(pill, ev);
    const end = ev.endDate > ev.startDate ? ev.endDate : ev.startDate;
    const left = r.minutesLeft < 60 ? `${window.OpenSkyDayAgenda.dur(r.minutesLeft)} left` : `until ${this.clock(new Date(end))}`;
    pill.innerHTML = `<span class="hd-event-title"></span>
      <span class="hd-ev-meta"><span class="hd-live-row"><b class="hd-now">NOW</b><span class="hd-event-rel"></span></span></span>
      <span class="hd-progress"><i></i></span>`;
    pill.querySelector(".hd-event-title").textContent = ev.title;
    pill.querySelector(".hd-event-rel").textContent = left;
    pill.querySelector(".hd-progress > i").style.width = `${Math.round(r.progress * 100)}%`;
    pill.querySelector(".hd-ev-meta").appendChild(this.calLabel(ev));
    pill.onclick = () => this.sendNotification("CALENDAR_EVENT_CLICKED", ev);
    return pill;
  },

  // a finished event: the just-ended row (kind "recent") or a row of the expanded done list (kind "done")
  quietPill(ev, text, kind) {
    const pill = document.createElement("button");
    pill.className = `hd-event ${kind}`;
    this.colored(pill, ev);
    pill.innerHTML = `<span class="hd-event-title">${this.icon("check")}<span></span></span><span class="hd-ev-meta"><span class="hd-event-time"></span></span>`;
    pill.querySelector(".hd-event-title > span").textContent = ev.title;
    pill.querySelector(".hd-event-time").textContent = text;
    pill.querySelector(".hd-ev-meta").appendChild(this.calLabel(ev));
    pill.onclick = () => this.sendNotification("CALENDAR_EVENT_CLICKED", ev);
    return pill;
  },

  eventPill(ev, day, rel) {
    const pill = document.createElement("button");
    pill.className = "hd-event" + (ev.endDate < this.nowMs() && !ev.allDay ? " passed" : "");
    this.colored(pill, ev);
    pill.innerHTML = `<span class="hd-event-title"></span><span class="hd-ev-meta"><span class="hd-event-time"></span></span>`;
    pill.querySelector(".hd-event-title").textContent = ev.title;
    pill.querySelector(".hd-event-time").textContent = this.when(ev, day);
    const meta = pill.querySelector(".hd-ev-meta");
    if (rel) {
      const r = document.createElement("span");
      r.className = "hd-event-rel";
      r.textContent = `${rel} ·`;
      meta.prepend(r);
    }
    meta.appendChild(this.calLabel(ev));
    pill.onclick = () => this.sendNotification("CALENDAR_EVENT_CLICKED", ev);
    return pill;
  },

  clock(d) {
    const twelve = !(typeof config !== "undefined" && config.timeFormat === 24);
    return d.toLocaleTimeString(this.locale(), { hour: "numeric", minute: "2-digit", hour12: twelve }).replace(/:00(?= ?[AP]M)/, "");
  },

  when(ev, day) {
    if (ev.allDay) return "All day";
    const start = new Date(ev.startDate), end = new Date(ev.endDate);
    const t = (d) => this.clock(d);
    const onDay = (d) => d.toDateString() === day.toDateString();
    if (!onDay(start) && !onDay(end)) return "All day";
    if (!onDay(start)) return `Until ${t(end)}`;
    if (end.getTime() === start.getTime()) return t(start);
    return onDay(end) ? `${t(start)} – ${t(end)}` : `${t(start)} →`;
  },

  nextWeekTile(from, to, events) {
    const tile = document.createElement("div");
    tile.className = "hd-day hd-nextweek";
    const last = new Date(to); last.setDate(last.getDate() - 1);
    const f = (d) => d.toLocaleDateString(this.locale(), { month: "short", day: "numeric" });
    tile.innerHTML = `
      <div class="hd-day-head"><span class="hd-day-name hd-nw-title">Next Week</span></div>
      <div class="hd-day-count">${f(from)} – ${f(last)}${events.length ? ` · ${events.length} event${events.length === 1 ? "" : "s"}` : ""}</div>
      <div class="hd-nw-list"></div>`;
    const list = tile.querySelector(".hd-nw-list");
    events.slice(0, 5).forEach((ev) => {
      const row = document.createElement("div");
      row.className = "hd-nw-row";
      const bar = window.OpenSkyEventColors ? window.OpenSkyEventColors.bar(ev) : "#9ca3af";
      row.innerHTML = `<span class="hd-nw-dot" style="background:${bar}"></span><span class="hd-nw-day"></span><span class="hd-nw-name"></span>`;
      row.querySelector(".hd-nw-day").textContent = new Date(ev.startDate).toLocaleDateString(this.locale(), { weekday: "short" });
      row.querySelector(".hd-nw-name").textContent = ev.title;
      list.appendChild(row);
    });
    if (events.length > 5) {
      const more = document.createElement("div");
      more.className = "hd-nw-more";
      more.textContent = `+${events.length - 5} more`;
      list.appendChild(more);
    }
    tile.onclick = () => { this.weekOffset++; this.renderCalendar(); };
    return tile;
  },

  /* ======================= weather ======================= */
  dateKey(d) { const pad = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; },

  weatherIcon(id) {
    const hd = MM.getModules().withClass("MMM-OpenSky-Header")[0];
    return hd && typeof hd._svgForWeatherId === "function" && id != null ? `<span class="hd-wx-icon">${hd._svgForWeatherId(id)}</span>` : "";
  },

  /* ======================= lists ======================= */
  renderLists() {
    if (!this.root) return;
    const all = [...this.lists.entries()].flatMap(([source, lists]) => lists.map((l) => ({ ...l, source })));
    const card = this.root.querySelector(".hd-lists");
    card.hidden = !all.length;
    this.root.classList.toggle("hd-no-lists", !all.length);
    const cols = card.querySelector(".hd-list-columns");
    cols.style.setProperty("--list-count", Math.min(3, Math.max(1, all.length)));
    cols.innerHTML = "";
    all.slice(0, 3).forEach((list, idx) => {
      const send = (n, extra) => this.sendNotification(n, { source: list.source, listId: list.id, ...extra });
      cols.appendChild(window.OpenSkyListColumn.render(list, {
        add: () => send("OPENSKY_LIST_ADD"),
        check: (item, el) => send("OPENSKY_LIST_CHECK", { item, el }),
        edit: (item) => send("OPENSKY_LIST_EDIT", { item })
      }, { alt: idx % 2 === 1 }));
    });
  },

  /* ======================= curbside pickup ======================= */
  // Small icons next to the "N events" counter: trash can (+ recycling) on trash day, leaf on yard-waste days.
  // From a pickup calendar (calendar link with "role": "pickup"): what its events on that day say, by keyword
  pickupFromCalendar(day) {
    const c = { trash: false, recycling: false, yard: false, expected: false, moved: null };
    const start = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime(), end = start + 86400000;
    for (const ev of this.pickupEvents || []) {
      const t = Number(ev.startDate);
      if (!(t >= start && t < end)) continue;
      const title = String(ev.title || "").toLowerCase();
      if (/recycl/.test(title)) c.recycling = true;
      if (/yard|leaf|leaves|garden|green ?waste|compost|organic|brush|christmas tree/.test(title)) c.yard = true;
      if (/trash|garbage|refuse|rubbish|black bin|general waste|landfill|solid waste/.test(title) || (/waste|bin|collection|pickup|pick-up/.test(title) && !c.recycling && !c.yard)) c.trash = true;
    }
    return c;
  },

  pickupIcons(day) {
    const fromCal = this.pickupEvents && this.pickupEvents.length ? this.pickupFromCalendar(day) : null;
    if ((!this.config.pickup || !window.OpenSkyPickup) && !fromCal) return "";
    const rules = this.config.pickup && window.OpenSkyPickup ? window.OpenSkyPickup.collectionsOn(day, this.config.pickup) : {};
    // both can be on: the calendar adds to the trash-day rules
    const c = fromCal ? { trash: !!(rules.trash || fromCal.trash), recycling: !!(rules.recycling || fromCal.recycling), yard: !!(rules.yard || fromCal.yard), expected: !!rules.expected && !fromCal.yard, moved: rules.moved || null } : rules;
    const why = c.moved ? ` (moved a day for ${c.moved})` : "";
    // recycling gets its own icon unless it always comes with the trash (weekly, in the trash-day rules)
    const weeklyRecycling = !fromCal && !(this.config.pickup && this.config.pickup.recycling && this.config.pickup.recycling.every === 2);
    const svg = (paths) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
    let html = "";
    if (c.trash) html += `<span class="hd-pickup hd-pickup-trash" title="${weeklyRecycling ? "Trash & recycling" : "Trash"}${why}">${svg(`<path d="M4 7h16M10 3.5h4M6 7l1 13a1.5 1.5 0 0 0 1.5 1.4h7A1.5 1.5 0 0 0 17 20l1-13"/><path d="M10 11v6M14 11v6"/>`)}</span>`;
    if (c.recycling && !weeklyRecycling) html += `<span class="hd-pickup hd-pickup-recycle" title="Recycling${why}">${svg(`<path d="M7 19H4.8a1.8 1.8 0 0 1-1.6-2.7L5.4 12.5"/><path d="M11 19h8.2a1.8 1.8 0 0 0 1.6-2.7l-1.2-2.1"/><path d="M14 16l-3 3 3 3"/><path d="M8.3 7.8 10.5 4a1.8 1.8 0 0 1 3.1 0l1.2 2.1"/><path d="M13.4 6.5l4.2-.9.9 4.2"/><path d="M8.6 12.3 5.4 12.5 4.2 9.3"/>`)}</span>`;
    if (c.yard) html += `<span class="hd-pickup hd-pickup-yard${c.expected ? " hd-pickup-expected" : ""}" title="Yard waste${c.expected ? " (expected — this year's schedule isn't published yet)" : why}">${svg(`<path d="M5 19c0-8 5-14 15-15 0 10-6 15-13 15"/><path d="M5 19c3-4 6-7 10-10"/>`)}</span>`;
    return html ? `<span class="hd-pickups">${html}</span>` : "";
  },

  /* ======================= icons ======================= */
  icon(name) {
    const p = {
      calendar: `<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>`,
      list: `<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 8h8M8 12h8M8 16h5"/>`,
      image: `<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>`,
      check: `<path d="M5 12.5l4.5 4.5L19 7.5"/>`,
      left: `<path d="M15 5l-7 7 7 7"/>`, right: `<path d="M9 5l7 7-7 7"/>`, plus: `<path d="M12 5v14M5 12h14"/>`
    }[name];
    return `<svg class="hd-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
  }
});
