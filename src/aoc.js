// Advent of Code private leaderboard data.
//
// AoC asks automated tools to fetch a private leaderboard's JSON at most once every 15 minutes and to send a
// User-Agent that says who they are. Every board is cached per (year, board, session), each request answers
// from that cache, and a new fetch starts only when the last *attempt* (successful or not) is old enough.

const crypto = require('crypto');

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_FETCH_MS = 15 * 60 * 1000; // AoC's limit while the event runs
const IDLE_FETCH_MS = 3 * 60 * 60 * 1000; // outside December nothing changes much
const TIMEOUT_MS = 6000; // TRMNL gives the markup endpoint 10 s in total
const BASE = 'https://adventofcode.com';
const USER_AGENT =
  process.env.AOC_USER_AGENT || 'trmnl-adventofcode/1.0 (TRMNL e-ink plugin; private leaderboard, <=1 req/15 min)';

class AocError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code; // 'auth' | 'not_found' | 'http' | 'network'
  }
}

// From 2025 on, Advent of Code has 12 puzzles instead of 25.
function defaultDays(year) {
  return year >= 2025 ? 12 : 25;
}

// Puzzles unlock at midnight US Eastern (UTC-5), which is 05:00 UTC.
function unlockTime(year, day) {
  return Date.UTC(year, 11, day, 5);
}

// The event a screen should be about: November already looks ahead to this December, Jan-Oct look back.
function currentEventYear(now = Date.now()) {
  const d = new Date(now);
  return d.getUTCMonth() >= 10 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
}

// Where the event stands: 'before' the first puzzle, 'running' while puzzles unlock and for the 24 hours of the last
// puzzle day (then nextDay/nextUnlock are null and `last` is true), 'final' once the last day is over.
function timing(year, now = Date.now(), days = defaultDays(year)) {
  const start = unlockTime(year, 1);
  if (now < start) return { phase: 'before', today: 0, nextDay: 1, nextUnlock: start, last: false };
  const today = Math.min(days, Math.floor((now - start) / DAY_MS) + 1);
  if (today < days) return { phase: 'running', today, nextDay: today + 1, nextUnlock: unlockTime(year, today + 1), last: false };
  if (now < unlockTime(year, days) + DAY_MS) return { phase: 'running', today, nextDay: null, nextUnlock: null, last: true };
  return { phase: 'final', today, nextDay: null, nextUnlock: null, last: false };
}

// Accepts "1234567", "1234567-abcdef12" (the join code) or the leaderboard URL.
function parseBoardId(input) {
  const s = String(input || '').trim();
  const m = s.match(/private\/view\/(\d+)/) || s.match(/^(\d+)(?:-[0-9a-f]+)?$/i);
  return m ? m[1] : null;
}

// Accepts the bare cookie value or "session=<value>"; AoC sessions are long hex strings.
function parseSession(input) {
  const s = String(input || '').trim().replace(/^session=/, '').replace(/;.*$/, '');
  return /^[0-9a-f]{64,256}$/i.test(s) ? s : null;
}

// Turns the leaderboard JSON into ranked members. Throws on anything that is not a leaderboard.
function parseLeaderboard(payload, year) {
  if (!payload || typeof payload.members !== 'object' || payload.members === null) {
    throw new AocError('http', 'response is not a leaderboard');
  }
  const days = Number(payload.num_days) > 0 ? Number(payload.num_days) : defaultDays(year);

  const members = Object.values(payload.members).map((m) => {
    const cdl = m.completion_day_level || {};
    const perDay = [];
    const solvedAt = []; // second-star timestamp per day, ms
    for (let d = 1; d <= days; d++) {
      const lvl = cdl[d] || cdl[String(d)] || {};
      perDay.push(lvl['2'] ? 2 : lvl['1'] ? 1 : 0);
      solvedAt.push(lvl['2'] ? Number(lvl['2'].get_star_ts) * 1000 : null);
    }
    const counted = perDay.reduce((a, b) => a + b, 0);
    return {
      id: String(m.id),
      name: m.name ? String(m.name) : `anonymous #${m.id}`,
      score: Number(m.local_score) || 0,
      stars: Number.isFinite(Number(m.stars)) ? Number(m.stars) : counted,
      lastStar: Number(m.last_star_ts) * 1000 || 0,
      perDay,
      solvedAt,
    };
  });

  const hasScores = members.some((m) => m.score > 0);
  members.sort(
    (a, b) =>
      (hasScores ? b.score - a.score : 0) ||
      b.stars - a.stars ||
      (a.lastStar || Infinity) - (b.lastStar || Infinity) ||
      a.name.localeCompare(b.name),
  );
  members.forEach((m, i) => (m.rank = i + 1));

  return {
    year: Number(payload.event) || year,
    ownerId: payload.owner_id != null ? String(payload.owner_id) : null,
    days,
    hasScores,
    members,
  };
}

// Who finished a given day, fastest first.
function daySolvers(board, day) {
  return board.members
    .filter((m) => m.perDay[day - 1] === 2 && m.solvedAt[day - 1])
    .sort((a, b) => a.solvedAt[day - 1] - b.solvedAt[day - 1]);
}

async function fetchLeaderboard({ year, boardId, session }) {
  let res;
  try {
    res = await fetch(`${BASE}/${year}/leaderboard/private/view/${boardId}.json`, {
      headers: { Cookie: `session=${session}`, 'User-Agent': USER_AGENT, Accept: 'application/json' },
      redirect: 'manual', // a logged-out request is redirected to an HTML page
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new AocError('network', err.message);
  }
  if (res.status === 404) throw new AocError('not_found', 'leaderboard not found');
  if ((res.status >= 300 && res.status < 400) || [400, 401, 403].includes(res.status)) {
    throw new AocError('auth', `HTTP ${res.status}`);
  }
  if (!res.ok) throw new AocError('http', `HTTP ${res.status}`);
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new AocError('auth', 'got HTML instead of JSON'); // AoC serves a page when the session is invalid
  }
  return parseLeaderboard(json, year);
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

// key -> { data, fetchedAt, attemptedAt, error, inflight }. Least recently used first; bounded so that boards of
// uninstalled users or changed settings do not pile up for the life of the process.
const boards = new Map();
const MAX_BOARDS = 500;

function boardKey({ year, boardId, session }) {
  const h = crypto.createHash('sha256').update(String(session)).digest('hex').slice(0, 16);
  return `${year}:${boardId}:${h}`;
}

function minInterval(year, now) {
  return timing(year, now).phase === 'running' || new Date(now).getUTCMonth() === 11 ? MIN_FETCH_MS : IDLE_FETCH_MS;
}

// A blip (network/http) with nothing to show is retried after AoC's 15 minutes, not after the 3 idle hours.
// A rejected session or a missing board will not fix itself, so those wait the normal interval.
function retryInterval(e, year, now) {
  if (!e.data && (e.error === 'network' || e.error === 'http')) return MIN_FETCH_MS;
  return minInterval(year, now);
}

// Returns { data, fetchedAt, error }. Waits for the network only when nothing is cached yet.
async function getBoard(cfg, { now = Date.now(), fetcher = fetchLeaderboard } = {}) {
  const key = boardKey(cfg);
  let e = boards.get(key);
  if (e) boards.delete(key); // re-inserted below: most recently used last
  else e = { data: null, fetchedAt: 0, attemptedAt: 0, error: null, inflight: null };
  boards.set(key, e);
  while (boards.size > MAX_BOARDS) boards.delete(boards.keys().next().value);

  if (!e.inflight && now - e.attemptedAt >= retryInterval(e, cfg.year, now)) {
    e.attemptedAt = now;
    e.inflight = fetcher(cfg)
      .then((data) => {
        e.data = data;
        e.fetchedAt = Date.now();
        e.error = null;
      })
      .catch((err) => {
        e.error = err.code || 'network';
        console.error(`AoC fetch ${cfg.year} failed: ${err.message}`);
      })
      .finally(() => {
        e.inflight = null;
      });
  }
  if (!e.data && e.inflight) await e.inflight;
  return { data: e.data, fetchedAt: e.fetchedAt, error: e.error };
}

function cacheSize() {
  return boards.size;
}

function clearCache() {
  boards.clear();
  titles.clear();
}

// ---------------------------------------------------------------------------
// Puzzle titles (public page, fetched once per day and kept)
// ---------------------------------------------------------------------------

const titles = new Map(); // "year-day" -> { title, at, inflight }

function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function parseTitle(html) {
  const m = String(html).match(/<h2[^>]*>--- Day \d+: (.+?) ---<\/h2>/);
  return m ? decodeEntities(m[1]) : null;
}

// Non-blocking: returns the title if known and starts a fetch otherwise, so the next refresh has it.
function puzzleTitle(year, day, now = Date.now()) {
  if (!day || now < unlockTime(year, day)) return null;
  const key = `${year}-${day}`;
  let t = titles.get(key);
  if (!t) titles.set(key, (t = { title: null, at: 0, inflight: null }));
  if (!t.title && !t.inflight && now - t.at > 60 * 60 * 1000) {
    t.at = now;
    t.inflight = fetch(`${BASE}/${year}/day/${day}`, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
      .then((r) => (r.ok ? r.text() : ''))
      .then((html) => {
        t.title = parseTitle(html);
      })
      .catch(() => {})
      .finally(() => {
        t.inflight = null;
      });
  }
  return t.title;
}

module.exports = {
  AocError,
  DAY_MS,
  MIN_FETCH_MS,
  MAX_BOARDS,
  defaultDays,
  unlockTime,
  currentEventYear,
  timing,
  parseBoardId,
  parseSession,
  parseLeaderboard,
  daySolvers,
  fetchLeaderboard,
  getBoard,
  boardKey,
  cacheSize,
  clearCache,
  parseTitle,
  puzzleTitle,
};
