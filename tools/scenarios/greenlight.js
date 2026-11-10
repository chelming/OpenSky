// Greenlight chores on the screen (fake Greenlight server): a kid's list shows today's open chores and ticking one off reaches Greenlight.
const http = require("http");
const PORT = 8098;
process.env.OPENSKY_GREENLIGHT_URL = `http://127.0.0.1:${PORT}`;
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const today = ymd(new Date());
const chores = [
  { chore_instance_id: "1::t::NO_TIME::WEEKLY", date: today, title: "Make bed", checked: false, enabled: true },
  { chore_instance_id: "2::t::NO_TIME::WEEKLY", date: today, title: "Feed dog", checked: true, enabled: true },
  { chore_instance_id: "3::t::NO_TIME::WEEKLY", date: today, title: "Empty dishwasher", checked: false, enabled: true }
];
const posts = [];
const fake = http.createServer((req, res) => {
  let raw = ""; req.on("data", (c) => { raw += c; });
  req.on("end", () => {
    const u = new URL(req.url, "http://x"), send = (code, obj) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
    if (u.pathname === "/v1/identity-bff/sign-in") return send(200, { type: "SUCCESS", accounts: [{ access_token: "tok-a", refresh_token: "tok-r", expires_in: 7200 }] });
    if (req.headers.authorization !== "tok-a") return send(401, {});
    if (u.pathname === "/v2/chores-bff/chores-checklist") return send(200, { sections: [{ type: "CHORES", date: today, chores }] });
    if (u.pathname === "/v2/chores-bff/chores" && req.method === "POST") {
      const b = JSON.parse(raw); posts.push(b);
      for (const id of b.chores) { const c = chores.find((x) => x.chore_instance_id === id); if (c) c.checked = b.action === "COMPLETE"; }
      return send(200, { toast_message: "ok", chores: [] });
    }
    send(404, {});
  });
});
fake.listen(PORT, "127.0.0.1"); fake.unref();

module.exports = async (page, h) => {
  const R = {}; const ok = (k, v, i) => { R[k] = v; h.log(`${v ? "PASS" : "FAIL"}  ${k}${i !== undefined ? "  — " + JSON.stringify(i) : ""}`); };
  const until = async (fn, tries = 60) => { for (let i = 0; i < tries && !(await fn()); i++) await h.sleep(250); return fn(); };
  const col = () => page.evaluate(() => { const c = [...document.querySelectorAll(".hd-lists .lc-list")].find((x) => x.querySelector(".lc-list-title").textContent === "Reese's chores"); return c ? [...c.querySelectorAll(".lc-item-text")].map((x) => x.textContent) : null; });
  await until(async () => ((await col()) || []).length);
  ok("the child's open chores show (done ones don't)", JSON.stringify(await col()) === '["Make bed","Empty dishwasher"]', await col());
  await page.evaluate(() => [...document.querySelectorAll(".hd-lists .lc-item")].find((r) => r.textContent === "Make bed").querySelector(".lc-check").click());
  await until(() => posts.length > 0, 60);
  ok("ticking a chore reaches Greenlight as COMPLETE after the Undo time", posts.length === 1 && posts[0].action === "COMPLETE" && posts[0].chores[0].startsWith("1::"), posts);
  const f = Object.entries(R).filter(([, v]) => !v).map(([k]) => k);
  h.log(`SUMMARY: ${f.length ? "FAILED: " + f.join("; ") : "ALL CHECKS PASSED"} (${Object.keys(R).length} checks)`);
};
module.exports.patchSettings = (s) => {
  s.lists = { lists: [{ name: "Reese's chores", provider: "greenlight", kid: "101", color: "green" }] };
};
module.exports.patchSecrets = (s) => { s.greenlight = { phone: "5551234567", password: "fake-greenlight-pw" }; };
