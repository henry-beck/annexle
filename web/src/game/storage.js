// localStorage persistence, all namespaced under "missing-country:".
// Progress is keyed by puzzle DATE, so a new UTC day (or a ?date= override) is a
// fresh key = fresh game, and a refresh mid-game restores the same key.
//
// Defence in depth: each saved record ALSO carries its own date, and load
// validates that stamp against the date being requested. So even if a record
// somehow ends up under the wrong key (a stale/corrupt entry from earlier
// testing, a browser quirk, whatever), it can never be shown for a different
// day — a mismatch is discarded and the day starts fresh.
const NS = "missing-country";
const PROGRESS_PREFIX = `${NS}:progress:`;
const progressKey = (date) => `${PROGRESS_PREFIX}${date}`;
const STREAK_KEY = `${NS}:streak`;

const isValidDate = (d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);

let _pruned = false;
// One-time sweep of malformed progress keys: any progress entry whose key
// suffix isn't a real date, or whose stamped date doesn't match its key
// (e.g. a legacy ":undefined" key, or a cross-date record). Runs once per load.
function pruneLegacyProgress() {
  if (_pruned) return;
  _pruned = true;
  try {
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith(PROGRESS_PREFIX)) continue;
      const date = key.slice(PROGRESS_PREFIX.length);
      let ok = isValidDate(date);
      if (ok) {
        try {
          const rec = JSON.parse(localStorage.getItem(key));
          ok = rec && rec.date === date;
        } catch {
          ok = false;
        }
      }
      if (!ok) localStorage.removeItem(key);
    }
  } catch {
    /* no localStorage — nothing to prune */
  }
}

export function loadProgress(date) {
  pruneLegacyProgress();
  if (!isValidDate(date)) return null;
  try {
    const raw = localStorage.getItem(progressKey(date));
    if (!raw) return null;
    const rec = JSON.parse(raw);
    // The record must know it belongs to THIS date. A mismatch is exactly the
    // "showing another day's game" symptom — drop it and start fresh.
    if (!rec || rec.date !== date) {
      localStorage.removeItem(progressKey(date));
      return null;
    }
    return rec;
  } catch {
    return null;
  }
}

export function saveProgress(date, state) {
  if (!isValidDate(date)) return; // never write an undefined/garbage key
  try {
    localStorage.setItem(progressKey(date), JSON.stringify({ date, ...state }));
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

// Whole-day gap between two UTC calendar-date strings ("YYYY-MM-DD"). Parsed
// field-by-field into Date.UTC so it's immune to the runner's timezone and to
// DST (UTC has none) — the one spot where date math could go subtly wrong.
function dayGap(from, to) {
  const [y1, m1, d1] = from.split("-").map(Number);
  const [y2, m2, d2] = to.split("-").map(Number);
  return (Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000;
}

// Streak to DISPLAY for `today`, given what's stored. Alive only if the last
// completed game was today (already played) or exactly yesterday (not yet
// missed); any larger gap means a day was skipped -> broken -> 0.
export function currentStreak(today) {
  const s = loadStreak();
  if (!s.lastDate) return 0;
  const gap = dayGap(s.lastDate, today);
  return gap === 0 || gap === 1 ? s.count : 0;
}

// Record a finished game's result, ONCE per date (idempotent — reloading a
// completed puzzle won't re-count). Wordle-style: the streak continues only if
// the previous completed game was EXACTLY the day before; a missed day (gap > 1)
// resets it before today's result is applied. A win then increments, a loss
// resets to 0.
export function recordResult(date, won) {
  const s = loadStreak();
  if (s.lastDate === date) return s; // already counted this date (reload)
  const consecutive = s.lastDate && dayGap(s.lastDate, date) === 1;
  const base = consecutive ? s.count : 0; // missed a day / first game -> from 0
  const next = {
    count: won ? base + 1 : 0,
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
