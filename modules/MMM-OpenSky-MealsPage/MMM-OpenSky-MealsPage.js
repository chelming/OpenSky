/* MMM-OpenSky-MealsPage — the full-screen Meals page: the week's meals from Mealie, a column per day (a row per day on
 * portrait screens). Shows what MMM-OpenSky-Meals broadcasts (OPENSKY_MEALS) and sends taps back to it
 * (OPENSKY_MEAL_OPEN → the recipe popup). Previous / next week / Today move through the weeks Mealie was asked for
 * (a week back to five weeks ahead).
 */
Module.register("MMM-OpenSky-MealsPage", {
  defaults: {
    firstDayOfWeek: 0,            // 0 = Sunday, 1 = Monday (opensky.json → locale)
    types: ["dinner"]
  },

  getStyles() { return ["MMM-OpenSky-MealsPage.css"]; },
  getScripts() { return ["modules/opensky-lib/client/opensky-client.js"]; },

  start() {
    this.state = { entries: [], loaded: false, error: null, types: this.config.types };
    this.weekOffset = 0;
    this.lastDay = new Date(this.nowMs()).toDateString();
    setInterval(() => { const d = new Date(this.nowMs()).toDateString(); if (d !== this.lastDay) { this.lastDay = d; this.weekOffset = 0; this.render(); } }, 60 * 1000);
  },

  // the one clock (scenarios pin it: page.nowMs = () => …)
  nowMs() { return Date.now(); },
  locale() { return (typeof config !== "undefined" && config.locale) || "en-US"; },
  key(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; },

  getDom() {
    if (!this.root) {
      this.root = document.createElement("div");
      this.root.className = "mp-root";
      this.root.innerHTML = `
        <header class="mp-head">
          <span class="mp-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3v7a2 2 0 0 0 2 2h1v9M10 3v7M7.5 3v6"/><path d="M18 21V3c-2.2 0-4 2.2-4 6v4h4"/></svg>Meals</span>
          <span class="mp-range"></span>
          <span class="mp-nav">
            <button class="mp-btn mp-prev" aria-label="Previous week"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg></button>
            <button class="mp-btn mp-today">Today</button>
            <button class="mp-btn mp-next" aria-label="Next week"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg></button>
          </span>
        </header>
        <div class="mp-msg" hidden></div>
        <div class="mp-days"></div>`;
      this.root.querySelector(".mp-prev").onclick = () => { this.weekOffset--; this.render(); };
      this.root.querySelector(".mp-next").onclick = () => { this.weekOffset++; this.render(); };
      this.root.querySelector(".mp-today").onclick = () => { this.weekOffset = 0; this.render(); };
    }
    this.render();
    return this.root;
  },

  notificationReceived(n, p) {
    if (n === "OPENSKY_MEALS" && p) { this.state = p; this.render(); }
    else if (n === "DOM_OBJECTS_CREATED") this.sendNotification("OPENSKY_MEALS_REFRESH");
  },

  resume() { this.weekOffset = 0; this.render(); this.sendNotification("OPENSKY_MEALS_REFRESH"); },   // back on this page: this week again

  // the week shown: the 7 days from the week's first day, `weekOffset` weeks from this one
  weekDays() {
    const now = new Date(this.nowMs());
    const back = (now.getDay() - (this.config.firstDayOfWeek === 1 ? 1 : 0) + 7) % 7;
    return Array.from({ length: 7 }, (_, i) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - back + this.weekOffset * 7 + i));
  },

  el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  },

  render() {
    if (!this.root) return;
    const days = this.weekDays(), loc = this.locale();
    const fmt = (d, o) => d.toLocaleDateString(loc, o);
    this.root.querySelector(".mp-range").textContent = `${fmt(days[0], { month: "short", day: "numeric" })} – ${fmt(days[6], { month: "short", day: "numeric" })}`;
    const st = this.state, msg = this.root.querySelector(".mp-msg"), box = this.root.querySelector(".mp-days");
    const nothing = st.loaded && !st.entries.length;
    // what to say instead of (or above) the days
    if (st.error && !st.loaded) { msg.textContent = `${st.error}. Check the Mealie settings on your phone (Settings → Set up from your phone → Meals).`; msg.hidden = false; box.hidden = true; return; }
    msg.hidden = !(st.error || nothing || !st.loaded);
    msg.textContent = st.error ? `Showing the last meal plan Mealie gave us. ${st.error}` : !st.loaded ? "Loading the meal plan…" : "Nothing is planned yet. Plan meals in Mealie and they show up here.";
    box.hidden = false;
    const types = this.state.types || this.config.types, label = (t) => t === "side" ? "Side" : t.charAt(0).toUpperCase() + t.slice(1);
    const today = this.key(new Date(this.nowMs()));
    box.replaceChildren(...days.map((d) => {
      const k = this.key(d), col = this.el("section", `mp-day${k === today ? " mp-today-col" : ""}`);
      const h = this.el("header", "mp-day-head");
      h.append(this.el("b", null, fmt(d, { weekday: "short" })), this.el("span", null, fmt(d, { month: "short", day: "numeric" })));
      col.append(h);
      const items = this.el("div", "mp-items");
      const entries = st.entries.filter((e) => e.date === k);
      entries.forEach((e) => {
        const c = this.el("button", `mp-meal${e.slug ? "" : " mp-plain"}`);
        c.type = "button";
        if (e.hasImage && e.recipeId) { const im = this.el("img", "mp-thumb"); im.alt = ""; im.loading = "lazy"; im.src = `/opensky-meal-image/${encodeURIComponent(e.recipeId)}`; im.onerror = () => im.remove(); c.append(im); }
        const t = this.el("span", "mp-meal-text");
        if (types.length > 1) t.append(this.el("small", null, label(e.type)));
        t.append(this.el("b", null, e.title));
        if (e.time) t.append(this.el("small", "mp-time", e.time));
        c.append(t);
        if (e.slug) c.onclick = () => this.sendNotification("OPENSKY_MEAL_OPEN", { entry: e });
        items.append(c);
      });
      if (!entries.length) items.append(this.el("p", "mp-empty", "—"));
      col.append(items);
      return col;
    }));
    this.root.querySelector(".mp-prev").disabled = this.weekOffset <= -1;   // Mealie is asked for a week back to five weeks ahead
    this.root.querySelector(".mp-next").disabled = this.weekOffset >= 5;
  }
});
