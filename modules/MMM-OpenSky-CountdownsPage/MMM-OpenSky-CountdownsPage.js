/* MMM-OpenSky-CountdownsPage — the Countdowns page: every current countdown (a vacation, a birthday, a big day) as a
 * large card with its photo, title, date and days to go. The countdowns are in opensky.json → countdowns (set from
 * phone setup → Countdowns); their photos are served as /opensky-countdown/<id> (MMM-OpenSky-Home's node helper).
 * A date that has passed hides after countdowns.keepDays, like on Home.
 */
Module.register("MMM-OpenSky-CountdownsPage", {
  defaults: {
    items: [],         // [{ id, title, date, yearly, photo, color }]
    keepDays: 0
  },

  getStyles() { return ["MMM-OpenSky-CountdownsPage.css"]; },
  getScripts() { return ["modules/opensky-lib/client/opensky-client.js", "modules/opensky-lib/client/countdowns.js"]; },

  start() {
    this.family = [];   // added from the family's phones, sent by Home (OPENSKY_FAMILY_COUNTDOWNS)
    this.lastDay = new Date(this.nowMs()).toDateString();
    setInterval(() => { const d = new Date(this.nowMs()).toDateString(); if (d !== this.lastDay) { this.lastDay = d; this.render(); } }, 60 * 1000);
  },

  // the one clock (scenarios pin it: page.nowMs = () => …)
  nowMs() { return Date.now(); },
  locale() { return (typeof config !== "undefined" && config.locale) || "en-US"; },

  getDom() {
    if (!this.root) {
      this.root = document.createElement("div");
      this.root.className = "cp-root";
      this.root.innerHTML = `
        <header class="cp-head">
          <span class="cp-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M5 12v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8M7.5 8a2.5 2.5 0 0 1 0-5C10 3 12 8 12 8s2-5 4.5-5a2.5 2.5 0 0 1 0 5"/></svg>Countdowns</span>
        </header>
        <div class="cp-msg" hidden></div>
        <div class="cp-grid"></div>`;
    }
    this.render();
    return this.root;
  },

  resume() { this.render(); },

  notificationReceived(n, payload) {
    if (n !== "OPENSKY_FAMILY_COUNTDOWNS") return;
    const items = payload && Array.isArray(payload.items) ? payload.items : [];
    const key = JSON.stringify(items.map((c) => [c.id, c.title, c.date, c.yearly]));
    if (key === this._familyKey) return;
    this._familyKey = key; this.family = items; this.render();
  },

  el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  },

  render() {
    if (!this.root) return;
    const C = window.OpenSkyCountdowns, E = window.OpenSkyEventColors, now = new Date(this.nowMs());
    const every = [...this.config.items, ...this.family];
    const list = C.visible(every, now, this.config.keepDays);
    const msg = this.root.querySelector(".cp-msg"), grid = this.root.querySelector(".cp-grid");
    msg.hidden = list.length > 0;
    msg.textContent = every.length
      ? "Nothing to count down to right now. Past dates hide by themselves; add a new one on your phone (Settings → Set up from your phone → Countdowns)."
      : "No countdowns yet. Add a trip, a birthday or a big day on your phone (Settings → Set up from your phone → Countdowns).";
    grid.dataset.count = String(Math.min(list.length, 6));
    grid.replaceChildren(...list.map((c) => {
      const card = this.el("article", `cp-card${c.days < 0 ? " cp-past" : c.days === 0 ? " cp-today" : ""}`);
      const [bg, bar] = E ? E.pair(c.color) : ["#ffc9a3", "#ec7a2c"];
      card.style.setProperty("--evc-bg", bg); card.style.setProperty("--evc-bar", bar);
      const pic = this.el("div", "cp-pic");
      pic.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M5 12v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8M7.5 8a2.5 2.5 0 0 1 0-5C10 3 12 8 12 8s2-5 4.5-5a2.5 2.5 0 0 1 0 5"/></svg>';
      if (c.photo) { const im = this.el("img"); im.alt = ""; im.src = `/opensky-countdown/${encodeURIComponent(c.id)}`; im.onerror = () => im.remove(); pic.append(im); }
      const body = this.el("div", "cp-body");
      const text = this.el("div", "cp-text");
      text.append(this.el("b", "cp-name", c.title),   // (text, never HTML)
        this.el("small", "cp-date", new Date(now.getFullYear(), now.getMonth(), now.getDate() + c.days, 12).toLocaleDateString(this.locale(), { weekday: "long", month: "long", day: "numeric", year: "numeric" })));
      const count = this.el("div", "cp-count");
      if (Math.abs(c.days) > 1) count.append(this.el("b", null, String(Math.abs(c.days))), this.el("small", null, c.days > 0 ? "days to go" : "days ago"));
      else count.append(this.el("b", "cp-word", C.label(c.days).replace(/!$/, "")));
      body.append(text, count);
      card.append(pic, body);
      card.setAttribute("aria-label", `${c.title}, ${C.label(c.days)}`);
      return card;
    }));
  }
});
