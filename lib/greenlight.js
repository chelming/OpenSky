/* OpenSky Greenlight (server side) — a kid's chores from the Greenlight family app, as a list provider.
 * Used by lib/lists.js (provider "greenlight") and phone setup.
 *
 * UNOFFICIAL: Greenlight has no public API. This talks to the same private service its own app uses, so it can stop
 * working whenever Greenlight changes it. It is off unless you set it up, and it only ever ticks chores off (or reads them).
 *
 * secrets.json → greenlight: { phone, password }          (set from phone setup; nobody edits the file)
 * State kept next to secrets.json, chmod 600 (greenlight-state.json): OpenSky's own device id, the rotating tokens, the kids.
 *   OpenSky signs in as its own "device" (a generated id) — it never reuses another app's or script's device id.
 * A list (opensky.json → lists.lists):  { name, provider: "greenlight", kid: "<Greenlight user id>" }
 *   shows today's open chores; ticking one off marks it done in Greenlight. Chores are added or changed in the Greenlight app.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { secret, FILE: SECRETS_FILE } = require(path.join(__dirname, "secrets.js"));

const BASE = () => String(process.env.OPENSKY_GREENLIGHT_URL || "https://prod.greenlight.gl-tech.io").replace(/\/+$/, "");
const STATE_FILE = () => process.env.OPENSKY_GREENLIGHT_STATE || path.join(path.dirname(SECRETS_FILE), "greenlight-state.json");
const APP_VERSION = "7.30.0";

class GreenlightError extends Error { constructor(m, status) { super(m); this.status = status; } }

/* ---------------- state (device id + tokens) ---------------- */
function readState() {
  try { const s = JSON.parse(fs.readFileSync(STATE_FILE(), "utf8")); return s && typeof s === "object" ? s : {}; } catch (e) { return {}; }
}
function writeState(s) {
  const f = STATE_FILE();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = `${f}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, f);
}
function deviceId() {
  const s = readState();
  if (s.deviceId) return s.deviceId;
  s.deviceId = crypto.randomUUID();
  writeState(s);
  return s.deviceId;
}

const creds = (given) => {
  const phone = String((given && given.phone) || secret("greenlight.phone") || "").trim();
  const password = String((given && given.password) || secret("greenlight.password") || "");
  if (!phone || !password) throw new GreenlightError("Greenlight isn't set up — add the parent's phone number and password in phone setup", 400);
  return { phone, password };
};

/* ---------------- http ---------------- */
async function http(method, route, { body, form, token, phone } = {}) {
  const headers = { Accept: "application/json", "api-version": APP_VERSION, "user-agent": `Greenlight/v${APP_VERSION}_29375 (Android)` };
  if (token) headers.Authorization = token;
  if (phone) headers["x-user"] = phone;
  let payload;
  if (form) { headers["Content-Type"] = "application/x-www-form-urlencoded"; payload = new URLSearchParams(form).toString(); }
  else if (body) { headers["Content-Type"] = "application/json; charset=utf-8"; payload = JSON.stringify(body); }
  let res;
  try { res = await fetch(`${BASE()}${route}`, { method, headers, body: payload, signal: AbortSignal.timeout(15000) }); }
  catch (e) { throw new GreenlightError("Can't reach Greenlight right now", 502); }
  let data = null;
  try { data = await res.json(); } catch (e) { /* empty or not JSON */ }
  if (res.status === 401) throw new GreenlightError("Greenlight signed OpenSky out", 401);
  if (!res.ok) throw new GreenlightError(`Greenlight error (HTTP ${res.status})`, res.status >= 500 ? 502 : res.status);
  return data || {};
}

/* ---------------- sign-in ---------------- */
let pending = null;   // { otpResourceId, at } while waiting for an SMS code

function takeAccount(r) {
  const a = (r && Array.isArray(r.accounts) && r.accounts[0]) || r;
  if (!a || !a.access_token || !a.refresh_token) throw new GreenlightError("Greenlight answered in a way OpenSky doesn't understand", 502);
  const s = readState();
  s.accessToken = a.access_token;
  s.refreshToken = a.refresh_token;
  s.expiresAt = Date.now() + (Number(a.expires_in) || 7200) * 1000;
  const kids = kidsOf(a.user);
  if (kids.length) s.kids = kids;
  writeState(s);
  return s;
}

function kidsOf(user) {
  const rows = (user && (user.children || user.kids)) || [];
  return (Array.isArray(rows) ? rows : []).map((c) => ({ id: String(c.id || c.user_id || ""), name: String(c.first_name || c.name || c.nickname || "").trim() })).filter((k) => k.id);
}

/** Sign in with the phone + password. → { ok: true, kids } or { needsCode: true, message } (Greenlight texted a code: send it to signInCode). */
async function signIn(given) {
  const c = creds(given);
  const r = await http("POST", "/v1/identity-bff/sign-in", { body: { device_id: deviceId(), credentials: c.phone, password: c.password } });
  if (r.type === "OTP" && r.otp_resource_id) {
    pending = { otpResourceId: r.otp_resource_id, at: Date.now() };
    return { needsCode: true, message: String(r.otp_message || "Greenlight texted a code to the parent's phone") };
  }
  if (r.type === "SUCCESS") { takeAccount(r); return { ok: true, kids: readState().kids || [] }; }
  if (r.type === "ERROR" || r.reason) throw new GreenlightError("Greenlight didn't accept that phone number and password", 400);
  throw new GreenlightError("Greenlight answered in a way OpenSky doesn't understand", 502);
}

async function signInCode(code) {
  if (!pending || Date.now() - pending.at > 15 * 60 * 1000) throw new GreenlightError("That sign-in has timed out — start again", 400);
  const r = await http("POST", "/v1/identity-bff/otp/sign-in", { body: { device_id: deviceId(), otp: String(code || "").trim(), otp_resource_id: pending.otpResourceId } });
  if (r.type !== "SUCCESS") throw new GreenlightError("Greenlight didn't accept that code", 400);
  pending = null;
  takeAccount(r);
  return { ok: true, kids: readState().kids || [] };
}

let refreshing = null;
async function token() {
  const s = readState();
  if (s.accessToken && s.expiresAt && Date.now() < s.expiresAt - 5 * 60 * 1000) return s.accessToken;
  if (!refreshing) {
    refreshing = (async () => {
      const cur = readState();
      if (cur.refreshToken) {
        try {
          const r = await http("POST", "/v1/identity/auth/token", { form: { grant_type: "REFRESH_TOKEN", device_id: deviceId(), refresh_token: cur.refreshToken } });
          takeAccount(r);
          return readState().accessToken;
        } catch (e) { if (e.status === 502) throw e; /* refused: fall through to a fresh sign-in */ }
      }
      const r = await signIn();
      if (r.needsCode) throw new GreenlightError("Greenlight wants a new text-message code — sign in again in phone setup", 401);
      return readState().accessToken;
    })().finally(() => { refreshing = null; });
  }
  return refreshing;
}

async function api(method, route, body) {
  const phone = creds().phone;
  try { return await http(method, route, { body, token: await token(), phone }); }
  catch (e) {
    if (e.status !== 401) throw e;
    const s = readState(); s.expiresAt = 0; writeState(s);   // expired early: one more go with a fresh token
    return http(method, route, { body, token: await token(), phone });
  }
}

/* ---------------- chores ---------------- */
const ymd = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const kidOf = (list) => {
  const k = String((list && list.kid) || "").trim();
  if (!/^\d+$/.test(k)) throw new GreenlightError(`Pick which child "${list && list.name}" is for in phone setup`, 400);
  return k;
};

const provider = {
  async items(list) {
    const d = await api("GET", `/v2/chores-bff/chores-checklist?user_id=${kidOf(list)}&filter=ALL&suggested_chores_enabled=true`);
    const today = ymd();
    const section = ((d && d.sections) || []).find((s) => s && s.type === "CHORES" && s.date === today);
    return ((section && section.chores) || []).filter((c) => c && !c.checked && c.enabled !== false && c.chore_instance_id && c.title)
      .map((c) => ({ id: String(c.chore_instance_id), text: String(c.title).trim() }));
  },
  async check(list, item) { await api("POST", "/v2/chores-bff/chores", { action: "COMPLETE", chores: [String(item.id)] }); },
  /** Un-tick (not used by the lists page yet). */
  async uncheck(list, item) { await api("POST", "/v2/chores-bff/chores", { action: "RESET", chores: [String(item.id)] }); },
  async add() { throw new GreenlightError("Chores are added in the Greenlight app", 400); },
  async edit() { throw new GreenlightError("Chores are changed in the Greenlight app", 400); },
  async remove() { throw new GreenlightError("Chores are removed in the Greenlight app", 400); }   // (never calls Greenlight's DELETE)
};

/** A child's chores for today, done ones too, for the Chores page: { chores: [{ id, text, done, overdue }], streak, allowance } (the last two are "" when Greenlight doesn't say). */
async function choresOf(kid) {
  const id = String(kid || "");
  if (!/^\d+$/.test(id)) throw new GreenlightError("Pick which child this is for in phone setup", 400);
  const [d, dash] = await Promise.all([
    api("GET", `/v2/chores-bff/chores-checklist?user_id=${id}&filter=ALL&suggested_chores_enabled=true`),
    api("GET", `/v2/chores-bff/dashboard?user_id=${id}&suggested_chores_enabled=true`).catch(() => ({}))   // (nice to have: a streak and the allowance)
  ]);
  const today = ymd();
  const section = ((d && d.sections) || []).find((x) => x && x.type === "CHORES" && x.date === today);
  const chart = (((dash.earnings || {}).card || {}).tab || {}).chart || {};
  return {
    chores: ((section && section.chores) || []).filter((c) => c && c.enabled !== false && c.chore_instance_id && c.title)
      .map((c) => ({ id: String(c.chore_instance_id), text: String(c.title).trim(), done: !!c.checked, overdue: !!c.is_overdue })),
    streak: String((dash.streak && dash.streak.title) || "").trim(),
    allowance: [chart.title, chart.subtitle].filter(Boolean).join(" ").trim()
  };
}

/** Mark a chore done (or not done again). */
async function setDone(id, done) {
  await api("POST", "/v2/chores-bff/chores", { action: done ? "COMPLETE" : "RESET", chores: [String(id)] });
}

/** What phone setup shows: is it set up, and which kids does Greenlight know. */
function status() {
  const s = readState();
  return { set: !!(secret("greenlight.phone") && secret("greenlight.password")), signedIn: !!s.refreshToken, kids: s.kids || [] };
}

module.exports = { GreenlightError, signIn, signInCode, status, provider, choresOf, setDone };
