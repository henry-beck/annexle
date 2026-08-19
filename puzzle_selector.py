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

# The game's launch date (day 0 of the daily rotation): puzzle N always lands
# on LAUNCH_DATE + N days. The manifest is generated from this, so regenerate
# it (missing_country.py manifest) after any change.
LAUNCH_DATE = date(2026, 8, 18)


def load_adjacency(path=ADJACENCY_PATH):
    with open(path) as fh:
        return json.load(fh)


# --------------------------------------------------------------- eligibility
def is_eligible(name, adjacency, min_neighbor_area_km2=25.0):
    """
    Widest rule: a country is an eligible target if it has AT LEAST ONE
    real (area >= min_neighbor_area_km2) land-border neighbor from
    find_neighbors(). Neighbors below that floor don't count — a
    micro-enclave (Monaco-in-France) can't be what a neighbor "expands
    into," render_svg drops it as a sub-pixel speck anyway.

    That's the entire rule. No enclosure floor, no neighbor-count minimum
    above one, no size-ratio check — earlier versions of this function had
    all three (a >=2-real-neighbor minimum with a fully-enclosed carve-out
    for exactly one, a target/neighbor size-ratio cap, and a manually
    curated allowlist of real coastal single-neighbor countries), each
    added to patch a specific bad case. All three are now subsumed by this
    one rule and deliberately removed rather than kept as dead code —
    quality concerns those checks used to catch (coastal ambiguity,
    implausible size mismatches, inflated render viewports) are handled
    downstream instead: `enclosure` is still computed and attached to each
    puzzle (see build_adjacency in missing_country.py) as a difficulty
    label for later ordering/tagging, not a gate here; and specific
    structural risks (a multi-island target where a neighbor only borders
    one disconnected part, e.g. UK/Ireland via Northern Ireland; a target
    whose render viewport is inflated by far-flung islands, e.g.
    Denmark/Bornholm) are surfaced by manual review/flagging before a
    country is actually built, not filtered out formulaically.

    Zero real neighbors means the target is excluded — pure islands (Sri
    Lanka, Iceland, Japan, Cuba, ...) and bridge/causeway-only "neighbors"
    (Bahrain, Singapore: the causeway isn't a shared polygon boundary, so
    find_neighbors already reports these as having none). There's no
    adjacent land for any neighbor to expand into, so there's no swallow
    to construct. These countries stay in the countries.json guess pool;
    they just can't be the hidden target.
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
    return len(real_neighbors) >= 1


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
