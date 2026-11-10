/* OpenSky share page: post a note, add photos. Talks to lib/share.js only. */
(() => {
  const app = document.getElementById("app");
  const ICON = {
    note: '<svg viewBox="0 0 24 24"><path d="M5 4h14v12l-5 5H5z"/><path d="M14 21v-5h5"/></svg>',
    photo: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/></svg>',
    x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    gift: '<svg viewBox="0 0 24 24"><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M5 12v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8M7.5 8a2.5 2.5 0 0 1 0-5C10 3 12 8 12 8s2-5 4.5-5a2.5 2.5 0 0 1 0 5"/></svg>',
    send: '<svg viewBox="0 0 24 24"><path d="M4 12l16-8-6 16-3-7z"/></svg>'
  };
  const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k) || ""; localStorage.setItem(k, v); } catch (e) { return ""; } };

  function el(tag, props = {}, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === "html") e.innerHTML = v;
      else if (k.startsWith("on")) e[k] = v;
      else if (v === false || v == null) continue;
      else e.setAttribute(k, v === true ? "" : v);
    }
    e.append(...kids.flat().filter((x) => x != null));
    return e;
  }
  const ic = (name, cls = "ic") => el("span", { class: cls, html: ICON[name] });

  async function api(path, opts = {}) {
    const r = await fetch(path, { ...opts, headers: { "X-OpenSky": "1", ...(opts.headers || {}) }, credentials: "same-origin" });
    let data = {};
    try { data = await r.json(); } catch (e) { /* not JSON */ }
    if (!r.ok) throw Object.assign(new Error(data.error || "Something went wrong"), { status: r.status, passcodeSet: data.passcodeSet });
    return data;
  }

  function locked(message) {
    app.replaceChildren(el("div", { class: "locked" }, el("img", { src: "icon.png", alt: "" }), el("h1", {}, "Family screen"), el("p", {}, message)));
  }

  function login(passcodeSet) {
    if (!passcodeSet) return locked("No passcode has been set yet. Whoever set up the screen can choose one in OpenSky's phone setup (Share with the family).");
    const input = el("input", { type: "password", placeholder: "Family passcode", autocomplete: "current-password", "aria-label": "Family passcode" });
    const msg = el("div", { class: "msg", role: "alert" });
    const go = el("button", { type: "submit", class: "btn" }, "Sign in");
    const form = el("form", { class: "login" }, input, el("div", { class: "row" }, go), msg);
    form.onsubmit = async (ev) => {
      ev.preventDefault();
      if (!input.value) return;
      go.disabled = true; msg.className = "msg"; msg.textContent = "";
      try { await api("/api/login", { method: "POST", body: JSON.stringify({ passcode: input.value }) }); boot(); }
      catch (e) { msg.className = "msg bad"; msg.textContent = e.message; input.value = ""; go.disabled = false; input.focus(); }
    };
    app.replaceChildren(el("div", { class: "locked" }, el("img", { src: "icon.png", alt: "" }), el("h1", {}, "Family screen"),
      el("p", {}, "Enter the family passcode to share a photo or a note."), form));
    input.focus();
  }

  function ago(ms) {
    const m = Math.round((Date.now() - ms) / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m} min ago`;
    if (m < 60 * 24) return `${Math.round(m / 60)} h ago`;
    return `${Math.round(m / 60 / 24)} d ago`;
  }

  function notesList(box, notes, onDelete) {
    box.replaceChildren(...(notes.length ? [el("div", { class: "notes-head" }, "On the screen now"), el("ul", { class: "notes" }, ...notes.map((n) =>
      el("li", {}, el("div", { class: "t" }, n.text, el("small", {}, [n.from, ago(n.at)].filter(Boolean).join(" · "))),
        el("button", { type: "button", "aria-label": "Remove this note", onclick: () => onDelete(n.id), html: ICON.x }))))] : []));
  }

  function noteCard(state, setNotes) {
    const text = el("textarea", { placeholder: "Pick up milk on the way home…", maxlength: String(state.maxText), "aria-label": "Your note" });
    const from = el("input", { type: "text", placeholder: "Your name (optional)", maxlength: "30", value: store("os_share_name"), "aria-label": "Your name", autocomplete: "given-name" });
    const days = el("select", { "aria-label": "How long to keep it" },
      ...[["1", "Keep for a day"], ["7", "Keep for a week"], ["0", "Until someone removes it"]].map(([v, t]) => el("option", { value: v }, t)));
    days.value = store("os_share_days") || "1";
    const count = el("div", { class: "count" }), msg = el("div", { class: "msg", role: "status" }), list = el("div");
    const left = () => { count.textContent = `${text.value.length} / ${state.maxText}`; };
    text.oninput = left; left();
    const send = el("button", { type: "button", class: "btn" }, ic("send"), "Post to the screen");
    send.onclick = async () => {
      if (!text.value.trim()) { msg.className = "msg bad"; msg.textContent = "Please type something first"; return; }
      send.disabled = true; msg.className = "msg"; msg.textContent = "";
      store("os_share_name", from.value.trim()); store("os_share_days", days.value);
      try {
        const r = await api("/api/notes", { method: "POST", body: JSON.stringify({ text: text.value, from: from.value, days: Number(days.value) }) });
        text.value = ""; left(); setNotes(r.notes);
        msg.className = "msg good"; msg.textContent = "Posted — it shows on the screen in a moment.";
      } catch (e) { msg.className = "msg bad"; msg.textContent = e.message; }
      send.disabled = false;
    };
    const redraw = (notes) => notesList(list, notes, async (id) => {
      try { setNotes((await api("/api/notes/delete", { method: "POST", body: JSON.stringify({ id }) })).notes); }
      catch (e) { msg.className = "msg bad"; msg.textContent = e.message; if (e.status === 404) setNotes(null); }
    });
    redraw(state.notes);
    return { node: el("section", { class: "card" }, el("h2", {}, ic("note"), "Post a note"), el("p", { class: "sub" }, "A short message that shows on the family screen."),
      text, count, el("div", { class: "row" }, from, days), el("div", { class: "row" }, send), msg, list), redraw };
  }

  function photoCard() {
    const input = el("input", { type: "file", accept: "image/jpeg,image/png,image/webp", multiple: true });
    const pick = el("button", { type: "button", class: "btn plain" }, ic("photo"), "Choose photos");
    const msg = el("div", { class: "msg", role: "status" }), previews = el("div", { class: "previews" });
    pick.onclick = () => input.click();
    input.onchange = async () => {
      const files = [...input.files];
      input.value = "";
      if (!files.length) return;
      pick.disabled = true; msg.className = "msg"; let ok = 0, bad = null;
      for (const f of files) {
        const p = el("div", { class: "p busy" });
        try { p.style.backgroundImage = `url(${URL.createObjectURL(f)})`; } catch (e) { /* no preview */ }
        previews.append(p);
        msg.textContent = `Sending ${ok + 1} of ${files.length}…`;
        try {
          await api(`/api/photos?name=${encodeURIComponent(f.name || "photo")}`, { method: "POST", body: f, headers: { "Content-Type": "application/octet-stream" } });
          ok++; p.className = "p done";
        } catch (e) { bad = e.message; p.className = "p bad"; }
      }
      pick.disabled = false;
      msg.className = bad ? "msg bad" : "msg good";
      msg.textContent = bad ? `${ok ? `${ok} added. ` : ""}${bad}` : ok === 1 ? "Added — it joins the slideshow." : `${ok} photos added — they join the slideshow.`;
    };
    return el("section", { class: "card" }, el("h2", {}, ic("photo"), "Add photos"), el("p", { class: "sub" }, "They join the slideshow on the family screen. JPEG, PNG or WebP."), pick, input, msg, previews);
  }

  const prettyDate = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); return m ? new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" }) : s; };

  function countdownCard(state, setItems) {
    const title = el("input", { type: "text", placeholder: "Beach trip, Grandma's birthday…", maxlength: String(state.maxTitle || 60), "aria-label": "What are we counting down to?" });
    const date = el("input", { type: "date", "aria-label": "Date" });
    const yearly = el("input", { type: "checkbox", id: "cd-yearly" });
    const msg = el("div", { class: "msg", role: "status" }), list = el("div");
    const add = el("button", { type: "button", class: "btn" }, ic("gift"), "Add to the screen");
    add.onclick = async () => {
      if (!title.value.trim() || !date.value) { msg.className = "msg bad"; msg.textContent = "Please give it a name and a date"; return; }
      add.disabled = true; msg.className = "msg"; msg.textContent = "";
      try {
        const r = await api("/api/countdowns", { method: "POST", body: JSON.stringify({ title: title.value, date: date.value, yearly: yearly.checked, from: store("os_share_name") }) });
        title.value = ""; date.value = ""; yearly.checked = false; setItems(r.countdowns);
        msg.className = "msg good"; msg.textContent = "Added — it shows on the screen in a moment.";
      } catch (e) { msg.className = "msg bad"; msg.textContent = e.message; }
      add.disabled = false;
    };
    const redraw = (items) => list.replaceChildren(...(items.length ? [el("div", { class: "notes-head" }, "Counting down now"), el("ul", { class: "notes" }, ...items.map((c) =>
      el("li", {}, el("div", { class: "t" }, c.title, el("small", {}, [prettyDate(c.date) + (c.yearly ? " · every year" : ""), c.from].filter(Boolean).join(" · "))),
        el("button", { type: "button", "aria-label": `Remove ${c.title}`, html: ICON.x, onclick: async () => {
          try { setItems((await api("/api/countdowns/delete", { method: "POST", body: JSON.stringify({ id: c.id }) })).countdowns); }
          catch (e) { msg.className = "msg bad"; msg.textContent = e.message; if (e.status === 404) api("/api/state").then((s) => setItems(s.countdowns)).catch(() => {}); }
        } }))))] : []));
    redraw(state.countdowns || []);
    return { node: el("section", { class: "card" }, el("h2", {}, ic("gift"), "Add a countdown"), el("p", { class: "sub" }, "A trip, a birthday or a big day: the screen counts the days down."),
      title, el("div", { class: "row" }, date), el("label", { class: "check", for: "cd-yearly" }, yearly, "Every year (a birthday)"), el("div", { class: "row" }, add), msg, list), redraw };
  }

  async function boot() {
    let state;
    try { state = await api("/api/state"); } catch (e) {
      if (e.status === 401) return login(e.passcodeSet);
      return locked(e.status === 429 ? "Too many tries — wait a minute and reload." : "Couldn't reach the screen's Pi. Check that you're on the home Wi-Fi.");
    }
    const note = noteCard(state, (notes) => { if (notes) return note.redraw(notes); api("/api/state").then((s) => note.redraw(s.notes)).catch(() => {}); });
    const cd = countdownCard(state, (items) => cd.redraw(items));
    const out = el("button", { type: "button", class: "btn plain", onclick: async () => { try { await api("/api/logout", { method: "POST" }); } catch (e) { /* already out */ } boot(); } }, "Sign out");
    app.replaceChildren(el("h1", {}, "Family screen"), note.node, cd.node, ...(state.photos ? [photoCard()] : []), out);
  }
  boot();
})();
