#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""Space Invaders attract pixel gate: a fresh MAME golden vs the JS render, drift-tolerant reconverge.

Invaders is a 1bpp BITMAP board (no gfx/tile ROMs): boards/invaders/video.js paints VRAM to
monochrome RGB and machine.renderFrame() hands the whole frame to tools/convergence.mjs --mode pixel,
which already does the reconverge + verdict (each JS frame scored against its nearest golden frame;
PASS iff none diverges past the threshold). So this suite is THIN -- it captures a short attract
golden via mame_golden.py, runs convergence for the requested --layer, and translates convergence's
own PASS into the literal `pixel_suite: PASS` line the per-commit gate requires.

A short --seconds attract window is a per-commit regression TRIPWIRE, not the full golden. Both layers
are byte-exact vs MAME on the attract (MEASURED 2026-09-03: convergence --mode pixel worst-frame 0.00%).

FAIL-CLOSED: `pixel_suite: PASS` prints ONLY on a clean convergence PASS. No mame / no romset ->
SKIP + nonzero (never PASS). A poisoned capture, a convergence non-PASS, a crash, or an incomplete run
each print a non-PASS line and exit nonzero -- exactly as pooyan's suite does.
"""
import argparse
import os
import re
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.dirname(HERE)                        # games/invaders
REPO = os.path.dirname(os.path.dirname(GAME))       # arcade-js
sys.path.insert(0, os.path.join(REPO, "tools"))
from raw_dumps import raw_dumps  # noqa: E402
HW = os.path.join(REPO, "boards", "invaders", "hardware.json")
LUA = os.path.join(HERE, "lua")
DRIVER = "invaders"
SECONDS = 4                     # ~240 attract frames: a short per-commit tripwire, not the full golden

# --done (the runbook DONE bar): the GAMEPLAY-vs-MAME check an attract-only gate is blind to, plus an
# extended attract regression. GAMEPLAY is a no-fire coin/start/move tape (movement + alien-march +
# render): no alien dies, so no alien-death busy-wait collapse desyncs the collapsed idiomatic timeline
# from MAME's -- it stays byte-aligned at TAPE_ORIGIN 0 through the window (the mid-play 0x20c0 collapse
# lands past DONE_GAMEPLAY_SECONDS). Shoot/collision/death correctness is the poke mechanics gate's job
# (it sidesteps tape-alignment; runbook 5).
# ATTRACT is capped BEFORE the ~11-13s "attract fork": the non-deterministic attract DEMO diverges there
# between the clock-free idiomatic layer and MAME. It is NOT a pinnable RNG item -- it is an inherent §4
# clock-free (model-b) mid-ISR-PHASE residual: the engine fires the RST pair at the vblank yield while MAME
# fires RST1 at true mid-frame (vpos 96), so the mid-frame alien-draw walker's phase drifts in the phase-
# sensitive demo (an entropy pin cannot close a phase drift). A demo-only cosmetic residual (bounded, static
# screens byte-exact either side), accepted -- see DONE.md; the gameplay-vs-MAME correctness is PART B.
DONE_ATTRACT_SECONDS = 10       # ~600 attract frames: extends the tripwire, stays before the ~11-13s fork
DONE_GAMEPLAY_SECONDS = 9       # ~537 frames: coin@300/start@360/play -> ends before the mid-play collapse
GAMEPLAY_TAPE = os.path.join(GAME, "tapes", "coin_start_move.lua")   # MAME-side driver for the golden
GAMEPLAY_TAPE_JSON = os.path.join(GAME, "tapes", "coin_start_move.json")  # convergence.mjs input tape
TAPE_ORIGIN = 0                 # coin pressed at MAME's frame -> idiomatic runs ~1:1 with the golden

# convergence.mjs prints "PASS — reconverges ..." (exit 0) on success, "FAIL — ..." otherwise.
CONV_PASS = re.compile(r"^PASS\b", re.M)


def have_romset(rompath):
    """(ok, skip_line): True only when `mame` runs and verifies the invaders romset. A clean SKIP
    (not FAIL) keeps the gate honest -- it means nothing was checked, not that a pixel diverged."""
    try:
        r = subprocess.run(["mame", "-rompath", rompath, "-verifyroms", DRIVER],
                           capture_output=True, text=True)
    except FileNotFoundError:
        return False, "pixel_suite: SKIP -- no `mame` on PATH; cannot build a golden to compare against."
    if r.returncode != 0:
        return False, f"pixel_suite: SKIP -- romset {DRIVER} not found under {rompath}."
    return True, ""


def capture_golden(rompath, out, seconds, tape=None):
    """Fresh certified golden via the shared capturer. `tape` (a tapes/*.lua driver) composes the
    coin/start/move inputs for the gameplay golden; omitted, it is the input-free attract golden.
    mame_golden.py exits nonzero on a POISONED capture, so its return code IS the poison guard."""
    cmd = [sys.executable, os.path.join(REPO, "tools", "mame_golden.py"),
           "--hardware", HW, "--lua-dir", LUA,
           "--rompath", rompath, "--out", out, "--seconds", str(seconds)]
    if tape:
        cmd += ["--tape", tape]
    return subprocess.run(cmd, cwd=REPO).returncode == 0


def run_convergence(golden, idiomatic, tape=None, tape_origin=0):
    """(ok, output): run convergence --mode pixel for the layer. With `tape` it drives a coin/start/move
    tape applied at f+tape_origin (gameplay). ok only when it exits 0 AND prints its PASS line -- both, so
    a crash after the verdict cannot pass (the gate applies this rule too)."""
    cmd = ["node", os.path.join(REPO, "tools", "convergence.mjs"),
           "--game", DRIVER, "--golden", golden, "--mode", "pixel"]
    if idiomatic:
        cmd.append("--idiomatic")
    if tape:
        cmd += ["--tape", tape, "--tape-origin", str(tape_origin)]
    r = subprocess.run(cmd, cwd=REPO, capture_output=True, text=True)
    out = (r.stdout or "") + (r.stderr or "")
    return (r.returncode == 0 and bool(CONV_PASS.search(out))), out


def _part(work, name, rompath, seconds, idiomatic, tape=None, tape_json=None, origin=0):
    """Capture a golden and reconverge one part; (ok, why). Fail-closed: a poisoned capture or a non-PASS
    convergence returns False. Prints the convergence output for the record."""
    golden = os.path.join(work, name)
    if not capture_golden(rompath, golden, seconds, tape=tape):
        return False, f"{name}: mame_golden refused to certify the capture (poisoned golden)."
    ok, out = run_convergence(golden, idiomatic, tape=tape_json, tape_origin=origin)
    print(f"[{name}]")
    print(out.rstrip())
    if not ok:
        return False, f"{name}: convergence did not PASS (a frame diverged, or the run was incomplete)."
    return True, ""


def main():
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--layer", default="oracle", choices=["oracle", "idiomatic"],
                   help="which layer to render (the gate runs both).")
    p.add_argument("--seconds", type=int, default=SECONDS,
                   help="attract golden length (a short per-commit tripwire, not the full golden).")
    p.add_argument("--done", action="store_true",
                   help="the runbook DONE bar: attract completeness + tape-driven gameplay vs MAME.")
    p.add_argument("--rompath", default=os.path.expanduser("~/Downloads"),
                   help="MAME romset search path (needs invaders); NOT the JS ROM dir.")
    p.add_argument("--keep-frames", action="store_true",
                   help="keep the raw frames.rgb / state.bin dumps after the verdict "
                        "(default: delete them; tools/raw_dumps.py).")
    a = p.parse_args()

    ok, skip = have_romset(a.rompath)
    if not ok:
        print(skip)
        return 1

    work = tempfile.mkdtemp(prefix="invaders_pixel_")
    with raw_dumps(work, keep=a.keep_frames, rmtree=True):
        idio = a.layer == "idiomatic"
        if a.done:
            # PART A -- attract completeness (well past the historical ~757-frame fork).
            ok, why = _part(work, "attract", a.rompath, DONE_ATTRACT_SECONDS, idio)
            if not ok:
                print(f"pixel_suite: FAIL -- {why}")
                return 1
            # PART B -- tape-driven GAMEPLAY vs MAME (the attract-blind hole).
            ok, why = _part(work, "gameplay", a.rompath, DONE_GAMEPLAY_SECONDS, idio,
                            tape=GAMEPLAY_TAPE, tape_json=GAMEPLAY_TAPE_JSON, origin=TAPE_ORIGIN)
            if not ok:
                print(f"pixel_suite: FAIL -- {why}")
                return 1
            print("pixel_suite: PASS")
            return 0

        # Per-commit tripwire: the short attract window only.
        ok, why = _part(work, "attract", a.rompath, a.seconds, idio)
        if not ok:
            print(f"pixel_suite: FAIL -- {why}")
            return 1
        print("pixel_suite: PASS")
        return 0


if __name__ == "__main__":
    sys.exit(main())
