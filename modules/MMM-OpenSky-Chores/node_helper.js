/* MMM-OpenSky-Chores node helper — the kids' chores from Greenlight (lib/greenlight.js; the login and tokens stay here).
 *   OS_CHORES_INIT {kids, refreshMinutes}   → starts refreshing; answers OS_CHORES {kids: [{id, chores, streak, allowance, loaded, error?}]}
 *   OS_CHORES_REFRESH                        → fetch again now (throttled)
 *   OS_CHORE_SET {id, kid, chore, done}      → ticks / un-ticks one chore → OS_CHORE_RESULT {id, ok, error?}, then OS_CHORES
 */
const NodeHelper = require("node_helper");
const path = require("path");
const greenlight = require(path.join(global.root_path, "modules", "opensky-lib", "greenlight.js"));

module.exports = NodeHelper.create({
  start() {
    this.kids = [];
    this.last = new Map();     // kid id → last good { chores, streak, allowance } (shown while Greenlight is unreachable)
    this.errors = new Map();
  },

  socketNotificationReceived(n, p) {
    if (n === "OS_CHORES_INIT") {
      this.kids = (p && Array.isArray(p.kids) ? p.kids : []).filter((k) => k && /^\d+$/.test(String(k.id)));
      clearInterval(this.timer);
      const minutes = Math.max(1, Number(p && p.refreshMinutes) || 5);
      this.timer = setInterval(() => this.refresh(), minutes * 60 * 1000);
      if (this.last.size) this.broadcast();
      this.refresh();
    } else if (n === "OS_CHORES_REFRESH") {
      if (Date.now() - (this.lastRefresh || 0) > 3000) this.refresh();
    } else if (n === "OS_CHORE_SET" && p && p.id) {
      const known = this.kids.some((k) => String(k.id) === String(p.kid));
      (known ? greenlight.setDone(p.chore, !!p.done) : Promise.reject(new Error("That child isn't on this screen any more"))).then(
        () => this.sendSocketNotification("OS_CHORE_RESULT", { id: p.id, ok: true }),
        (e) => {
          console.error(`[OpenSky] chores: couldn't ${p.done ? "tick" : "untick"} a chore: ${e.message}`);   // (no chore text, no tokens)
          this.sendSocketNotification("OS_CHORE_RESULT", { id: p.id, ok: false, error: e.message });
        }
      ).finally(() => this.refresh(true));
    }
  },

  async refresh(force) {
    if (this.running && !force) return;
    this.running = true;
    this.lastRefresh = Date.now();
    await Promise.all(this.kids.map(async (k) => {
      const id = String(k.id);
      try { this.last.set(id, await greenlight.choresOf(id)); this.errors.delete(id); }
      catch (e) {
        if (!this.errors.has(id)) console.error(`[OpenSky] chores: ${e.message}`);
        this.errors.set(id, e.message);
      }
    }));
    this.running = false;
    this.broadcast();
  },

  broadcast() {
    this.sendSocketNotification("OS_CHORES", {
      kids: this.kids.map((k) => {
        const id = String(k.id), d = this.last.get(id);
        return { id, chores: d ? d.chores : [], streak: d ? d.streak : "", allowance: d ? d.allowance : "",
          loaded: !!d || this.errors.has(id), error: d ? null : (this.errors.get(id) || null) };
      })
    });
  }
});
