"""
Daily puzzle selection — decides WHICH country is the target on a given date.

Reads out/adjacency.json (produced by `missing_country.py adjacency`), which
covers every country regardless of whether missing_country.py has ever built
an SVG for it. This module answers two separate questions:

  1. eligibility  — is this country a FAIR target at all? (see is_eligible)
  2. daily pick   — of the eligible pool, which one does today's date map to?

This file is a draft for review. Nothing in the game or the build pipeline
imports it yet — see the bottom of the file for open questions on the
heuristic before wiring it into build_puzzles / the React app.

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
                min_neighbor_area_km2=25.0):
    """
    A country is a fair "missing" target if:

      - it has at least `min_neighbors` land neighbors. One neighbor means
        the erased territory becomes a single blob added to a single
        country — an unmistakable shape change, not a puzzle (mirrors
        missing_country.py's own build-auto bias against 1-neighbor
        targets, minus its carve-out for fully-enclosed countries like
        Lesotho, which we deliberately do NOT replicate here — that's a
        real open question, see notes below).

      - at least ONE real (>= min_neighbor_area_km2) neighbor is large
        enough to plausibly anchor the swallow: target_area / (that
        neighbor's area) <= max_target_ratio. This is a weak "does a
        plausible absorber exist at all" check against the target's
        BIGGEST real neighbor, not every neighbor — a target can have
        several small neighbors alongside one big one (Austria's 8
        neighbors range from Liechtenstein to Germany) and still be a
        clean puzzle, because the actual swallow (missing_country.py's
        Voronoi partition) gives each neighbor a slice sized by shared
        border length, not an equal split. A first version of this check
        required EVERY neighbor to pass and wrongly excluded France for
        merely bordering Belgium alongside three bigger neighbors — caught
        by the fixture test below.

        Neighbors smaller than `min_neighbor_area_km2` don't count as
        "real" here — render_svg already drops sub-pixel specks, so a
        micro-enclave (Monaco bordering France) shouldn't factor in at
        all.

        This is intentionally ONE-DIRECTIONAL: a neighbor much BIGGER than
        the target (India next to Nepal, ratio ~22x) is NOT penalized —
        that's the pipeline's own flagship case (enclosure ~1.0, "PERFECT"
        in `candidates`). A huge neighbor's silhouette barely changes when
        it absorbs a small target, which is the illusion the game wants,
        not a defect. A first symmetric version of this check wrongly
        excluded Nepal for exactly that reason.

    Both thresholds are exposed as kwargs so they're easy to tune once we
    have real adjacency.json data to eyeball against (see __main__ below).

    NOT handled here on purpose: massive countries with genuine ocean
    coastline (e.g. Russia) are expected to already fail the pipeline's
    existing `enclosure` filter in missing_country.py (lots of border is
    coastline, not land-neighbor boundary) — that's a separate, existing
    check this module doesn't duplicate.

    OPEN QUESTION for review: should min_neighbors count only "real"
    (>= min_neighbor_area_km2) neighbors, so a country bordering one big
    neighbor + one micro-enclave doesn't count as having 2? Currently it
    does NOT — min_neighbors is checked against the raw neighbor list
    before the area floor is applied. Flagging rather than deciding.
    """
    info = adjacency.get(name)
    if info is None:
        return False

    neighbors = info["neighbors"]
    if len(neighbors) < min_neighbors:
        return False

    target_area = info["area_km2"]
    if target_area <= 0:
        return False

    real_neighbor_areas = [
        n_info["area_km2"]
        for n in neighbors
        if (n_info := adjacency.get(n)) and n_info["area_km2"] >= min_neighbor_area_km2
    ]
    if not real_neighbor_areas:
        return False
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
