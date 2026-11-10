/* OpenSky weather extras (server side): the hourly forecast, weather alerts and the radar's frame list.
 *   hourly  Open-Meteo (free, no key): next 24 hours - temperature, condition id (same ids as lib/weather.js), chance of rain
 *   alerts  NWS api.weather.gov (free, no key, United States only). Elsewhere: { supported: false } - the page says so.
 *   radar   RainViewer (free, no key): the list of recent radar frames. The page loads the map pictures itself.
 * Test stand-ins: OPENSKY_WEATHER_URL (Open-Meteo), OPENSKY_NWS_URL, OPENSKY_RADAR_URL, OPENSKY_RADAR_BASE (basemap tiles).
 */
const { wmoToId } = require("./weather.js");

const TIMEOUT = 15000;
const OPEN_METEO = () => (process.env.OPENSKY_WEATHER_URL || "https://api.open-meteo.com").replace(/\/+$/, "");
const NWS = () => (process.env.OPENSKY_NWS_URL || "https://api.weather.gov").replace(/\/+$/, "");
const RAINVIEWER = () => (process.env.OPENSKY_RADAR_URL || "https://api.rainviewer.com").replace(/\/+$/, "");
const BASEMAP = () => process.env.OPENSKY_RADAR_BASE || "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png";

async function getJson(url, headers) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** The next 24 hours: [{ day: "YYYY-MM-DD", hour: 0-23, temp, id, rain }] (rain = chance of precipitation in %, or null) */
async function fetchHourly(o) {
  if (!Number.isFinite(o.latitude) || !Number.isFinite(o.longitude)) throw new Error("no location set");
  const unit = (o.units || "imperial") === "imperial" ? "fahrenheit" : "celsius";
  const j = await getJson(`${OPEN_METEO()}/v1/forecast?latitude=${o.latitude}&longitude=${o.longitude}` +
    `&hourly=temperature_2m,weather_code,precipitation_probability&forecast_hours=24&temperature_unit=${unit}&timezone=auto`);
  const h = j.hourly;
  if (!h || !Array.isArray(h.time)) throw new Error("no hourly forecast in the answer");
  const out = [];
  h.time.forEach((t, i) => {
    const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):/.exec(t);
    if (!m || h.temperature_2m[i] == null) return;
    const p = h.precipitation_probability && h.precipitation_probability[i];
    out.push({ day: m[1], hour: Number(m[2]), temp: Math.round(h.temperature_2m[i]), id: wmoToId(h.weather_code[i]), rain: p == null ? null : Math.round(p) });
  });
  return out.slice(0, 24);
}

// Roughly the United States (50 states + Puerto Rico), where the NWS has alerts. Anywhere else: not supported.
function inUS(lat, lon) {
  return (lat >= 24 && lat <= 50 && lon >= -125 && lon <= -66) ||     // lower 48 (the edges include a little of Canada and Mexico)
    (lat >= 51 && lat <= 72 && (lon <= -129 || lon >= 172)) ||   // Alaska
    (lat >= 18 && lat <= 23 && lon >= -161 && lon <= -154) ||         // Hawaii
    (lat >= 17 && lat <= 19 && lon >= -68 && lon <= -65);             // Puerto Rico, US Virgin Islands
}
const SEVERITY = { extreme: 4, severe: 3, moderate: 2, minor: 1 };
const clip = (s, n) => { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s; };

/** { supported, alerts: [{ id, event, severity: "extreme"|"severe"|"moderate"|"minor", headline, text, ends, areas }] }, worst first */
async function fetchAlerts(o) {
  if (!Number.isFinite(o.latitude) || !Number.isFinite(o.longitude)) throw new Error("no location set");
  if (!inUS(o.latitude, o.longitude)) return { supported: false, alerts: [] };
  const j = await getJson(`${NWS()}/alerts/active?point=${o.latitude.toFixed(4)},${o.longitude.toFixed(4)}`,
    { "User-Agent": "OpenSky family calendar", Accept: "application/geo+json" });
  const alerts = (j.features || []).map((f) => f.properties || {}).filter((p) => p.event && p.status !== "Test").map((p) => ({
    id: String(p.id || p.event), event: clip(p.event, 60),
    severity: SEVERITY[String(p.severity).toLowerCase()] ? String(p.severity).toLowerCase() : "minor",
    headline: clip(p.headline, 200), text: clip(p.description, 700), ends: p.ends || p.expires || null, areas: clip(p.areaDesc, 120)
  }));
  alerts.sort((a, b) => SEVERITY[b.severity] - SEVERITY[a.severity]);
  return { supported: true, alerts: alerts.slice(0, 8) };
}

/** { frames: [{ time (unix s), url: tile template with {z}/{x}/{y} }], base: basemap tile template } - the last hour or so of radar */
async function fetchRadar() {
  const j = await getJson(`${RAINVIEWER()}/public/weather-maps.json`);
  const host = String(j.host || "").replace(/\/+$/, "");
  const past = (j.radar && j.radar.past) || [];
  if (!/^https?:\/\//.test(host) || !past.length) throw new Error("no radar pictures in the answer");
  const frames = past.slice(-6).filter((f) => /^\/[\w/.-]+$/.test(String(f.path))).map((f) => ({ time: f.time, url: `${host}${f.path}/256/{z}/{x}/{y}/2/1_1.png` }));
  if (!frames.length) throw new Error("no radar pictures in the answer");
  return { frames, base: BASEMAP() };
}

module.exports = { fetchHourly, fetchAlerts, fetchRadar, inUS };
