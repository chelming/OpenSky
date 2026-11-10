// Phone setup for the Devices page (fake Home Assistant, port 8102): turn the page on, enter the address + token, Find my
// devices (lights, switches, locks, sensors only), add tiles, name them, reorder, remove, save. The tiles land in
// opensky.json → devices.tiles; the token only in secrets.json. Writable copies of the settings (tools/out), never the fixtures.
const fs = require("fs"), path = require("path"), http = require("http");
const OUT = path.join(__dirname, "..", "out");
const HA = 8102, TOKEN = "ha-devices-phone-token";
const fakeHA = http.createServer((req, res) => {
  res.writeHead(req.headers.authorization === `Bearer ${TOKEN}` ? 200 : 401, { "Content-Type": "application/json" });
  res.end(JSON.stringify(req.url === "/api/states" ? [
    { entity_id: "media_player.kitchen", state: "playing", attributes: { friendly_name: "Kitchen" } },
    { entity_id: "light.hall", state: "on", attributes: { friendly_name: "Hall light" } },
    { entity_id: "lock.front", state: "locked", attributes: { friendly_name: "Front door" } },
    { entity_id: "sensor.temp", state: "21", attributes: { friendly_name: "Living room temperature" } },
    { entity_id: "switch.fan", state: "off", attributes: { friendly_name: "Desk fan" } },
    { entity_id: "automation.x", state: "on", attributes: {} }] : {}));
});
fakeHA.listen(HA, "127.0.0.1"); fakeHA.unref();

module.exports = async (page, h, app) => {
  const R = {}; const ok = (k, v, i) => { R[k] = v; h.log(`${v ? "PASS" : "FAIL"}  ${k}${i !== undefined ? "  — " + JSON.stringify(i) : ""}`); };
  const until = async (fn, tries = 40) => { for (let i = 0; i < tries && !(await fn()); i++) await h.sleep(250); return fn(); };
  const settings = () => JSON.parse(fs.readFileSync(path.join(OUT, "opensky.test.json"), "utf8"));
  const secrets = () => JSON.parse(fs.readFileSync(path.join(OUT, "secrets.test.json"), "utf8"));

  await page.evaluate(() => MM.getModules().withClass("MMM-OpenSky-Sidebar")[0].sendNotification("OPENSKY_SETUP_OPEN"));
  await until(() => page.evaluate(() => document.querySelectorAll(".osu-code span").length === 6));
  const code = await page.evaluate(() => [...document.querySelectorAll(".osu-code span")].map((s) => s.textContent).join(""));
  await app.evaluate(({ BrowserWindow }) => { const w = new BrowserWindow({ width: 390, height: 844, show: true }); w.loadURL("http://localhost:8091/"); });
  const phone = await app.waitForEvent("window", { timeout: 20000 });
  await phone.waitForLoadState();
  await until(() => phone.evaluate(() => !!document.querySelector(".code-input")));
  await phone.fill(".code-input", code);
  await until(() => phone.evaluate(() => !!document.querySelector("#family")));

  const tap = async (scope, selector, label) => {
    const done = await phone.evaluate(([sc, sel, t]) => {
      const b = [...document.querySelector(sc).querySelectorAll(sel)].find((x) => x.textContent.trim() === t || x.getAttribute("aria-label") === t);
      if (!b) return false; b.click(); return true;
    }, [scope, selector, label]);
    if (!done) throw new Error(`nothing to tap: ${scope} ${selector} "${label}"`);
    await h.sleep(250);
  };
  const type = async (selector, value) => { await phone.fill(selector, value); await h.sleep(100); };
  const save = async () => {
    await tap(".bar", ".btn", "Save");
    return until(() => phone.evaluate(() => /Saved ✓/.test(document.querySelector(".bar")?.textContent || "")));
  };
  const extras = () => phone.evaluate(() => document.querySelector("#extras").textContent);
  const tiles = () => (settings().devices || {}).tiles;

  ok("no Devices section until the page is on", !/Find my devices/.test(await extras()));
  await tap("#pages", ".toggle", "Devices");
  await until(async () => /Find my devices/.test(await extras()));
  ok("Devices page on: its section appears in Extras, with the address and token fields", /Find my devices/.test(await extras()) && (await phone.evaluate(() => !!document.querySelector("#extras input[placeholder='Paste a long-lived access token']"))));
  await type("#extras input[placeholder='http://homeassistant.local:8123']", `http://127.0.0.1:${HA}`);
  await type("#extras input[placeholder='Paste a long-lived access token']", TOKEN);
  await save();
  ok("address + token saved to secrets.json only", secrets().homeassistant?.token === TOKEN && !JSON.stringify(settings()).includes(TOKEN));

  await tap("#extras", ".btn.block", "Find my devices");
  await until(async () => /light\.hall/.test(await extras()));
  const listed = await phone.evaluate(() => [...document.querySelectorAll("#extras .btn")].map((b) => b.getAttribute("aria-label") || "").filter((l) => /^Add /.test(l)));
  ok("Find my devices lists lights, switches, locks, sensors by name — no speakers or automations", listed.join("|") === "Add Desk fan|Add Front door|Add Hall light|Add Living room temperature", listed);

  await tap("#extras", ".btn", "Add Hall light"); await tap("#extras", ".btn", "Add Front door"); await tap("#extras", ".btn", "Add Desk fan");
  await type("#extras input[aria-label='Name for light.hall']", "Hall");
  await tap("#extras", ".mini", "Move down");   // (the first row's Down: Hall after Front door)
  await tap("#extras", ".btn", "Add Living room temperature");
  await h.shot("devices-phone");
  await save();
  ok("tiles saved in the order picked, with the typed name (others keep Home Assistant's)", JSON.stringify(tiles()) === '[{"entity":"lock.front"},{"entity":"light.hall","name":"Hall"},{"entity":"switch.fan"},{"entity":"sensor.temp"}]', tiles());
  const removed = await phone.evaluate(() => { const b = [...document.querySelectorAll("#extras .mini")].filter((x) => x.getAttribute("aria-label") === "Remove"); b[2].click(); return b.length; });
  await h.sleep(250);
  await save();
  ok("Remove takes a tile off (the fan)", removed === 4 && JSON.stringify(tiles().map((t) => t.entity)) === '["lock.front","light.hall","sensor.temp"]', tiles());
  ok("the page is in opensky.json; the secrets file has no tiles", settings().pages.includes("devices") && !JSON.stringify(secrets()).includes("light.hall"));
};

module.exports.patchSettings = (s) => { delete s.profiles; [...s.calendar.sources, ...s.lists.lists].forEach((x) => delete x.profiles); delete s.devices; s.pages = (s.pages || []).filter((p) => p !== "devices"); };
