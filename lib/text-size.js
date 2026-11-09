/* OpenSky text size (server side) — opensky.json → look.textSize: "small", "normal" (the default), "large" or "xlarge".
 * It makes everything on the screen that much bigger or smaller, on top of look.scale. The screen
 * (lib/client/opensky-client.js → OpenSkyTextSize) and config/config.js use the same rule.
 */
const FACTORS = { small: 0.9, normal: 1, large: 1.15, xlarge: 1.3 };
const LABELS = { small: "Small", normal: "Normal", large: "Large", xlarge: "Extra large" };

/** "small" | "normal" | "large" | "xlarge" (any case; "extra-large" too), or null when it's none of them. */
function normalize(v) {
  const s = String(v == null ? "" : v).trim().toLowerCase().replace(/[\s_-]/g, "");
  const k = s === "extralarge" ? "xlarge" : s;
  return FACTORS[k] ? k : null;
}

module.exports = { normalize, FACTORS, LABELS };
