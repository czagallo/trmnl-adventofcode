// Builds the screen's view model from a user's settings and the cached leaderboard. No I/O beyond getBoard/puzzleTitle.

const aoc = require('./aoc');

// cfg: { session, boardId, year: 'auto' | number, memberId } (from the store or env)
async function buildView(cfg, { now = Date.now(), getBoard = aoc.getBoard, puzzleTitle = aoc.puzzleTitle } = {}) {
  if (!cfg || !cfg.session || !cfg.boardId) return { state: 'setup' };

  const auto = !cfg.year || cfg.year === 'auto';
  const year = auto ? aoc.currentEventYear(now) : Number(cfg.year);
  const t = aoc.timing(year, now);
  // Before Day 1 an automatic year shows last year's final standings next to the countdown.
  const boardYear = auto && t.phase === 'before' ? year - 1 : year;

  const res = await getBoard({ year: boardYear, boardId: cfg.boardId, session: cfg.session }, { now });
  const board = res.data;
  const days = board ? board.days : aoc.defaultDays(year);
  const timingNow = aoc.timing(year, now, boardYear === year ? days : aoc.defaultDays(year));

  if (!board) {
    // A board for an event that has not started yet may not exist: the countdown alone is still worth showing.
    if (res.error === 'not_found' && timingNow.phase === 'before') {
      return { state: 'ok', year, boardYear, timing: timingNow, board: null, me: null, today: null, error: null };
    }
    return { state: 'error', error: res.error || 'network', year, boardYear, timing: timingNow };
  }

  const meId = cfg.memberId ? String(cfg.memberId) : board.ownerId;
  const me = board.members.find((m) => m.id === meId) || null;

  let today = null;
  // "Today" only means something while the event is fresh: during the unlocks and until the end of December.
  if (boardYear === year && timingNow.today > 0 && now < Date.UTC(year + 1, 0, 1)) {
    const solvers = aoc.daySolvers(board, timingNow.today);
    today = {
      day: timingNow.today,
      title: puzzleTitle(year, timingNow.today, now),
      finished: solvers.length,
      first: solvers[0] ? { name: solvers[0].name, at: solvers[0].solvedAt[timingNow.today - 1] } : null,
    };
  }

  return {
    state: 'ok',
    year,
    boardYear,
    timing: timingNow,
    board,
    me,
    today,
    error: res.error, // set when the last refresh failed and we are showing older data
    fetchedAt: res.fetchedAt,
  };
}

module.exports = { buildView };
