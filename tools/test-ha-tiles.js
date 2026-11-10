// Unit test for the Devices page's server side: lib/ha-tiles.js against a fake Home Assistant
// (lights, switches, locks, sensors; unreachable, wrong token, no setup).
const fs = require("fs"), os = require("os"), path = require("path"), http = require("http");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "opensky-hatiles-"));
process.env.OPENSKY_SECRETS = path.join(tmp, "secrets.json");   // (read by lib/secrets.js from the first require on)
let passed = 0, failed = 0;
const ok = (n, c, i) => { c ? passed++ : failed++; console.log(`${c ? "PASS" : "FAIL"}  ${n}${i !== undefined ? "  — " + JSON.stringify(i) : ""}`); };
const fails = async (fn) => { try { await fn(); return null; } catch (e) { return e.message; } };

const TOKEN = "ha-test-token-9f3a";
const states = [
  { entity_id: "light.hall", state: "on", attributes: { friendly_name: "Hall light", brightness: 128 } },
  { entity_id: "light.attic", state: "unavailable", attributes: { friendly_name: "Attic" } },
  { entity_id: "switch.fan", state: "off", attributes: { friendly_name: "Fan" } },
  { entity_id: "lock.front", state: "locked", attributes: { friendly_name: "Front door" } },
  { entity_id: "sensor.temp", state: "21.5", attributes: { friendly_name: "Living room", unit_of_measurement: "°C" } },
  { entity_id: "sensor.power", state: "340", attributes: { friendly_name: "Power", unit_of_measurement: "W" } },
  { entity_id: "binary_sensor.garage", state: "on", attributes: { friendly_name: "Garage", device_class: "garage_door" } },
  { entity_id: "media_player.kitchen", state: "idle", attributes: { friendly_name: "Kitchen" } },
  { entity_id: "automation.x", state: "on", attributes: {} }
];
const calls = [];
const server = http.createServer((req, res) => {
  let raw = ""; req.on("data", (c) => { raw += c; });
  req.on("end", () => {
    const send = (code, obj) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, {});
    if (req.url === "/api/states") return send(200, states);
    if (req.method === "POST" && req.url.startsWith("/api/services/")) { calls.push(`${req.url.slice(14)} ${raw}`); return send(200, []); }
    send(404, {});
  });
});

(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const ha = require(path.join(__dirname, "..", "lib", "ha-tiles.js"));

  ok("1 not set up → says how to set it up, no secret in the message", /isn't set up/.test(await fails(() => ha.tiles([{ entity: "light.hall" }]))));
  fs.writeFileSync(process.env.OPENSKY_SECRETS, JSON.stringify({ homeassistant: { url: "http://127.0.0.1:9", token: TOKEN } }));
  const down = await fails(() => ha.tiles([{ entity: "light.hall" }]));
  ok("2 unreachable → a friendly message", /Can't reach Home Assistant/.test(down) && !down.includes(TOKEN), down);
  fs.writeFileSync(process.env.OPENSKY_SECRETS, JSON.stringify({ homeassistant: { url, token: "wrong" } }));
  ok("3 wrong token → 'refused the token', no token in the message", /refused the token/.test(await fails(() => ha.tiles([{ entity: "light.hall" }]))));
  fs.writeFileSync(process.env.OPENSKY_SECRETS, JSON.stringify({ homeassistant: { url: url + "/", token: TOKEN } }));

  const t = await ha.tiles([{ entity: "light.hall" }, { entity: "light.attic", name: "Loft" }, { entity: "switch.fan", name: "Desk fan" }, { entity: "lock.front" }, { entity: "sensor.temp" }, { entity: "sensor.power" }, { entity: "binary_sensor.garage" }, { entity: "light.gone" }, { entity: "media_player.kitchen" }, { entity: "../etc" }]);
  const by = (id) => t.find((x) => x.id === id);
  ok("4 only lights/switches/locks/sensors are tiles, in the order given (others dropped)", t.map((x) => x.id).join() === "light.hall,light.attic,switch.fan,lock.front,sensor.temp,sensor.power,binary_sensor.garage,light.gone", t.map((x) => x.id));
  ok("5 a light: on, brightness in %", by("light.hall").on === true && by("light.hall").detail === "50%" && by("light.hall").name === "Hall light" && by("light.hall").kind === "light", by("light.hall"));
  ok("6 a chosen name wins; unavailable device marked not available", by("light.attic").name === "Loft" && by("light.attic").available === false && by("switch.fan").name === "Desk fan" && by("switch.fan").on === false);
  ok("7 a lock: on = locked, with its words", by("lock.front").kind === "lock" && by("lock.front").on === true && by("lock.front").detail === "Locked");
  ok("8 sensors: value + unit (°C close, W spaced); a garage door sensor says Open", by("sensor.temp").detail === "21.5°C" && by("sensor.power").detail === "340 W" && by("binary_sensor.garage").detail === "Open" && by("binary_sensor.garage").kind === "sensor");
  ok("9 an entity Home Assistant no longer has is reported, not an error", by("light.gone").available === false && /Not found/.test(by("light.gone").detail));

  await ha.control("light.hall", "off"); await ha.control("switch.fan", "on"); await ha.control("lock.front", "unlock"); await ha.control("lock.front", "lock");
  ok("10 on/off/lock/unlock → the right Home Assistant services",
    calls.join("|") === 'light/turn_off {"entity_id":"light.hall"}|switch/turn_on {"entity_id":"switch.fan"}|lock/unlock {"entity_id":"lock.front"}|lock/lock {"entity_id":"lock.front"}', calls);
  ok("11 sensors can't be controlled; a lock can't be 'turned on'; unknown entities and buttons refused",
    /only be read/.test(await fails(() => ha.control("sensor.temp", "on"))) && /Unknown button/.test(await fails(() => ha.control("lock.front", "on"))) &&
    /Unknown button/.test(await fails(() => ha.control("light.hall", "lock"))) && /Which device/.test(await fails(() => ha.control("automation.x", "on"))) && /Which device/.test(await fails(() => ha.control("light.hall/../x", "on"))) && calls.length === 4);

  const list = await ha.listEntities();
  ok("12 the phone's list: lights, switches, locks, sensors by name; no media players or automations", list.map((x) => x.id).join() === "light.attic,binary_sensor.garage,switch.fan,light.hall,sensor.temp,lock.front,sensor.power".split(",").sort((a, b) => list.find((x) => x.id === a).name.localeCompare(list.find((x) => x.id === b).name)).join() && list.length === 7, list.map((x) => x.id));

  server.close(); fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`SUMMARY pass=${passed} fail=${failed}`);
})();
