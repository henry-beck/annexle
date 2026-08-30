# Roadmap / parked ideas

Future work recorded here so it isn't lost. Nothing in this file is built yet.

## "Distributed distortion" (xkcd-style) difficulty mode

**Status:** parked, not built. Builds on top of the current per-piece swallow.

**What it is.** The current swallow confines every border change to the
*target's own footprint*: one country is erased and its territory is
partitioned among the countries that border each of its pieces. The anomaly is
therefore **localized** — a player who knows the region can focus on the one
area where borders look off.

The distributed mode instead perturbs borders between **non-target** countries
too, so the distortion spreads across the whole region and there is **no clean
hole** to find. This is the [xkcd "Contiguous 41 States"](https://xkcd.com/1902/)
effect: every border is subtly wrong, so no single spot gives the answer away.
It would be a **selectable difficulty mode**, not the default — the localized
swallow stays the standard puzzle.

**How it relates to what exists.** It layers on the per-piece swallow, not a
rewrite of it: after (or instead of) collapsing the target, apply bounded
random perturbations to a set of internal borders among neighboring countries,
seeded deterministically per date.

**Open questions to resolve before building:**
- **Propagation.** How far from the target does perturbation spread — a fixed
  ring of N neighbors, a distance radius, or the whole visible viewport? Too
  little and it's the localized puzzle with noise; too much and every daily
  puzzle looks like the same soup.
- **Determinism.** Perturbations must be identical for every player on a given
  date (same seeding discipline as `puzzle_selector.pick_for_date`), while
  still looking organic.
- **Hover-name giveaway.** The D3 client shows a country's name on hover. If
  distorted regions still report true names, hovering trivializes the puzzle;
  the mode may need to suppress or fuzz hover names, which interacts with the
  base game's hover behavior and needs a deliberate decision.

## Border naturalness (polish)

**Status:** parked, not built. Not needed for a playable v1 — the output is
correct, just stylized.

The per-piece Voronoi swallow produces geometrically clean partition seams —
straight-ish lines meeting at sharp vertices — which read as artificial
compared to real borders. France is the clearest example: radiating straight
lines plus a thin sliver toward the Mediterranean. Two separate issues:

1. **Inherent Voronoi seam straightness.** Future options: jitter/perturb the
   boundaries, snap them to real geographic features (rivers/ridgelines), or use
   a different partition method entirely.
2. **Occasional thin slivers** from a point-contact or micro-neighbor grabbing a
   narrow wedge. Investigate specific cases (France's Med-ward sliver)
   separately.

Best tackled alongside the xkcd distributed-distortion mode above, since both
rewrite the border-drawing path.

---

# Feature roadmap (product backlog)

Product/gameplay backlog, tiered by what gates it. Planning only — nothing here
is built. The two geometry notes above (distortion, border naturalness) are
orthogonal polish items and are not part of these tiers.

## Launch blockers

Needed before a public launch.

- **How-to-play popup.** Opened via a **"?" icon in a corner**. Includes a
  **visual before/after illustration** of a country being swallowed (real map
  before → swallowed map after).
- **Visual / branding.** White background, logo, and icons for the
  options/toggles (replacing the current dark, text-labelled controls).
- **Background timer.** Runs for stats; not necessarily displayed. A
  data-collection primitive that feeds local stats.
- **Local player stats.** Device/browser-local via `localStorage` — **not**
  cross-device. Tracks: guesses-to-solve, all-time success rate, total solved,
  current streak, longest streak.
  - **Regression guard (explicit):** the existing `localStorage` persistence
    (daily progress keyed by date, streak, and the `pref:*` display settings)
    must keep working **unchanged** through all other launch-blocker work. Stats
    extend that same storage layer; verify no regression to daily-progress
    restore or streak counting as this and adjacent features land.
- **Per-puzzle difficulty rating.** easy / medium / hard. (The pipeline already
  computes an `enclosure` score per puzzle plus neighbor counts — a natural
  basis for deriving this label, emitted into `puzzles.json`.)
- **Progressive hint system.** **Replaces the current distance/direction
  feedback entirely** — confirmed to ship at launch, not as a fast-follow. On
  each wrong guess, reveal the next hint:
  1. Arrow toward the general direction / continent.
  2. Distance from all guesses so far, and going forward.
  3. A history fact about the country.
  4. A famous landmark.
  5. Highlight one bordering country on the map.
- **Post-solve country blurb.** After solving, show a short blurb about the
  target country (history / fun facts), inspired by maptag.gg's post-solve info
  panel. **Self-contained** — no external integration with maptag.gg itself.
- **Design note — one shared content bank.** The hint system's history-fact
  (hint 3) and landmark (hint 4) content and the post-solve blurb must draw from
  **one shared per-country content bank**, not content built separately per
  feature. Design the bank's schema once; both features consume it.
- **Open question (unresolved) — content sourcing.** Who sources / writes the
  per-country facts and landmarks for **~165 countries** (history fact,
  landmark, and blurb)? Not yet decided. Flag this as the **likely pace-setting
  dependency for launch**, separate from the code work — the code can be built
  against a schema + stub data, but launch can't happen until the bank is filled.

## Post-launch — requires backend

Deferred: the site is currently **static / `localStorage`-only, with no server**.
These need one built first.

- **Cross-player stats.** Percentile and comparison to other players across all
  stats.
- **Leaderboard.** With name entry + profanity filtering.
- **Multiplayer.**

## Post-launch — self-contained

No backend needed; can follow launch whenever.

- **Archive mode** — play past puzzles; random-5-in-a-row shuffle.
- **Multiple-countries-missing-at-once** mode.
- **Regional practice mode** and alternate modes (e.g. include islands).
- **Options banner / nav** — archive, US, regions, numbers/alphabet (TBD).
- **Misc** — footer with info/copyright; incorrect-guess highlighting on the
  map; per-country mini-games (flag guessing, etc.).

---

# Launch-blocker build sequence (proposed)

Ordering the launch blockers by dependency. Two things drive the order: (1) the
**shared content bank** must exist before both the content-hints and the blurb
are built on it, and (2) the **hint system rewrites the guess→feedback→solve
loop**, which the stats feature measures — so that loop should settle before
stats is finalized.

**Critical path is content, not code.** The open question (who writes ~165
countries of facts/landmarks/blurbs) is the long pole. Kick off content
authoring *first and in parallel* with everything below; the code can be built
against the schema + stub data and swapped to real content when it lands.

1. **Content bank — schema + sourcing kickoff.** Define the per-country record
   (history fact, landmark, blurb; keyed by country code) and start the
   authoring pipeline immediately. No gameplay code yet — this unblocks hints
   3/4 and the blurb and is the pace-setter. Everything downstream can develop
   against stubbed entries.
2. **Difficulty rating.** Cheap and independent — derive easy/med/hard from the
   existing `enclosure` + neighbor data in the pipeline and emit it into
   `puzzles.json`. No content or gameplay-loop dependency; good early win and
   available as context for stats/UI.
3. **Progressive hint system — core loop first.** The largest gameplay change;
   reworks the guess-feedback path (`useGameState` + `GuessPanel`), replacing
   distance/direction. Build the staged-reveal framework and wire the hints that
   need **no content bank** — 1 (direction, reuses `geo.js` bearing), 2
   (distance, reuses `haversine`), and 5 (highlight a bordering country, uses
   the `neighbors` already in `puzzles.json`). Land hints **3 and 4 as content
   arrives**. Do this before finalizing stats, because it defines what a
   "guess" and a "solve" are.
4. **Background timer + local stats.** Build together on the existing
   `localStorage` layer, against the now-settled guess/solve loop from step 3.
   Timer is the data primitive; stats (guesses-to-solve, success rate, total
   solved, current/longest streak) record off the finalized solve event. Run
   the **persistence regression guard** here — confirm daily-progress restore
   and streak counting still work unchanged.
5. **Post-solve blurb.** Consumes the step-1 content bank; ships when blurb
   content is written. Small once the bank exists — a panel shown on solve.
6. **How-to-play popup + before/after illustration.** Build after the hint loop
   (step 3) is final, so the instructions describe the actual shipped mechanics.
   The before/after swallow illustration can be generated from the pipeline (a
   real base map vs. its swallowed diff) rather than hand-drawn.
7. **Visual / branding pass (white bg, logo, toggle icons).** The theme touches
   every screen, so do it as one coherent pass **after** the feature set is
   stable — otherwise UI gets rebuilt twice. Cheap insurance: introduce a color
   **token layer early** (the current code hardcodes dark hex inline) so the
   eventual light-theme swap is a token change, not a component rewrite.

Rough parallelism: content authoring (step 1) runs the whole time; difficulty
(2) is independent and can happen anytime; hints (3) → stats (4) is the main
serial spine; blurb (5) trails the content; instructions (6) trail the hints;
branding (7) is the closing pass. Launch readiness is gated by the content bank
filling up, not by the code.
