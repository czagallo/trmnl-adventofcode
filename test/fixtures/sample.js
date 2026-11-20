// Deterministic fake leaderboard in AoC's JSON shape, for tests and previews.
const NAMES = ['Ada Lovelace', 'grace-hopper', 'Linus', null, 'Margaret H.', 'kernighan', 'Barbara Liskov', 'tux', 'Edsger', 'Radia P.', 'Ken T.', 'Frances Allen', 'dmr'];

function samplePayload({ year = 2026, days = 12, solvedDays = 7, owner = 1003 } = {}) {
  const members = {};
  NAMES.forEach((name, i) => {
    const id = 1000 + i;
    const cdl = {};
    let stars = 0;
    let last = 0;
    for (let d = 1; d <= solvedDays; d++) {
      // stronger players near the top, a few gaps and part-one-only days
      const skill = 1 - i / NAMES.length;
      const seed = ((i * 31 + d * 17) % 10) / 10;
      if (seed > skill + 0.25) continue;
      const t1 = Date.UTC(year, 11, d, 5) / 1000 + 600 + i * 420 + d * 97;
      cdl[d] = { 1: { get_star_ts: t1, star_index: 0 } };
      stars++;
      last = t1;
      if (seed < skill) {
        cdl[d][2] = { get_star_ts: t1 + 300 + i * 200, star_index: 1 };
        stars++;
        last = t1 + 300 + i * 200;
      }
    }
    members[id] = { id, name, stars, local_score: stars * (NAMES.length - i) + (stars ? 3 : 0), global_score: 0, last_star_ts: last, completion_day_level: cdl };
  });
  return { event: String(year), owner_id: owner, num_days: days, members };
}

module.exports = { samplePayload };
