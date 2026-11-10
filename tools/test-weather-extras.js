// Unit test for lib/weather-extras.js against a fake Open-Meteo / NWS / RainViewer: the hourly forecast, alerts (US only,
// worst first, test messages skipped), the radar frame list, and friendly failures.
const path = require("path");
let passed = 0, failed = 0;
const ok = (n, c, i) => { c ? passed++ : failed++; console.log(`${c ? "PASS" : "FAIL"}  ${n}${i !== undefined ? "  — " + JSON.stringify(i) : ""}`); };
const fails = async (fn) => { try { await fn(); return null; } catch (e) { return e.message; } };
(async () => {
  const fake = await require("./fixtures/fake-weather.js").create();
  process.env.OPENSKY_WEATHER_URL = process.env.OPENSKY_NWS_URL = process.env.OPENSKY_RADAR_URL = fake.url;
  process.env.OPENSKY_RADAR_BASE = fake.base;
  const x = require(path.join(__dirname, "..", "lib", "weather-extras.js"));
  const boston = { latitude: 42.3601, longitude: -71.0589, units: "imperial" };

  const h = await x.fetchHourly(boston);
  ok("1 hourly: 24 hours with temperature, a condition id and the chance of rain", h.length === 24 && h[0].temp === 50 && h[0].id === 800 && h[10].id === 500 && h[10].rain === 50 && h[0].hour >= 0 && /^\d{4}-\d\d-\d\d$/.test(h[0].day), h[0]);
  await x.fetchHourly({ ...boston, units: "metric" });
  ok("2 hourly: metric asks for Celsius", fake.state.seen.unit === "celsius");

  const a = await x.fetchAlerts(boston);
  ok("3 alerts (US): worst first, the test message skipped", a.supported && a.alerts.length === 2 && a.alerts[0].event === "Tornado Warning" && a.alerts[0].severity === "extreme" && a.alerts[1].severity === "moderate", a);
  ok("4 alerts: the NWS gets a User-Agent and the point", /OpenSky/.test(fake.state.seen.nwsAgent) && fake.state.seen.point === "42.3601,-71.0589", fake.state.seen);
  const uk = await x.fetchAlerts({ latitude: 51.5, longitude: -0.12 });
  ok("5 alerts outside the US: not supported", uk.supported === false && uk.alerts.length === 0);
  ok("6 inUS: Hawaii, Alaska and Puerto Rico count, London and Sydney don't", x.inUS(21.3, -157.8) && x.inUS(61.2, -149.9) && x.inUS(18.4, -66.1) && !x.inUS(51.5, -0.12) && !x.inUS(-33.9, 151.2));

  const r = await x.fetchRadar();
  ok("7 radar: the last 6 frames, oldest first, as tile templates; the basemap template", r.frames.length === 6 && r.frames[0].time < r.frames[5].time && /\{z\}\/\{x\}\/\{y\}/.test(r.frames[0].url) && r.base === fake.base, r.frames[0]);

  fake.state.up = false;
  ok("8 hourly offline → an error to show, not a crash", /HTTP 503/.test(await fails(() => x.fetchHourly(boston))));
  ok("9 alerts offline → an error to show", /HTTP 503/.test(await fails(() => x.fetchAlerts(boston))));
  ok("10 radar offline → an error to show", /HTTP 503/.test(await fails(() => x.fetchRadar())));
  ok("11 no location → plain message", /no location/.test(await fails(() => x.fetchHourly({}))));
  fake.close();
  console.log(`SUMMARY pass=${passed} fail=${failed}`);
})().catch((e) => { console.log(`SUMMARY pass=${passed} fail=${failed + 1} (crashed: ${e.message})`); process.exit(1); });
