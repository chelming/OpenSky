// Phone setup → AI helper (fake AI server, port 8104): the Test button is usable as soon as an address is typed (it used to stay grayed
// out until the page redrew), an empty address gets a plain message, a good one says which model answered (and that it can read
// photos), a wrong one says it can't reach it, and the addresses land in opensky.json → ai (never in secrets.json).
// Writable copies of the settings (tools/out), never the fixtures.
const fs = require("fs"), path = require("path"), http = require("http");
const OUT = path.join(__dirname, "..", "out");
const AI = 8104;
const fakeAI = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(req.url === "/v1/models" ? { data: [{ id: "fake-model.gguf", architecture: { input_modalities: ["text", "image"] } }] } : {}));
});
fakeAI.listen(AI, "127.0.0.1"); fakeAI.unref();

module.exports = async (page, h, app) => {
  const R = {}; const ok = (k, v, i) => { R[k] = v; h.log(`${v ? "PASS" : "FAIL"}  ${k}${i !== undefined ? "  — " + JSON.stringify(i) : ""}`); };
  const until = async (fn, tries = 40) => { for (let i = 0; i < tries && !(await fn()); i++) await h.sleep(250); return fn(); };
  const settings = () => JSON.parse(fs.readFileSync(path.join(OUT, "opensky.test.json"), "utf8"));

  await page.evaluate(() => MM.getModules().withClass("MMM-OpenSky-Sidebar")[0].sendNotification("OPENSKY_SETUP_OPEN"));
  await until(() => page.evaluate(() => document.querySelectorAll(".osu-code span").length === 6));
  const code = await page.evaluate(() => [...document.querySelectorAll(".osu-code span")].map((s) => s.textContent).join(""));
  await app.evaluate(({ BrowserWindow }) => { const w = new BrowserWindow({ width: 390, height: 844, show: true }); w.loadURL("http://localhost:8091/"); });
  const phone = await app.waitForEvent("window", { timeout: 20000 });
  await phone.waitForLoadState();
  await until(() => phone.evaluate(() => !!document.querySelector(".code-input")));
  await phone.fill(".code-input", code);
  await until(() => phone.evaluate(() => !!document.querySelector("#ai")));

  const card = () => phone.evaluate(() => document.querySelector("#ai").textContent);
  const testBtn = () => phone.evaluate(() => { const b = [...document.querySelectorAll("#ai .btn")].find((x) => /Test the connection|Testing/.test(x.textContent)); return b ? { disabled: b.disabled, text: b.textContent } : null; });
  const clickTest = async () => { await phone.evaluate(() => [...document.querySelectorAll("#ai .btn")].find((x) => /Test the connection/.test(x.textContent)).click()); await h.sleep(300); };
  const type = async (selector, value) => { await phone.fill(selector, value); await h.sleep(100); };
  const save = async () => {
    await phone.evaluate(() => [...document.querySelector(".bar").querySelectorAll(".btn")].find((x) => x.textContent.trim() === "Save").click());
    return until(() => phone.evaluate(() => /Saved ✓/.test(document.querySelector(".bar")?.textContent || "")));
  };

  ok("the AI helper card is there, off by default (both addresses empty)", /AI helper/.test(await card()) && !settings().ai);
  let b = await testBtn();
  ok("Test the connection is clickable even before anything is typed", b && b.disabled === false, b);
  await clickTest();
  ok("an empty address → a plain message, nothing is called", /Type the AI helper's address first/.test(await card()), await card());

  await type("#ai input[placeholder='https://llama-cpp.example']", "http://127.0.0.1:1");
  b = await testBtn();
  ok("typing an address doesn't need a redraw: the button is clickable right away", b && b.disabled === false, b);
  await clickTest();
  await until(async () => /Can't reach/.test(await card()));
  ok("a wrong address → says it can't reach it, and what to check", /Can't reach the AI helper\. Is it on, and is the address right\?/.test(await card()), await card());

  await type("#ai input[placeholder='https://llama-cpp.example']", `http://127.0.0.1:${AI}/`);
  await type("#ai input[placeholder='https://asr.example']", `http://127.0.0.1:${AI}`);
  await clickTest();
  await until(async () => /Connected ✓/.test(await card()));
  ok("a good address → Connected, with the model's name; the speech helper answers too", /Connected ✓ fake-model\.gguf/.test(await card()) && /speech helper answers ✓/.test(await card()) && !/can't read photos/.test(await card()), await card());
  ok("the earlier error is gone", !/Can't reach/.test(await card()));
  await h.shot("ai-phone");
  await save();
  ok("saved in opensky.json → ai (a trailing slash tidied)", settings().ai && settings().ai.url === `http://127.0.0.1:${AI}` && settings().ai.transcribeUrl === `http://127.0.0.1:${AI}`, settings().ai);
  ok("emptying the address switches it off (the key is removed, not left empty)", await (async () => { await type("#ai input[placeholder='https://llama-cpp.example']", ""); await save(); return !("url" in (settings().ai || {})); })(), settings().ai);

  const f = Object.entries(R).filter(([, v]) => !v).map(([k]) => k);
  h.log(`SUMMARY: ${f.length ? "FAILED: " + f.join("; ") : "ALL CHECKS PASSED"} (${Object.keys(R).length} checks)`);
};

module.exports.patchSettings = (s) => { delete s.ai; };
