// A stand-in for NYT's Connections and Strands JSON (nytimes.com/svc/<game>/v2/<date>.json) and quartileswordgame.com's
// /api/daily, for the Games tests.
// create(port) → Promise<{ server, state, url, close }>; state.up = false answers 503 (NYT down); state.hits counts requests.
const http = require("http");

// Connections: 4 groups of 4, `position` = where each card starts on the board
const GROUPS = [
  ["FRUITS", ["APPLE", "PEAR", "PLUM", "FIG"]],
  ["PLANETS", ["MARS", "VENUS", "EARTH", "SATURN"]],
  ["SOUND-ALIKES", ["BEAR", "BARE", "BEER", "BIER"]],
  ["STARTS WITH SUN", ["SUNDAY", "SUNSET", "SUNRISE", "SUNBURN"]]
];
const POSITIONS = [5, 0, 11, 14, 3, 9, 12, 15, 10, 7, 8, 2, 13, 6, 4, 1];   // a fixed "shuffle"
const connections = () => ({
  status: "OK", id: 9001, print_date: "x", stream: "daily",
  categories: GROUPS.map(([title, words], g) => ({ title, cards: words.map((w, i) => ({ content: w, position: POSITIONS[g * 4 + i] })) }))
});

// Strands: spangram PANCAKES down column 0; one 5-letter theme word in columns 1-5 of every row
const SPAN = "PANCAKES", ROWWORDS = ["BACON", "TOAST", "SYRUP", "BAGEL", "CREPE", "BERRY", "HONEY", "CREAM"];
const strands = () => ({
  status: "OK", id: 8001, printDate: "x", clue: "Morning meal", spangram: SPAN,
  themeWords: ROWWORDS,
  startingBoard: ROWWORDS.map((w, r) => SPAN[r] + w),
  themeCoords: Object.fromEntries(ROWWORDS.map((w, r) => [w, [1, 2, 3, 4, 5].map((c) => [r, c])])),
  spangramCoords: SPAN.split("").map((_, r) => [r, 0]),
  solutions: ["CAKE", "EAST", "ACRE", "TOAST", "PANE", "SPAN"]
});

// Quartiles (quartileswordgame.com/api/daily): 20 tiles in word order, five hidden four-tile words, and every word the tiles make
const QT_TILES = ["wa", "ter", "me", "lon", "ba", "sk", "et", "ball", "cho", "co", "la", "tes", "fi", "re", "wo", "rks", "ra", "in", "bo", "ws"];
const QT_TARGETS = ["WATERMELON", "BASKETBALL", "CHOCOLATES", "FIREWORKS", "RAINBOWS"];
const quartiles = () => ({
  id: "daily-4242", levelNumber: "4242", targetWords: QT_TARGETS, wordSegments: QT_TILES,
  fourSegmentWords: QT_TARGETS.map((w) => w.toLowerCase()),
  threeSegmentWords: ["basket"], twoSegmentWords: ["water", "cola", "fire", "rain", "bask", "melon"], oneSegmentWords: ["ball"],
  maxScore: 125, theme: "Fun", themeDisplay: "Fun", date: "x", puzzleNumber: 4242, seed: 4242
});

function create(port = 0) {
  const state = { up: true, hits: 0 };
  const server = http.createServer((req, res) => {
    state.hits++;
    if (!state.up) { res.writeHead(503); return res.end(); }
    if (/^\/api\/daily\?date=\d{4}-\d{2}-\d{2}$/.test(req.url)) { res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify(quartiles())); }
    const m = /^\/svc\/(connections|strands)\/v2\/\d{4}-\d{2}-\d{2}\.json$/.exec(req.url);
    if (!m) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(m[1] === "connections" ? connections() : strands()));
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => {
    const p = server.address().port;
    resolve({ server, state, url: `http://127.0.0.1:${p}/svc`, close: () => server.close() });
  }));
}
module.exports = { create, GROUPS, POSITIONS, SPAN, ROWWORDS, QT_TILES, QT_TARGETS };
