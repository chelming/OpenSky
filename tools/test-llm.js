// Unit test for lib/llm.js against a fake OpenAI-style server (chat, models, audio transcriptions).
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "opensky-llm-"));
process.env.OPENSKY_SECRETS = path.join(tmp, "secrets.json");
process.env.OPENSKY_SETTINGS = path.join(tmp, "opensky.json");
fs.writeFileSync(process.env.OPENSKY_SECRETS, JSON.stringify({ ai: { key: "sekret-key" } }));
const llm = require(path.join(__dirname, "..", "lib", "llm.js"));

let passed = 0, failed = 0;
const ok = (name, cond, info) => { cond ? passed++ : failed++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${info !== undefined ? "  — " + JSON.stringify(info) : ""}`); };
const fails = async (fn) => { try { await fn(); return null; } catch (e) { return e.message; } };

let chatReply = '{"title":"Dentist"}', asrReply = { text: "language English<asr_text>Dentist Tuesday at three." }, vision = true, slow = false, requireKey = false;
const seen = [];
const server = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks);
    const send = (code, obj) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
    if (requireKey && req.headers.authorization !== "Bearer sekret-key") return send(401, {});
    if (req.url === "/v1/models") return send(200, { data: [{ id: "/models/test.gguf", architecture: { input_modalities: vision ? ["text", "image"] : ["text"] } }] });
    if (req.url === "/v1/chat/completions") {
      const b = JSON.parse(body); seen.push(b);
      if (slow) return;                                    // never answers
      return send(200, { choices: [{ message: { content: chatReply } }] });
    }
    if (req.url === "/v1/audio/transcriptions") { seen.push({ asr: body.toString("latin1") }); return send(200, asrReply); }
    send(404, {});
  });
});

(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}`;

  ok("1 nothing configured → off", llm.enabled() === false && llm.voiceEnabled() === false);
  ok("2 asking while off → plain message", /isn't set up/.test(await fails(() => llm.askJson("s", "u", {}))));
  fs.writeFileSync(process.env.OPENSKY_SETTINGS, JSON.stringify({ ai: { url: url + "/v1/", transcribeUrl: url } }));
  ok("3 configured (a trailing /v1/ is tidied) → on", llm.enabled() && llm.voiceEnabled() && llm.config().url === url);

  const c = await llm.connect();
  ok("4 connect lists the model and whether it can see photos", c.model === "/models/test.gguf" && c.vision === true, c);
  vision = false;
  ok("5 a text-only model → vision false", (await llm.connect()).vision === false);
  ok("6 an address typed but not saved yet can be tested", (await llm.connect({ url })).model === "/models/test.gguf");
  ok("7 a bad address is explained", /should look like/.test(await fails(() => llm.connect({ url: "nope" }))) && /Can't reach/.test(await fails(() => llm.connect({ url: "http://127.0.0.1:1" }))));

  const schema = { type: "object", properties: { title: { type: "string" } }, required: ["title"] };
  const a = await llm.askJson("sys", "dentist tuesday", schema);
  const sent = seen[seen.length - 1];
  ok("8 JSON answer is parsed", a.title === "Dentist", a);
  ok("9 request: schema enforced, thinking off, system + user messages", sent.response_format.type === "json_schema" && sent.response_format.json_schema.schema === undefined ? false : sent.response_format.json_schema.schema.required[0] === "title" && sent.chat_template_kwargs.enable_thinking === false && sent.messages[0].role === "system" && sent.messages[1].content === "dentist tuesday", sent);
  chatReply = '<think>hmm</think>\n{"title":"Soccer"}';
  ok("10 a leftover <think> block is dropped", (await llm.askJson("s", "u", schema)).title === "Soccer");
  chatReply = "not json";
  ok("11 an unusable answer → try again message", /wasn't usable/.test(await fails(() => llm.askJson("s", "u", schema))));
  slow = true;
  ok("12 no answer in time → says so", /too long/.test(await fails(() => llm.askJson("s", "u", schema, { timeoutMs: 200 }))));
  slow = false;

  requireKey = true;
  ok("13 the key from secrets.json is sent as a bearer token", (await llm.connect()).model === "/models/test.gguf");
  requireKey = false;
  ok("14 the key never appears in what the page could see (config() is server side; no key in the saved settings)", !fs.readFileSync(process.env.OPENSKY_SETTINGS, "utf8").includes("sekret-key"));

  const t = await llm.transcribe(Buffer.from("RIFFfakewav"), "audio/wav");
  const asr = seen[seen.length - 1].asr;
  ok("15 transcribe strips Qwen3-ASR's 'language English<asr_text>' prefix", t === "Dentist Tuesday at three.", t);
  ok("16 transcribe asks for response_format json (the only one llama.cpp's ASR accepts)", /name="response_format"\r\n\r\njson/.test(asr) && /filename="clip\.wav"/.test(asr));
  asrReply = { text: "language None<asr_text>" };
  ok("17 silence → empty text, not an error", (await llm.transcribe(Buffer.from("x"))) === "");
  asrReply = { text: "Plain text from Parakeet" };
  ok("18 a server that returns clean text works too", (await llm.transcribe(Buffer.from("x"), "audio/webm;codecs=opus")) === "Plain text from Parakeet" && /filename="clip\.webm"/.test(seen[seen.length - 1].asr));
  ok("19 empty and huge recordings are refused", /No sound/.test(await fails(() => llm.transcribe(Buffer.alloc(0)))) && /too long/.test(await fails(() => llm.transcribe(Buffer.alloc(9 * 1024 * 1024)))));

  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`passed=${passed} fail=${failed}`);
  process.exit(failed ? 1 : 0);
})();
