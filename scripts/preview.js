#!/usr/bin/env node
// Renders every layout on every screen class with TRMNL's real framework CSS and screenshots it with headless Chrome.
//   node scripts/preview.js [outDir] [--scenario=running|before|final|old] [--live]
// Sample data by default; --live uses AOC_SESSION / AOC_LEADERBOARD_ID from .env (one real request).
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const aoc = require('../src/aoc');
const { buildView } = require('../src/view');
const { renderAll } = require('../src/markup');
const { samplePayload } = require('../test/fixtures/sample');

const args = process.argv.slice(2);
const live = args.includes('--live');
const scenario = (args.find((a) => a.startsWith('--scenario=')) || '--scenario=running').split('=')[1];
const outDir = path.resolve(args.find((a) => !a.startsWith('--')) || path.join(__dirname, '..', 'preview'));
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const FRAMEWORK = 'https://trmnl.com';

const SCREENS = [
  { name: 'og-1bit', cls: 'screen--og screen--md screen--1bit', w: 800, h: 480 },
  { name: 'og-2bit', cls: 'screen--ogv2 screen--md screen--2bit', w: 800, h: 480 },
  { name: 'trmnl-x-lg', cls: 'screen--v2 screen--lg screen--4bit', w: 1872, h: 1404 },
];

const SCENARIOS = {
  running: { now: Date.UTC(2026, 11, 7, 14, 40), payload: samplePayload({ year: 2026, solvedDays: 7 }) },
  before: { now: Date.UTC(2026, 10, 19, 9, 0), payload: samplePayload({ year: 2025, solvedDays: 12 }) },
  final: { now: Date.UTC(2026, 11, 20, 9, 0), payload: samplePayload({ year: 2026, solvedDays: 12 }) },
  old: { now: Date.UTC(2026, 11, 7, 14, 40), payload: samplePayload({ year: 2024, days: 25, solvedDays: 25 }), year: 2024 },
};

function page(screen, portrait, body) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="${FRAMEWORK}/css/latest/plugins.css">
<script src="${FRAMEWORK}/js/latest/plugins.js"></script>
<style>html,body{margin:0;padding:0;background:#fff}</style></head>
<body class="trmnl"><div class="screen ${screen.cls}${portrait ? ' screen--portrait' : ''}">${body}</div></body></html>`;
}

async function main() {
  let v;
  let now = Date.now();
  if (live) {
    v = await buildView({
      session: aoc.parseSession(process.env.AOC_SESSION),
      boardId: aoc.parseBoardId(process.env.AOC_LEADERBOARD_ID),
      year: process.env.AOC_YEAR || 'auto',
      memberId: process.env.AOC_MEMBER_ID,
    });
  } else {
    const s = SCENARIOS[scenario];
    if (!s) throw new Error(`unknown scenario ${scenario}`);
    now = s.now;
    v = await buildView(
      { session: 'x'.repeat(64), boardId: '1003', year: s.year || 'auto' },
      {
        now,
        getBoard: async (cfg) => ({ data: aoc.parseLeaderboard(s.payload, cfg.year), fetchedAt: now, error: null }),
        puzzleTitle: (y, d) => ['', 'Secret Entrance', 'Gift Shop', 'Lobby', 'Printing Department', 'Cafeteria', 'Trash Compactor', 'Laboratories', 'Playground', 'Movie Theater', 'Factory', 'Reactor', 'Christmas Tree Farm'][d] || null,
      },
    );
  }
  const m = renderAll(v, { baseUrl: 'http://localhost:3012', timeZone: 'Europe/Vienna', now });
  const icon = 'data:image/svg+xml;base64,' + fs.readFileSync(path.join(__dirname, '..', 'icon.svg')).toString('base64');
  const fix = (s) => s.replaceAll('http://localhost:3012/icon.svg', icon);
  const LAYOUTS = {
    full: fix(m.markup),
    half_horizontal: `<div class="mashup mashup--1Tx1B">${fix(m.markup_half_horizontal)}${fix(m.markup_half_horizontal)}</div>`,
    half_vertical: `<div class="mashup mashup--1Lx1R">${fix(m.markup_half_vertical)}${fix(m.markup_half_vertical)}</div>`,
    quadrant: `<div class="mashup mashup--2x2">${fix(m.markup_quadrant).repeat(4)}</div>`,
  };

  fs.mkdirSync(outDir, { recursive: true });
  let n = 0;
  for (const s of SCREENS) {
    for (const portrait of [false, true]) {
      for (const [layout, body] of Object.entries(LAYOUTS)) {
        const name = `${live ? 'live' : scenario}-${s.name}${portrait ? '-portrait' : ''}-${layout}`;
        const html = path.join(outDir, `${name}.html`);
        fs.writeFileSync(html, page(s, portrait, body));
        const [w, h] = portrait ? [s.h, s.w] : [s.w, s.h];
        execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
          `--window-size=${w},${h}`, '--virtual-time-budget=6000', `--screenshot=${path.join(outDir, `${name}.png`)}`, `file://${html}`],
        { stdio: 'ignore' });
        n++;
      }
    }
  }
  console.log(`${n} screenshots in ${outDir}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
