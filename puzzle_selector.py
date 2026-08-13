"""
Daily puzzle selection — decides WHICH country is the target on a given date.

Reads out/adjacency.json (produced by `missing_country.py adjacency`), which
covers every country regardless of whether missing_country.py has ever built
an SVG for it. This module answers two separate questions:

  1. eligibility  — is this country a FAIR target at all? (see is_eligible)
  2. daily pick   — of the eligible pool, which one does today's date map to?

Wired into missing_country.py's `build-auto` and `build-daily` commands as
the eligibility filter. Not yet wired into the React app (missing-country-game.jsx
still resets its daily index by simple modulo, per README's note on the
days-since-launch-epoch change still needed there).

Usage
-----
    python missing_country.py adjacency   # writes out/adjacency.json first
    python puzzle_selector.py             # prints eligible count + today's pick
"""

import json
import random
import sys
from datetime import date, datetime, timezone

ADJACENCY_PATH = "out/adjacency.json"

# Placeholder — should be set to the game's real launch date once fixed, so
# puzzle N always lands on the same calendar date (per README's daily-index
# note). Until then this just anchors the cycle for local testing.
LAUNCH_DATE = date(2026, 1, 1)


def load_adjacency(path=ADJACENCY_PATH):
    with open(path) as fh:
        return json.load(fh)


# --------------------------------------------------------------- eligibility
def is_eligible(name, adjacency, min_neighbors=2, max_target_ratio=15.0,
                min_neighbor_area_km2=25.0, enclosure_carveout=0.999):
    """
    A country is a fair "missing" target if:

      - it has at least `min_neighbors` REAL land neighbors, where "real"
        means area >= min_neighbor_area_km2. A country bordering one real
        neighbor plus a sliver enclave is treated as a 1-neighbor case —
        the enclave doesn't help the illusion, render_svg drops it as a
        sub-pixel speck anyway.

      - EXCEPTION: a target with exactly one real neighbor is still
        eligible if it's (near) fully enclosed by that neighbor
        (info["enclosure"] >= enclosure_carveout, same 0.999 threshold
        `candidates` uses for "PERFECT (fully enclosed)") — Lesotho,
        San Marino. There the whole hole just fills in solid with no
        ambiguity. This is an explicit exception path, checked only when
        real-neighbor count is exactly 1, NOT a general relaxation of
        min_neighbors — a coastal single-neighbor country (most of its
        border is sea, enclosure well under 0.999) still gets excluded,
        since the swallow is ambiguous there (does the neighbor cross the
        coast, or the sea?), same reasoning as the pipeline's existing
        `enclosure` filter in missing_country.py.

      - at least ONE real neighbor is large enough to plausibly anchor the
        swallow: target_area / (that neighbor's area) <= max_target_ratio.
        Checked against the target's BIGGEST real neighbor, not every
        neighbor — a target can have several small neighbors alongside one
        big one (Austria's 8 neighbors range from Liechtenstein to
        Germany) and still be a clean puzzle, because the actual swallow
        (missing_country.py's Voronoi partition) gives each neighbor a
        slice sized by shared border length, not an equal split. A first
        version of this check required EVERY neighbor to pass and wrongly
        excluded France for merely bordering Belgium alongside three
        bigger neighbors.

        This is intentionally ONE-DIRECTIONAL: a neighbor much BIGGER than
        the target (India next to Nepal, ratio ~22x) is NOT penalized —
        that's the pipeline's own flagship case (enclosure ~1.0, "PERFECT"
        in `candidates`). A huge neighbor's silhouette barely changes when
        it absorbs a small target, which is the illusion the game wants,
        not a defect. A first symmetric version of this check wrongly
        excluded Nepal for exactly that reason.

    All thresholds are exposed as kwargs so they're easy to tune once we
    have real adjacency.json data to eyeball against (see __main__ below).

    NOT handled here on purpose: massive countries with genuine ocean
    coastline (e.g. Russia) are expected to already fail the pipeline's
    existing `enclosure` filter (lots of border is coastline, not
    land-neighbor boundary) — that's a separate, existing check this
    module doesn't duplicate outside of the single-neighbor carve-out
    above, where enclosure is the deciding signal anyway.
    """
    info = adjacency.get(name)
    if info is None:
        return False

    target_area = info["area_km2"]
    if target_area <= 0:
        return False

    real_neighbors = [
        n for n in info["neighbors"]
        if (n_info := adjacency.get(n)) and n_info["area_km2"] >= min_neighbor_area_km2
    ]

    if len(real_neighbors) < min_neighbors:
        fully_enclosed = (
            len(real_neighbors) == 1
            and info.get("enclosure", 0.0) >= enclosure_carveout
        )
        if not fully_enclosed:
            return False

    if not real_neighbors:
        return False
    real_neighbor_areas = [adjacency[n]["area_km2"] for n in real_neighbors]
    if target_area / max(real_neighbor_areas) > max_target_ratio:
        return False

    return True


def eligible_targets(adjacency, **kwargs):
    """Sorted list of country names that pass is_eligible. Sorted (not
    insertion order) so the pool is stable regardless of adjacency.json's
    key order, which matters once we seed a shuffle off of it below."""
    return sorted(
        name for name in adjacency if is_eligible(name, adjacency, **kwargs)
    )


# -------------------------------------------------------- deterministic pick
def _cycle_order(pool, cycle):
    """A pool-length permutation, seeded so it's identical for every player
    and every run. Reshuffled per `cycle` so a full pass through the pool
    doesn't hand out targets in the same order every time it repeats."""
    order = list(pool)
    random.Random(f"missing-country-cycle-{cycle}").shuffle(order)
    return order


def pick_for_date(d, pool, launch=LAUNCH_DATE):
    """Deterministic target for calendar date `d`, same for every player.
    Indexes by days-since-launch into a seeded shuffle of the eligible
    pool (README's suggestion), so within one full cycle of the pool no
    target repeats, and which day a given target lands on is stable even
    if the pool is regenerated (same input -> same order)."""
    if not pool:
        raise ValueError("no eligible targets")
    n = len(pool)
    days = (d - launch).days
    cycle, idx = divmod(days, n)
    return _cycle_order(pool, cycle)[idx]


if __name__ == "__main__":
    adjacency = load_adjacency()
    pool = eligible_targets(adjacency)
    print(f"{len(pool)} / {len(adjacency)} countries eligible")
    today = datetime.now(timezone.utc).date()
    print(f"today ({today}): {pick_for_date(today, pool)}")
