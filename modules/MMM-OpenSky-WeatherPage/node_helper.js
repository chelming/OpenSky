/* MMM-OpenSky-WeatherPage node helper - the weather extras (lib/weather-extras.js). The page never calls these services itself
 * (except the map pictures). Each part is fetched on its own, so one failing leaves the others working.
 *   OS_WX_INIT {latitude, longitude, units, hourly, alerts, radar, refreshMinutes} → starts refreshing; answers OS_WX_DATA
 *   OS_WX_REFRESH                                                                  → fetch again now (throttled to once a minute)
 *   OS_WX_DATA { hourly?: {ok, hours, current, rainDays|error}, alerts?: {ok, supported, alerts|error}, radar?: {ok, frames, base|error}, at }
 */
const NodeHelper = require("node_helper");
const path = require("path");
const extras = require(path.join(global.root_path, "modules", "opensky-lib", "weather-extras.js"));

module.exports = NodeHelper.create({
  start() { this.cfg = null; this.timer = null; this.lastAt = 0; },

  socketNotificationReceived(n, p) {
    if (n === "OS_WX_INIT" && p) {
      this.cfg = {
        latitude: Number(p.latitude), longitude: Number(p.longitude), units: p.units === "metric" ? "metric" : "imperial",
        hourly: !!p.hourly, alerts: !!p.alerts, radar: !!p.radar
      };
      clearInterval(this.timer);
      this.timer = setInterval(() => this.refresh(true), Math.max(5, Number(p.refreshMinutes) || 10) * 60 * 1000);
      this.refresh(true);
    } else if (n === "OS_WX_REFRESH") this.refresh(false);
  },

  async refresh(force) {
    const c = this.cfg;
    if (!c || (!force && Date.now() - this.lastAt < 60 * 1000)) return;
    this.lastAt = Date.now();
    const part = async (fn) => { try { return { ok: true, ...(await fn()) }; } catch (e) { return { ok: false, error: e.message }; } };
    const [hourly, alerts, radar] = await Promise.all([
      c.hourly ? part(() => extras.fetchForecast(c)) : null,
      c.alerts ? part(() => extras.fetchAlerts(c)) : null,
      c.radar ? part(() => extras.fetchRadar()) : null
    ]);
    const out = { at: Date.now() };
    if (hourly) out.hourly = hourly;
    if (alerts) out.alerts = alerts;
    if (radar) out.radar = radar;
    this.sendSocketNotification("OS_WX_DATA", out);
  }
});
