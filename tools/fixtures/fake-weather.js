// A stand-in for Open-Meteo (hourly), the NWS alerts API, RainViewer and the map tiles, for the weather-extras tests.
// create(port) → { server, state, url, base, close }. state: { up, alerts: [...], seen: {...}, tiles: n } - tests flip `up` to simulate no internet.
const http = require("http");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

function create(port = 0) {
  const state = {
    up: true, tiles: 0, seen: {},
    alerts: [
      { id: "a1", event: "Flood Watch", severity: "Moderate", headline: "Flood Watch issued for Suffolk County <b>x</b>", description: "Heavy rain may cause flooding.\n\nStay away from rivers.", ends: new Date(Date.now() + 6 * 3600e3).toISOString(), areaDesc: "Suffolk" },
      { id: "a2", event: "Tornado Warning", severity: "Extreme", headline: "Tornado Warning", description: "Take shelter now.", ends: null, areaDesc: "Suffolk" },
      { id: "a3", event: "Test Message", status: "Test", severity: "Minor", headline: "ignore me" }
    ]
  };
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x"), json = (o) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
    if (!state.up) { res.writeHead(503); return res.end(); }
    if (u.pathname === "/v1/forecast") {
      const now = new Date(), time = [], temp = [], code = [], pop = [];
      for (let i = 0; i < 24; i++) {
        const t = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + i);
        time.push(`${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}T${String(t.getHours()).padStart(2, "0")}:00`);
        temp.push(50.4 + i); code.push(i < 6 ? 0 : 61); pop.push(i < 6 ? 0 : 40 + i);
      }
      state.seen.unit = u.searchParams.get("temperature_unit");
      return json({ hourly: { time, temperature_2m: temp, weather_code: code, precipitation_probability: pop } });
    }
    if (u.pathname === "/alerts/active") {
      state.seen.nwsAgent = req.headers["user-agent"]; state.seen.point = u.searchParams.get("point");
      return json({ features: state.alerts.map((a) => ({ properties: { status: "Actual", ...a } })) });
    }
    if (u.pathname === "/public/weather-maps.json") {
      const now = Math.floor(Date.now() / 600000) * 600;
      return json({ host: `http://127.0.0.1:${server.address().port}/radar`, radar: { past: Array.from({ length: 8 }, (_, i) => ({ time: now - (7 - i) * 600, path: `/v2/radar/${now - (7 - i) * 600}` })), nowcast: [] } });
    }
    if (u.pathname.startsWith("/radar/") || u.pathname.startsWith("/base/")) { state.tiles++; res.writeHead(200, { "Content-Type": "image/png", "Access-Control-Allow-Origin": "*" }); return res.end(PNG); }
    res.writeHead(404); res.end();
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => {
    const url = `http://127.0.0.1:${server.address().port}`;
    server.unref();
    resolve({ server, state, url, base: `${url}/base/{z}/{x}/{y}.png`, close: () => server.close() });
  }));
}
module.exports = { create };
