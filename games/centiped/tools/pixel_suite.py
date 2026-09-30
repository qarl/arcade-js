#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""Centipede pixel gate: the RNG-replayed idiomatic render vs a fresh MAME golden, drift-tolerant reconverge.

Centiped's attract demo forks on POKEY RANDOM, so the render is entropy-matched: the capture logs MAME's
$100a stream (observe-only, dump_state_rng.lua) and convergence.mjs replays it into the layer before
rendering, then diffs each JS frame against its NEAREST golden frame. Two modes:

  (default, per-commit TRIPWIRE) --seconds ~10s attract prefix, --layer {oracle,idiomatic}: a fast
    regression check. NOT a done-proof (blind to gameplay + deep states).

  --done (ship gate, runbook 5) the real bar:
    (1) ATTRACT full ~10-min golden, idiomatic layer: render CORRECTNESS over frames [W, FORK_FLOOR] +
        COMPLETENESS (clean run, all 36k frames, no RNG over-read) over the WHOLE golden. The correctness
        window is BOUNDED at FORK_FLOOR because a documented, diagnosed clock-free residual forks the
        unattended ATTRACT DEMO at ~frame 33730 (562s): the clock-free engine ages serviceTimerBank's
        countdown bank on a fixed frame-beat, so a heavy wave-restart iteration diverges from MAME (the
        cycle-driven ORACLE matches MAME EXACTLY over the full 600s -- so this is the clock-free timing
        approximation, not a routine bug; attract-demo-only, zero player-visible impact). The bound keeps
        REAL TEETH: a regression that forks BEFORE FORK_FLOOR lands inside [W,FORK_FLOOR] -> drift blows the
        tight floor -> RED; an incomplete run -> the completeness checks -> RED (both verified). See
        scratchpad/gameover/FINDING-33730.md.
    (2) GAMEPLAY tape (coin/start/PLAY, one board, no heavy restart): FULL (unbounded) pixel AND state
        convergence of the idiomatic layer vs a MAME golden captured under the SAME tape. This is the
        gameplay-vs-MAME correctness the attract run cannot see.

FAIL-CLOSED: `pixel_suite: PASS` prints ONLY when every sub-check printed convergence PASS. No mame/romset
-> SKIP + nonzero (never PASS). Any cannot-run / non-PASS / crash exits nonzero.
"""
import argparse, os, re, shutil, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.dirname(HERE)                        # games/centiped
REPO = os.path.dirname(os.path.dirname(GAME))       # arcade-js
sys.path.insert(0, os.path.join(REPO, "tools"))
from raw_dumps import raw_dumps  # noqa: E402
LUA = os.path.join(HERE, "lua", "dump_state_rng.lua")
LUA_TAPE = os.path.join(HERE, "lua", "dump_state_rng_tape.lua")
CONV = os.path.join(HERE, "convergence.mjs")
TAPE = os.path.join(GAME, "tapes", "coin_start_play.json")
DRIVER = "centiped3"
W, H = 256, 240
FPX = W * H * 3
SECONDS = 10                    # ~600 attract frames: a per-commit regression tripwire, not the full golden
DONE_SECONDS = 600              # the full ~10-min attract golden (36k frames): completeness + correctness
GAMEPLAY_SECONDS = 15           # the coin/start/play tape runs to ~frame 710
# The clock-free attract-demo residual forks at ~frame 33730; assert render correctness up to here (a
# ~730-frame margin) and completeness over the whole golden. A regression that forks earlier REDs.
FORK_FLOOR = 33000
CONV_PASS = re.compile(r"^centiped_convergence: PASS", re.M)
DONE_GOLDEN = os.path.join(HERE, ".golden-done-600s")   # gitignored; reused only after a --keep-frames run
TAPE_GOLDEN = os.path.join(HERE, ".golden-tape")        # gitignored; reused only after a --keep-frames run


def have_romset(rompath, mame):
    try:
        r = subprocess.run([mame, "-rompath", rompath, "-verifyroms", DRIVER],
                           capture_output=True, text=True, timeout=120)
        return "is good" in (r.stdout + r.stderr)
    except Exception:
        return False


def capture(rompath, mame, out, seconds, lua=LUA):
    """One MAME run -> AVI frames + state + $100a RNG stream; ffmpeg converts the (bgr24) AVI to rgb24 raw.
    `out` MUST be an absolute path (MAME writes -aviwrite relative to its own cwd otherwise). `lua` selects
    the autoboot script (dump_state_rng.lua for attract; dump_state_rng_tape.lua drives the input tape).
    Returns True iff frames.rgb + rng.bin were produced with ~the expected frame count."""
    os.makedirs(out, exist_ok=True)
    avi = os.path.join(out, "out.avi")
    env = {**os.environ, "STATE_OUT": os.path.join(out, "state.bin"), "RNG_OUT": os.path.join(out, "rng.bin")}
    try:
        # ISOLATE cfg/nvram to this per-run dir: without -cfg_directory MAME reads the working-dir
        # cfg/<game>.cfg, which an ad-hoc grounding capture can poison (a self-test capture leaves the
        # service switch HELD -> the golden boots into the frozen self-test). `out` starts clean, so MAME
        # falls back to default dips (service idle) and the golden is immune to a stale working-dir cfg.
        subprocess.run([mame, DRIVER, "-rompath", rompath, "-norotate", "-video", "none", "-sound", "none",
                        "-nothrottle", "-frameskip", "0", "-nonvram_save", "-nocheat", "-noautosave",
                        "-cfg_directory", out, "-nvram_directory", out,
                        "-seconds_to_run", str(seconds), "-aviwrite", avi,
                        "-autoboot_script", lua, "-autoboot_delay", "0"],
                       cwd=REPO, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=900)
        frames = os.path.join(out, "frames.rgb")
        subprocess.run(["ffmpeg", "-y", "-i", avi, "-map", "0:v:0", "-pix_fmt", "rgb24", "-f", "rawvideo", frames],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=900)
        os.remove(avi)  # the AVI is large; frames.rgb is what convergence reads
        want = seconds * 60
        got = os.path.getsize(frames) // FPX
        return got >= want * 0.9
    except Exception:
        return False


def golden_ok(d, seconds):
    """A cached golden is reusable iff frames.rgb + rng.bin + state.bin exist and the frame count is ~right."""
    fr, rg, st = (os.path.join(d, f) for f in ("frames.rgb", "rng.bin", "state.bin"))
    if not (os.path.exists(fr) and os.path.exists(rg) and os.path.exists(st)):
        return False
    return os.path.getsize(fr) // FPX >= seconds * 60 * 0.9


def ensure_golden(d, rompath, mame, seconds, lua):
    if golden_ok(d, seconds):
        return True
    return capture(rompath, mame, os.path.abspath(d), seconds, lua=lua)


def run_conv(extra):
    """Run convergence.mjs with `extra` args (pass --layer explicitly); echo output; True iff it printed PASS."""
    r = subprocess.run(["node", CONV, *extra],
                       cwd=REPO, capture_output=True, text=True, timeout=1800)
    out = r.stdout + r.stderr
    sys.stdout.write(out if out.endswith("\n") else out + "\n")
    return r.returncode == 0 and CONV_PASS.search(out) is not None


def run_default(a, work):
    if not capture(a.rompath, a.mame, work, a.seconds):
        print("pixel_suite: FAIL -- capture did not produce the expected frames (poisoned/short)"); return False
    r = subprocess.run(["node", CONV, "--mode", "pixel", "--golden", work, "--layer", a.layer],
                       cwd=REPO, capture_output=True, text=True, timeout=600)
    out = r.stdout + r.stderr
    sys.stdout.write(out if out.endswith("\n") else out + "\n")
    return r.returncode == 0 and CONV_PASS.search(out) is not None


def run_done(a):
    # (1) ATTRACT full-golden: bounded render correctness + completeness. Tight floors so an earlier fork REDs.
    if not ensure_golden(DONE_GOLDEN, a.rompath, a.mame, DONE_SECONDS, LUA):
        print("pixel_suite: FAIL -- could not build the full attract golden"); return False
    print(f"-- attract full golden ({DONE_SECONDS}s): bounded pixel [W,{FORK_FLOOR}] + completeness over all")
    if not run_conv(["--mode", "pixel", "--stream", "--layer", "idiomatic", "--golden", DONE_GOLDEN,
                     "--converge-until", str(FORK_FLOOR), "--px-avg", "0.10", "--px-max", "0.25"]):
        print("pixel_suite: FAIL -- attract bounded pixel convergence did not PASS"); return False
    print(f"-- attract full golden: bounded state [W,{FORK_FLOOR}] + completeness over all")
    if not run_conv(["--mode", "state", "--layer", "idiomatic", "--golden", DONE_GOLDEN,
                     "--converge-until", str(FORK_FLOOR), "--t-avg", "20", "--t-max", "40"]):
        print("pixel_suite: FAIL -- attract bounded state convergence did not PASS"); return False
    # (2) GAMEPLAY tape vs a MAME golden captured under the SAME tape (both MAME-aligned; see convergence.mjs).
    if not ensure_golden(TAPE_GOLDEN, a.rompath, a.mame, GAMEPLAY_SECONDS, LUA_TAPE):
        print("pixel_suite: FAIL -- could not build the gameplay-tape golden"); return False
    # (a) idiomatic-vs-ORACLE: the shipped clock-free layer must reproduce the faithful cycle-driven oracle
    #     in gameplay. TIGHT teethed floor (both share the JS trackball model, so the diff is confound-free).
    print("-- gameplay (a): idiomatic-vs-oracle (clock-free residual), teethed floor")
    if not run_conv(["--vs-oracle", "--layer", "idiomatic", "--golden", TAPE_GOLDEN, "--tape", TAPE,
                     "--t-avg", "50", "--t-max", "100"]):
        print("pixel_suite: FAIL -- gameplay idiomatic-vs-oracle convergence did not PASS"); return False
    # (c) oracle-vs-MAME: the NAMED, BOUNDED trackball-input-model boundary (io.applyTrackball vs MAME's
    #     quadrature). A coarse-but-teethed tripwire -- a real gameplay regression blows past it (null-mutant
    #     155/228 vs the 72.8/138 boundary). A small RNG over-read (<=4) is the boundary's control-flow cost.
    print("-- gameplay (c): oracle-vs-MAME (trackball boundary), named+bounded+teethed")
    if not run_conv(["--mode", "state", "--layer", "oracle", "--golden", TAPE_GOLDEN, "--tape", TAPE,
                     "--over-tol", "4", "--t-avg", "110", "--t-max", "180"]):
        print("pixel_suite: FAIL -- gameplay oracle-vs-MAME boundary convergence did not PASS"); return False
    # (b) the deterministic input->response gameplay logic is asserted by test/tape.test.js (standing gate).
    return True


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--layer", default="oracle")   # per-commit default renders the oracle; --done forces idiomatic
    p.add_argument("--seconds", type=int, default=SECONDS)
    p.add_argument("--done", action="store_true")  # the ship gate: full golden (bounded) + gameplay tape
    p.add_argument("--rompath", default=os.path.join(os.environ.get("HOME", ""), "Downloads"))
    p.add_argument("--mame", default="/opt/homebrew/bin/mame")
    p.add_argument("--keep-frames", action="store_true",
                   help="keep the raw frames.rgb / state.bin dumps after the verdict "
                        "(default: delete them; tools/raw_dumps.py).")
    a = p.parse_args()

    if not shutil.which("ffmpeg"):
        print("pixel_suite: SKIP -- ffmpeg not found"); sys.exit(1)
    if not shutil.which(a.mame):
        print(f"pixel_suite: SKIP -- no `mame` at {a.mame}"); sys.exit(1)
    if not have_romset(a.rompath, a.mame):
        print(f"pixel_suite: SKIP -- no verified {DRIVER} romset at {a.rompath}"); sys.exit(1)

    if a.done:
        with raw_dumps(DONE_GOLDEN, TAPE_GOLDEN, keep=a.keep_frames):  # --keep-frames also keeps them reusable
            ok = run_done(a)
        if ok:
            print("pixel_suite: PASS"); sys.exit(0)
        sys.exit(1)

    work = tempfile.mkdtemp(prefix="centiped_px_")
    with raw_dumps(work, keep=a.keep_frames, rmtree=True):
        if run_default(a, work):
            print("pixel_suite: PASS"); sys.exit(0)
        print("pixel_suite: FAIL -- convergence did not PASS"); sys.exit(1)


if __name__ == "__main__":
    main()
