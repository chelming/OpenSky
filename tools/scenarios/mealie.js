// Mealie on the screen (fake Mealie server): a shopping list shows its items and Add / check-off reach Mealie,
// and the meal plan shows on the week as its own calendar.
const http = require("http");
const PORT = 8097;
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const t = new Date(), tomorrow = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1);
const items = [{ id: "i1", shoppingListId: "L1", note: "Flour", display: "Flour", checked: false, position: 1 }];
const fake = http.createServer((req, res) => {
  let raw = ""; req.on("data", (c) => { raw += c; });
  req.on("end", () => {
    const u = new URL(req.url, "http://x"), send = (code, obj) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(obj === undefined ? "" : JSON.stringify(obj)); };
    if (req.headers.authorization !== "Bearer fake-mealie-token") return send(401, {});
    const p = u.pathname;
    if (p === "/api/households/shopping/lists") return send(200, { items: [{ id: "L1", name: "Groceries" }] });
    if (p === "/api/households/shopping/lists/L1") return send(200, { id: "L1", listItems: items });
    if (p === "/api/households/shopping/items" && req.method === "POST") { const b = JSON.parse(raw); items.push({ id: `i${items.length + 1}`, shoppingListId: b.shoppingListId, note: b.note, display: b.note, checked: false, position: 9 }); return send(201, {}); }
    const m = p.match(/^\/api\/households\/shopping\/items\/([^/]+)$/), it = m && items.find((x) => x.id === m[1]);
    if (m && it && req.method === "GET") return send(200, it);
    if (m && it && req.method === "PUT") { Object.assign(it, JSON.parse(raw)); return send(200, it); }
    if (p === "/api/households/mealplans") return send(200, { items: [{ id: "m1", date: ymd(tomorrow), entryType: "dinner", title: "", recipe: { name: "Test Lasagna" } }, { id: "m2", date: ymd(tomorrow), entryType: "lunch", title: "Not Shown Lunch" }] });
    send(404, {});
  });
});
fake.listen(PORT, "127.0.0.1"); fake.unref();

module.exports = async (page, h) => {
  const R = {}; const ok = (k, v, i) => { R[k] = v; h.log(`${v ? "PASS" : "FAIL"}  ${k}${i !== undefined ? "  — " + JSON.stringify(i) : ""}`); };
  const until = async (fn, tries = 60) => { for (let i = 0; i < tries && !(await fn()); i++) await h.sleep(250); return fn(); };
  const col = () => page.evaluate(() => { const c = [...document.querySelectorAll(".hd-lists .lc-list")].find((x) => x.querySelector(".lc-list-title").textContent === "Groceries"); return c ? [...c.querySelectorAll(".lc-item-text")].map((x) => x.textContent) : null; });
  await until(async () => ((await col()) || []).length);
  ok("the Mealie shopping list shows its items", JSON.stringify(await col()) === '["Flour"]', await col());
  await page.evaluate(() => [...document.querySelectorAll(".hd-lists .lc-list")].find((x) => x.querySelector(".lc-list-title").textContent === "Groceries").querySelector(".lc-add-item").click());
  await h.sleep(300);
  await page.evaluate(() => { document.querySelector(".osl-input").value = "Butter"; [...document.querySelectorAll(".osl-btn")].find((b) => b.textContent === "Add").click(); });
  await until(async () => ((await col()) || []).includes("Butter"));
  ok("Add item reaches Mealie", items.some((x) => x.note === "Butter" && x.shoppingListId === "L1"));
  await page.evaluate(() => [...document.querySelectorAll(".hd-lists .lc-item")].find((r) => r.textContent === "Flour").querySelector(".lc-check").click());
  await until(() => items[0].checked === true, 60);
  ok("check-off reaches Mealie after the Undo time", items[0].checked === true);
  const title = () => page.evaluate(() => [...document.querySelectorAll(".hd-week .hd-event-title, .hd-today .hd-event-title")].map((e) => e.textContent));
  await until(async () => (await title()).includes("Test Lasagna"));
  const seen = await title();
  ok("tomorrow's dinner from the meal plan shows on the week", seen.includes("Test Lasagna"), seen);
  ok("meals that weren't chosen (lunch) don't", !seen.includes("Not Shown Lunch"));
  const f = Object.entries(R).filter(([, v]) => !v).map(([k]) => k);
  h.log(`SUMMARY: ${f.length ? "FAILED: " + f.join("; ") : "ALL CHECKS PASSED"} (${Object.keys(R).length} checks)`);
};
module.exports.patchSettings = (s) => {
  s.lists = { lists: [{ name: "Groceries", provider: "mealie", shoppingList: "Groceries", shoppingListId: "L1", color: "green" }] };
  s.calendar.sources = [...(s.calendar.sources || []), { name: "Dinner", type: "mealie", meals: ["dinner"], color: "orange" }];
};
module.exports.patchSecrets = (s) => { s.mealie = { url: `http://127.0.0.1:${PORT}`, token: "fake-mealie-token" }; };
