import { MAX_GUESSES, arrowEmoji } from "./constants.js";

// Worldle-style share string for an end-of-game result. Pure (no DOM / no
// import.meta) so it's unit-testable and the caller supplies the site URL.
//
// Each guess is 5 proximity squares + a direction arrow: one 🟩 per full 20%
// of proximity, a 🟨 if the leftover is at least half a square (≥10%), the rest
// ⬜. The correct guess is 🟩🟩🟩🟩🟩🎯 (no arrow — it's the answer).

export function proximitySquares(pct) {
  const green = Math.floor(pct / 20);
  const half = pct - green * 20 >= 10 ? 1 : 0;
  const white = 5 - green - half;
  return "🟩".repeat(green) + "🟨".repeat(half) + "⬜".repeat(white);
}

export function shareRow(g) {
  return g.correct ? "🟩🟩🟩🟩🟩🎯" : proximitySquares(g.pct) + arrowEmoji(g.bearingDeg);
}

export function buildShareText({ dayNumber, date, status, guesses, streak, url }) {
  const score = status === "won" ? guesses.length : "X";
  const day = dayNumber == null ? "?" : dayNumber;
  const header = `#Annexle #${day} (${date}) ${score}/${MAX_GUESSES}`;
  const streakLine = `🔥 Current streak: ${streak} ${streak === 1 ? "day" : "days"}`;
  return [header, streakLine, ...guesses.map(shareRow), url].join("\n");
}
