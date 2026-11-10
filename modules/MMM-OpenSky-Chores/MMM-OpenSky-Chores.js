/* MMM-OpenSky-Chores — the full-screen Chores page: each child's chores for today from Greenlight (unofficial), one card per child.
 * Tap a chore to tick it off, tap it again to un-tick it. Chores are added and changed in the Greenlight app.
 * The login and tokens stay in the node helper; this page only gets chore names and done / not done.
 */
Module.register("MMM-OpenSky-Chores", {
  defaults: {
    kids: [],               // [{ id, name, color }] from opensky.json → chores.kids
    refreshMinutes: 5
  },

  getStyles() { return ["MMM-OpenSky-Chores.css"]; },
  getScripts() { return ["modules/opensky-lib/client/opensky-client.js"]; },

  start() {
    this.byKid = new Map();   // kid id → { chores, streak, allowance, loaded, error }
    this.seq = 0;
    this.sendSocketNotification("OS_CHORES_INIT", { kids: this.config.kids.map((k) => ({ id: k.id })), refreshMinutes: this.config.refreshMinutes });
  },

  getDom() {
    if (!this.root) {
      this.root = document.createElement("div");
      this.root.className = "ch-root";
      this.root.innerHTML = `
        <header class="ch-head"><span class="ch-title">${window.OpenSkyIcons.svg("chores")}Chores</span></header>
        <div class="ch-kids"></div>
        <div class="ch-none" hidden>No children yet. Go to <b>Settings</b> → <b>Set up from your phone</b> → <b>Chores</b>.</div>`;
    }
    this.render();
    return this.root;
  },

  notificationReceived(n) { if (n === "DOM_OBJECTS_CREATED") this.sendSocketNotification("OS_CHORES_REFRESH"); },
  resume() { this.sendSocketNotification("OS_CHORES_REFRESH"); },

  socketNotificationReceived(n, p) {
    if (n === "OS_CHORES" && p && Array.isArray(p.kids)) {
      for (const k of p.kids) this.byKid.set(k.id, k);
      this.render();
    } else if (n === "OS_CHORE_RESULT" && p && !p.ok) {
      if (window.OpenSkyToast) window.OpenSkyToast(p.error || "Couldn't reach Greenlight", "error");
    }
  },

  tap(kid, chore) {
    chore.done = !chore.done;                                   // show it at once; the refresh after it confirms (or puts it back)
    this.render();
    this.sendSocketNotification("OS_CHORE_SET", { id: ++this.seq, kid: kid.id, chore: chore.id, done: chore.done });
  },

  render() {
    if (!this.root) return;
    const box = this.root.querySelector(".ch-kids");
    const scroll = new Map([...box.querySelectorAll(".ch-card")].map((c) => [c.dataset.kid, c.querySelector(".ch-items").scrollTop]));
    box.innerHTML = "";
    this.root.querySelector(".ch-none").hidden = this.config.kids.length > 0;
    box.dataset.count = String(this.config.kids.length);
    for (const kid of this.config.kids) {
      const d = this.byKid.get(kid.id) || { chores: [], loaded: false };
      const EC = window.OpenSkyEventColors, c = EC && EC.colorOf(kid.color);
      const card = document.createElement("section");
      card.className = "ch-card";
      card.dataset.kid = kid.id;
      if (c) {
        const solid = EC.pair(c)[1];
        card.style.setProperty("--ch-accent", solid);
        card.style.setProperty("--ch-tint", `color-mix(in srgb, ${solid} 8%, white)`);
        card.style.setProperty("--ch-dark", `color-mix(in srgb, ${solid} 78%, black)`);
      }
      const done = d.chores.filter((x) => x.done).length, total = d.chores.length;
      card.innerHTML = `
        <div class="ch-card-head"><span class="ch-name"></span><span class="ch-count"></span></div>
        <div class="ch-meta" hidden></div>
        <div class="ch-bar" hidden><span></span></div>
        <div class="ch-items"></div>`;
      card.querySelector(".ch-name").textContent = kid.name || "Chores";
      if (d.loaded && total) {
        card.querySelector(".ch-count").textContent = `${done} of ${total}`;
        const bar = card.querySelector(".ch-bar");
        bar.hidden = false;
        bar.firstElementChild.style.width = `${Math.round(100 * done / total)}%`;
      }
      const meta = [d.streak, d.allowance].filter(Boolean).join(" · ");
      if (meta) { const m = card.querySelector(".ch-meta"); m.hidden = false; m.textContent = meta; }
      const list = card.querySelector(".ch-items");
      if (!d.loaded) list.innerHTML = `<div class="ch-empty">Loading…</div>`;
      else if (d.error && !total) { list.innerHTML = `<div class="ch-empty ch-error"></div>`; list.firstChild.textContent = d.error; }
      else if (!total) list.innerHTML = `<div class="ch-empty">No chores today</div>`;
      else {
        if (done === total) { const ok = document.createElement("div"); ok.className = "ch-alldone"; ok.textContent = "All done!"; list.append(ok); }
        // open chores first, finished ones below (a ticked chore moves down, an un-ticked one comes back up)
        for (const chore of [...d.chores.filter((x) => !x.done), ...d.chores.filter((x) => x.done)]) {
          const row = document.createElement("button");
          row.type = "button";
          row.className = "ch-item" + (chore.done ? " is-done" : "") + (chore.overdue && !chore.done ? " is-overdue" : "");
          row.innerHTML = `<span class="ch-check"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span><span class="ch-text"></span>`;
          row.querySelector(".ch-text").textContent = chore.text;
          row.setAttribute("aria-pressed", chore.done ? "true" : "false");
          row.onclick = () => this.tap(kid, chore);
          list.append(row);
        }
      }
      box.append(card);
      const top = scroll.get(kid.id);
      if (top) list.scrollTop = top;
    }
  }
});
