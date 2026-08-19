// localStorage persistence, all namespaced under "missing-country:".
// Progress is keyed by puzzle DATE, so a new UTC day (or a ?date= override) is a
// fresh key = fresh game, and a refresh mid-game restores the same key.
const NS = "missing-country";
const progressKey = (date) => `${NS}:progress:${date}`;
const STREAK_KEY = `${NS}:streak`;

export function loadProgress(date) {
  try {
    const raw = localStorage.getItem(progressKey(date));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveProgress(date, state) {
  try {
    localStorage.setItem(progressKey(date), JSON.stringify(state));
  } catch {
    /* private mode / quota — non-fatal, game still playable this session */
  }
}

export function loadStreak() {
  try {
    const raw = localStorage.getItem(STREAK_KEY);
    return raw ? JSON.parse(raw) : { count: 0, lastDate: null, lastResult: null };
  } catch {
    return { count: 0, lastDate: null, lastResult: null };
  }
}

// Record a finished game's result, ONCE per date (idempotent — reloading a
// completed puzzle won't re-count). Win increments the streak, a loss resets it.
export function recordResult(date, won) {
  const s = loadStreak();
  if (s.lastDate === date) return s; // already counted this date
  const next = {
    count: won ? s.count + 1 : 0,
    lastDate: date,
    lastResult: won ? "won" : "lost",
  };
  try {
    localStorage.setItem(STREAK_KEY, JSON.stringify(next));
  } catch {
    /* non-fatal */
  }
  return next;
}
