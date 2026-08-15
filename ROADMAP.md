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
