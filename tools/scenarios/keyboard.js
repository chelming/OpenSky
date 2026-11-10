// On-screen keyboard: appears for text boxes (not date/time), types at the caret, capitals, numbers, Return, hide,
// and popups move above it.
module.exports = async (page, h) => {
  const R = {}; const ok = (k, v, i) => { R[k] = v; h.log(`${v ? "PASS" : "FAIL"}  ${k}${i !== undefined ? "  — " + JSON.stringify(i) : ""}`); };
  const kb = () => page.evaluate(() => { const k = document.querySelector(".okb"); return !!k && !k.hidden && document.body.classList.contains("kb-open"); });
  const key = async (k) => { await h.tap(`.okb-key[data-key="${k}"]`); await h.sleep(60); };
  const value = () => page.evaluate(() => document.activeElement && document.activeElement.value);
  const until = async (fn, tries = 20) => { for (let i = 0; i < tries && !(await fn()); i++) await h.sleep(200); return fn(); };

  ok("hidden at start", !(await kb()));
  const lang = await page.evaluate(() => navigator.language);
  ok("the screen's language follows the settings (en-US date boxes on an en-GB Pi)", lang === "en-US", lang);
  for (let i = 0; i < 20 && !(await page.evaluate(() => document.querySelectorAll(".hd-lists .lc-add-item").length)); i++) await h.sleep(500);
  await h.tap(".hd-lists .lc-add-item");
  await until(kb);
  ok("a popup's text box brings it up", await kb());
  const geo = await page.evaluate(() => ({ modal: document.querySelector(".osl-modal").getBoundingClientRect().bottom, kb: document.querySelector(".okb").getBoundingClientRect().top }));
  ok("the popup sits above the keyboard", geo.modal < geo.kb, geo);
  // (it slides up: wait until it stands still, or a tap measured mid-slide lands beside the key — on a busy computer)
  let last = null;
  for (let i = 0; i < 20; i++) { const t = await page.evaluate(() => document.querySelector(".okb").getBoundingClientRect().top); if (t === last) break; last = t; await h.sleep(100); }
  for (const k of ["m", "i", "l", "k"]) await key(k);
  ok("an empty box starts with a capital; typing goes in", (await value()) === "Milk", await value());
  await key("{back}"); await key("{shift}"); await key("s");
  ok("backspace + shift for one capital", (await value()) === "MilS", await value());
  await key("{space}"); await key("{numbers}"); await key("2"); await key("{letters}"); await key("x");
  ok("numbers layer, then back to letters", (await value()) === "MilS 2x", await value());
  await page.evaluate(() => { const el = document.activeElement; el.setSelectionRange(0, 0); });
  await key("a");
  ok("types at the caret, not only at the end", (await value()) === "aMilS 2x", await value());
  await key("{enter}");
  await until(async () => !(await page.evaluate(() => !!document.querySelector(".osl-overlay"))));
  ok("Return = the popup's main button (added); the keyboard goes away with the popup", !(await page.evaluate(() => !!document.querySelector(".osl-overlay"))) && !(await kb()));

  // the event editor: text yes, date/time pickers no
  await page.evaluate(() => MM.getModules().withClass("MMM-OpenSky-Home")[0].sendNotification("CALENDAR_ADD_EVENT", { date: new Date() }));
  await h.sleep(500);
  await page.evaluate(() => document.getElementById("event-start-date").focus()); await h.sleep(250);
  const forDate = await kb();
  await page.evaluate(() => document.getElementById("event-title").focus()); await h.sleep(250);
  ok("event form: not for the date picker, yes for the title", !forDate && await kb(), { forDate });
  await h.shot("keyboard-event");
  await h.tap(".okb-hide"); await h.sleep(300);
  ok("the hide key closes it", !(await kb()));
  await page.evaluate(() => document.querySelector(".event-close-btn, .event-btn-secondary")?.click());

  // Portrait (1080x1920): the keyboard is capped (440 design px), not 40 % of 1920 px, so the keys keep their shape
  const kbBox = () => page.evaluate(() => {
    const k = document.querySelector(".okb"), z = Number(getComputedStyle(document.documentElement).getPropertyValue("--os-zoom")) || 1, keys = [...k.querySelectorAll(".okb-key")].filter((x) => /^[a-z]$/.test(x.dataset.key || ""));
    const r = k.getBoundingClientRect(), q = keys[0].getBoundingClientRect();
    return { H: innerHeight / z, kb: Math.round(r.height / z), keyH: Math.round(q.height / z), keyW: Math.round(q.width / z) };
  });
  await page.evaluate(() => MM.getModules().withClass("MMM-OpenSky-Home")[0].sendNotification("CALENDAR_ADD_EVENT", { date: new Date() })); await h.sleep(500);
  const land = await (async () => { await page.evaluate(() => document.getElementById("event-title").focus()); await until(kb); await h.sleep(500); return kbBox(); })();
  ok("landscape 1080 px tall: the keyboard is 40 % (432 px)", Math.abs(land.kb - 0.4 * land.H) < 2 && land.kb <= 440, land);
  await h.tap(".okb-hide"); await h.sleep(300);
  await page.setViewportSize({ width: 1080, height: 1920 }); await h.sleep(1500);
  await page.evaluate(() => document.getElementById("event-title") && document.getElementById("event-title").focus()); await until(kb); await h.sleep(500);
  const port = await kbBox();
  ok("portrait 1920 px tall: the keyboard is capped (<= 440 px, not 768) and its keys are not stretched (taller than wide by less than 1.3x)", port.kb <= 440 && port.kb > 300 && port.keyH <= port.keyW * 1.3, port);
  await h.shot("keyboard-portrait");
  const room = await page.evaluate(() => { const m = document.querySelector(".calendar-editor-modal"), k = document.querySelector(".okb"); return m ? m.getBoundingClientRect().bottom <= k.getBoundingClientRect().top + 1 : null; });
  ok("portrait: the event form still sits above the keyboard", room === true, room);
  await h.tap(".okb-hide"); await h.sleep(300);
  await page.evaluate(() => document.querySelector(".event-close-btn, .event-btn-secondary")?.click());

  const f = Object.entries(R).filter(([, v]) => !v).map(([k]) => k);
  h.log(`SUMMARY: ${f.length ? "FAILED: " + f.join("; ") : "ALL CHECKS PASSED"} (${Object.keys(R).length} checks)`);
};
