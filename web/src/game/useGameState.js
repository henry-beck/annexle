import { useEffect, useState } from "react";
import { haversine, bearing } from "./geo.js";
import { MAX_GUESSES, proximityPct } from "./constants.js";
import { loadProgress, saveProgress, currentStreak, recordResult } from "./storage.js";

// The game brain for one daily puzzle. Owns the guesses + win/lose status,
// persists them under the puzzle's date, restores on reload, and maintains the
// streak. Status is "playing" | "won" | "lost".
export function useGameState({ date, target, targetCentroid, countries }) {
  const [guesses, setGuesses] = useState([]);
  const [status, setStatus] = useState("playing");
  const [streak, setStreak] = useState(() => currentStreak(date));

  // Restore saved progress whenever the puzzle date changes — this is also the
  // day-rollover path: a new date has no (or its own) saved progress. The
  // displayed streak is the gap-aware effective value (broken if a day was
  // missed), not the raw stored count.
  useEffect(() => {
    const saved = loadProgress(date);
    setGuesses(saved?.guesses ?? []);
    setStatus(saved?.status ?? "playing");
    setStreak(currentStreak(date));
  }, [date]);

  function submitGuess(name) {
    if (status !== "playing" || !targetCentroid) return;
    const from = countries.find((c) => c.name === name);
    if (!from) return;

    const correct = name === target;
    const distKm = Math.round(haversine(from, targetCentroid));
    const bearingDeg = Math.round(bearing(from, targetCentroid));
    const entry = {
      name,
      distKm,
      bearingDeg,
      pct: correct ? 100 : proximityPct(distKm),
      correct,
    };

    const nextGuesses = [...guesses, entry];
    const nextStatus = correct
      ? "won"
      : nextGuesses.length >= MAX_GUESSES
      ? "lost"
      : "playing";

    setGuesses(nextGuesses);
    setStatus(nextStatus);
    saveProgress(date, { guesses: nextGuesses, status: nextStatus });

    // Terminal transition happens exactly once (submit is guarded to "playing").
    if (nextStatus !== "playing") {
      setStreak(recordResult(date, nextStatus === "won").count);
    }
  }

  return {
    guesses,
    status,
    remaining: MAX_GUESSES - guesses.length,
    streak,
    submitGuess,
  };
}
