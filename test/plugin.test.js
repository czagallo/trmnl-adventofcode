const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const aoc = require('../src/aoc');
const { buildView } = require('../src/view');
const { renderAll, esc, countdown } = require('../src/markup');
const { createStore } = require('../src/store');
const { samplePayload } = require('./fixtures/sample');

const H = 3600e3;
const CFG = { session: 'ab'.repeat(48), boardId: '1003', year: 'auto' };
const boardFrom = (payload) => async (cfg) => ({ data: aoc.parseLeaderboard(payload, cfg.year), fetchedAt: 1, error: null });

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------

test('puzzles unlock at 05:00 UTC, 12 days from 2025 on and 25 before', () => {
  assert.equal(new Date(aoc.unlockTime(2026, 1)).toISOString(), '2026-12-01T05:00:00.000Z');
  assert.equal(aoc.defaultDays(2024), 25);
  assert.equal(aoc.defaultDays(2025), 12);
});

test('timing walks through before, running and final', () => {
  const before = aoc.timing(2026, Date.UTC(2026, 11, 1, 4, 59));
  assert.deepEqual([before.phase, before.today, before.nextDay], ['before', 0, 1]);

  const d1 = aoc.timing(2026, Date.UTC(2026, 11, 1, 5, 0));
  assert.deepEqual([d1.phase, d1.today, d1.nextDay], ['running', 1, 2]);
  assert.equal(d1.nextUnlock, Date.UTC(2026, 11, 2, 5));

  const d7 = aoc.timing(2026, Date.UTC(2026, 11, 8, 4, 0));
  assert.equal(d7.today, 7);

  const last = aoc.timing(2026, Date.UTC(2026, 11, 12, 5, 0));
  assert.deepEqual([last.phase, last.today, last.last, last.nextDay, last.nextUnlock], ['running', 12, true, null, null]);
  assert.equal(aoc.timing(2026, Date.UTC(2026, 11, 13, 4, 59)).phase, 'running');

  const fin = aoc.timing(2026, Date.UTC(2026, 11, 13, 5, 0));
  assert.deepEqual([fin.phase, fin.today, fin.nextUnlock, fin.last], ['final', 12, null, false]);
  assert.equal(aoc.timing(2024, Date.UTC(2024, 11, 25, 12), 25).last, true);
  assert.equal(aoc.timing(2024, Date.UTC(2024, 11, 20, 12), 25).phase, 'running');
});

test('current event year looks ahead in November and back until October', () => {
  assert.equal(aoc.currentEventYear(Date.UTC(2026, 10, 19)), 2026);
  assert.equal(aoc.currentEventYear(Date.UTC(2026, 11, 3)), 2026);
  assert.equal(aoc.currentEventYear(Date.UTC(2027, 0, 5)), 2026);
  assert.equal(aoc.currentEventYear(Date.UTC(2027, 9, 31)), 2026);
});

// ---------------------------------------------------------------------------
// Input parsing
// ---------------------------------------------------------------------------

test('leaderboard IDs come from numbers, join codes and URLs', () => {
  assert.equal(aoc.parseBoardId('1234567'), '1234567');
  assert.equal(aoc.parseBoardId(' 1234567-1a2b3c4d '), '1234567');
  assert.equal(aoc.parseBoardId('https://adventofcode.com/2025/leaderboard/private/view/1234567'), '1234567');
  assert.equal(aoc.parseBoardId('https://adventofcode.com/2025/leaderboard/private/view/1234567.json'), '1234567');
  assert.equal(aoc.parseBoardId('abc'), null);
  assert.equal(aoc.parseBoardId(''), null);
});

test('session cookies are accepted bare or as session=..., anything else is rejected', () => {
  const hex = '53616c7465645f5f'.repeat(8);
  assert.equal(aoc.parseSession(hex), hex);
  assert.equal(aoc.parseSession(`session=${hex}; Path=/`), hex);
  assert.equal(aoc.parseSession('not-a-cookie'), null);
  assert.equal(aoc.parseSession('abc123'), null);
});

// ---------------------------------------------------------------------------
// Leaderboard
// ---------------------------------------------------------------------------

test('parseLeaderboard ranks by score, then stars, then who got there first', () => {
  const b = aoc.parseLeaderboard(samplePayload({ year: 2026, solvedDays: 7 }), 2026);
  assert.equal(b.days, 12);
  assert.equal(b.ownerId, '1003');
  assert.equal(b.members.length, 13);
  for (let i = 1; i < b.members.length; i++) assert.ok(b.members[i - 1].score >= b.members[i].score);
  assert.deepEqual(b.members.map((m) => m.rank), b.members.map((_, i) => i + 1));
  const anon = b.members.find((m) => m.id === '1003');
  assert.equal(anon.name, 'anonymous #1003');
  assert.equal(anon.perDay.length, 12);
  assert.equal(anon.perDay.reduce((a, c) => a + c, 0), anon.stars);
});

test('parseLeaderboard falls back to stars when a board has no scores', () => {
  const p = samplePayload({ year: 2026, solvedDays: 3 });
  for (const m of Object.values(p.members)) m.local_score = 0;
  const b = aoc.parseLeaderboard(p, 2026);
  assert.equal(b.hasScores, false);
  for (let i = 1; i < b.members.length; i++) assert.ok(b.members[i - 1].stars >= b.members[i].stars);
});

test('parseLeaderboard rejects things that are not leaderboards', () => {
  assert.throws(() => aoc.parseLeaderboard(null, 2026));
  assert.throws(() => aoc.parseLeaderboard({ event: '2026' }, 2026));
});

test('puzzle titles are read from the day page', () => {
  assert.equal(aoc.parseTitle('<article><h2>--- Day 7: Laboratories &amp; Lasers ---</h2>'), 'Laboratories & Lasers');
  assert.equal(aoc.parseTitle('<h2>nope</h2>'), null);
});

// ---------------------------------------------------------------------------
// Cache and rate limit
// ---------------------------------------------------------------------------

test('getBoard fetches at most once per 15 minutes per board, even when fetches fail', async () => {
  aoc.clearCache();
  const now = Date.UTC(2026, 11, 7, 12);
  let calls = 0;
  const ok = async () => {
    calls++;
    return aoc.parseLeaderboard(samplePayload(), 2026);
  };
  const cfg = { ...CFG, year: 2026 };
  await aoc.getBoard(cfg, { now, fetcher: ok });
  await aoc.getBoard(cfg, { now: now + 14 * 60e3, fetcher: ok });
  assert.equal(calls, 1);
  await aoc.getBoard(cfg, { now: now + 15 * 60e3, fetcher: ok });
  await new Promise((r) => setImmediate(r));
  assert.equal(calls, 2);

  aoc.clearCache();
  let failing = 0;
  const bad = async () => {
    failing++;
    throw new aoc.AocError('network', 'down');
  };
  const r = await aoc.getBoard(cfg, { now, fetcher: bad });
  assert.equal(r.data, null);
  assert.equal(r.error, 'network');
  await aoc.getBoard(cfg, { now: now + 60e3, fetcher: bad });
  assert.equal(failing, 1);
});

test('a failed first fetch is retried after 15 minutes, even outside December; auth errors wait the full interval', async () => {
  const now = Date.UTC(2026, 6, 1, 12); // July: the idle interval is 3 hours
  const cfg = { ...CFG, year: 2025 };
  for (const [code, retryAfter] of [['network', 15], ['http', 15], ['auth', 180], ['not_found', 180]]) {
    aoc.clearCache();
    let calls = 0;
    const bad = async () => {
      calls++;
      throw new aoc.AocError(code, 'down');
    };
    await aoc.getBoard(cfg, { now, fetcher: bad });
    await aoc.getBoard(cfg, { now: now + (retryAfter - 1) * 60e3, fetcher: bad });
    await new Promise((r) => setImmediate(r));
    assert.equal(calls, 1, `${code}: no retry before ${retryAfter} min`);
    await aoc.getBoard(cfg, { now: now + retryAfter * 60e3, fetcher: bad });
    await new Promise((r) => setImmediate(r));
    assert.equal(calls, 2, `${code}: retried after ${retryAfter} min`);
  }
});

test('a failed refresh with data cached waits the normal interval', async () => {
  aoc.clearCache();
  const now = Date.UTC(2026, 6, 1, 12);
  const cfg = { ...CFG, year: 2025 };
  let calls = 0;
  await aoc.getBoard(cfg, { now, fetcher: async () => aoc.parseLeaderboard(samplePayload({ year: 2025 }), 2025) });
  const bad = async () => {
    calls++;
    throw new aoc.AocError('network', 'down');
  };
  await aoc.getBoard(cfg, { now: now + 3 * H, fetcher: bad });
  await new Promise((r) => setImmediate(r));
  await aoc.getBoard(cfg, { now: now + 3 * H + 30 * 60e3, fetcher: bad });
  await new Promise((r) => setImmediate(r));
  assert.equal(calls, 1);
});

test('the board cache is bounded and drops the least recently used board first', async () => {
  aoc.clearCache();
  const now = Date.UTC(2026, 11, 7, 12);
  const fetcher = async (c) => aoc.parseLeaderboard(samplePayload(), c.year);
  const cfg = (i) => ({ ...CFG, year: 2026, boardId: String(i) });
  await aoc.getBoard(cfg(0), { now, fetcher });
  for (let i = 1; i < aoc.MAX_BOARDS; i++) await aoc.getBoard(cfg(i), { now, fetcher });
  await aoc.getBoard(cfg(0), { now, fetcher }); // touch the oldest: it becomes the newest
  await aoc.getBoard(cfg(aoc.MAX_BOARDS), { now, fetcher });
  assert.equal(aoc.cacheSize(), aoc.MAX_BOARDS);
  let refetched = 0;
  await aoc.getBoard(cfg(0), { now, fetcher: async () => (refetched++, fetcher(cfg(0))) });
  assert.equal(refetched, 0, 'recently used board was kept');
  await aoc.getBoard(cfg(1), { now, fetcher: async () => (refetched++, fetcher(cfg(1))) });
  assert.equal(refetched, 1, 'least recently used board was evicted');
  aoc.clearCache();
});

test('getBoard keeps serving the last good data when a refresh fails', async () => {
  aoc.clearCache();
  const now = Date.UTC(2026, 11, 7, 12);
  const cfg = { ...CFG, year: 2026 };
  await aoc.getBoard(cfg, { now, fetcher: async () => aoc.parseLeaderboard(samplePayload(), 2026) });
  await aoc.getBoard(cfg, { now: now + 16 * 60e3, fetcher: async () => { throw new aoc.AocError('auth'); } });
  await new Promise((r) => setImmediate(r));
  const r = await aoc.getBoard(cfg, { now: now + 17 * 60e3, fetcher: async () => assert.fail('should not fetch') });
  assert.ok(r.data);
  assert.equal(r.error, 'auth');
});

test('different sessions do not share a cached board', () => {
  assert.notEqual(aoc.boardKey({ ...CFG, year: 2026 }), aoc.boardKey({ ...CFG, year: 2026, session: 'cd'.repeat(48) }));
});

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

test('view without settings asks for setup', async () => {
  assert.equal((await buildView(null)).state, 'setup');
  assert.equal((await buildView({ boardId: '1' })).state, 'setup');
});

test('before Day 1 an automatic year shows last year\'s board with a countdown', async () => {
  let asked;
  const v = await buildView(CFG, {
    now: Date.UTC(2026, 10, 19, 9),
    getBoard: async (cfg) => {
      asked = cfg.year;
      return { data: aoc.parseLeaderboard(samplePayload({ year: 2025, solvedDays: 12 }), 2025), fetchedAt: 1, error: null };
    },
    puzzleTitle: () => null,
  });
  assert.equal(asked, 2025);
  assert.equal(v.year, 2026);
  assert.equal(v.timing.phase, 'before');
  assert.equal(v.today, null);
  assert.equal(v.me.id, '1003'); // defaults to the owner
});

test('during the event the view knows today\'s day, title and fastest finisher', async () => {
  const v = await buildView({ ...CFG, memberId: '1000' }, {
    now: Date.UTC(2026, 11, 7, 14),
    getBoard: boardFrom(samplePayload({ year: 2026, solvedDays: 7 })),
    puzzleTitle: (y, d) => `Title ${d}`,
  });
  assert.equal(v.timing.today, 7);
  assert.equal(v.today.title, 'Title 7');
  assert.ok(v.today.finished > 0);
  assert.ok(v.today.first.name);
  assert.equal(v.me.id, '1000');
});

test('a missing board before the event still shows the countdown; other errors show a message', async () => {
  const missing = async () => ({ data: null, fetchedAt: 0, error: 'not_found' });
  const pre = await buildView({ ...CFG, year: '2026' }, { now: Date.UTC(2026, 10, 19), getBoard: missing });
  assert.equal(pre.state, 'ok');
  assert.equal(pre.board, null);
  const auth = await buildView(CFG, { now: Date.UTC(2026, 11, 7), getBoard: async () => ({ data: null, error: 'auth' }) });
  assert.deepEqual([auth.state, auth.error], ['error', 'auth']);
});

// ---------------------------------------------------------------------------
// Markup
// ---------------------------------------------------------------------------

const LAYOUT_KEYS = ['markup', 'markup_half_horizontal', 'markup_half_vertical', 'markup_quadrant'];
const VIEW_CLASS = { markup: 'view--full', markup_half_horizontal: 'view--half_horizontal', markup_half_vertical: 'view--half_vertical', markup_quadrant: 'view--quadrant' };

async function views() {
  const run = (now, payload, cfg = CFG) => buildView(cfg, { now, getBoard: boardFrom(payload), puzzleTitle: () => '{{ evil }} {% raw %}' });
  return [
    ['running', await run(Date.UTC(2026, 11, 7, 14), samplePayload({ year: 2026, solvedDays: 7 }))],
    ['before', await run(Date.UTC(2026, 10, 19), samplePayload({ year: 2025, solvedDays: 12 }))],
    ['final', await run(Date.UTC(2026, 11, 20), samplePayload({ year: 2026, solvedDays: 12 }))],
    ['25 days', await run(Date.UTC(2026, 11, 7), samplePayload({ year: 2024, days: 25, solvedDays: 25 }), { ...CFG, year: '2024' })],
    ['setup', { state: 'setup' }],
    ['error', { state: 'error', error: 'auth' }],
    ['null', null],
  ];
}

test('renderAll returns every layout, Liquid-safe and without hex colors', async () => {
  for (const [name, v] of await views()) {
    const out = renderAll(v, { baseUrl: 'https://x.example', timeZone: 'Europe/Vienna', now: Date.UTC(2026, 11, 7, 14) });
    assert.deepEqual(Object.keys(out).sort(), [...LAYOUT_KEYS].sort(), name);
    for (const k of LAYOUT_KEYS) {
      assert.match(out[k], new RegExp(VIEW_CLASS[k]), `${name} ${k}`);
      assert.match(out[k], /class="title_bar"/, `${name} ${k}`);
      assert.doesNotMatch(out[k], /\{\{|\{%/, `${name} ${k} contains Liquid delimiters`);
      assert.doesNotMatch(out[k], /(?:color|fill|stroke|background)\s*[:=]\s*"?\s*#[0-9a-f]{3}/i, `${name} ${k} contains a hex color`);
    }
  }
});

test('member names are escaped, including Liquid braces', async () => {
  const p = samplePayload({ year: 2026, solvedDays: 7 });
  p.members[1000].name = '<script>{{ x }}</script>';
  const v = await buildView(CFG, { now: Date.UTC(2026, 11, 7, 14), getBoard: boardFrom(p), puzzleTitle: () => null });
  const out = renderAll(v, { baseUrl: 'https://x.example' });
  assert.doesNotMatch(out.markup, /<script>/);
  assert.match(out.markup, /&lt;script&gt;&#123;&#123; x &#125;&#125;/);
  assert.equal(esc('{%'), '&#123;%');
});

test('the user is shown even when ranked below the visible rows', async () => {
  const v = await buildView({ ...CFG, memberId: '1012' }, {
    now: Date.UTC(2026, 11, 7, 14),
    getBoard: boardFrom(samplePayload({ year: 2026, solvedDays: 7 })),
    puzzleTitle: () => null,
  });
  assert.ok(v.me.rank > 10);
  const out = renderAll(v, { baseUrl: 'https://x.example' });
  assert.match(out.markup, />dmr</);
  assert.match(out.markup_half_horizontal, />dmr</);
});

// The visible text of a markup string, tags removed and whitespace collapsed.
const text = (html) => html.replace(/<style[^>]*>.*?<\/style>/gs, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');

test('the Day 1 unlock is shown on the user\'s local date and time', async () => {
  const now = Date.UTC(2026, 10, 21, 12);
  const v = await buildView(CFG, { now, getBoard: boardFrom(samplePayload({ year: 2025, solvedDays: 12 })), puzzleTitle: () => null });
  const at = (timeZone) => text(renderAll(v, { baseUrl: 'https://x.example', timeZone, now }).markup);
  assert.match(at('Europe/Vienna'), /Day 1: 1 Dec, 06:00/);
  assert.match(at('America/New_York'), /Day 1: 1 Dec, 00:00/);
  assert.match(at('America/Chicago'), /Day 1: 30 Nov, 23:00/);
  assert.match(at('America/Los_Angeles'), /Day 1: 30 Nov, 21:00/);
  assert.match(at('Pacific/Honolulu'), /Day 1: 30 Nov, 19:00/);
  assert.match(at('Not/AZone'), /Day 1: 1 Dec, 05:00/);
  // the evening before, the unlock is "today" for the Americas and "tomorrow" east of UTC-5
  const eve = Date.UTC(2026, 10, 30, 22); // 14:00 in Los Angeles, 23:00 in Vienna
  assert.match(text(renderAll(v, { baseUrl: 'https://x.example', timeZone: 'America/Los_Angeles', now: eve }).markup), /Day 1: today 21:00/);
  assert.match(text(renderAll(v, { baseUrl: 'https://x.example', timeZone: 'Europe/Vienna', now: eve }).markup), /Day 1: tomorrow 06:00/);
});

test('the next unlock during the event says which local day it falls on', async () => {
  const now = Date.UTC(2026, 11, 7, 14); // next unlock: Dec 8, 05:00 UTC
  const v = await buildView(CFG, { now, getBoard: boardFrom(samplePayload({ year: 2026, solvedDays: 7 })), puzzleTitle: () => 'Laboratories' });
  const at = (timeZone) => text(renderAll(v, { baseUrl: 'https://x.example', timeZone, now }).markup_half_horizontal);
  assert.match(at('Europe/Vienna'), /Day 8 in 15h 00m tomorrow 06:00/);
  assert.match(at('America/Los_Angeles'), /Day 8 in 15h 00m today 21:00/);
});

test('the last puzzle day shows that day and its title, the day after shows Final', async () => {
  const opts = (now) => ({ now, getBoard: boardFrom(samplePayload({ year: 2026, solvedDays: 12 })), puzzleTitle: (y, d) => `Title ${d}` });
  const lastNow = Date.UTC(2026, 11, 12, 20);
  const last = await buildView(CFG, opts(lastNow));
  assert.equal(last.today.title, 'Title 12');
  const out = renderAll(last, { baseUrl: 'https://x.example', now: lastNow });
  for (const k of LAYOUT_KEYS) {
    assert.match(text(out[k]), /Day 12 Title 12 Last puzzle/, k);
    assert.doesNotMatch(text(out[k]), /Final|days out|NaN|null/, k);
  }
  assert.match(text(out.markup), /2026 standings/);
  assert.doesNotMatch(text(out.markup), /final standings/);

  const finNow = Date.UTC(2026, 11, 13, 6);
  const fin = renderAll(await buildView(CFG, opts(finNow)), { baseUrl: 'https://x.example', now: finNow });
  assert.match(text(fin.markup), /Final All 12 days out/);
  assert.match(text(fin.markup), /2026 final standings/);
});

test('half-horizontal puts each fact on its own row: no "A · B · C" lines', async () => {
  for (const [name, v] of await views()) {
    const out = renderAll(v, { baseUrl: 'https://x.example', timeZone: 'Europe/Vienna', now: Date.UTC(2026, 11, 7, 14) });
    for (const k of LAYOUT_KEYS.filter((k) => k !== 'markup_quadrant')) {
      assert.doesNotMatch(out[k], /·/, `${name} ${k}`);
    }
  }
});

test('TRMNL X portrait gets its own shorter list in the full view, still ending with the user\'s row', async () => {
  const now = Date.UTC(2026, 11, 7, 14);
  const v = await buildView({ ...CFG, memberId: '1012' }, { now, getBoard: boardFrom(samplePayload({ year: 2026, solvedDays: 7 })), puzzleTitle: () => null });
  const out = renderAll(v, { baseUrl: 'https://x.example', now }).markup;
  const portrait = out.slice(out.indexOf('class="hidden lg:portrait:flex flex--col"'));
  assert.ok(out.includes('class="hidden lg:flex lg:portrait:hidden flex--col"'));
  const portraitRows = portrait.split('<span class="label lg:label--large lg:portrait:label--xlarge value--tnums" style="flex:none;width:2.2ch').length - 1;
  assert.equal(portraitRows, 12);
  assert.match(portrait, />dmr</); // rank 13, shown as the last row
});

test('text that may be cut off is a block, so it ends in an ellipsis (the framework\'s .label is a flex box)', async () => {
  const now = Date.UTC(2026, 11, 7, 14);
  const v = await buildView(CFG, { now, getBoard: boardFrom(samplePayload({ year: 2026, solvedDays: 7 })), puzzleTitle: () => 'A title' });
  const out = renderAll(v, { baseUrl: 'https://x.example', now });
  for (const k of LAYOUT_KEYS) {
    for (const m of out[k].matchAll(/style="([^"]*text-overflow:ellipsis[^"]*)"/g)) assert.match(m[1], /display:block/, k);
  }
});

test('the quadrant leaves out the unlock clock line', async () => {
  const now = Date.UTC(2026, 11, 7, 14);
  const v = await buildView(CFG, { now, getBoard: boardFrom(samplePayload({ year: 2026, solvedDays: 7 })), puzzleTitle: () => null });
  const out = renderAll(v, { baseUrl: 'https://x.example', timeZone: 'Europe/Vienna', now });
  assert.doesNotMatch(text(out.markup_quadrant), /tomorrow/);
  assert.match(text(out.markup_quadrant), /Day 8 in 15h 00m/);
  assert.match(text(out.markup), /tomorrow 06:00/);
});

test('countdown formats days, hours and minutes', () => {
  assert.equal(countdown(11 * 24 * H + 20 * H), '11d 20h');
  assert.equal(countdown(14 * H + 20 * 60e3), '14h 20m');
  assert.equal(countdown(5 * H + 60e3), '5h 01m');
  assert.equal(countdown(42 * 60e3), '42m');
  assert.equal(countdown(-1), '0m');
});

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

test('store persists settings with owner-only permissions and forgets them on delete', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aoc-store-'));
  const file = path.join(dir, 'connections.json');
  const a = createStore(file);
  a.update('u1', { boardId: '1', session: 'secret' });
  assert.equal((fs.statSync(file).mode & 0o777).toString(8), '600');
  assert.equal(createStore(file).get('u1').session, 'secret');
  a.delete('u1');
  assert.equal(createStore(file).get('u1'), null);
  fs.rmSync(dir, { recursive: true });
});

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

test('/markup and /webhooks/uninstall reject malformed uuids', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aoc-http-'));
  process.env.DATA_FILE = path.join(dir, 'connections.json');
  delete require.cache[require.resolve('../src/store')];
  delete require.cache[require.resolve('../server')];
  const app = require('../server');
  const server = await new Promise((r) => {
    const s = app.listen(0, '127.0.0.1', () => r(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (p, body) =>
    fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    for (const uuid of ['../../etc', 'a'.repeat(65), 'x y', '__proto__']) {
      const r = await post('/markup', { trmnl: JSON.stringify({ user: { uuid } }) });
      assert.equal(r.status, 200);
      assert.match((await r.json()).markup, /Connect your leaderboard/, uuid);
      assert.equal((await post('/webhooks/uninstall', { user: { uuid } })).status, 400, uuid);
    }
    assert.equal((await post('/webhooks/uninstall', {})).status, 400);
    assert.equal((await post('/webhooks/uninstall', { user: { uuid: 'abc-123' } })).status, 200);
    // a well-formed uuid without settings gets the setup message too, never the .env board
    assert.match((await (await post('/markup', { user_uuid: 'abc-123' })).json()).markup, /Connect your leaderboard/);
  } finally {
    server.close();
    fs.rmSync(dir, { recursive: true });
    delete process.env.DATA_FILE;
  }
});
