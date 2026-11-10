// Devices page (fake Home Assistant, port 8101): Home Assistant lights, switches, locks and sensors as tiles.
// Tiles with their chosen names and states; a tap on a light / switch reaches Home Assistant; a lock needs a second tap
// (and a lone tap times out); sensors are read-only; an unreachable Home Assistant gives a friendly message and the tiles
// come back when it answers; compact and portrait layouts fit. The token is only in secrets.json (the harness also checks
// that it never reaches the log).
const http = require("http");
const PORT = 8101, TOKEN = "fake-ha-devices-token";
const states = {
  "light.hall": { state: "on", attributes: { friendly_name: "Hall light", brightness: 128 } },
  "switch.fan": { state: "off", attributes: { friendly_name: "Desk fan" } },
  "lock.front": { state: "locked", attributes: { friendly_name: "Front door lock" } },
  "sensor.temp": { state: "21.5", attributes: { friendly_name: "Living room", unit_of_measurement: "°C" } },
  "light.attic": { state: "unavailable", attributes: { friendly_name: "Attic" } }
};
const calls = []; let down = false;
const fake = http.createServer((req, res) => {
  let raw = ""; req.on("data", (c) => { raw += c; });
  req.on("end", () => {
    if (down) return req.destroy();
    const send = (code, obj) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, {});
    if (req.url === "/api/states") return send(200, Object.entries(states).map(([entity_id, s]) => ({ entity_id, ...s })));
    const m = req.url.match(/^\/api\/services\/(\w+)\/(\w+)$/);
    if (req.method === "POST" && m) {
      const id = JSON.parse(raw).entity_id; calls.push(`${m[1]}.${m[2]} ${id}`);
      states[id].state = { turn_on: "on", turn_off: "off", lock: "locked", unlock: "unlocked" }[m[2]];
      return send(200, []);
    }
    send(404, {});
  });
});
fake.listen(PORT, "127.0.0.1"); fake.unref();

module.exports = async (page, h) => {
  const R = {}; const ok = (k, v, i) => { R[k] = v; h.log(`${v ? "PASS" : "FAIL"}  ${k}${i !== undefined ? "  — " + JSON.stringify(i) : ""}`); };
  const until = async (fn, n = 40) => { for (let i = 0; i < n && !(await fn()); i++) await h.sleep(250); return fn(); };
  const tile = (id) => page.evaluate((e) => { const t = document.querySelector(`.dv-tile[data-entity="${e}"]`); return t ? { name: t.querySelector(".dv-name").textContent, state: t.querySelector(".dv-state").textContent, disabled: t.disabled, cls: t.className } : null; }, id);
  const tap = async (id) => { const b = await h.box(`.dv-tile[data-entity="${id}"]`); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); };

  await h.tap(".os-page-devices"); await h.sleep(1200);
  ok("a Devices tile in the sidebar opens the Devices page", await page.evaluate(() => !!document.querySelector(".dv-root")?.getBoundingClientRect().width));
  await until(async () => (await tile("light.hall")) !== null);
  const names = await page.evaluate(() => [...document.querySelectorAll(".dv-tile .dv-name")].map((n) => n.textContent));
  ok("tiles in the order set, with their chosen names (Home Assistant's name when none)", JSON.stringify(names) === '["Hall","Desk fan","Front door lock","Living room","Attic"]', names);
  const s0 = [await tile("light.hall"), await tile("switch.fan"), await tile("lock.front"), await tile("sensor.temp"), await tile("light.attic")];
  ok("states: light On, switch Off, lock Locked, sensor 21.5°C, unavailable one says so", s0.map((t) => t.state).join("|") === "On|Off|Locked|21.5°C|Not reachable", s0.map((t) => t.state));
  ok("sensors and unreachable devices can't be tapped", s0[3].disabled && s0[4].disabled && !s0[0].disabled);
  await page.evaluate(() => { const i = document.querySelector(".dv-tile svg"); return !!i; });
  ok("tiles have inline SVG icons and the event-pill colors", await page.evaluate(() => [...document.querySelectorAll(".dv-tile")].every((t) => t.querySelector(".dv-ic svg") && /--evc-bg:/.test(t.getAttribute("style")) && !/[\u{1F300}-\u{1FAFF}]/u.test(t.textContent))));
  await h.shot("devices-landscape");

  await tap("light.hall"); await h.sleep(300);
  ok("tap the light: it shows Off at once", (await tile("light.hall")).state === "Off");
  await until(async () => calls.includes("light.turn_off light.hall"), 20);
  ok("…and Home Assistant got turn_off", calls.includes("light.turn_off light.hall"), calls);
  await tap("switch.fan"); await until(async () => calls.includes("switch.turn_on switch.fan"), 20);
  ok("tap the switch: turn_on reaches Home Assistant", calls.includes("switch.turn_on switch.fan") && (await tile("switch.fan")).state === "On", calls);

  // the lock: a first tap only asks
  await tap("lock.front"); await h.sleep(500);
  ok("first tap on the lock only asks: 'Tap again to unlock'; nothing sent", (await tile("lock.front")).state === "Tap again to unlock" && !calls.some((c) => c.startsWith("lock.")), calls);
  await h.shot("devices-lock-confirm");
  await h.sleep(4600);
  ok("a lone tap times out (back to Locked, nothing sent)", (await tile("lock.front")).state === "Locked" && !calls.some((c) => c.startsWith("lock.")));
  await tap("lock.front"); await h.sleep(400); await tap("lock.front");
  await until(async () => calls.includes("lock.unlock lock.front"), 20);
  ok("two taps unlock: Home Assistant got unlock", calls.includes("lock.unlock lock.front"), calls);
  await until(async () => (await tile("lock.front")).state === "Unlocked", 30);
  ok("the lock tile now says Unlocked", (await tile("lock.front")).state === "Unlocked", await tile("lock.front"));

  // Home Assistant goes away: a friendly message, tiles kept (faded); back again: it clears
  down = true;
  await page.evaluate(() => MM.getModules().withClass("MMM-OpenSky-Devices")[0].sendSocketNotification("OS_DEV_VISIBLE", true));
  await until(async () => /Can't show your devices/.test(await page.evaluate(() => document.querySelector(".dv-root")?.textContent || "")), 40);
  const msg = await page.evaluate(() => document.querySelector(".dv-msg")?.textContent || "");
  ok("Home Assistant unreachable: 'Can't show your devices right now' with what to check", /Can't show your devices/.test(msg) && /Can't reach Home Assistant\. Is it on/.test(msg), msg);
  await h.shot("devices-down");
  down = false;
  await until(async () => !(await page.evaluate(() => document.querySelector(".dv-msg"))), 40);
  ok("it answers again: the message goes, the tiles are live", !(await page.evaluate(() => document.querySelector(".dv-msg"))) && (await tile("light.hall")).state === "Off");

  // other layouts
  const fits = () => page.evaluate(() => { const r = document.querySelector(".dv-root").getBoundingClientRect(), g = document.querySelector(".dv-grid"); const tiles = [...document.querySelectorAll(".dv-tile")].map((t) => t.getBoundingClientRect()); return { layout: document.documentElement.dataset.layout, W: innerWidth, H: innerHeight, right: r.right, bottom: r.bottom, cols: new Set(tiles.map((t) => Math.round(t.left))).size, narrow: tiles.every((t) => t.right <= r.right + 1), gridScrolls: g.scrollHeight > g.clientHeight + 1 }; });
  await page.setViewportSize({ width: 1024, height: 600 }); await h.sleep(1200);
  let f = await fits();
  ok("compact (1024×600): page and all tiles on screen, no scrolling for five tiles", f.layout === "compact" && f.right <= f.W + 1 && f.bottom <= f.H + 1 && f.narrow && !f.gridScrolls, f);
  await h.shot("devices-compact");
  await page.setViewportSize({ width: 720, height: 1280 }); await h.sleep(1200);
  f = await fits();
  ok("portrait (720×1280): two tiles across, all on screen", f.layout === "portrait" && f.cols === 2 && f.right <= f.W + 1 && f.bottom <= f.H + 1 && f.narrow, f);
  await h.shot("devices-portrait");
  await page.setViewportSize({ width: 1920, height: 1080 }); await h.sleep(800);
};

module.exports.patchSettings = (s) => {
  s.pages = ["home", "calendar", "devices", "timer"];
  s.devices = { tiles: [{ entity: "light.hall", name: "Hall" }, { entity: "switch.fan" }, { entity: "lock.front" }, { entity: "sensor.temp" }, { entity: "light.attic" }] };
};
module.exports.patchSecrets = (s) => { s.homeassistant = { url: `http://127.0.0.1:${PORT}`, token: TOKEN }; };
