// Pure markup builders for every TRMNL layout.
//
// Same rules as the other plugins in this repo:
// - The platform picks the screen and adds screen--sm/md/lg, screen--portrait and bit-depth classes; we never branch
//   on device in JS. Text uses framework classes with lg:/portrait: prefixes, graphics are SVG with a viewBox.
// - Black and white only (currentColor in SVG), no hex colors: they dither badly on 1-bit panels.
// - TRMNL parses every markup string as Liquid, so nothing may contain "{{" or "{%". esc() also escapes braces,
//   because member names and puzzle titles come from outside.

const FILL = 'width:100%;height:100%;min-width:0;min-height:0';
const STYLE =
  '<style>.aoc-hero{flex:0 0 34%;min-width:0;min-height:0}.screen--portrait .aoc-hero{flex:0 0 auto}' +
  '.screen--portrait .aoc-board{justify-content:flex-start!important}</style>';

function esc(s) {
  return String(s).replace(
    /[&<>"'{}]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '{': '&#123;', '}': '&#125;' })[c],
  );
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function countdown(ms) {
  const mins = Math.max(0, Math.ceil(ms / 60000));
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}m`;
}

function clock(ms, timeZone) {
  const opts = { hour: '2-digit', minute: '2-digit', hour12: false };
  try {
    return new Date(ms).toLocaleTimeString('en-GB', { ...opts, timeZone: timeZone || 'UTC' });
  } catch {
    return new Date(ms).toLocaleTimeString('en-GB', { ...opts, timeZone: 'UTC' });
  }
}

function dateTime(ms, timeZone) {
  const opts = { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false };
  try {
    return new Date(ms).toLocaleString('en-GB', { ...opts, timeZone: timeZone || 'UTC' });
  } catch {
    return new Date(ms).toLocaleString('en-GB', { ...opts, timeZone: 'UTC' });
  }
}

// ---------------------------------------------------------------------------
// Graphics
// ---------------------------------------------------------------------------

function starPoints(cx, cy, r) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 ? r * 0.45 : r;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push(`${(cx + rad * Math.cos(a)).toFixed(2)},${(cy + rad * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(' ');
}

// One cell per day: filled star = both parts, outlined star = part one, dot = not solved, nothing = still locked.
function starRowSvg(perDay, unlocked) {
  const cells = perDay
    .map((s, i) => {
      const cx = i * 10 + 5;
      if (i >= unlocked) return '';
      if (s === 2) return `<polygon points="${starPoints(cx, 5, 4.8)}" fill="currentColor"/>`;
      if (s === 1) return `<polygon points="${starPoints(cx, 5, 4.3)}" fill="none" stroke="currentColor" stroke-width="1"/>`;
      return `<circle cx="${cx}" cy="5" r="0.9" fill="currentColor"/>`;
    })
    .join('');
  return `<svg viewBox="0 0 ${perDay.length * 10} 10" preserveAspectRatio="xMinYMid meet" style="display:block;${FILL}" xmlns="http://www.w3.org/2000/svg">${cells}</svg>`;
}

function bigStar() {
  return `<svg viewBox="0 0 10 10" style="display:inline-block;width:0.8em;height:0.8em;vertical-align:-0.05em" xmlns="http://www.w3.org/2000/svg"><polygon points="${starPoints(5, 5.3, 4.9)}" fill="currentColor"/></svg>`;
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

// Type ramps. Base = TRMNL OG (800x480), lg: = TRMNL X, lg:portrait: = TRMNL X held upright, which has the most room
// and gets the biggest type. The quadrant is the same size on X in either orientation, so it skips the portrait step.
const T = {
  label: 'label lg:label--large lg:portrait:label--xlarge',
  meta: 'description lg:description--large lg:portrait:description--xlarge',
  rowText: 'label lg:label--large lg:portrait:label--xlarge',
  rowNum: 'label lg:label--large lg:portrait:label--xlarge value--tnums',
  statLabel: 'label label--small lg:label--base lg:portrait:label--large',
  statValue: 'value value--xsmall lg:value--small lg:portrait:value--base value--tnums',
  quadLabel: 'label lg:label--large',
  quadNum: 'label lg:label--large value--tnums',
};
const HERO = {
  large: { big: 'value value--xlarge lg:value--xxlarge lg:portrait:value--xxxlarge', sub: 'label label--large lg:label--xlarge lg:portrait:label--xxlarge', top: T.label },
  medium: { big: 'value value--large lg:value--xlarge lg:portrait:value--xxlarge', sub: 'label lg:label--large lg:portrait:label--xlarge', top: T.label },
  quad: { big: 'value value--large lg:value--xlarge', sub: 'label lg:label--large', top: T.quadLabel },
};

function titleBar(ctx, v) {
  const instance = ctx.instance || (v && v.boardYear ? `${v.boardYear} private leaderboard` : 'Private leaderboard');
  return `<div class="title_bar">
<img class="image" src="${esc(ctx.baseUrl)}/icon.svg" alt="">
<span class="title">Advent of Code</span>
<span class="instance">${esc(instance)}</span>
</div>`;
}

// How many day cells are already unlocked on the shown board.
function unlockedDays(v) {
  if (!v.board) return 0;
  if (v.boardYear !== v.year) return v.board.days; // last year's board: everything is out
  return v.timing.phase === 'before' ? 0 : v.timing.today;
}

// Top rows, and the user's own row as the last one when they are not in the top.
function pickRows(v, max) {
  const all = v.board ? v.board.members : [];
  if (all.length <= max || !v.me || v.me.rank <= max) return all.slice(0, max);
  return [...all.slice(0, max - 1), v.me];
}

function rows(v, max, { starRow = true, starClass = '', starEm = 1.15, starMax = '52%', text = T.rowText, num = T.rowNum } = {}) {
  if (!v.board) return '';
  const unlocked = unlockedDays(v);
  const list = pickRows(v, max);
  const gapBefore = (m, i) => i > 0 && m.rank !== list[i - 1].rank + 1;
  return list
    .map((m, i) => {
      const isMe = v.me && m.id === v.me.id;
      return `<div class="flex flex--row" style="align-items:center;gap:8px;padding:1px 6px;border-radius:4px;${
        isMe ? 'outline:2px solid currentColor;outline-offset:-2px;' : ''
      }${gapBefore(m, i) ? 'border-top:1px dashed currentColor;' : ''}">
<span class="${num}" style="flex:none;width:2.2ch;text-align:right">${m.rank}</span>
<span class="${text}" style="flex:1 1 0;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;${
        isMe ? 'font-weight:700' : ''
      }">${esc(m.name)}</span>
${starRow ? `<div class="${starClass}" style="flex:0 1 auto;width:calc(${m.perDay.length} * ${starEm}em);max-width:${starMax};min-width:0;height:${starEm}em">${starRowSvg(m.perDay, unlocked)}</div>` : ''}
<span class="${num}" style="flex:none;min-width:3.2ch;text-align:right;white-space:nowrap">${m.stars}${bigStar()}</span>
${v.board.hasScores ? `<span class="${num}" style="flex:none;min-width:3.6ch;text-align:right">${m.score}</span>` : ''}
</div>`;
    })
    .join('');
}

// A longer list on TRMNL X, which has room for it. Two lists rather than hidden rows, so "your row last" stays right.
function rowsByScreen(v, max, lgMax, opts) {
  const base = rows(v, max, opts);
  if (!v.board || v.board.members.length <= max) return `<div class="flex flex--col" style="gap:inherit;align-items:stretch">${base}</div>`;
  return `<div class="flex flex--col lg:hidden" style="gap:inherit;align-items:stretch">${base}</div>
<div class="hidden lg:flex flex--col" style="gap:inherit;align-items:stretch">${rows(v, lgMax, opts)}</div>`;
}

function boardHeading(v) {
  if (!v.board) return '';
  const n = v.board.members.length;
  const what = v.boardYear !== v.year || v.timing.phase === 'final' ? `${v.boardYear} final standings` : `${v.boardYear} standings`;
  return `<div class="flex flex--row" style="justify-content:space-between;align-items:baseline;padding:0 6px 2px;border-bottom:2px solid currentColor;margin-bottom:2px">
<span class="${T.label}">${esc(what)}</span>
<span class="${T.label}">${n} ${n === 1 ? 'member' : 'members'}</span>
</div>`;
}

// The big statement: today's day, the countdown, or the final tally.
function hero(v, ctx, size = 'large') {
  const { big, sub, top } = HERO[size];
  const t = v.timing;
  if (t.phase === 'before') {
    return `<span class="${top}">Advent of Code ${v.year} starts in</span>
<span class="${big} value--tnums" style="white-space:nowrap">${esc(countdown(t.nextUnlock - ctx.now))}</span>
<span class="${sub}">Day 1 · Dec 1, ${esc(clock(t.nextUnlock, ctx.timeZone))}</span>`;
  }
  const title = v.today && v.today.title
    ? `<span class="${sub}" style="overflow:hidden;white-space:nowrap;text-overflow:ellipsis;max-width:100%">${esc(v.today.title)}</span>`
    : '';
  if (t.phase === 'running') {
    return `<span class="${top}">Advent of Code ${v.year}</span>
<span class="${big}">Day ${t.today}</span>
${title}
<span class="${sub}" style="margin-top:4px">Day ${t.nextDay} in&nbsp;<b>${esc(countdown(t.nextUnlock - ctx.now))}</b>&nbsp;· ${esc(clock(t.nextUnlock, ctx.timeZone))}</span>`;
  }
  return `<span class="${top}">Advent of Code ${v.year}</span>
<span class="${big}">Final</span>
<span class="${sub}">All ${t.today} days out</span>`;
}

function stat(name, value) {
  return `<div class="flex flex--col" style="align-items:center;gap:0;min-width:0">
<span class="${T.statLabel}">${esc(name)}</span>
<span class="${T.statValue}">${value}</span>
</div>`;
}

// You: rank, stars, points as three small stats.
function meStats(v) {
  if (!v.me || !v.board) return '';
  const cells = [
    stat('Rank', `${v.me.rank}<span class="label label--small">/${v.board.members.length}</span>`),
    stat('Stars', `${v.me.stars}<span class="label label--small">/${v.board.days * 2}</span>`),
  ];
  if (v.board.hasScores) cells.push(stat('Points', String(v.me.score)));
  return `<div class="flex flex--row" style="justify-content:space-around;align-items:flex-start;border-top:1px solid currentColor;border-bottom:1px solid currentColor;padding:6px 0">${cells.join('')}</div>`;
}

function todayLine(v, ctx) {
  if (!v.today || !v.board) return '';
  const n = v.board.members.length;
  const first = v.today.first ? ` · first: ${v.today.first.name} ${clock(v.today.first.at, ctx.timeZone)}` : '';
  return `<span class="${T.label}">${v.today.finished} of ${n} finished day ${v.today.day}${esc(first)}</span>`;
}

function staleLine(v, ctx) {
  if (!v.error || !v.fetchedAt) return '';
  return `<span class="${T.meta}">AoC unreachable · data from ${esc(dateTime(v.fetchedAt, ctx.timeZone))}</span>`;
}

// ---------------------------------------------------------------------------
// Layouts
// ---------------------------------------------------------------------------

function full(v, ctx) {
  return `<div class="view view--full">${STYLE}
<div class="layout">
<div class="flex flex--row portrait:flex--col gap--large" style="${FILL};align-items:stretch">
  <div class="aoc-hero flex flex--col" style="justify-content:center;gap:4px">
    ${hero(v, ctx)}
    <div style="height:8px"></div>
    ${meStats(v)}
    ${todayLine(v, ctx)}
    ${staleLine(v, ctx)}
  </div>
  <div class="aoc-board flex flex--col" style="flex:1 1 0;min-width:0;min-height:0;justify-content:center;align-items:stretch;gap:3px;overflow:hidden">
    ${boardHeading(v)}
    ${rowsByScreen(v, 10, 16)}
  </div>
</div>
</div>
${titleBar(ctx, v)}
</div>`;
}

function halfHorizontal(v, ctx) {
  return `<div class="view view--half_horizontal">${STYLE}
<div class="layout">
<div class="flex flex--row portrait:flex--col gap--large" style="${FILL};align-items:stretch">
  <div class="aoc-hero flex flex--col" style="justify-content:center;gap:2px">
    ${hero(v, ctx, 'medium')}
    ${staleLine(v, ctx)}
  </div>
  <div class="flex flex--col" style="flex:1 1 0;min-width:0;min-height:0;justify-content:center;align-items:stretch;gap:2px;overflow:hidden">
    ${rows(v, 5, { starClass: 'portrait:hidden' })}
  </div>
</div>
</div>
${titleBar(ctx, v)}
</div>`;
}

function halfVertical(v, ctx) {
  const starRow = !v.board || v.board.days <= 12;
  return `<div class="view view--half_vertical">${STYLE}
<div class="layout">
<div class="flex flex--col gap--small" style="${FILL};align-items:stretch;justify-content:center;overflow:hidden">
  <div class="flex flex--col" style="gap:2px">${hero(v, ctx, 'medium')}</div>
  ${meStats(v)}
  <div class="flex flex--col" style="gap:2px;min-height:0;overflow:hidden;margin-top:6px;align-items:stretch">${rowsByScreen(v, 8, 12, { starRow, starClass: 'portrait:hidden', starEm: 0.85, starMax: '36%' })}</div>
</div>
</div>
${titleBar(ctx, v)}
</div>`;
}

function quadrant(v, ctx) {
  return `<div class="view view--quadrant">${STYLE}
<div class="layout">
<div class="flex flex--col" style="${FILL};justify-content:center;gap:2px;overflow:hidden">
  ${hero(v, ctx, 'quad')}
  ${v.me && v.board ? `<span class="value value--xsmall lg:value--small value--tnums">#${v.me.rank} · ${v.me.stars}/${v.board.days * 2} ${bigStar()}</span>` : ''}
  ${v.board ? `<div class="hidden lg:flex flex--col" style="gap:2px;margin-top:10px;align-self:stretch">${rows(v, 3, { starRow: false, text: T.quadLabel, num: T.quadNum })}</div>` : ''}
</div>
</div>
${titleBar(ctx, v)}
</div>`;
}

const MESSAGES = {
  setup: ['Connect your leaderboard', 'Open this plugin’s settings in TRMNL and add your private leaderboard and AoC session cookie.'],
  auth: ['AoC session expired', 'Paste a fresh session cookie in the plugin settings. Sessions last about a month.'],
  not_found: ['Leaderboard not found', 'Check the leaderboard ID and year in the plugin settings.'],
  network: ['Advent of Code unreachable', 'It will retry on the next refresh.'],
  http: ['Advent of Code unreachable', 'It will retry on the next refresh.'],
};

function message(view, v, ctx) {
  const [title, text] = MESSAGES[v.state === 'setup' ? 'setup' : v.error] || MESSAGES.network;
  return `<div class="view view--${view}">
<div class="layout layout--col layout--center" style="gap:6px">
  <span class="title text--center">${esc(title)}</span>
  <span class="description text--center">${esc(text)}</span>
</div>
${titleBar(ctx, v)}
</div>`;
}

// ctx: { baseUrl, instance, timeZone, now }
function renderAll(v, ctx) {
  const c = { now: Date.now(), ...ctx };
  if (!v || v.state !== 'ok') {
    const vv = v || { state: 'error', error: 'network' };
    return {
      markup: message('full', vv, c),
      markup_half_horizontal: message('half_horizontal', vv, c),
      markup_half_vertical: message('half_vertical', vv, c),
      markup_quadrant: message('quadrant', vv, c),
    };
  }
  return {
    markup: full(v, c),
    markup_half_horizontal: halfHorizontal(v, c),
    markup_half_vertical: halfVertical(v, c),
    markup_quadrant: quadrant(v, c),
  };
}

module.exports = { renderAll, esc, countdown, clock, starRowSvg, pickRows };
