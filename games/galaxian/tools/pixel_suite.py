#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""Galaxian pixel gate: a fresh MAME golden vs the JS render, drift-tolerant reconverge.

Galaxian has a hardware LFSR STARFIELD (boards/galaxian/video.js) over a tile/sprite pipeline; the attract
screen twinkles+scrolls it, so the diff is drift-tolerant (each JS frame vs its NEAREST golden frame, via
tools/convergence.mjs --mode pixel). VALIDATED 2026-09-07: --idiomatic reconverges 0px on most frames,
worst 0.56% over the full ~1200-frame golden.

BORN-LIVE: galaxian's whole-game spine (mainLoop, enterVblankService) is idiomatic and runs on the
generator engine; there is NO separate cycle-free oracle whole-game render (the pure-translated runCycleFree
path can't drive the idiomatic spine). So this suite ALWAYS renders the IDIOMATIC layer -- the shipped
whole-game render -- for either --layer flag (the translated oracle is the per-routine equivalence
reference, exercised by the equivalence-<addr> tests, not a whole-game pixel target). This keeps the gate
covering the shipped layer (pixel-gate.md `suite_renders_idiomatic`).

FAIL-CLOSED: `pixel_suite: PASS` prints ONLY on a clean convergence PASS. No mame / no romset -> SKIP +
nonzero (never PASS). A poisoned capture, a convergence non-PASS, a crash, or an incomplete run each print a
non-PASS line and exit nonzero.
"""
import argparse, os, re, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.dirname(HERE)                        # games/galaxian
REPO = os.path.dirname(os.path.dirname(GAME))       # arcade-js
sys.path.insert(0, os.path.join(REPO, "tools"))
from raw_dumps import raw_dumps  # noqa: E402
HW = os.path.join(REPO, "boards", "galaxian", "hardware.json")
LUA = os.path.join(HERE, "lua")
DRIVER = "galaxian"
SECONDS = 4                     # ~240 attract frames: a short per-commit regression tripwire, not the full golden

# --done (the runbook DONE bar): attract completeness past the mid-attract screen-blanks + tape-driven
# GAMEPLAY vs MAME (the attract-blind hole). The gameplay tape is authored in a following commit (needs the
# landmark-aware alignment galaxian's board-wipe/wave collapse warps); until then --done fails closed on the
# gameplay part, so it cannot be counted green for DONE.
DONE_ATTRACT_SECONDS = 12
GAMEPLAY_TAPE = os.path.join(GAME, "tapes", "coin_start_move.lua")
GAMEPLAY_TAPE_JSON = os.path.join(GAME, "tapes", "coin_start_move.json")
TAPE_ORIGIN = 0

CONV_PASS = re.compile(r"^PASS\b", re.M)


def have_romset(rompath):
    try:
        r = subprocess.run(["mame", "-rompath", rompath, "-verifyroms", DRIVER],
                           capture_output=True, text=True)
    except FileNotFoundError:
        return False, "pixel_suite: SKIP -- no `mame` on PATH; cannot build a golden to compare against."
    if r.returncode != 0:
        return False, f"pixel_suite: SKIP -- romset {DRIVER} not found under {rompath}."
    return True, ""


def capture_golden(rompath, out, seconds, tape=None):
    """Fresh certified golden via the shared capturer; its nonzero return IS the poison guard."""
    cmd = [sys.executable, os.path.join(REPO, "tools", "mame_golden.py"),
           "--hardware", HW, "--lua-dir", LUA, "--rompath", rompath, "--out", out, "--seconds", str(seconds)]
    if tape:
        cmd += ["--tape", tape]
    return subprocess.run(cmd, cwd=REPO).returncode == 0


def run_convergence(golden, tape=None, tape_origin=0):
    """Reconverge the IDIOMATIC render (always --idiomatic; see the born-live note above) vs the golden."""
    cmd = ["node", os.path.join(REPO, "tools", "convergence.mjs"),
           "--game", DRIVER, "--golden", golden, "--mode", "pixel", "--idiomatic"]
    if tape:
        cmd += ["--tape", tape, "--tape-origin", str(tape_origin)]
    r = subprocess.run(cmd, cwd=REPO, capture_output=True, text=True)
    out = (r.stdout or "") + (r.stderr or "")
    return (r.returncode == 0 and bool(CONV_PASS.search(out))), out


def _part(work, name, rompath, seconds, tape=None, tape_json=None, origin=0):
    golden = os.path.join(work, name)
    if not capture_golden(rompath, golden, seconds, tape=tape):
        return False, f"{name}: mame_golden refused to certify the capture (poisoned golden)."
    ok, out = run_convergence(golden, tape=tape_json, tape_origin=origin)
    print(f"[{name}]"); print(out.rstrip())
    if not ok:
        return False, f"{name}: convergence did not PASS (a frame diverged, or the run was incomplete)."
    return True, ""


def main():
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    # --layer is accepted (the gate passes it) but galaxian renders idiomatic for both -- see the born-live note.
    p.add_argument("--layer", default="idiomatic", choices=["oracle", "idiomatic"])
    p.add_argument("--seconds", type=int, default=SECONDS)
    p.add_argument("--done", action="store_true")
    p.add_argument("--rompath", default=os.path.expanduser("~/Downloads"))
    p.add_argument("--keep-frames", action="store_true",
                   help="keep the raw frames.rgb / state.bin dumps after the verdict "
                        "(default: delete them; tools/raw_dumps.py).")
    a = p.parse_args()

    ok, skip = have_romset(a.rompath)
    if not ok:
        print(skip); return 1

    work = tempfile.mkdtemp(prefix="galaxian_pixel_")
    with raw_dumps(work, keep=a.keep_frames, rmtree=True):
        if a.done:
            ok, why = _part(work, "attract", a.rompath, DONE_ATTRACT_SECONDS)
            if not ok:
                print(f"pixel_suite: FAIL -- {why}"); return 1
            if not (os.path.exists(GAMEPLAY_TAPE) and os.path.exists(GAMEPLAY_TAPE_JSON)):
                print("pixel_suite: FAIL -- PART B (gameplay vs MAME) not yet authored: "
                      "games/galaxian/tapes/coin_start_move.{lua,json} pending (next commit).")
                return 1
            ok, why = _part(work, "gameplay", a.rompath, DONE_ATTRACT_SECONDS,
                            tape=GAMEPLAY_TAPE, tape_json=GAMEPLAY_TAPE_JSON, origin=TAPE_ORIGIN)
            if not ok:
                print(f"pixel_suite: FAIL -- {why}"); return 1
            print("pixel_suite: PASS"); return 0

        ok, why = _part(work, "attract", a.rompath, a.seconds)
        if not ok:
            print(f"pixel_suite: FAIL -- {why}"); return 1
        print("pixel_suite: PASS"); return 0


if __name__ == "__main__":
    sys.exit(main())
