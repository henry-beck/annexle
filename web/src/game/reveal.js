// Map a reveal level (how many hints are unlocked) to what the map shows:
//   level 0     -> nothing
//   level 1     -> the continent name as text (no circle, no shading)
//   level 2..N  -> the shrinking circles (circles[level-2])
// Russia is a hardcoded special case: every level shows one fixed line, never a
// continent or circle. This is Russia-only, not a general rule.
export function revealFor({ target, continent, circles }, level) {
  if (!level) return { circle: null, text: null };
  if (target === "Russia") return { circle: null, text: "It’s literally Russia" };
  if (level === 1) return { circle: null, text: `Continent: ${continent || "—"}` };
  const circle = circles && circles[level - 2] ? circles[level - 2] : null;
  return { circle, text: null };
}
