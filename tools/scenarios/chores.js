// The Chores page (fake Greenlight server): one card per child with today's chores, done ones included; tapping ticks / un-ticks in Greenlight.
const http = require("http");
const PORT = 8099;
process.env.OPENSKY_GREENLIGHT_URL = `http://127.0.0.1:${PORT}`;
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const today = ymd(new Date());
const chores = {
  101: [
    { chore_instance_id: "1::t::NO_TIME::WEEKLY", date: today, title: "Make bed", checked: false, enabled: true },
    { chore_instance_id: "2::t::NO_TIME::WEEKLY", date: today, title: "Feed dog", checked: true, enabled: true },
    { chore_instance_id: "3::t::NO_TIME::WEEKLY", date: today, title: "Empty dishwasher", checked: false, enabled: true }
  ],
  102: []
};
const posts = [];
const fake = http.createServer((req, res) => {
  let raw = ""; req.on("data", (c) => { raw += c; });
  req.on("end", () => {
    const u = new URL(req.url, "http://x"), send = (code, obj) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
    if (u.pathname === "/v1/identity-bff/sign-in") return send(200, { type: "SUCCESS", accounts: [{ access_token: "tok-a", refresh_token: "tok-r", expires_in: 7200 }] });
    if (req.headers.authorization !== "tok-a") return send(401, {});
    const kid = u.searchParams.get("user_id");
    if (u.pathname === "/v2/chores-bff/dashboard") return send(200, { streak: { title: "Reese is on a 3 week streak!" } });
    if (u.pathname === "/v2/chores-bff/chores-checklist") return send(200, { sections: [{ type: "CHORES", date: today, chores: chores[kid] || [] }] });
    if (u.pathname === "/v2/chores-bff/chores" && req.method === "POST") {
      const b = JSON.parse(raw); posts.push(b);
      for (const list of Object.values(chores)) for (const c of list) if (b.chores.includes(c.chore_instance_id)) c.checked = b.action === "COMPLETE";
      return send(200, { toast_message: "ok", chores: [] });
    }
    send(404, {});
  });
});
fake.listen(PORT, "127.0.0.1"); fake.unref();

module.exports = async (page, h) => {
  const R = {}; const ok = (k, v, i) => { R[k] = v; h.log(`${v ? "PASS" : "FAIL"}  ${k}${i !== undefined ? "  — " + JSON.stringify(i) : ""}`); };
  const until = async (fn, tries = 60) => { for (let i = 0; i < tries && !(await fn()); i++) await h.sleep(250); return fn(); };
  ok("the sidebar has a Chores button", !!(await page.$(".os-page-chores")));
  await h.tap(".os-page-chores"); await h.sleep(800);
  const card = (name) => page.evaluate((name) => {
    const c = [...document.querySelectorAll(".ch-card")].find((x) => x.querySelector(".ch-name").textContent === name);
    return c ? { count: c.querySelector(".ch-count").textContent, meta: c.querySelector(".ch-meta").textContent, items: [...c.querySelectorAll(".ch-item")].map((r) => r.querySelector(".ch-text").textContent + (r.classList.contains("is-done") ? " ✓" : "")), text: c.textContent } : null;
  }, name);
  await until(async () => ((await card("Reese")) || { items: [] }).items.length);
  const r = await card("Reese");
  ok("a card per child: progress, streak, open chores first and the done one below", r && r.count === "1 of 3" && r.meta.includes("3 week streak") && JSON.stringify(r.items) === '["Make bed","Empty dishwasher","Feed dog ✓"]', r);
  ok("a child with no chores says so", /No chores today/.test(((await card("Quinn")) || {}).text || ""), await card("Quinn"));
  await page.evaluate(() => [...document.querySelectorAll(".ch-item")].find((x) => x.textContent === "Make bed").click());
  await until(async () => posts.length > 0);
  ok("tapping a chore ticks it in Greenlight", posts.length === 1 && posts[0].action === "COMPLETE" && posts[0].chores[0].startsWith("1::"), posts);
  ok("…and it moves to the done ones", ((await card("Reese")).items || []).includes("Make bed ✓"), (await card("Reese")).items);
  await page.evaluate(() => [...document.querySelectorAll(".ch-item")].find((x) => x.textContent === "Make bed").click());
  await until(async () => posts.length > 1);
  ok("tapping a done chore un-ticks it (RESET)", !!posts[1] && posts[1].action === "RESET", posts);
  await h.shot("chores-page");
  const f = Object.entries(R).filter(([, v]) => !v).map(([k]) => k);
  h.log(`SUMMARY: ${f.length ? "FAILED: " + f.join("; ") : "ALL CHECKS PASSED"} (${Object.keys(R).length} checks)`);
};
module.exports.patchSettings = (s) => {
  s.pages = [...(s.pages || ["home"]).filter((p) => p !== "chores"), "chores"];
  s.chores = { kids: [{ id: "101", name: "Reese", color: "green" }, { id: "102", name: "Quinn", color: "purple" }] };
};
module.exports.patchSecrets = (s) => { s.greenlight = { phone: "5551234567", password: "fake-greenlight-pw" }; };
