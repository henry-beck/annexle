// Game constants + feedback helpers, ported verbatim from the
// missing-country-game.jsx prototype so the wired game matches it.
export const MAX_GUESSES = 6;
export const MAX_DIST = 20000; // km, for the proximity %

const ARROWS = ["⬆️", "↗️", "➡️", "↘️", "⬇️", "↙️", "⬅️", "↖️"];

// 8-way compass emoji for a bearing in degrees (used in the share string).
export function arrowEmoji(bng) {
  return ARROWS[Math.round(bng / 45) % 8];
}

// Distance -> a 0–100% hot/cold score against MAX_DIST.
export function proximityPct(distKm) {
  return Math.max(0, Math.round((1 - distKm / MAX_DIST) * 100));
}
