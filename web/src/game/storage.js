// localStorage persistence, namespaced. Progress is keyed by puzzle DATE, so a
// new UTC day (or a ?date= override) is a fresh key = fresh game, and a refresh
// mid-game restores the same key.
//
// Defence in depth: each saved record ALSO carries its own date, and load
// validates that stamp against the date being requested. So even if a record
// somehow ends up under the wrong key (a stale/corrupt entry from earlier
// testing, a browser quirk, whatever), it can never be shown for a different
// day — a mismatch is discarded and the day starts fresh.
//
// Everything is built by createStorage(namespace) so multiple isolated stores
// can coexist without ever touching each other's keys — real daily play lives
// under "missing-country:*" (the default instance whose functions are the named
// exports below), and dev/QC play lives under "missing-country:dev:*". The two
// prefixes diverge right after "missing-country:" ("dev:" vs "progress:"/
// "streak"), so neither instance's reads, writes, or prune sweep can see the
// other's data.

const isValidDate = (d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);

// Whole-day gap between two UTC calendar-date strings ("YYYY-MM-DD"). Parsed
// field-by-field into Date.UTC so it's immune to the runner's timezone and to
// DST (UTC has none) — the one spot where date math could go subtly wrong.
function dayGap(from, to) {
  const [y1, m1, d1] = from.split("-").map(Number);
  const [y2, m2, d2] = to.split("-").map(Number);
  return (Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000;
}

// Build an isolated store bound to `ns` (e.g. "missing-country" or
// "missing-country:dev"). All keys, the one-time prune, and the streak live
// entirely under that namespace.
export function createStorage(ns) {
  const PROGRESS_PREFIX = `${ns}:progress:`;
  const progressKey = (date) => `${PROGRESS_PREFIX}${date}`;
  const STREAK_KEY = `${ns}:streak`;

  let pruned = false;
  // One-time sweep of malformed progress keys IN THIS NAMESPACE: any progress
  // entry whose key suffix isn't a real date, or whose stamped date doesn't
  // match its key (e.g. a legacy ":undefined" key, or a cross-date record).
  function pruneLegacyProgress() {
    if (pruned) return;
    pruned = true;
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

  function loadProgress(date) {
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

  function saveProgress(date, state) {
    if (!isValidDate(date)) return; // never write an undefined/garbage key
    try {
      localStorage.setItem(progressKey(date), JSON.stringify({ date, ...state }));
    } catch {
      /* private mode / quota — non-fatal, game still playable this session */
    }
  }

  function loadStreak() {
    try {
      const raw = localStorage.getItem(STREAK_KEY);
      return raw ? JSON.parse(raw) : { count: 0, lastDate: null, lastResult: null };
    } catch {
      return { count: 0, lastDate: null, lastResult: null };
    }
  }

  // Streak to DISPLAY for `today`, given what's stored. Alive only if the last
  // completed game was today (already played) or exactly yesterday (not yet
  // missed); any larger gap means a day was skipped -> broken -> 0.
  function currentStreak(today) {
    const s = loadStreak();
    if (!s.lastDate) return 0;
    const gap = dayGap(s.lastDate, today);
    return gap === 0 || gap === 1 ? s.count : 0;
  }

  // Record a finished game's result, ONCE per date (idempotent — reloading a
  // completed puzzle won't re-count). Wordle-style: the streak continues only if
  // the previous completed game was EXACTLY the day before; a missed day
  // (gap > 1) resets it before today's result is applied. A win then
  // increments, a loss resets to 0.
  function recordResult(date, won) {
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

  return { loadProgress, saveProgress, loadStreak, currentStreak, recordResult };
}

// Global player preferences (not date-keyed): a display choice like distinct
// coloring persists across every day and every session. Stored under
// "missing-country:pref:*", a prefix that can't collide with progress/streak or
// the dev store. Every access is wrapped so private mode / disabled storage just
// falls back to the default instead of throwing.
const PREF_PREFIX = "missing-country:pref:";

export function loadPref(key, fallback) {
  try {
    const raw = localStorage.getItem(`${PREF_PREFIX}${key}`);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function savePref(key, value) {
  try {
    localStorage.setItem(`${PREF_PREFIX}${key}`, JSON.stringify(value));
  } catch {
    /* private mode / quota — non-fatal, choice just isn't remembered */
  }
}

// The real daily-play store. Its methods are re-exported as module functions so
// existing callers keep working unchanged.
export const defaultStorage = createStorage("missing-country");
export const loadProgress = defaultStorage.loadProgress;
export const saveProgress = defaultStorage.saveProgress;
export const loadStreak = defaultStorage.loadStreak;
export const currentStreak = defaultStorage.currentStreak;
export const recordResult = defaultStorage.recordResult;
