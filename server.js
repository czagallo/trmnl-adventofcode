require('dotenv').config();
const path = require('path');
const express = require('express');
const aoc = require('./src/aoc');
const { buildView } = require('./src/view');
const { renderAll, esc } = require('./src/markup');
const { createStore } = require('./src/store');

const PORT = Number(process.env.PORT) || 3012;
const CLIENT_ID = process.env.TRMNL_CLIENT_ID;
const CLIENT_SECRET = process.env.TRMNL_CLIENT_SECRET;
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const TRMNL_OAUTH_URL = 'https://usetrmnl.com/oauth/token';

// Local testing only: a markup request without a user uuid (curl) uses these. Real TRMNL requests always carry a
// uuid and only ever see that user's own saved settings.
const ENV_CONFIG = {
  session: aoc.parseSession(process.env.AOC_SESSION),
  boardId: aoc.parseBoardId(process.env.AOC_LEADERBOARD_ID),
  year: process.env.AOC_YEAR || 'auto',
  memberId: process.env.AOC_MEMBER_ID || null,
};

const store = createStore();
const app = express();
app.disable('x-powered-by');
// TRMNL posts the markup request form-encoded with nested keys (trmnl[user][...]); JSON is for local testing.
app.use(express.urlencoded({ extended: true, limit: '100kb' }));
app.use(express.json({ limit: '100kb' }));

const UUID_RE = /^[A-Za-z0-9-]{1,64}$/;

app.get('/icon.svg', (req, res) => {
  res.set('Cache-Control', 'public, max-age=86400');
  res.sendFile(path.join(__dirname, 'icon.svg'));
});

// Icons for TRMNL's light and dark UI: /icon-light.svg|png (black) and /icon-dark.svg|png (white), transparent.
app.get(/^\/icon-(light|dark)\.(svg|png)$/, (req, res) => {
  res.set('Cache-Control', 'public, max-age=86400');
  res.sendFile(path.join(__dirname, 'icons', `icon-${req.params[0]}.${req.params[1]}`));
});

// ---------------------------------------------------------------------------
// Installation (OAuth)
// ---------------------------------------------------------------------------

app.get('/install', async (req, res) => {
  const { code, installation_callback_url: callback } = req.query;
  if (!code || !callback) return res.status(400).json({ error: 'Missing code or installation_callback_url' });
  if (!CLIENT_ID || !CLIENT_SECRET) return res.status(500).json({ error: 'Plugin credentials not configured' });

  try {
    const r = await fetch(TRMNL_OAUTH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, code, grant_type: 'authorization_code' }),
      signal: AbortSignal.timeout(8000),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok || !body.access_token) throw new Error(`token exchange failed (HTTP ${r.status})`);
    console.log('Install: token exchange ok');
    res.redirect(302, callback);
  } catch (err) {
    console.error('Install failed:', err.message);
    res.status(500).json({ error: 'Installation failed' });
  }
});

app.post('/webhooks/install-success', (req, res) => {
  const user = req.body?.user;
  if (!user?.uuid || !UUID_RE.test(user.uuid)) return res.status(400).json({ error: 'No user data' });
  store.update(user.uuid, { plugin_setting_id: user.plugin_setting_id ?? null });
  console.log('Install success for user', user.uuid);
  res.json({ success: true });
});

app.post('/webhooks/uninstall', (req, res) => {
  const uuid = req.body?.user?.uuid || req.body?.uuid;
  if (uuid) store.delete(uuid); // drops the stored session cookie too
  console.log('Uninstall for user', uuid || '(unknown)');
  res.json({ success: true });
});

// ---------------------------------------------------------------------------
// Settings page
// ---------------------------------------------------------------------------

function managePage(uuid, conn, notice) {
  const year = conn?.year || 'auto';
  const thisYear = aoc.currentEventYear();
  const years = ['auto', ...Array.from({ length: thisYear - 2014 }, (_, i) => String(thisYear - i))];
  const back = conn?.plugin_setting_id
    ? `https://usetrmnl.com/plugin_settings/${encodeURIComponent(conn.plugin_setting_id)}/edit?force_refresh=true`
    : 'https://usetrmnl.com';
  const sessionHint = conn?.session ? `Saved (ends in …${esc(conn.session.slice(-4))}). Leave empty to keep it.` : 'Required.';

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Advent of Code Leaderboard</title>
<style>
body{font-family:system-ui,sans-serif;max-width:600px;margin:40px auto;padding:0 16px;line-height:1.5;color:#1a1a1a}
label{display:block;font-weight:600;margin-top:18px}
input,select{width:100%;box-sizing:border-box;padding:9px;font:inherit;border:1px solid #bbb;border-radius:6px;margin-top:4px}
small{color:#555;display:block;margin-top:4px}
button,.btn{display:inline-block;margin-top:24px;margin-right:8px;padding:10px 18px;font:inherit;border-radius:6px;border:1px solid #1a1a1a;background:#1a1a1a;color:#fff;text-decoration:none;cursor:pointer}
.btn{background:#fff;color:#1a1a1a}
.notice{padding:10px 14px;border-radius:6px;margin:16px 0;background:#eef6ee;border:1px solid #9c9}
.notice.err{background:#fbeeee;border-color:#d99}
code{background:#f1f1f1;padding:1px 4px;border-radius:3px}
details{margin-top:8px}
</style></head>
<body>
<h1>Advent of Code Leaderboard</h1>
<p>Shows a private leaderboard with everyone's stars, today's puzzle and the countdown to the next unlock.</p>
${notice ? `<div class="notice${notice.ok ? '' : ' err'}">${esc(notice.text)}</div>` : ''}
<form method="POST" action="/manage/save">
<input type="hidden" name="uuid" value="${esc(uuid)}">

<label for="board">Private leaderboard</label>
<input id="board" name="board" required value="${esc(conn?.boardId || '')}" placeholder="1234567 or https://adventofcode.com/2025/leaderboard/private/view/1234567">
<small>The number in the leaderboard's URL, or the URL itself. Your own leaderboard's ID is your AoC user ID.</small>

<label for="session">AoC session cookie</label>
<input id="session" name="session" type="password" autocomplete="off" spellcheck="false" placeholder="53616c7465645f5f…">
<small>${sessionHint}</small>
<details><summary>Where do I find it?</summary>
<small>Log in at adventofcode.com, open the browser's developer tools → Application (Chrome) or Storage (Firefox) → Cookies →
<code>https://adventofcode.com</code>, and copy the value of <code>session</code>. It is stored on this plugin's server only,
used for nothing but reading this leaderboard (at most once every 15 minutes), and deleted when you uninstall the plugin.</small>
</details>

<label for="year">Year</label>
<select id="year" name="year">${years
    .map((y) => `<option value="${y}"${y === String(year) ? ' selected' : ''}>${y === 'auto' ? 'Automatic (current event)' : y}</option>`)
    .join('')}</select>
<small>Automatic shows this December's event, and last year's final standings until it starts.</small>

<label for="member">Highlight member ID (optional)</label>
<input id="member" name="member" inputmode="numeric" value="${esc(conn?.memberId || '')}" placeholder="Leaderboard owner">
<small>Whose row is outlined and whose rank is shown. Defaults to the leaderboard's owner.</small>

<button type="submit">Save and test</button>
<a class="btn" href="${esc(back)}">Back to TRMNL</a>
</form>
</body></html>`;
}

app.get('/manage', (req, res) => {
  const uuid = String(req.query.uuid || '');
  if (!UUID_RE.test(uuid)) return res.status(400).send('Missing or invalid uuid');
  res.type('html').send(managePage(uuid, store.get(uuid)));
});

const ERROR_TEXT = {
  auth: 'Advent of Code did not accept the session cookie, or it has no access to this leaderboard.',
  not_found: 'Advent of Code has no such leaderboard for that year.',
  network: 'Advent of Code did not respond. Settings are saved; it will retry on the next refresh.',
  http: 'Advent of Code returned an unexpected response. Settings are saved; it will retry on the next refresh.',
};

app.post('/manage/save', async (req, res) => {
  const uuid = String(req.body.uuid || '');
  if (!UUID_RE.test(uuid)) return res.status(400).send('Missing or invalid uuid');
  const conn = store.get(uuid);

  const boardId = aoc.parseBoardId(req.body.board);
  const rawSession = String(req.body.session || '').trim();
  const session = rawSession ? aoc.parseSession(rawSession) : conn?.session;
  const year = /^(auto|20\d\d)$/.test(req.body.year) ? req.body.year : 'auto';
  const memberId = /^\d{1,12}$/.test(String(req.body.member || '').trim()) ? String(req.body.member).trim() : null;

  const fail = (text) => res.status(400).type('html').send(managePage(uuid, conn, { ok: false, text }));
  if (!boardId) return fail('That does not look like a leaderboard ID or URL.');
  if (!session) return fail(rawSession ? 'That does not look like an AoC session cookie (a long hex string).' : 'The session cookie is required.');

  const next = store.update(uuid, { boardId, session, year, memberId });

  // Try it right away; the result lands in the cache the screen reads from, so this costs no extra request.
  const v = await buildView(next);
  let notice;
  if (v.state === 'ok' && v.board) {
    const me = v.me ? ` You are #${v.me.rank} with ${v.me.stars} stars.` : memberId ? ` Member ${memberId} is not on this leaderboard.` : '';
    notice = { ok: true, text: `Connected: ${v.board.members.length} members on the ${v.boardYear} leaderboard.${me}` };
  } else if (v.state === 'ok') {
    notice = { ok: true, text: `Saved. The ${v.boardYear} leaderboard does not exist yet; the countdown shows until it does.` };
  } else {
    notice = { ok: false, text: ERROR_TEXT[v.error] || ERROR_TEXT.network };
  }
  res.type('html').send(managePage(uuid, next, notice));
});

// ---------------------------------------------------------------------------
// Screen generation
// ---------------------------------------------------------------------------

app.post('/markup', async (req, res) => {
  const trmnl = req.body?.trmnl || {};
  const uuid = req.body?.user_uuid || trmnl.user?.uuid;
  const cfg = uuid ? store.get(uuid) : ENV_CONFIG;
  try {
    const v = await buildView(cfg);
    res.json(
      renderAll(v, {
        baseUrl: BASE_URL,
        instance: trmnl.plugin_settings?.instance_name,
        timeZone: trmnl.user?.time_zone_iana,
      }),
    );
  } catch (err) {
    console.error('Markup failed:', err);
    res.json(renderAll(null, { baseUrl: BASE_URL }));
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', users: store.size() });
});

if (require.main === module) {
  app.listen(PORT, '127.0.0.1', () => console.log(`TRMNL Advent of Code plugin on http://127.0.0.1:${PORT}`));
}

module.exports = app;
