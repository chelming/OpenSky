/* OpenSky AI helper client (server side) — talks to any OpenAI-compatible server on your network (llama.cpp's llama-server,
 * Ollama, LM Studio…). Used by lib/quick-add.js ("dentist Tuesday 3pm", a photo of a flyer, a spoken sentence).
 *
 * opensky.json → ai: { url: "https://llama-cpp.example", model?: "<name>", transcribeUrl?: "https://asr.example" }
 *   (empty/absent = the feature is off and hidden). Set from phone setup; nobody edits the file.
 * secrets.json → ai.key (optional bearer key, only if the server wants one).
 *
 * The model sees text and photos but can only ever *propose* things: callers turn its answer into a draft that a person confirms.
 */
const fs = require("fs");
const path = require("path");
const { secret } = require(path.join(__dirname, "secrets.js"));

const SETTINGS = process.env.OPENSKY_SETTINGS || path.join(global.root_path || process.cwd(), "config", "opensky.json");

class AiError extends Error { constructor(m, status) { super(m); this.status = status; } }

const clean = (u) => String(u || "").trim().replace(/\/+$/, "").replace(/\/v1$/, "");

/** The saved settings (or `over`, e.g. an address that is being tested and isn't saved yet). */
function config(over) {
  let saved = {};
  try { saved = (JSON.parse(fs.readFileSync(SETTINGS, "utf8")).ai) || {}; } catch (e) { /* no file yet */ }
  const c = { ...saved, ...(over || {}) };
  return { url: clean(c.url), model: String(c.model || "").trim(), transcribeUrl: clean(c.transcribeUrl), key: String((over && over.key) || secret("ai.key") || "") };
}

const enabled = () => !!config().url;
const voiceEnabled = () => !!config().transcribeUrl;

function check(url, what) {
  if (!url) throw new AiError(`${what} isn't set up — add its address in phone setup`, 400);
  if (!/^https?:\/\/[^/\s]+/i.test(url)) throw new AiError(`The ${what} address should look like https://llama-cpp.example`, 400);
}

async function call(base, route, init, timeoutMs, key, what) {
  let res;
  try {
    res = await fetch(`${base}${route}`, { ...init, headers: { Accept: "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}), ...(init.headers || {}) }, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    throw new AiError(e && e.name === "TimeoutError" ? `${what} took too long to answer` : `Can't reach ${what}. Is it on, and is the address right?`, 502);
  }
  if (res.status === 401 || res.status === 403) throw new AiError(`${what} refused the key — check it in phone setup`, 401);
  if (res.status === 400) throw new AiError(`${what} didn't accept that request${await detail(res)}`, 400);
  if (!res.ok) throw new AiError(`${what} had a problem (HTTP ${res.status})`, 502);
  try { return await res.json(); } catch (e) { throw new AiError(`That address didn't answer like ${what} — is it the right one?`, 502); }
}
async function detail(res) { try { const d = await res.json(); const m = d && (d.error && (d.error.message || d.error)) || d.message; return m ? ` (${String(m).slice(0, 120)})` : ""; } catch (e) { return ""; } }

/** Check an address: lists the model and whether it can look at photos. Returns { model, vision }. */
async function connect(over) {
  const c = config(over);
  check(c.url, "The AI helper");
  const d = await call(c.url, "/v1/models", { method: "GET" }, 10000, c.key, "the AI helper");
  const m = (d && d.data && d.data[0]) || null;
  if (!m) throw new AiError("The AI helper has no model loaded", 502);
  const modes = (m.architecture && m.architecture.input_modalities) || [];
  return { model: c.model || m.id, vision: modes.includes("image") };
}

/** Is something answering at the speech helper's address? (Servers differ in what they expose, so any answer counts.) */
async function reachable(over) {
  const c = config(over);
  check(c.transcribeUrl, "The speech helper");
  try { await fetch(`${c.transcribeUrl}/`, { headers: c.key ? { Authorization: `Bearer ${c.key}` } : {}, signal: AbortSignal.timeout(8000) }); }
  catch (e) { throw new AiError("Can't reach the speech helper. Is it on, and is the address right?", 502); }
  return true;
}

/** Ask for JSON that fits `schema`. `content` is a string or an OpenAI content array (text + image_url parts). Returns the parsed object. */
async function askJson(system, content, schema, opt = {}) {
  const c = config();
  check(c.url, "The AI helper");
  const body = {
    ...(c.model ? { model: c.model } : {}),
    messages: [{ role: "system", content: system }, { role: "user", content }],
    temperature: 0.1,
    max_tokens: opt.maxTokens || 1200,
    response_format: { type: "json_schema", json_schema: { name: "answer", strict: true, schema } },
    chat_template_kwargs: { enable_thinking: false }     // short extraction: no thinking pass
  };
  const d = await call(c.url, "/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, opt.timeoutMs || 90000, c.key, "the AI helper");
  let text = d && d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content;
  if (typeof text !== "string") throw new AiError("The AI helper sent back nothing", 502);
  text = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  try { return JSON.parse(text); } catch (e) { throw new AiError("The AI helper's answer wasn't usable — try again", 502); }
}

// llama.cpp's Qwen3-ASR puts "language English<asr_text>" in front of the sentence
const tidyTranscript = (t) => String(t || "").replace(/^\s*language\s+\S+\s*<asr_text>/i, "").replace(/<\/?asr_text>/gi, "").trim();

/** Audio (a Buffer) → text, through an OpenAI-style /v1/audio/transcriptions server. Empty string when nothing was said. */
async function transcribe(audio, mime = "audio/wav") {
  const c = config();
  check(c.transcribeUrl, "The speech helper");
  if (!audio || !audio.length) throw new AiError("No sound was recorded", 400);
  if (audio.length > 8 * 1024 * 1024) throw new AiError("That recording is too long — keep it to a sentence", 413);
  const ext = /webm/.test(mime) ? "webm" : /ogg/.test(mime) ? "ogg" : /mp4|m4a|aac/.test(mime) ? "m4a" : "wav";
  const form = new FormData();
  form.append("file", new Blob([audio], { type: mime }), `clip.${ext}`);
  form.append("model", "whisper-1");
  form.append("response_format", "json");           // the only format llama.cpp's ASR server accepts
  const d = await call(c.transcribeUrl, "/v1/audio/transcriptions", { method: "POST", body: form }, 30000, c.key, "the speech helper");
  return tidyTranscript(d && d.text);
}

module.exports = { config, enabled, voiceEnabled, connect, reachable, askJson, transcribe, tidyTranscript, AiError };
