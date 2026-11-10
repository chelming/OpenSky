// Unit test for lib/greenlight.js against a fake Greenlight server: sign-in (direct and with a text-message code), token refresh,
// a refused refresh, today's chores, check / uncheck, and that it never calls Greenlight's DELETE.
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "opensky-greenlight-"));
const SECRETS = path.join(tmp, "secrets.json");
process.env.OPENSKY_SECRETS = SECRETS;
process.env.OPENSKY_GREENLIGHT_STATE = path.join(tmp, "greenlight-state.json");

let passed = 0, failed = 0;
const ok = (name, cond, info) => { cond ? passed++ : failed++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${info !== undefined ? "  — " + JSON.stringify(info) : ""}`); };
const fails = async (fn) => { try { await fn(); return null; } catch (e) { return e.message; } };
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const today = ymd(new Date()), tomorrow = ymd(new Date(Date.now() + 864e5));

// fake Greenlight
let MODE = "direct";            // "direct": sign-in answers SUCCESS · "otp": it asks for a code
let refreshOk = true, n = 0;
const seen = [], devices = new Set();
const chores = [
  { chore_instance_id: "1::t::NO_TIME::WEEKLY", date: today, title: "Make bed", checked: false, enabled: true },
  { chore_instance_id: "2::t::NO_TIME::WEEKLY", date: today, title: "Feed dog", checked: true, enabled: true },
  { chore_instance_id: "3::t::NO_TIME::WEEKLY", date: today, title: "Dishes", checked: false, enabled: true }
];
const account = () => ({ access_token: `access-${++n}`, refresh_token: `refresh-${n}`, expires_in: 7200, user: { children: [{ id: 101, first_name: "Reese" }, { id: 102, first_name: "Quinn" }] } });
const server = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => { raw += c; });
  req.on("end", () => {
    const u = new URL(req.url, "http://x"), send = (code, obj) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
    seen.push(`${req.method} ${u.pathname}`);
    if (u.pathname === "/v1/identity-bff/sign-in") {
      const b = JSON.parse(raw); devices.add(b.device_id);
      if (b.password !== "pw") return send(200, { type: "ERROR", reason: "ERR_INVALID" });
      return MODE === "otp" ? send(200, { type: "OTP", otp_resource_id: "res-1", otp_message: "Code sent" }) : send(200, { type: "SUCCESS", accounts: [account()] });
    }
    if (u.pathname === "/v1/identity-bff/otp/sign-in") {
      const b = JSON.parse(raw); devices.add(b.device_id);
      return b.otp === "123456" && b.otp_resource_id === "res-1" ? send(200, { type: "SUCCESS", accounts: [account()] }) : send(200, { type: "ERROR" });
    }
    if (u.pathname === "/v1/identity/auth/token") {
      const f = new URLSearchParams(raw); devices.add(f.get("device_id"));
      return refreshOk && f.get("grant_type") === "REFRESH_TOKEN" && f.get("refresh_token") === `refresh-${n}` ? send(200, account()) : send(400, {});
    }
    if (!(req.headers.authorization || "").startsWith("access-") || req.headers.authorization !== `access-${n}`) return send(401, {});
    if (u.pathname === "/v2/chores-bff/dashboard") return send(200, { streak: { title: "Reese is on a 3 week streak!" }, earnings: { card: { tab: { chart: { title: "$4", subtitle: "so far" } } } } });
    if (u.pathname === "/v2/chores-bff/chores-checklist") {
      if (u.searchParams.get("user_id") !== "101") return send(200, { sections: [] });
      return send(200, { type: "SECTIONS", sections: [{ type: "CHORES", date: tomorrow, chores: [{ chore_instance_id: "9::t::NO_TIME::WEEKLY", title: "Tomorrow only", checked: false, enabled: true }] }, { type: "CHORES", date: today, chores }] });
    }
    if (u.pathname === "/v2/chores-bff/chores" && req.method === "POST") {
      const b = JSON.parse(raw);
      for (const id of b.chores) { const c = chores.find((x) => x.chore_instance_id === id); if (c) c.checked = b.action === "COMPLETE"; }
      seen.push(`action ${b.action}`);
      return send(200, { toast_message: "ok", chores: [] });
    }
    send(404, {});
  });
});

(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  process.env.OPENSKY_GREENLIGHT_URL = `http://127.0.0.1:${server.address().port}`;
  const gl = require(path.join(__dirname, "..", "lib", "greenlight.js"));
  const lists = require(path.join(__dirname, "..", "lib", "lists.js"));
  const list = { name: "Reese's chores", provider: "greenlight", kid: "101" };
  const state = () => JSON.parse(fs.readFileSync(process.env.OPENSKY_GREENLIGHT_STATE, "utf8"));

  ok("1 'greenlight' is a list provider", lists.PROVIDERS.includes("greenlight") && lists.provider(list) === gl.provider);
  ok("2 not set up → says where", /phone setup/.test(await fails(() => gl.provider.items(list))));
  ok("3 a wrong password is explained", /didn't accept that phone number and password/.test(await fails(() => gl.signIn({ phone: "555", password: "bad" }))));

  const r = await gl.signIn({ phone: "555", password: "pw" });
  ok("4 sign-in that answers SUCCESS → the kids", r.ok && JSON.stringify(r.kids) === '[{"id":"101","name":"Reese"},{"id":"102","name":"Quinn"}]', r);
  const st = state();
  ok("5 OpenSky made its own device id and keeps tokens + kids in a private file (600)", /^[0-9a-f-]{36}$/.test(st.deviceId) && st.accessToken === "access-1" && (fs.statSync(process.env.OPENSKY_GREENLIGHT_STATE).mode & 0o777) === 0o600);
  ok("6 every call used that one device id", devices.size === 1 && devices.has(st.deviceId), [...devices]);

  fs.writeFileSync(SECRETS, JSON.stringify({ greenlight: { phone: "555", password: "pw" } }));
  ok("7 today's open chores only (done ones and other days left out)", (await gl.provider.items(list)).map((x) => x.text).join("|") === "Make bed|Dishes");
  ok("8 a list needs a child picked", /Pick which child/.test(await fails(() => gl.provider.items({ name: "x", provider: "greenlight" }))));

  await gl.provider.check(list, { id: "1::t::NO_TIME::WEEKLY" });
  ok("9 check → COMPLETE, and it's gone from the list", seen.includes("action COMPLETE") && (await gl.provider.items(list)).map((x) => x.text).join() === "Dishes");
  await gl.provider.uncheck(list, { id: "1::t::NO_TIME::WEEKLY" });
  ok("10 uncheck → RESET, and it's back", seen.includes("action RESET") && (await gl.provider.items(list)).length === 2);

  const before = seen.length;
  const msgs = [await fails(() => gl.provider.add(list, "x")), await fails(() => gl.provider.edit(list, { id: "1" }, "x")), await fails(() => gl.provider.remove(list, { id: "1" }))];
  ok("11 add / edit / remove are refused kindly and never reach Greenlight (no DELETE)", msgs.every((m) => /Greenlight app/.test(m)) && seen.length === before && !seen.some((s) => s.startsWith("DELETE")), msgs);

  const c1 = await gl.choresOf("101");
  ok("10b the Chores page gets today's chores with the done ones too, plus streak + allowance", c1.chores.map((x) => `${x.text}:${x.done ? 1 : 0}`).join("|") === "Make bed:0|Feed dog:1|Dishes:0" && c1.streak === "Reese is on a 3 week streak!" && c1.allowance === "$4 so far", c1);
  await gl.setDone("1::t::NO_TIME::WEEKLY", true);
  ok("10c setDone(true) ticks, setDone(false) un-ticks", (await gl.choresOf("101")).chores[0].done === true && (await gl.setDone("1::t::NO_TIME::WEEKLY", false), (await gl.choresOf("101")).chores[0].done === false));
  ok("10d a bad child id is refused before anything is sent", /Pick which child/.test(await fails(() => gl.choresOf("abc"))));

  // token about to expire → refreshed with the rotating refresh token
  let s = state(); s.expiresAt = Date.now() + 60 * 1000; fs.writeFileSync(process.env.OPENSKY_GREENLIGHT_STATE, JSON.stringify(s));
  const nBefore = n;
  await gl.provider.items(list);
  ok("12 an expiring token is refreshed (and the new refresh token kept)", n === nBefore + 1 && state().refreshToken === `refresh-${n}` && seen.includes("POST /v1/identity/auth/token"));

  // refresh refused → signs in again by itself
  s = state(); s.expiresAt = 0; fs.writeFileSync(process.env.OPENSKY_GREENLIGHT_STATE, JSON.stringify(s)); refreshOk = false;
  seen.length = 0;
  await gl.provider.items(list);
  ok("13 a refused refresh → signs in again with the saved password", seen.includes("POST /v1/identity-bff/sign-in") && state().accessToken === `access-${n}`, seen);
  refreshOk = true;

  // the server rotates the token under us (401) → one retry
  n++;   // the token OpenSky holds is now stale
  ok("14 a stale token (401) → one retry with a fresh one", (await gl.provider.items(list)).length === 2);

  // a brand-new device that needs a text-message code
  fs.rmSync(process.env.OPENSKY_GREENLIGHT_STATE);
  MODE = "otp";
  const o = await gl.signIn({ phone: "555", password: "pw" });
  ok("15 a sign-in that wants a code says so", o.needsCode === true && /Code sent/.test(o.message), o);
  ok("16 a wrong code is refused", /didn't accept that code/.test(await fails(() => gl.signInCode("000000"))));
  const o2 = await gl.signInCode(" 123456 ");
  ok("17 the right code finishes it (a fresh state means a fresh device id, kept through the code step)", o2.ok && o2.kids.length === 2 && devices.size === 2 && gl.status().signedIn, { devices: devices.size });
  ok("18 status never includes the password or tokens", !/pw|access-|refresh-/.test(JSON.stringify(gl.status())), gl.status());

  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`passed=${passed} fail=${failed}`);
  process.exit(failed ? 1 : 0);
})();
