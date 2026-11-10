/* OpenSky countdown photos (server side) — one picture per countdown, kept on the Pi in a "countdown-photos" folder next to
 * opensky.json (OPENSKY_COUNTDOWN_PHOTOS = another folder, for tests). The countdowns themselves (title, date…) are
 * in opensky.json → countdowns; a countdown with `photo: true` has a file here named after its id.
 *
 * save(id, bytes) · copyFrom(id, file) (a photo from the photo library) · remove(id) · read(id) → { type, body } | null
 * Ids are lowercase letters and digits only (made by phone setup), so an id can never point outside the folder.
 */
const fs = require("fs");
const path = require("path");

const MM_ROOT = global.root_path || process.cwd();
const SETTINGS = process.env.OPENSKY_SETTINGS || path.join(MM_ROOT, "config", "opensky.json");
const DIR = () => process.env.OPENSKY_COUNTDOWN_PHOTOS || path.join(path.dirname(SETTINGS), "countdown-photos");
const MAX_BYTES = 6 * 1024 * 1024;       // an upload (the phone page shrinks it first)
const MAX_LIBRARY = 40 * 1024 * 1024;    // a library photo is copied as it is
const ID_RE = /^[a-z0-9]{4,24}$/;
const fail = (m, status) => Object.assign(new Error(m), { status });

function typeOf(b) {
  if (b[0] === 0xff && b[1] === 0xd8) return ["jpg", "image/jpeg"];
  if (b.length > 8 && b.toString("ascii", 1, 4) === "PNG") return ["png", "image/png"];
  if (b.length > 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") return ["webp", "image/webp"];
  return null;
}
const files = (id) => ["jpg", "png", "webp"].map((e) => path.join(DIR(), `${id}.${e}`));

function remove(id) {
  if (!ID_RE.test(String(id))) return;
  for (const f of files(id)) { try { fs.unlinkSync(f); } catch (e) { /* not there */ } }
}

function save(id, body, max = MAX_BYTES) {
  if (!ID_RE.test(String(id))) throw fail("That countdown has no photo slot yet", 400);
  if (!Buffer.isBuffer(body) || !body.length) throw fail("Please choose a photo first", 400);
  if (body.length > max) throw fail(`That photo is too big (${Math.round(max / 1048576)} MB at most)`, 413);
  const t = typeOf(body);
  if (!t) throw fail("That isn't a photo OpenSky can show (JPEG, PNG or WebP)", 400);
  fs.mkdirSync(DIR(), { recursive: true });
  remove(id);
  const f = path.join(DIR(), `${id}.${t[0]}`);
  fs.writeFileSync(`${f}.tmp`, body);
  fs.renameSync(`${f}.tmp`, f);
}

/** A photo from the photo library (the path photos.findInFolder gave us) */
function copyFrom(id, file) {
  save(id, fs.readFileSync(file), MAX_LIBRARY);
}

function read(id) {
  if (!ID_RE.test(String(id))) return null;
  for (const f of files(id)) {
    try { const body = fs.readFileSync(f); return { type: typeOf(body)[1], body }; } catch (e) { /* next */ }
  }
  return null;
}

module.exports = { save, copyFrom, remove, read, MAX_BYTES, ID_RE };
