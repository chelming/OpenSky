/* OpenSky dark mode (server side) — opensky.json → look.theme: "light" (the default), "dark" or "auto" (dark from sunset to
 * sunrise at the configured location, or 19:00 to 07:00 without one). look.lightSensor: true lets an ambient light sensor,
 * where the screen has one, overrule the sun. The screen (lib/client/opensky-client.js → OpenSkyTheme, which also holds the
 * sun maths) and config/config.js use the same rule.
 */
const LABELS = { light: "Light", dark: "Dark", auto: "Auto (by sun)" };

/** "light" | "dark" | "auto" (any case), or null when it's none of them. */
function normalize(v) {
  const s = String(v == null ? "" : v).trim().toLowerCase().replace(/[\s_()-]/g, "");
  return s === "light" || s === "dark" ? s : (s === "auto" || s === "autobysun" ? "auto" : null);
}

module.exports = { normalize, LABELS };
