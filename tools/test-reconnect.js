// Unit test for OpenSkyReconnect (lib/client/opensky-client.js): reload once when the server comes back after being down or 404.
let passed = 0, failed = 0;
const ok = (n, c, i) => { c ? passed++ : failed++; console.log(`${c ? "PASS" : "FAIL"}  ${n}${i !== undefined ? "  — " + JSON.stringify(i) : ""}`); };
global.window = {};
require("../lib/client/opensky-client.js");
const R = window.OpenSkyReconnect;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let state = "up", reloads = 0, now = 1e12;
  const realNow = Date.now; Date.now = () => now;
  const stop = R.watch({ check: async () => { if (state === "error") throw new Error("down"); return state === "up"; }, reload: () => { reloads++; }, every: 5 });
  await sleep(40);
  ok("1 a healthy server is never reloaded", reloads === 0, reloads);
  state = "error"; await sleep(40);
  ok("2 while the server is down nothing reloads", reloads === 0, reloads);
  state = "up"; now += 11000; await sleep(40);
  ok("3 it reloads once when the server comes back", reloads === 1, reloads);
  await sleep(40);
  ok("4 and not again while it stays up", reloads === 1, reloads);
  state = "404"; await sleep(40); state = "up"; now += 11000; await sleep(40);
  ok("5 a 404 while starting counts as down: reload when it answers", reloads === 2, reloads);
  state = "error"; await sleep(20); state = "up"; now += 100; await sleep(40);
  ok("6 never twice within 10 seconds", reloads === 2, reloads);
  stop(); Date.now = realNow;
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
