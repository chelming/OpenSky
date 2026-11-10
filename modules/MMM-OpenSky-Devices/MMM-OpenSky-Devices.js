/* MMM-OpenSky-Devices — the Devices page: Home Assistant lights, switches, locks and sensors as tappable tiles.
 * Tap a light or switch to turn it on or off; a lock asks for a second tap ("Tap again to unlock") so a stray touch can't
 * open the door. Sensors are read-only. Which tiles show, their names and order: opensky.json → devices.tiles
 * (phone setup → Extras → Devices). The address and token stay in secrets.json; the node helper talks to Home Assistant.
 */
Module.register("MMM-OpenSky-Devices", {
  defaults: { tiles: [] },   // [{ entity, name? }]

  getStyles() { return ["MMM-OpenSky-Devices.css"]; },
  getScripts() { return ["modules/opensky-lib/client/opensky-client.js"]; },

  start() {
    this.states = null;     // [{ id, name, kind, on, state, detail, available }] — null until the first answer
    this.error = null;
    this.confirm = null;    // { id, timer }: a lock waiting for its second tap
    this.sendSocketNotification("OS_DEV_INIT", { tiles: this.config.tiles });
  },

  suspend() { this.sendSocketNotification("OS_DEV_VISIBLE", false); this.cancelConfirm(); },
  resume() { this.sendSocketNotification("OS_DEV_VISIBLE", true); },
  notificationReceived(n) { if (n === "OPENSKY_IDLE_RESET") this.cancelConfirm(); },

  socketNotificationReceived(n, p) {
    if (n === "OS_DEV_STATE") {
      this.states = p.tiles; this.error = p.error;
      this.updateDom();
    } else if (n === "OS_DEV_ERROR") {
      this.toast(p.message);
      this.sendSocketNotification("OS_DEV_VISIBLE", true);   // show what is true now
    }
  },

  cancelConfirm() { if (this.confirm) { clearTimeout(this.confirm.timer); this.confirm = null; if (this.root) this.updateDom(); } },

  el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; },
  icon(name) { return window.OpenSkyIcons ? window.OpenSkyIcons.svg(name) : ""; },   // (only our own icons)

  iconFor(t) {
    if (t.kind === "light") return "devices";
    if (t.kind === "switch") return "plug";
    if (t.kind === "lock") return t.on ? "padlock" : "padlockOpen";
    return "gauge";
  },

  // the dashboard's pale event-pill colors: on = a strong color, off = gray, an unlocked door stands out
  colorFor(t) {
    if (!t.available) return "gray";
    if (t.kind === "light") return t.on ? "yellow" : "gray";
    if (t.kind === "switch") return t.on ? "blue" : "gray";
    if (t.kind === "lock") return t.state === "jammed" ? "red" : t.on ? "emerald" : "orange";
    return t.on ? "teal" : "gray";
  },

  tap(t) {
    if (!t.available || t.kind === "sensor") return;
    if (t.kind === "lock") {
      if (!(this.confirm && this.confirm.id === t.id)) {
        this.cancelConfirm();
        this.confirm = { id: t.id, timer: setTimeout(() => this.cancelConfirm(), 4000) };
        return this.updateDom();
      }
      this.cancelConfirm();
      const unlock = t.on;
      t.state = unlock ? "unlocking" : "locking"; t.detail = unlock ? "Unlocking…" : "Locking…";
      this.updateDom();
      return this.sendSocketNotification("OS_DEV_CONTROL", { entity: t.id, action: unlock ? "unlock" : "lock" });
    }
    t.on = !t.on; t.state = t.on ? "on" : "off"; t.detail = "";   // at once; Home Assistant's answer follows
    this.updateDom();
    this.sendSocketNotification("OS_DEV_CONTROL", { entity: t.id, action: t.on ? "on" : "off" });
  },

  toast(message) {
    if (!this.root) return;
    const t = this.el("div", "dv-toast", message);
    this.root.append(t);
    setTimeout(() => t.remove(), 4000);
  },

  getDom() {
    const root = this.root = this.el("div", "dv-root");
    const EC = window.OpenSkyEventColors;
    const head = this.el("div", "dv-head");
    const title = this.el("span", "dv-title");
    title.innerHTML = this.icon("devices");
    title.append(this.el("b", null, "Devices"));
    head.append(title);
    root.append(head);

    if (!this.config.tiles.length) {
      const m = this.el("div", "dv-empty");
      m.innerHTML = this.icon("devices");
      m.append(this.el("h2", null, "No devices yet"), this.el("p", null, "On your phone: Settings → Set up from your phone → Extras → Devices. Pick the lights, switches and locks you want here."));
      root.append(m);
      return root;
    }
    if (this.error) {
      const msg = this.el("div", "dv-msg");
      msg.append(this.el("b", null, "Can't show your devices right now"), this.el("span", null, this.error));
      root.append(msg);
    }
    if (!this.states) { if (!this.error) root.append(this.el("div", "dv-msg", "Asking Home Assistant…")); return root; }

    const grid = this.el("div", `dv-grid${this.error ? " dv-stale" : ""}`);
    for (const t of this.states) {
      const asking = this.confirm && this.confirm.id === t.id;
      const b = this.el("button", `dv-tile dv-${t.kind}${t.on ? " on" : ""}${asking ? " asking" : ""}${t.available ? "" : " off-line"}`);
      b.type = "button";
      const [bg, bar] = EC ? EC.pair(this.colorFor(t)) : ["#e5e7eb", "#9ca3af"];
      b.setAttribute("style", `--evc-bg:${bg};--evc-bar:${bar}`);
      b.dataset.entity = t.id;
      const ic = this.el("span", "dv-ic"); ic.innerHTML = this.icon(this.iconFor(t));
      const state = asking ? (t.on ? "Tap again to unlock" : "Tap again to lock")
        : !t.available ? (t.detail || "Not reachable")
        : t.kind === "sensor" || t.kind === "lock" ? t.detail
        : t.on ? "On" : "Off";
      b.append(ic, this.el("span", "dv-name", t.name), this.el("span", "dv-state", state));
      b.setAttribute("aria-label", `${t.name}, ${state}`);
      if (t.kind === "sensor" || !t.available) b.disabled = true;
      else b.onclick = () => this.tap(t);
      grid.append(b);
    }
    root.append(grid);
    return root;
  }
});
