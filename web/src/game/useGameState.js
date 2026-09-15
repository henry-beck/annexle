import { useEffect, useState } from "react";
import { MAX_GUESSES } from "./constants.js";
import { defaultStorage } from "./storage.js";

// The game brain for one daily puzzle. Owns the ordered ATTEMPTS (each a guess
// or a skip) + win/lose status, persists them under the puzzle's date, restores
// on reload, and maintains the streak. Status is "playing" | "won" | "lost".
//
// A guess and a skip both consume one of MAX_GUESSES attempts and advance the
// hint reveal identically. `revealLevel` is how many hints are unlocked (one per
// wrong attempt, capped at MAX_GUESSES-1): reveal 1 is the continent, reveals
// 2.. are the shrinking circles. The final (6th) attempt unlocks no new hint —
// it's played against reveal 5's circle (sudden death).
//
// `storage` is injectable (a createStorage() instance) so dev/QC play can run
// against an isolated namespace without ever touching real daily-play keys.
export function useGameState({ date, target, countries, storage = defaultStorage }) {
  const { loadProgress, saveProgress, currentStreak, recordResult } = storage;
  const [attempts, setAttempts] = useState([]);
  const [status, setStatus] = useState("playing");
  const [streak, setStreak] = useState(() => currentStreak(date));

  // Restore saved progress whenever the puzzle date changes — this is also the
  // day-rollover path: a new date has no (or its own) saved progress.
  useEffect(() => {
    const saved = loadProgress(date);
    setAttempts(saved?.attempts ?? []);
    setStatus(saved?.status ?? "playing");
    setStreak(currentStreak(date));
  }, [date]);

  // Append one attempt and derive the new status. Guarded to "playing" so the
  // terminal streak transition happens exactly once.
  function commit(entry) {
    if (status !== "playing") return;
    const next = [...attempts, entry];
    const nextStatus = entry.correct
      ? "won"
      : next.length >= MAX_GUESSES
      ? "lost"
      : "playing";
    setAttempts(next);
    setStatus(nextStatus);
    saveProgress(date, { attempts: next, status: nextStatus });
    if (nextStatus !== "playing") {
      setStreak(recordResult(date, nextStatus === "won").count);
    }
  }

  function submitGuess(name) {
    if (status !== "playing") return;
    if (!countries.find((c) => c.name === name)) return; // guard: pool member only
    commit({ type: "guess", name, correct: name === target });
  }

  function submitSkip() {
    if (status !== "playing") return;
    commit({ type: "skip", correct: false });
  }

  const wrong = attempts.filter((a) => !a.correct).length;
  return {
    attempts,
    status,
    remaining: MAX_GUESSES - attempts.length,
    streak,
    revealLevel: Math.min(wrong, MAX_GUESSES - 1), // hints unlocked so far
    submitGuess,
    submitSkip,
  };
}
