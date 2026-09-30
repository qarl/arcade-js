#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""Frogger mechanic-coverage poke suite — the game side of tools/mechanics_gate.py.

THE MODEL (poke, don't play). For each declared mechanic, poke its scenario IDENTICALLY into MAME (a tape lua
captured by tools/mame_golden.py) and into the idiomatic JS engine (mech_compare.mjs), drive a few frames,
and assert the two RAMs AGREE byte-for-byte at the boot reconverge offset. MAME is the ORACLE (no
hand-authored expected value), so a faithful-but-wrong port fails too.

CONTRACT: print one line per test — `MECHANIC <id> PASS` or `MECHANIC <id> FAIL <reason>` — and exit 0 on a
clean run. REQUIRES `mame` + `frogger.zip` under the rompath, `node`, and the assembled ROM at
games/frogger/rom/; a missing prerequisite is a fail-closed FAIL.

timer_expiry: the scene core renderFrogSceneAndTickTimer (0x0942) decrements TIME_REMAINING_P1 (0x83e5) and
raises the expiry flag 0x83cf at 0, but only re-runs while BOARD_LAYOUT_GATE (0x83ea) is held 0 (steady
in-play latches it SET and the timer freezes — verified vs MAME). So the scenario holds 0x83ea=0 in both
engines, seeds 0x83e5, and asserts JS==MAME across the drain window. Scope: this tick + flag only; the
death-on-timeout cascade is separate translated code, out of scope for this first slice.
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
SCENARIO_LUA = os.path.join(REPO, "games/frogger/tapes/timer_expiry.lua")
HARDWARE = os.path.join(REPO, "boards/frogger/hardware.json")
LUA_DIR = os.path.join(REPO, "games/frogger/tools/lua")
ROMPATH = os.path.expanduser(os.environ.get("FROGGER_ROMPATH", "~/Downloads"))

# One dict per mechanic keeps the MAME lua env and the JS comparator args in lockstep (same pokes to both).
# Frames are CANONICAL MAME frame numbers; the JS side is shifted by `delta` internally by mech_compare.mjs.
TIMER_EXPIRY = dict(
    id="timer_expiry",
    coin=150, start=210,
    gate_hold_from=330,     # open the board-layout gate late, after BOTH engines are in the settled frozen state
    poke_frame=360, poke_val=8,
    delta=51,               # idiomatic boot runs this many vblank-yields AHEAD of MAME (measured; vs-oracle-gameplay)
    pre_landmark=325,       # frozen state BEFORE the gate-hold — pins the reconverge offset independently
    drain_landmark=370,     # after the poked countdown hits 0 at poke_frame+poke_val (=368) — window covers expiry
    window=20,
    search="30,72",
    seconds=9,              # golden length; must reach past drain_landmark
    frames=430,
)


def capture_golden(mech, out_dir):
    """Capture the MAME golden state.bin for a mechanic scenario. Returns (ok, state_path, detail)."""
    env = dict(os.environ)
    env.update(
        TAPE_COIN_FRAME=str(mech["coin"]),
        TAPE_START_FRAME=str(mech["start"]),
        TAPE_GATE_HOLD_FROM=str(mech["gate_hold_from"]),
        TAPE_TIMER_POKE_FRAME=str(mech["poke_frame"]),
        TAPE_TIMER_POKE_VAL=str(mech["poke_val"]),
    )
    argv = [
        sys.executable, os.path.join(REPO, "tools/mame_golden.py"),
        "--hardware", HARDWARE,
        "--lua-dir", LUA_DIR,
        "--rompath", ROMPATH,
        "--tape", SCENARIO_LUA,
        "--out", out_dir,
        "--seconds", str(mech["seconds"]),
        "--no-frames",
    ]
    try:
        r = subprocess.run(argv, env=env, cwd=REPO, capture_output=True, text=True, timeout=1200)
    except (OSError, subprocess.SubprocessError) as e:
        return False, None, f"MAME golden capture failed to run: {e}"
    state = os.path.join(out_dir, "state.bin")
    if r.returncode != 0 or not os.path.exists(state):
        tail = (r.stdout + r.stderr).strip().splitlines()[-3:]
        return False, None, f"MAME golden capture did not certify ({' | '.join(tail)})"
    return True, state, ""


def run_compare(mech, state_path):
    """Run the JS-vs-MAME comparator. Returns (ok, detail) parsed from its RESULT line."""
    argv = [
        "node", MECH_COMPARE,
        "--golden", state_path,
        "--coin", str(mech["coin"]), "--start", str(mech["start"]),
        "--gate-hold-from", str(mech["gate_hold_from"]),
        "--timer-poke", f"{mech['poke_frame']}={mech['poke_val']}",
        "--delta", str(mech["delta"]),
        "--frames", str(mech["frames"]),
        "--pre-landmark", str(mech["pre_landmark"]),
        "--drain-landmark", str(mech["drain_landmark"]),
        "--window", str(mech["window"]),
        "--search", mech["search"],
    ]
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
    """Run one mechanic test; print its MECHANIC result line. Returns True iff it PASSED."""
    mid = mech["id"]
    with tempfile.TemporaryDirectory(prefix=f"mech_{mid}_") as out_dir, raw_dumps(out_dir, rmtree=True):
        ok, state, detail = capture_golden(mech, out_dir)
        if not ok:
            print(f"MECHANIC {mid} FAIL {detail}")
            return False
        ok, detail = run_compare(mech, state)
        print(f"MECHANIC {mid} {'PASS' if ok else 'FAIL ' + detail}")
        return ok


def main():
    # The gate blocks off the MECHANIC FAIL line regardless, but a direct invocation should reflect a
    # failure in its exit code too.
    return 0 if run_test(TIMER_EXPIRY) else 1


if __name__ == "__main__":
    sys.exit(main())
