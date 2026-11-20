# Advent of Code Leaderboard for TRMNL

Your Advent of Code private leaderboard on your TRMNL: everyone's stars day by day, today's puzzle, and the countdown
to the next unlock.

- **During the event:** today's day and puzzle title, a countdown to the next unlock in your time zone, your rank,
  stars and points, how many finished today and who was first
- **Before Day 1:** a countdown to the start, next to last year's final standings
- **Afterwards:** the final standings
- Star grid per member: filled star = both parts, outlined star = part one, dot = not solved
- Your own row is always visible, even when you are below the top 10
- Handles both formats: 12 puzzles (2025 onwards) and 25 puzzles (2015–2024)
- Every layout (full, half horizontal, half vertical, quadrant) on every screen (TRMNL OG 1-/2-bit, TRMNL X, Kindle,
  portrait), in pure black and white

## Setup (as a user)

In the plugin's settings page, enter:

1. **Private leaderboard**: its ID or URL (`https://adventofcode.com/2025/leaderboard/private/view/1234567`)
2. **AoC session cookie**: adventofcode.com → developer tools → Cookies → `session`
3. Optionally a **year** (default: automatic) and the **member ID** to highlight (default: the leaderboard owner)

"Save and test" fetches the board once and tells you if the cookie and ID work.

## Being nice to Advent of Code

AoC asks automated tools to request a private leaderboard at most once every 15 minutes. The plugin caches every board
per (year, leaderboard, session) and starts a new request only when the previous *attempt* is 15 minutes old, also
after errors. Outside December it waits 3 hours. Puzzle titles are fetched once per day. Set `AOC_USER_AGENT` to
something with a way to reach you, as AoC asks.

## Privacy

The session cookie is stored only in `data/connections.json` on the plugin server (mode 600). It is never logged or
sent back to the browser, and it is deleted when the plugin is uninstalled.

## Development

```bash
npm install
cp .env.example .env
npm run dev                                   # http://127.0.0.1:3012
npm test

npm run preview                               # screenshots of every layout on every screen in ./preview (needs Chrome)
npm run preview -- --scenario=before          # also: running (default), final, old (a 25-day year)
npm run preview -- --live                     # real data from AOC_SESSION / AOC_LEADERBOARD_ID in .env

# a markup request without a user uuid uses the AOC_* variables from .env
curl -X POST http://127.0.0.1:3012/markup --data-urlencode 'trmnl[user][time_zone_iana]=Europe/Vienna'
```

Code: `src/aoc.js` (fetching, parsing, cache, event timing), `src/view.js` (what the screen shows),
`src/markup.js` (layouts), `src/store.js` (user settings).

## Deployment

Pushes to `main` are tested and deployed by GitHub Actions (`.github/workflows/deploy.yml`), which runs
`deployment/deploy.sh` on the server. The server connection comes from repository secrets. The service writes user
settings to `data/`, which the deploy script creates.

## License

MIT
