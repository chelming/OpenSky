/* MMM-OpenSky-Devices node helper — Home Assistant lights, switches, locks and sensors (lib/ha-tiles.js).
 * The page never sees the address or token.
 *   OS_DEV_INIT {tiles: [{entity, name?}]} → OS_DEV_STATE {tiles, error?}
 *   OS_DEV_VISIBLE true|false              (polls every 4 s while the page shows, else every 60 s)
 *   OS_DEV_CONTROL {entity, action}        → the device is changed (only the tiles set in opensky.json), then OS_DEV_STATE
 *                                            (or OS_DEV_ERROR {entity, message})
 */
const NodeHelper = require("node_helper");
const path = require("path");
const ha = require(path.join(global.root_path, "modules", "opensky-lib", "ha-tiles.js"));

module.exports = NodeHelper.create({
  start() { this.list = []; this.visible = false; this.timer = null; this.last = ""; },

  socketNotificationReceived(n, p) {
    if (n === "OS_DEV_INIT") {
      this.list = Array.isArray(p && p.tiles) ? p.tiles.filter((t) => t && ha.ENTITY.test(t.entity || "")) : [];
      this.last = "";
      // Home Assistant pushes changes over its websocket; we then re-read at once (the polling below slows right down while it's connected)
      if (!this.watcher && this.list.length) {
        this.watcher = ha.watch((entity) => {
          if (!this.list.some((t) => t.entity === entity)) return;
          clearTimeout(this.pushTimer);
          this.pushTimer = setTimeout(() => this.poll(), 250);   // (a burst of changes → one read)
        });
      }
      this.poll();
    } else if (n === "OS_DEV_VISIBLE") {
      this.visible = !!p;
      if (this.visible) { this.last = ""; this.poll(); }
    } else if (n === "OS_DEV_CONTROL" && p) {
      // only a device that is a tile on this screen can be changed
      if (!this.list.some((t) => t.entity === p.entity)) return this.sendSocketNotification("OS_DEV_ERROR", { entity: p.entity, message: "That device isn't one of this screen's tiles" });
      ha.control(p.entity, p.action)
        .catch((e) => { console.error(`[OpenSky] devices: ${e.message}`); this.sendSocketNotification("OS_DEV_ERROR", { entity: p.entity, message: e.message }); })
        .finally(() => setTimeout(() => { this.last = ""; this.poll(); }, 600));
    }
  },

  async poll() {
    clearTimeout(this.timer);
    let msg;
    if (!this.list.length) msg = { tiles: [], error: null };
    else {
      try { msg = { tiles: await ha.tiles(this.list), error: null }; }
      catch (e) {
        if (this.failing !== e.message) console.error(`[OpenSky] devices: ${e.message}`);
        this.failing = e.message; msg = { tiles: null, error: e.message };
      }
      if (!msg.error) this.failing = null;
    }
    const key = JSON.stringify(msg);
    if (key !== this.last) { this.last = key; this.sendSocketNotification("OS_DEV_STATE", msg); }
    const live = this.watcher && this.watcher.live();   // pushes arrive: polling is only a safety net
    this.timer = setTimeout(() => this.poll(), live || !this.visible ? 60000 : 4000);
  },

  stop() { clearTimeout(this.timer); clearTimeout(this.pushTimer); if (this.watcher) this.watcher.stop(); }
});
