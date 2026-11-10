/* OpenSky weather copy and curve geometry for the Weather page. Works in the browser (window.OpenSkyWeatherCopy) and in Node (require) for tests.
 * Everything here is computed from the forecast - no sentence is hard-coded to a number.
 *
 * hours: [{ day: "YYYY-MM-DD", hour: 0-23, temp, id, rain }] - the next 24 hours, the first one is "now"; id = OpenWeatherMap-style condition id.
 * units: "imperial" (°F) or "metric" (°C); the thresholds below are in °F and are converted for metric.
 */
(function (root) {
  const toF = (t, units) => (units === "metric" ? t * 9 / 5 + 32 : t);
  const hourLabel = (h, hour12) => (hour12 === false ? `${String(h).padStart(2, "0")}:00` : `${h % 12 || 12} ${h < 12 ? "AM" : "PM"}`);
  const isRain = (id) => id != null && ((id >= 200 && id < 300) || (id >= 300 && id < 600));
  const isSnow = (id) => id != null && id >= 600 && id < 700;
  const rainOf = (h) => (h.rain == null ? 0 : h.rain);

  /** The clothing tip for a range with this low and this chance of rain: rain 40%+ wins, then 62+ light, 50-61 jacket, below 50 warm coat */
  function chipFor(low, rain, units) {
    const f = toF(low, units);
    if (rain != null && rain >= 40) return { key: "rain", label: "Rain jacket" };
    if (f >= 62) return { key: "light", label: "T-shirt or light layer" };
    if (f >= 50) return { key: "jacket", label: "Jacket" };
    return { key: "coat", label: "Warm coat" };
  }

  function condLabel(id, temp, isDay, units) {
    if (id == null) return "";
    if (id >= 200 && id < 300) return "Thunderstorms";
    if (id >= 300 && id < 400) return "Drizzle";
    if (id >= 500 && id < 600) return id >= 502 ? "Heavy rain" : "Rain";
    if (id >= 600 && id < 700) return "Snow";
    if (id >= 700 && id < 800) return "Foggy";
    const f = temp == null ? 60 : toF(temp, units);
    const feel = f < 35 ? "freezing" : f < 50 ? "cold" : f < 78 ? "mild" : f < 90 ? "warm" : "hot";
    const sky = id === 800 ? (isDay === false ? "Clear" : "Sunny") : id === 801 ? (isDay === false ? "Mostly clear" : "Mostly sunny") : id === 802 ? "Partly cloudy" : "Cloudy";
    return `${sky} and ${feel}`;
  }

  /** "clear-day" | "cloudy" | "rain" | "snow" | "night" - the sky the hero card is painted in */
  function skyKind(id, isDay) {
    if (isRain(id)) return "rain";
    if (isSnow(id)) return "snow";
    if (isDay === false) return "night";
    return id == null || id <= 801 ? "clear-day" : "cloudy";
  }

  const extreme = (hours, pick) => { let k = 0; hours.forEach((h, i) => { if (pick(h.temp, hours[k].temp)) k = i; }); return k; };

  /** { high, highIdx, highHour, low, lowIdx, lowHour } over the hours */
  function extremes(hours) {
    const hi = extreme(hours, (a, b) => a > b), lo = extreme(hours, (a, b) => a < b);
    return { high: hours[hi].temp, highIdx: hi, highHour: hours[hi].hour, low: hours[lo].temp, lowIdx: lo, lowHour: hours[lo].hour };
  }

  /** The one sentence on the hero card: the peak and when, when it cools, and a jacket / umbrella tip (rain 40%+ is mentioned instead of the jacket) */
  function sentence(hours, opts) {
    const o = opts || {}, units = o.units, h12 = o.hour12;
    if (!hours || !hours.length) return "";
    const e = extremes(hours), parts = [];
    parts.push(e.highIdx === 0 ? `It's at its warmest now, ${e.high}°.` : `Warming to ${e.high}° around ${hourLabel(e.highHour, h12)}.`);
    // when it falls fastest: the biggest drop over 2 hours after the peak
    let best = null;
    for (let i = e.highIdx; i + 2 < hours.length; i++) { const d = hours[i].temp - hours[i + 2].temp; if (!best || d > best.d) best = { d, i }; }
    const dropLimit = units === "metric" ? 2 : 4;
    if (best && best.d >= dropLimit) parts.push(`${parts.length && e.highIdx !== 0 ? "Then dropping" : "Dropping"} fast after ${hourLabel(hours[best.i].hour, h12)}.`);
    const wet = hours.findIndex((h) => rainOf(h) >= 40);
    if (wet >= 0) parts.push(wet === 0 ? "Rain is likely now, so take an umbrella." : `Rain is likely around ${hourLabel(hours[wet].hour, h12)}, so take an umbrella.`);
    else {
      const next12 = Math.min(...hours.slice(0, 13).map((h) => toF(h.temp, units)));
      if (next12 < 40) parts.push("Bring a warm coat if you're out tonight.");
      else if (next12 < 50) parts.push("Bring a jacket if you're out tonight.");
    }
    return parts.join(" ");
  }

  /** { max, text } - "Dry all day" under 20%, otherwise "Rain around 6 PM" (the hour of the highest chance). null when there is no rain data at all. */
  function rainStrip(hours, opts) {
    const have = (hours || []).filter((h) => h.rain != null);
    if (!have.length) return null;
    const top = have.reduce((a, b) => (b.rain > a.rain ? b : a));
    if (top.rain < 20) return { max: top.rain, text: "Dry all day" };
    const first = have.findIndex((h) => h.rain >= Math.max(20, top.rain - 10));
    const at = have[first >= 0 ? first : 0];
    return { max: top.rain, text: at === hours[0] ? "Rain now" : `Rain around ${hourLabel(at.hour, opts && opts.hour12)}` };
  }

  const range = (lo, hi) => (lo === hi ? `${lo}°` : `${lo}–${hi}°`);

  /** The "Plan around it" periods, from the hours: [{ when, range, text, chip: {key,label} }].
   *  Now to 5 PM, 5 PM to 9 PM, 9 PM to 5 AM (periods that are already over are left out), then Tomorrow from the daily forecast
   *  (tomorrow: { high, low, id, rain }). */
  function plans(hours, tomorrow, opts) {
    const o = opts || {}, units = o.units, h12 = o.hour12, out = [];
    if (hours && hours.length) {
      const h0 = hours[0].hour, abs = (i) => h0 + i;                 // hours since midnight of the first day
      const cuts = [17, 21, 29].filter((c) => c > abs(0));           // 5 PM, 9 PM, 5 AM next day
      let startIdx = 0, from = "Now";
      for (const c of cuts) {
        const endIdx = Math.min(hours.length - 1, c - h0);
        const seg = hours.slice(startIdx, endIdx + 1);
        if (seg.length >= 2) out.push(period(seg, `${from} to ${hourLabel(c % 24, h12)}`, units));
        startIdx = endIdx; from = hourLabel(c % 24, h12);
        if (endIdx >= hours.length - 1) break;
      }
    }
    if (tomorrow && tomorrow.high != null && tomorrow.low != null) {
      const chip = chipFor(tomorrow.low, tomorrow.rain, units);
      const sky = condLabel(tomorrow.id, tomorrow.high, true, units).replace(/ and (freezing|cold|mild|warm|hot)$/, "");
      const text = tomorrow.rain != null && tomorrow.rain >= 40 ? `${tomorrow.rain}% chance of rain. Pack umbrellas for the school run.` : `${sky}.${tomorrow.rain != null && tomorrow.rain >= 20 ? ` ${tomorrow.rain}% chance of rain.` : ""}`;
      out.push({ when: "Tomorrow", range: range(tomorrow.low, tomorrow.high), text, chip });
    }
    return out;
  }

  function period(seg, when, units) {
    const temps = seg.map((h) => h.temp), lo = Math.min(...temps), hi = Math.max(...temps);
    const rain = Math.max(...seg.map(rainOf)), chip = chipFor(lo, rain, units);
    const wetAt = seg.find((h) => rainOf(h) >= 40);
    const ids = seg.map((h) => h.id).filter((x) => x != null);
    const sky = ids.length ? condLabel(ids.sort((a, b) => ids.filter((v) => v === b).length - ids.filter((v) => v === a).length)[0], hi, true, units).replace(/ and (freezing|cold|mild|warm|hot)$/, "") : "";
    const delta = seg[seg.length - 1].temp - seg[0].temp, per = Math.round(Math.abs(delta) / (seg.length - 1));
    let trend;
    if (rain >= 40) trend = `${rain}% chance of rain${wetAt ? "" : ""}. Take an umbrella.`;
    else if (delta <= -3 && per >= 1) trend = `Falls about ${per}° an hour.`;
    else if (delta >= 3 && per >= 1) trend = `Warms about ${per}° an hour.`;
    else trend = "Holding steady.";
    return { when, range: range(lo, hi), text: `${sky ? sky + ". " : ""}${trend}`, chip };
  }

  /** The curve in a 1000 x 260 box: { line, area, pts: [{ x%, y% }], lo, hi } - cubic smoothing, the y scale fit to the data with padding */
  function curve(hours) {
    const n = hours.length, temps = hours.map((h) => h.temp);
    const mn = Math.min(...temps), mx = Math.max(...temps), pad = Math.max(2, (mx - mn) * 0.25);
    const lo = mn - pad, hi = mx + pad;
    const px = (i) => (n > 1 ? (i / (n - 1)) * 1000 : 500), py = (t) => 240 - ((t - lo) / (hi - lo)) * 220;
    const pts = temps.map((t, i) => [px(i), py(t)]);
    const r = (v) => Math.round(v * 10) / 10;
    let line = `M${r(pts[0][0])} ${r(pts[0][1])}`;
    for (let i = 1; i < pts.length; i++) { const cx = (pts[i - 1][0] + pts[i][0]) / 2; line += ` C${r(cx)} ${r(pts[i - 1][1])} ${r(cx)} ${r(pts[i][1])} ${r(pts[i][0])} ${r(pts[i][1])}`; }
    return { line, area: `${line} L${r(pts[pts.length - 1][0])} 260 L0 260Z`, pts: pts.map(([x, y]) => ({ x: r(x / 10), y: r((y / 260) * 100) })), lo, hi };
  }

  /** One shared scale for the week's bars: [{ left%, span% }] per day ({low, high}), min = lowest low - 2, max = highest high + 2 */
  function weekBars(days) {
    if (!days.length) return [];
    const mn = Math.min(...days.map((d) => d.low)) - 2, mx = Math.max(...days.map((d) => d.high)) + 2, span = mx - mn || 1;
    return days.map((d) => ({ left: Math.round(((d.low - mn) / span) * 1000) / 10, span: Math.max(4, Math.round(((d.high - d.low) / span) * 1000) / 10) }));
  }

  /** The radar's one-line status from what we know (no distances in the free feed): { text, dry, hours } - hours = how long it stays dry (up to 24) */
  function radarStatus(hours, currentId) {
    const wetNow = isRain(currentId) || (hours && hours.length && rainOf(hours[0]) >= 60);
    if (wetNow) return { text: "Rain nearby", dry: false, hours: 0 };
    const k = (hours || []).findIndex((h) => rainOf(h) >= 40);
    const dryHours = k < 0 ? (hours || []).length : k;
    return { text: k >= 0 && k <= 3 ? "Rain nearby" : "No rain nearby", dry: !(k >= 0 && k <= 3), hours: dryHours };
  }

  const api = { chipFor, condLabel, skyKind, extremes, sentence, rainStrip, plans, curve, weekBars, radarStatus, hourLabel };
  if (typeof window !== "undefined") window.OpenSkyWeatherCopy = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : this);
