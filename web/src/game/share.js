import { MAX_GUESSES } from "./constants.js";

// Worldle-style share string for an end-of-game result. Pure (no DOM / no
// import.meta) so it's unit-testable and the caller supplies the site URL.
//
// One block per attempt, in order: 🟥 a wrong guess, ⬛ a skip, 🟩 the winning
// guess. There's no per-guess proximity under the shrinking-circle mechanic, so
// the row shows the guess/skip pattern and how many attempts it took.

export function attemptBlock(a) {
  if (a.correct) return "🟩";
  return a.type === "skip" ? "⬛" : "🟥";
}

export function buildShareText({ dayNumber, date, status, attempts, streak, url }) {
  const score = status === "won" ? attempts.length : "X";
  const day = dayNumber == null ? "?" : dayNumber;
  const header = `#Annexle #${day} (${date}) ${score}/${MAX_GUESSES}`;
  const streakLine = `🔥 Current streak: ${streak} ${streak === 1 ? "day" : "days"}`;
  const blocks = attempts.map(attemptBlock).join("");
  return [header, streakLine, blocks, url].join("\n");
}
