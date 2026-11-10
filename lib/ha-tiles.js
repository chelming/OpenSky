/* OpenSky Devices page (server side) — Home Assistant lights, switches, locks and sensors as tiles.
 * Used by MMM-OpenSky-Devices' node helper and by phone setup (to list what Home Assistant has).
 * Address + long-lived token: secrets.json → homeassistant.url / .token (the same as Home Assistant lists and speakers);
 * they never reach the page.
 *   tiles([{ entity, name? }]) → [{ id, name, kind, on, state, detail, available }]   (one request for all)
 *   control(entity, action)    action: "on" | "off" (lights, switches) · "lock" | "unlock" (locks); sensors are read-only
 *   listEntities()             → [{ id, name, kind, state }] every light, switch, lock and sensor Home Assistant has
 */
const path = require("path");
const { secret } = require(path.join(__dirname, "secrets.js"));

const KINDS = { light: "light", switch: "switch", lock: "lock", sensor: "sensor", binary_sensor: "sensor" };
const ENTITY = /^(light|switch|lock|sensor|binary_sensor)\.[a-z0-9_]+$/;
const kindOf = (id) => KINDS[String(id).split(".")[0]] || null;

async function haCall(method, p, body) {
  const url = String(secret("homeassistant.url") || "").replace(/\/+$/, ""), token = secret("homeassistant.token");
  if (!url || !token) throw new Error("Home Assistant isn't set up — add its address and token in phone setup");
  let res;
  try {
    res = await fetch(`${url}${p}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(5000) });
  } catch (e) { throw new Error("Can't reach Home Assistant. Is it on, and is the address right?"); }
  if (res.status === 401 || res.status === 403) throw new Error("Home Assistant refused the token — make a new one in phone setup");
  if (res.status === 404) throw new Error("Home Assistant doesn't know that device");
  if (!res.ok) throw new Error(`Home Assistant error (HTTP ${res.status})`);
  return res;
}

const BINARY = {   // binary_sensor device_class → [on, off]
  door: ["Open", "Closed"], window: ["Open", "Closed"], garage_door: ["Open", "Closed"], opening: ["Open", "Closed"],
  motion: ["Motion", "Clear"], occupancy: ["Occupied", "Clear"], presence: ["Home", "Away"], moisture: ["Wet", "Dry"],
  smoke: ["Smoke", "Clear"], lock: ["Unlocked", "Locked"], connectivity: ["Connected", "Offline"]
};

/** One Home Assistant state → a tile */
function tileOf(st, name) {
  const a = st.attributes || {}, kind = kindOf(st.entity_id), s = String(st.state);
  const available = !["unavailable", "unknown"].includes(s);
  const t = { id: st.entity_id, name: String(name || a.friendly_name || st.entity_id), kind, on: false, state: s, detail: "", available };
  if (kind === "light" || kind === "switch") {
    t.on = s === "on";
    if (kind === "light" && t.on && a.brightness != null) t.detail = `${Math.round(Number(a.brightness) / 2.55)}%`;
  } else if (kind === "lock") {
    t.on = s === "locked";   // on = secure
    t.detail = ({ locked: "Locked", unlocked: "Unlocked", locking: "Locking…", unlocking: "Unlocking…", jammed: "Jammed", open: "Open" })[s] || s;
  } else if (kind === "sensor") {
    if (st.entity_id.startsWith("binary_sensor.")) {
      const w = BINARY[a.device_class] || ["On", "Off"];
      t.on = s === "on"; t.detail = available ? (s === "on" ? w[0] : w[1]) : "";
    } else t.detail = available ? `${s}${a.unit_of_measurement ? (/^[%°]/.test(a.unit_of_measurement) ? "" : " ") + a.unit_of_measurement : ""}` : "";
  }
  return t;
}

module.exports = {
  ENTITY,
  async tiles(list) {
    const wanted = (list || []).filter((t) => t && ENTITY.test(t.entity || ""));
    const all = new Map((await (await haCall("GET", "/api/states")).json()).map((s) => [s.entity_id, s]));
    return wanted.map((t) => {
      const st = all.get(t.entity);
      return st ? tileOf(st, t.name) : { id: t.entity, name: String(t.name || t.entity), kind: kindOf(t.entity), on: false, state: "missing", detail: "Not found in Home Assistant", available: false };
    });
  },
  async control(entity, action) {
    if (!ENTITY.test(entity || "")) throw new Error("Which device?");
    const kind = kindOf(entity), domain = entity.split(".")[0];
    if (kind === "sensor") throw new Error("Sensors can only be read");
    const svc = kind === "lock" ? { lock: "lock", unlock: "unlock" }[action] : { on: "turn_on", off: "turn_off" }[action];
    if (!svc) throw new Error("Unknown button");
    await haCall("POST", `/api/services/${domain}/${svc}`, { entity_id: entity });
  },
  async listEntities() {
    const all = await (await haCall("GET", "/api/states")).json();
    return all.filter((s) => ENTITY.test(s.entity_id || "")).map((s) => ({ id: s.entity_id, name: String((s.attributes || {}).friendly_name || s.entity_id), kind: kindOf(s.entity_id), state: String(s.state) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
};
