#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""Space Invaders mechanic-coverage poke suite — the game side of tools/mechanics_gate.py.

THE MODEL (poke, don't play). For each declared mechanic, poke its scenario IDENTICALLY into MAME (a tape lua
captured by tools/mame_golden.py) and into the idiomatic JS engine (mech_compare.mjs), then assert the
mechanic's own cells AGREE with MAME. MAME is the ORACLE (no hand-authored expected value), so a
faithful-but-wrong port fails too. mech_compare.mjs documents why invaders asserts the mechanic's write-set at
a pinned frame offset rather than frogger's whole-RAM byte-compare (the non-deterministic alien-shot subsystem)
and why each compare window stays PRE-COLLAPSE.

CONTRACT: print one line per test — `MECHANIC <id> PASS` or `MECHANIC <id> FAIL <reason>` — and exit 0 on a
clean run. REQUIRES `mame` + `invaders.zip` under the rompath, `node`, and the assembled ROM at
games/invaders/rom/; a missing prerequisite is a fail-closed FAIL.

Each mechanic keeps its MAME tape env and the JS comparator args in lockstep (the same pokes to both). `offset`
is the measured boot/collapse frame lead of the idiomatic ordinal behind the MAME frame (invaders' analogue of
frogger's fixed delta); mech_compare pins and confirms it before asserting the window.

  extra_ship_award      — awardExtraShip (0x0935): arm the award-pending flag (0x20e5) + seat the tally
                          (0x20f9) above the bonus threshold; the reserve count (0x21ff) rises by one, flag
                          clears, the lives-digit column repaints.
  player_shot_hits_alien — resolvePlayerShotHit (0x14d8): seat a live player shot one step below a bottom-row
                          alien (a live column); the ROM's stepper drives it up, the collision latches, the
                          alien dies — grid cell 0x2100 live->0, PLAYER_SHOT_STATUS 2->5, ALIEN_COUNT -1, kill
                          score added (0x20f8/0x20f9).
  player_death          — playerShipHandler (0x028e): seat the record-0 death drain (the ship-hit state) with
                          two reserves; the ROM consumes the life — reserve count (0x21ff) 2->1 and the round
                          continues (respawn: GAME_ACTIVE / GAME_IN_PROGRESS stay set).
"""

import os
import re
import subprocess
import sys
import tempfile

TOOLS = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(os.path.dirname(TOOLS)))
sys.path.insert(0, os.path.join(REPO, "tools"))
from raw_dumps import raw_dumps  # noqa: E402
MECH_COMPARE = os.path.join(TOOLS, "mech_compare.mjs")
HARDWARE = os.path.join(REPO, "boards/invaders/hardware.json")
LUA_DIR = os.path.join(REPO, "games/invaders/tools/lua")
TAPES = os.path.join(REPO, "games/invaders/tapes")
ROMPATH = os.path.expanduser(os.environ.get("INVADERS_ROMPATH", "~/Downloads"))

EXTRA_SHIP_AWARD = dict(
    id="extra_ship_award",
    scenario_lua=os.path.join(TAPES, "extra_ship_award.lua"),
    coin=300,
    start=360,
    poke_frame=760,
    tally_val=0x20,  # above either 0x10/0x15 bonus threshold
    offset=24,
    pin_landmark=740,  # pre-poke; confirms the offset alignment
    win_lo=763,
    win_hi=770,  # after the award has fired (count risen, flag cleared)
    seconds=17,  # golden length; must reach past win_hi (17s ~= 1014 frames)
)

PLAYER_SHOT_HITS_ALIEN = dict(
    id="player_shot_hits_alien",
    scenario_lua=os.path.join(TAPES, "player_shot_hits_alien.lua"),
    coin=300,
    start=360,
    poke_frame=764,  # JS ordinal 740 (poke) + offset 24; the shot is seated below a bottom-row alien
    offset=24,
    pin_landmark=740,  # pre-poke; confirms the offset alignment
    win_lo=766,
    win_hi=772,  # after the kill (cell 0x2100 cleared, status 5), before the explosion-despawn collapse
    seconds=15,  # golden length; must reach past win_hi (15s ~= 895 frames)
)

PLAYER_DEATH = dict(
    id="player_death",
    scenario_lua=os.path.join(TAPES, "player_death.lua"),
    coin=300,
    start=360,
    poke_frame=764,  # JS ordinal 740 (poke) + offset 24; the record-0 death-drain seat
    reserves=2,      # seat two reserves so the 2->1 drop is non-vacuous
    offset=24,
    pin_landmark=740,  # pre-poke; confirms the offset alignment
    win_lo=766,
    win_hi=772,  # after the life is consumed (reserve 2->1, respawn), before the respawn collapse
    seconds=15,
)

MECHS = [EXTRA_SHIP_AWARD, PLAYER_SHOT_HITS_ALIEN, PLAYER_DEATH]


def capture_golden(mech, out_dir):
    """Capture the MAME golden state.bin for a mechanic scenario. Returns (ok, state_path, detail)."""
    env = dict(os.environ)
    env.update(
        TAPE_COIN_FRAME=str(mech["coin"]),
        TAPE_START_FRAME=str(mech["start"]),
        TAPE_POKE_FRAME=str(mech["poke_frame"]),
    )
    if "tally_val" in mech:
        env["TAPE_TALLY_VAL"] = str(mech["tally_val"])
    if "reserves" in mech:
        env["TAPE_RESERVES"] = str(mech["reserves"])
    argv = [
        sys.executable,
        os.path.join(REPO, "tools/mame_golden.py"),
        "--hardware",
        HARDWARE,
        "--lua-dir",
        LUA_DIR,
        "--rompath",
        ROMPATH,
        "--tape",
        mech["scenario_lua"],
        "--out",
        out_dir,
        "--seconds",
        str(mech["seconds"]),
        "--no-frames",
    ]
    try:
        r = subprocess.run(
            argv, env=env, cwd=REPO, capture_output=True, text=True, timeout=1200
        )
    except (OSError, subprocess.SubprocessError) as e:
        return False, None, f"MAME golden capture failed to run: {e}"
    state = os.path.join(out_dir, "state.bin")
    if r.returncode != 0 or not os.path.exists(state):
        tail = (r.stdout + r.stderr).strip().splitlines()[-3:]
        return False, None, f"MAME golden capture did not certify ({' | '.join(tail)})"
    return True, state, ""


def run_compare(mech, state_path, perturb=False):
    """Run the JS-vs-MAME comparator. Returns (ok, detail) parsed from its RESULT line."""
    argv = [
        "node",
        MECH_COMPARE,
        "--mechanic",
        mech["id"],
        "--golden",
        state_path,
        "--coin",
        str(mech["coin"]),
        "--start",
        str(mech["start"]),
        "--poke-frame",
        str(mech["poke_frame"]),
        "--offset",
        str(mech["offset"]),
        "--pin-landmark",
        str(mech["pin_landmark"]),
        "--win-lo",
        str(mech["win_lo"]),
        "--win-hi",
        str(mech["win_hi"]),
    ]
    if "tally_val" in mech:
        argv += ["--tally-val", str(mech["tally_val"])]
    if perturb:
        argv += ["--perturb"]
    try:
        r = subprocess.run(argv, cwd=REPO, capture_output=True, text=True, timeout=600)
    except (OSError, subprocess.SubprocessError) as e:
        return False, f"comparator failed to run: {e}"
    m = re.search(r"^RESULT (PASS|FAIL)\b(.*)$", r.stdout + r.stderr, re.M)
    if not m:
        tail = (r.stdout + r.stderr).strip().splitlines()[-2:]
        return False, f"comparator produced no RESULT line ({' | '.join(tail)})"
    return m.group(1) == "PASS", m.group(2).strip()


def run_test(mech):
    """Run one mechanic test; print its MECHANIC result line. Returns True iff it PASSED.

    A pass requires BOTH the real compare to PASS and the --perturb mutation to FAIL — a mechanic whose
    perturbed twin still passes has no teeth and is reported as a failure."""
    mid = mech["id"]
    with tempfile.TemporaryDirectory(prefix=f"mech_{mid}_") as out_dir, raw_dumps(out_dir, rmtree=True):
        ok, state, detail = capture_golden(mech, out_dir)
        if not ok:
            print(f"MECHANIC {mid} FAIL {detail}")
            return False
        ok, detail = run_compare(mech, state)
        if not ok:
            print(f"MECHANIC {mid} FAIL {detail}")
            return False
        # Teeth: the perturbed (trigger-dropped) twin MUST diverge, or the compare proves nothing.
        pok, pdetail = run_compare(mech, state, perturb=True)
        if pok:
            print(f"MECHANIC {mid} FAIL --perturb still PASSED (vacuous — the compare has no teeth)")
            return False
        print(f"MECHANIC {mid} PASS")
        return True


def main():
    ok = True
    for mech in MECHS:
        ok = run_test(mech) and ok
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
