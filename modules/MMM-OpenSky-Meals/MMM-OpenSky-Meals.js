/* MMM-OpenSky-Meals
 * The family's meal plan from Mealie. No visible page of its own: it keeps the plan fresh and answers taps.
 *   broadcasts   OPENSKY_MEALS { entries: [{ id, date: "YYYY-MM-DD", type, title, recipeId, slug, hasImage, time }], loaded, error, types }
 *                (the Meals page shows the week, Home shows tonight's dinner)
 *   OPENSKY_MEALS_REFRESH         → fetch again (e.g. a page came back on screen)
 *   OPENSKY_MEAL_OPEN { entry }   → the recipe popup: picture, times, ingredients, steps, and "Add ingredients to <list>"
 *   OPENSKY_MEAL_ADD { date }     → (on-device plan) the "add a meal" popup for that day, and OPENSKY_MEAL_OPEN on an entry without
 *                                   a recipe opens the same popup to change or remove it. Typed text is only ever shown as text.
 * Recipe text goes into the page as plain text, never HTML (anyone who can write a recipe can't run code on the screen).
 * Popups live on <body>.
 */
Module.register("MMM-OpenSky-Meals", {
  defaults: {
    types: ["dinner"],        // breakfast, lunch, dinner, side — from opensky.json → meals.types
    addToList: null,          // { id, name } the shopping list "Add ingredients" fills; null = no button
    local: false              // the plan is kept on this Pi (meals.provider "local"): meals are added and changed on the Meals page
  },

  getStyles() { return ["MMM-OpenSky-Meals.css"]; },
  getScripts() { return ["modules/opensky-lib/client/opensky-client.js"]; },

  start() {
    this.state = { entries: [], loaded: false, error: null };
    this.seq = 0;
    this.sendSocketNotification("OS_MEALS_INIT", { types: this.config.types, local: this.config.local });
  },

  getDom() { return document.createElement("div"); },

  notificationReceived(n, p) {
    if (n === "OPENSKY_MEALS_REFRESH") this.sendSocketNotification("OS_MEALS_REFRESH");
    else if (n === "OPENSKY_MEAL_OPEN" && p && p.entry) { if (this.config.local) this.openEditor(p.entry); else this.openRecipe(p.entry); }
    else if (n === "OPENSKY_MEAL_ADD" && p && p.date && this.config.local) this.openEditor({ date: p.date });
    else if (n === "OPENSKY_IDLE_RESET" || n === "PAGE_CHANGED") this.close();
  },

  socketNotificationReceived(n, p) {
    if (n === "OS_MEALS" && p) {
      this.state = { entries: Array.isArray(p.entries) ? p.entries : [], loaded: !!p.loaded, error: p.error || null };
      this.sendNotification("OPENSKY_MEALS", { ...this.state, types: this.config.types });
    } else if (n === "OS_MEALS_SAVED" && p) {
      this.busy = false;
      const ed = this.editor;
      if (!ed) return;
      if (p.ok) this.close();
      else { ed.err.textContent = p.error || "Couldn't save that"; ed.err.hidden = false; ed.buttons.forEach((b) => { b.disabled = false; }); }
    } else if (n === "OS_MEALS_RECIPE_DATA" && p && this.popup && this.popup.slug === p.slug) {
      this.showRecipe(p.recipe, p.error);
    } else if (n === "OS_MEALS_ADDED" && p && this.addId === p.id) {
      this.addId = null;
      const b = this.popup && this.popup.add;
      if (b) { b.disabled = false; b.textContent = b.dataset.label; }
      if (window.OpenSkyToast) window.OpenSkyToast(p.ok ? `Added to ${this.config.addToList.name}` : (p.error || "Couldn't add them"), p.ok ? "success" : "error");
    }
  },

  /* ---------------- the recipe popup ---------------- */
  el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  },

  close() {
    if (this.popup) { this.popup.overlay.remove(); this.popup = null; this.addId = null; }
    if (this.editor) { this.editor.overlay.remove(); this.editor = null; this.busy = false; }
  },

  /* ---------------- add / change a meal (on-device plan) ---------------- */
  openEditor(entry) {
    this.close();
    const types = this.config.types, label = (t) => t.charAt(0).toUpperCase() + t.slice(1);
    const editing = !!entry.id, loc = (typeof config !== "undefined" && config.locale) || "en-US";
    const [y, mo, d] = entry.date.split("-").map(Number);
    const overlay = this.el("div", "osm-overlay"), modal = this.el("div", "osm-modal osm-edit");
    overlay.onclick = (e) => { if (e.target === overlay && !this.busy) this.close(); };
    const head = this.el("div", "osm-head"), x = this.el("button", "osm-x", "×");
    x.type = "button"; x.setAttribute("aria-label", "Close"); x.onclick = () => { if (!this.busy) this.close(); };
    head.append(this.el("div", "osm-title", `${editing ? "Change meal" : "Add a meal"} · ${new Date(y, mo - 1, d).toLocaleDateString(loc, { weekday: "long", month: "short", day: "numeric" })}`), x);
    const body = this.el("div", "osm-form");
    const input = this.el("input", "osm-input");
    input.type = "text"; input.maxLength = 200; input.placeholder = "What's for the meal?"; input.value = entry.title || ""; input.autocomplete = "off";
    let type = entry.type && types.includes(entry.type) ? entry.type : (types.includes("dinner") ? "dinner" : types[0]);
    const seg = this.el("div", "osm-types");
    const chips = types.map((t) => {
      const b = this.el("button", `osm-type${t === type ? " osm-on" : ""}`, label(t)); b.type = "button";
      b.onclick = () => { type = t; chips.forEach((c) => c.classList.toggle("osm-on", c === b)); };
      return b;
    });
    if (types.length > 1) seg.append(...chips);
    const err = this.el("p", "osm-err"); err.hidden = true;
    const actions = this.el("div", "osm-actions");
    const buttons = [];
    const send = (kind, payload) => { this.busy = true; err.hidden = true; buttons.forEach((b) => { b.disabled = true; }); this.sendSocketNotification(kind, payload); };
    if (editing) {
      const del = this.el("button", "osm-btn osm-danger", "Remove"); del.type = "button";
      del.onclick = () => send("OS_MEALS_DELETE", { id: entry.id });
      buttons.push(del); actions.append(del);
    }
    const save = this.el("button", "osm-btn osm-main", editing ? "Save" : "Add"); save.type = "button";
    save.onclick = () => {
      const title = input.value.replace(/\s+/g, " ").trim();
      if (!title) { err.textContent = "Please type what's for the meal"; err.hidden = false; input.focus(); return; }
      send("OS_MEALS_SAVE", { id: entry.id || undefined, date: entry.date, type, title });
    };
    buttons.push(save); actions.append(save);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") save.click(); else if (e.key === "Escape" && !this.busy) this.close(); });
    body.append(input, seg, err, actions);
    modal.append(head, body);
    overlay.append(modal);
    document.body.append(overlay);
    this.editor = { overlay, err, buttons };
    setTimeout(() => input.focus(), 50);   // (the on-screen keyboard follows the focus)
  },

  openRecipe(entry) {
    if (!entry.slug) return;   // a note-only entry ("Pizza night"): nothing more to show (on-device plan: openEditor)
    this.close();
    const overlay = this.el("div", "osm-overlay"), modal = this.el("div", "osm-modal");
    overlay.onclick = (e) => { if (e.target === overlay) this.close(); };
    const head = this.el("div", "osm-head"), title = this.el("div", "osm-title", entry.title), x = this.el("button", "osm-x", "×");
    x.type = "button"; x.setAttribute("aria-label", "Close"); x.onclick = () => this.close();
    head.append(title, x);
    const body = this.el("div", "osm-body");
    body.append(this.el("p", "osm-wait", "Opening the recipe…"));
    modal.append(head, body);
    overlay.append(modal);
    document.body.append(overlay);
    this.popup = { overlay, body, title, slug: entry.slug, add: null };
    this.sendSocketNotification("OS_MEALS_RECIPE", { slug: entry.slug });
  },

  showRecipe(r, error) {
    const body = this.popup.body;
    body.replaceChildren();
    if (error || !r) { body.append(this.el("p", "osm-wait", error || "Couldn't open that recipe")); return; }
    this.popup.title.textContent = r.name;
    const side = this.el("div", "osm-side"), main = this.el("div", "osm-main");
    if (r.hasImage) {
      const img = this.el("img", "osm-img");
      img.alt = ""; img.src = `/opensky-meal-image/${encodeURIComponent(r.id)}`;
      img.onerror = () => img.remove();
      side.append(img);
    }
    const facts = [...(r.servings ? [["Serves", r.servings]] : []), ...r.times];
    if (facts.length) {
      const f = this.el("div", "osm-facts");
      facts.forEach(([k, v]) => { const c = this.el("div", "osm-fact"); c.append(this.el("small", null, k), this.el("b", null, v)); f.append(c); });
      side.append(f);
    }
    if (r.description) side.append(this.el("p", "osm-desc", r.description));
    const list = this.config.addToList;
    if (list) {
      const b = this.el("button", "osm-add", `Add ingredients to ${list.name}`);
      b.type = "button"; b.dataset.label = b.textContent;
      b.onclick = () => {
        if (this.addId) return;
        this.addId = `a${++this.seq}`;
        b.disabled = true; b.textContent = "Adding…";
        this.sendSocketNotification("OS_MEALS_ADD", { id: this.addId, listId: list.id, recipeId: r.id });
      };
      this.popup.add = b;
      side.append(b);
    }
    main.append(this.el("h3", "osm-h", "Ingredients"));
    const ul = this.el("ul", "osm-ingredients");
    r.ingredients.forEach((i) => { const li = this.el("li", i.text ? "" : "osm-section", i.text || i.heading); if (i.text && i.heading) li.title = i.heading; ul.append(li); });
    if (!r.ingredients.length) ul.append(this.el("li", "osm-none", "No ingredients listed"));
    main.append(ul);
    if (r.steps.length) {
      main.append(this.el("h3", "osm-h", "Steps"));
      const ol = this.el("ol", "osm-steps");
      r.steps.forEach((s) => { const li = this.el("li"); if (s.title) li.append(this.el("b", null, s.title), document.createElement("br")); li.append(document.createTextNode(s.text)); ol.append(li); });
      main.append(ol);
    }
    body.append(side, main);
  }
});
