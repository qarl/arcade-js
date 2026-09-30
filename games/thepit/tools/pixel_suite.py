# SPDX-License-Identifier: GPL-3.0-only
"""The Pit gameplay pixel gate: JS render vs a live MAME golden, through coin -> start -> dig.

TWO LAYERS, TWO GATES (the commit gate runs BOTH, and both must PASS):
  * --layer idiomatic -> renders the shipping IDIOMATIC generator engine and does a DRIFT-TOLERANT
    idiomatic-vs-MAME comparison (the frame-collapsing engine drifts a few frames at each busy-wait, so
    a fixed offset is wrong here). This is the default (and what --layer omitted resolves to). Its teeth
    are the rough tolerance + the band-row budget + game_responded; a PASS is NOT byte-parity (see below).
  * --layer oracle -> renders the frozen TRANSLATED oracle on the cycle-driven engine (render.js runFrames,
    NO --idiomatic) and asserts the JS frame buffer is BYTE-IDENTICAL to MAME across the play window. The
    oracle shares MAME's frame origin (it burns the power-on settle frames), so this is a FIXED-OFFSET
    byte-exact diff (pixel_gate.frame_diffs at FROZEN_OFFSET). Any differing frame -> FAIL. The idiomatic
    coroutine layer is separately proven byte-identical to this oracle over video RAM, so validating the
    oracle byte-exact + the idiomatic drift-band together validates both.

The Pit ships on the idiomatic layer (manifest.runtime == "idiomatic"): the whole game runs on the
generator/coroutine engine (core/frame-stepped.js runIdiomaticGame — the control spine is generators
yielding at each vblank). This gate renders THAT layer on THAT engine and pixel-diffs it against a live
MAME golden, driving the same coin/start/dig tape into both, all the way through the tunnelling gameplay.
Attract takes no input and a golden of it captures itself, so it proves little; this drives real play.

BYO-ROM: the golden is captured live from your own thepitu1 romset (copyrighted, never committed). Point
--rompath at the dir that CONTAINS a `thepitu1` romset dir; the gate SKIPS (exit 0) if MAME cannot verify
it, so CI without the ROM stays green.

    python3 games/thepit/tools/pixel_suite.py --layer idiomatic --rompath /path/to/roms

★ WHY THIS IS A DRIFT-TOLERANT COMPARISON, NOT A FIXED OFFSET. The idiomatic runtime runs on the
frame-stepped generator engine, which COLLAPSES the multi-frame screen-blank / board-draw busy-waits the
game spends real frames on in MAME. So at each such transition the two sides drift by a few frames locally
(the generator leads or lags MAME by up to ~4 frames), then reconverge. A single fixed offset shows those
transients as 90-99% "differences" that are pure frame-phase, not content. Measured: with a bounded local
drift of +-DRIFT frames the CORRECT layer matches MAME within 1.27% across the WHOLE run (attract+coin+
credit+play+dig); the transients vanish because the matching content is a few frames away, and a WRONG
layer stays diverged because a content error is present at EVERY nearby frame (see the wrong-twin below).

★ WHAT THIS GATE CANNOT SEE, so a PASS is not read as byte-parity. Pixel-comparing a MOVING game across a
frame-collapsing engine has an irreducible ~730px (1.3%) per-frame floor: the actors are at continuous
sub-frame positions and the nearest golden frame within the drift window still leaves them a pixel or two
off. So a regression SMALLER than roughly one sprite is BELOW this floor and invisible to the pixel band --
it is covered only by the rough tolerance and by game_responded (the state proof). This is The Pit's
analogue of Time Pilot's documented top-band hole; it is a real limit of drift-tolerant pixel-matching of
chaotic gameplay, and it is why the wrong-twin below is a TILEMAP shape byte (whole-board, well over the
floor) rather than a single actor sprite (which sits inside the floor and cannot be caught here).

MEASUREMENTS (re-derive if the engine, the tape timing, or the boot settle changes):
  * LANDMARK / GEN_OFFSET. The generator burns NO frames on the power-on settle delay MAME spends ~20
    real frames on (coldBootInit's settle loop touches no memory, so nothing models it). So the two sides
    share no frame origin: LANDMARK=20 is that boot gap. Measured two independent ways that agreed: (a) the
    attract screen matches MAME byte-exact at js[i] vs golden[i+21] (GEN_OFFSET=LANDMARK+1, the +1 being
    MAME's AVI lag); (b) a work-RAM state sweep with no input minimises at golden frame = gen frame + 20
    (a sharp V: worst-cell count 13 -> 4 -> 13 across the neighbours). render.js applies the tape at
    frame + LANDMARK, so a coin keyed to the golden's absolute frame number fires on the matching gen frame.
  * DRIFT=5. The measured minimum that absorbs every collapse transient is 4 (D=3 leaves the board-draw
    at golden 583-584 over budget; D=4 clears all and the floor is stable past it); 5 keeps one frame of
    headroom for a re-capture whose timing shifts by one. A content error is present at EVERY nearby frame,
    so extra drift never hides one -- it only smooths pure frame-phase.
  * BAND_FROM=16 / BAND_MAX_PX=2200. BAND_FROM skips the top HUD rows (a persistent ~28px score/credits
    residual). BAND_MAX_PX is 3x the CORRECT layer's band floor (measured 722px in rows 16.. under DRIFT),
    NOT fitted to the twin.

★ THE WRONG-TWIN, the teeth. Flipping ONE bit in the tile-shape code paintScreen (idiomatic/paintScreen.js,
`mem8[VIDEO_RAM_BASE + cell] = mem8[tileImage + cell]`) stores into the tilemap -- `^ 0x01` -- paints the
whole playfield with the wrong tile image. It drives EVERY gameplay frame to ~8239px (14%), so all 206
non-transient frames go over BOTH the 5% rough tolerance AND the 2200px band, while the correct layer's
worst is 729px (0 over either). Clean 12x separation. (The scratch flip is reverted, never committed.)
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.dirname(HERE)                       # games/thepit
REPO = os.path.dirname(os.path.dirname(GAME))      # repo root
sys.path.insert(0, os.path.join(REPO, "tools"))

import numpy as np  # noqa: E402
import pixel_gate  # noqa: E402
from hardware import Hardware  # noqa: E402
from raw_dumps import raw_dumps  # noqa: E402

HW = os.path.join(REPO, "boards", "thepit", "hardware.json")
DRIVER = "thepitu1"
SECONDS = 13                       # boot -> coin(400) -> start(460) -> ~300f of dig
PINSPEC = "4b34:00,4b35:00,4b39:00,4b3a:00"   # entropyPinRomSpec(manifest.entropyPin)

# --- Frame alignment (measured; see the module docstring) --------------------------------------
LANDMARK = 20                      # boot gap: render.js applies the tape at frame + LANDMARK
GEN_OFFSET = LANDMARK + 1          # js[i] compared to golden[i + GEN_OFFSET] (+1 = MAME AVI lag)
DRIFT = 5                          # bounded local frame drift the collapse transients need (measured
                                   # minimum is 4 -- D=3 leaves the board-draw over budget; 5 keeps one
                                   # frame of headroom for a re-capture whose timing shifts by one)

# --- The tape (absolute golden frame numbers; render.js re-bases them by + LANDMARK) ------------
LUA_COIN, LUA_START = 400, 460
HOLD = 8
DOWN_FROM = 480                    # hold Down from here; pulse Dig every 32f (matches coin_start.lua dig)
DIG_PERIOD, DIG_HOLD = 32, 6

# --- The teeth (measured) ----------------------------------------------------------------------
BAND_FROM = 16                     # skip the top HUD rows (persistent ~28px score/credits residual)
BAND_MAX_PX = 2200                 # 3x the CORRECT band floor (722px, rows 16.. under DRIFT); NOT the twin's

# --- Oracle layer (frozen translated, BYTE-EXACT vs MAME; port HEAD's logic) --------------------
ORA_DIFF_FROM = 2                  # skip the documented boot-transition frames 0-1: one 8x8 edge tile
                                   # turns on ONE frame early in the JS render (a boot-phase artifact,
                                   # cosmetically invisible); a real regression at any LATER frame still FAILs
ORA_COIN, ORA_START, ORA_DOWN_FROM = 402, 462, 482   # golden 400/460/480 rebased by +2 (render.js drops
                                                      # the power-on render[0] and JS[M] lines up with
                                                      # golden[M+FROZEN_OFFSET], the AVI lag)
ORA_DIG_PERIOD, ORA_DIG_HOLD, ORA_HOLD = 32, 6, 8    # dig pulse period/hold + coin/start hold (mirror the tape)
ORA_PLAY_JS = 464                  # JS frame where GAME_STATE 3->1 (gameplay begins)

# --- Golden state cells that prove the run actually PLAYED (analogue of timeplt COIN_TAKEN/PLAY_ACTIVE) --
IN1_DEBOUNCED = 0x8015             # debounced coin/start latch: bit 0x01 = coin held (active-high IN1)
GAME_STATE = 0x8001                # 0 attract, 3 credit-standby (coin accepted), 1 one-player game (play)

# ══ --done: the runbook DONE BAR (attract COMPLETENESS + tape-driven GAMEPLAY vs MAME) ══════════
# The two default paths above (run_idiomatic / run_oracle) are the per-commit gates tools/pixel_gate_
# required.py invokes plain (fixed-window gameplay diff at GEN_OFFSET). --done is the go-forward SHIP
# bar: it reconverges the WHOLE run with the drift-tolerant "nearest-golden-frame" rule (docs/pixel-
# gate.md, tools/convergence.mjs) against FRESH pinned MAME goldens, adding the attract COMPLETENESS
# pass an attract-blind gate structurally lacks (runbook 5: an attract-only gate must NOT count green
# for done) AND a tape-driven GAMEPLAY-vs-MAME pass. Fail-closed: prints `pixel_suite: PASS` ONLY when
# every part converges; if it CANNOT run (no mame/romset) it exits 0 WITHOUT printing PASS -- the DONE
# gate (tools/done_gate.py check_pixel) keys on that literal line, never the exit code.
#
#   ★ WHY THIS SUITE RECONVERGES IN-PROCESS INSTEAD OF SHELLING `node tools/convergence.mjs` (as frogger
#   does). convergence.mjs renders through its OWN Machine.create + tape mechanism, which does NOT know
#   The Pit's measured LANDMARK boot gap: the idiomatic generator burns NO frames on the ~20-frame power-
#   on settle MAME spends real frames on, and render.js is the one renderer that applies the tape at
#   frame + LANDMARK so a coin keyed to the golden's absolute frame fires on the matching generator frame
#   (module docstring). So --done renders the idiomatic layer through games/thepit/tools/render.js EXACTLY
#   as the per-commit path does -- reusing that proven alignment -- then applies convergence.mjs's OWN
#   reconverge rule here, byte-for-byte: an 8px downsample grid (convergence.mjs's S=8), each scored JS
#   frame matched to its NEAREST golden frame over the WHOLE golden (alignment-free -- absorbs the ~20f
#   boot collapse + the local collapse drift, never a fixed offset), PASS iff none diverges past a FIXED
#   %-threshold. The threshold is convergence.mjs's default (--px-threshold 5) and is NEVER tuned here;
#   --done tunes only seconds/tape (mirrors what render_js/capture_golden already use).
#
# Both parts PIN entropy on BOTH sides (the same PINSPEC + --pin the default path uses): The Pit's attract
# runs a self-playing demo, so an UNpinned reconverge would fork JS from MAME on RNG alone, not on a real
# rendering regression. The pin is TEST-ONLY (never the shipped game).
DONE_ATTRACT_SECONDS = 16        # a longer attract window than the 13s tripwire (title/demo), reconverged
DONE_GAMEPLAY_SECONDS = SECONDS  # coin(400) -> start(460) -> ~300f of dig; the same tape as the default path
RECON_STRIDE = 15                # score every 15th JS frame (convergence.mjs default --frame-stride)
RECON_S = 8                      # 8px downsample grid (convergence.mjs default sample stride S)
RECON_PX_THRESHOLD = 5.0         # FIXED %-floor (convergence.mjs default --px-threshold); NEVER tuned here
MIN_DISTINCT = 10                # positive control: a frozen/black screen proves nothing -- require motion


def verify_roms(rompath):
    try:
        r = subprocess.run(["mame", "-rompath", rompath, "-verifyroms", DRIVER],
                           capture_output=True, text=True)
    except FileNotFoundError:
        return None
    return "is good" in (r.stdout + r.stderr)


def capture_golden(rompath, out):
    """Capture the pinned MAME dig golden. mame_golden's boot-signature 'poison' heuristic can flag the
    coin/start screen-blanks (they resemble boot); its own STATE checks are the authority, so we accept a
    nonzero exit and validate from the state dump (game_responded + no_real_reset) instead."""
    env = dict(os.environ, TAPE_MODE="dig")
    subprocess.run(
        ["python3", os.path.join(REPO, "tools", "mame_golden.py"),
         "--hardware", HW, "--lua-dir", os.path.join(GAME, "tools", "lua"),
         "--tape", os.path.join(GAME, "tapes", "coin_start.lua"),
         "--pin-entropy", PINSPEC,
         "--rompath", rompath, "--out", out, "--seconds", str(SECONDS)],
        env=env, capture_output=True, text=True, timeout=240)
    return (os.path.exists(os.path.join(out, "frames.rgb"))
            and os.path.exists(os.path.join(out, "state.bin")))


def state_column(golden_dir, addr):
    """Every frame's value of one work-RAM cell, read out of the golden's state dump.

    Geometry comes from the same hardware.json the capture used, which checks its regions sum to the
    declared frame size -- so a layout change cannot silently mis-index."""
    regions = Hardware.load(HW).state_regions
    frame_bytes = sum(size for _n, _b, size in regions)
    off = 0
    for _name, base, size in regions:
        if base <= addr < base + size:
            off += addr - base
            break
        off += size
    else:
        raise SystemExit(f"pixel_suite: 0x{addr:04X} is not in any dumped state region")
    with open(os.path.join(golden_dir, "state.bin"), "rb") as fh:
        blob = fh.read()
    if len(blob) % frame_bytes:
        raise SystemExit(f"pixel_suite: state.bin is {len(blob)} bytes, not a multiple of "
                         f"{frame_bytes} -- the dumped state regions have changed")
    return np.frombuffer(blob, dtype=np.uint8)[off::frame_bytes]


def game_responded(golden_dir):
    """Did the golden take the coin, and did the game then start?

    Without this a tape that never reached the machine leaves both sides in attract, every frame matches,
    and the gate PASSes over a run that played nothing. The debounced latch alone is not enough (it proves
    the bits arrived, not that the machine acted); GAME_STATE progressing 0 -> 3 -> 1 proves the response."""
    latch = state_column(golden_dir, IN1_DEBOUNCED)
    gs = state_column(golden_dir, GAME_STATE)
    return {
        "coin bits latched (IN1.0)": [f for f, v in enumerate(latch) if v & 0x01],
        "credit accepted (state 3)": [f for f, v in enumerate(gs) if v == 3],
        "play active (state 1)": [f for f, v in enumerate(gs) if v == 1],
    }


def no_real_reset(golden_dir):
    """A genuine watchdog reset reverts work RAM to the boot image; confirm the flagged screen-blanks are
    NORMAL progression, not a reset (mame_golden's poison heuristic can't tell them apart from frames)."""
    regions = Hardware.load(HW).state_regions
    frame_bytes = sum(size for _n, _b, size in regions)
    blob = np.fromfile(os.path.join(golden_dir, "state.bin"), dtype=np.uint8).reshape(-1, frame_bytes)
    boot = blob[0][:64]
    resets = [i for i in range(1, len(blob)) if np.array_equal(blob[i][:64], boot)]
    return (not resets), resets


def render_js(rompath, out, frames):
    """Render the IDIOMATIC layer on the generator engine, entropy-pinned, driving the same tape as the
    golden. Bits/ports from boards/thepit + manifest.inputs: coin=IN1(0xA800) bit0x01, start=bit0x04;
    down=IN0(0xA000) bit0x04, dig=bit0x10. Frames are the golden's ABSOLUTE numbers; render.js re-bases
    them by + LANDMARK (--tape-origin). render.js wants the parts dir with MAME-canonical names (the same
    romset MAME just verified: p9.ic9, p8.ic8, 82s123.ic4), so it lives under --rompath/thepitu1."""
    cmd = ["node", os.path.join(HERE, "render.js"), "--idiomatic", "--pin",
           "--tape-origin", str(LANDMARK), "--frames", str(frames),
           "--romset", os.path.join(rompath, DRIVER), "--frames-out", out,
           "--input", f"0xa800=0x01@{LUA_COIN}:hold{HOLD}",       # coin
           "--input", f"0xa800=0x04@{LUA_START}:hold{HOLD}",      # 1P start
           "--input", f"0xa000=0x04@{DOWN_FROM}:hold{frames}"]    # hold Down from DOWN_FROM
    for f in range(DOWN_FROM, frames, DIG_PERIOD):                # pulse Dig periodically
        cmd += ["--input", f"0xa000=0x10@{f}:hold{DIG_HOLD}"]
    r = subprocess.run(cmd, capture_output=True, text=True)
    return os.path.exists(os.path.join(out, "frames.rgb")), r.stdout + r.stderr


def render_oracle(rompath, out, frames):
    """Render the ORACLE (frozen translated) layer on the cycle-driven engine (render.js runFrames, NO
    --idiomatic), entropy-pinned, driving the same coin/start/dig tape as the golden. This layer shares
    MAME's frame origin, so the tape rides the golden's absolute numbers rebased by +2 (render.js drops
    the power-on render[0] and JS[M] lines up with golden[M+FROZEN_OFFSET]): coin@golden400 -> tape 402,
    start@golden460 -> 462, hold Down from 482 and pulse Dig every 32f. render.js wants the parts dir with
    MAME-canonical names (the romset MAME just verified: p9.ic9, p8.ic8, 82s123.ic4), under --rompath."""
    romset = os.path.join(rompath, DRIVER)
    dig = []
    for f in range(ORA_DOWN_FROM, frames + 2, ORA_DIG_PERIOD):     # JS mirror of the lua dig pulses
        dig += ["--input", f"0xa000=0x10@{f}:hold{ORA_DIG_HOLD}"]
    cmd = ["node", os.path.join(HERE, "render.js"), "--pin", "--frames", str(frames),
           "--romset", romset, "--frames-out", out,
           "--input", f"0xa800=0x01@{ORA_COIN}:hold{ORA_HOLD}",       # coin  (golden 400 + 2)
           "--input", f"0xa800=0x04@{ORA_START}:hold{ORA_HOLD}",      # 1P start (golden 460 + 2)
           "--input", f"0xa000=0x04@{ORA_DOWN_FROM}:hold{frames}"] + dig  # hold Down from 482
    r = subprocess.run(cmd, capture_output=True, text=True)
    return os.path.exists(os.path.join(out, "frames.rgb")), r.stdout + r.stderr


def drift_diffs(js_rgb, golden_rgb, from_frame=0):
    """Drift-tolerant per-frame comparison. For each js frame i, pick the golden frame in
    [i+GEN_OFFSET-DRIFT, i+GEN_OFFSET+DRIFT] with the FEWEST differing pixels (the alignment), and record
    that count AND its band-row (BAND_FROM..) count against the SAME matched frame. Returns (full, band)
    arrays. This is the collapse-aware comparison the module docstring mandates -- never a fixed offset."""
    w, h, bpf = pixel_gate.screen_geometry(HW)
    jn = os.path.getsize(js_rgb) // bpf
    gn = os.path.getsize(golden_rgb) // bpf
    full, band = [], []
    with open(js_rgb, "rb") as jf, open(golden_rgb, "rb") as gf:
        for i in range(from_frame, jn):
            lo, hi = i + GEN_OFFSET - DRIFT, i + GEN_OFFSET + DRIFT
            if lo < 0 or hi >= gn:
                break
            jf.seek(i * bpf)
            a = np.frombuffer(jf.read(bpf), dtype=np.uint8).reshape(h, w, 3)
            best_full, best_gi = None, None
            for gi in range(lo, hi + 1):
                gf.seek(gi * bpf)
                b = np.frombuffer(gf.read(bpf), dtype=np.uint8).reshape(h, w, 3)
                c = int(np.any(a != b, axis=2).sum())
                if best_full is None or c < best_full:
                    best_full, best_gi, best_b = c, gi, b
            full.append(best_full)
            band.append(int(np.any(a[BAND_FROM:] != best_b[BAND_FROM:], axis=2).sum()))
    return np.asarray(full, dtype=np.int64), np.asarray(band, dtype=np.int64)


# ── --done helpers ─────────────────────────────────────────────────────────────────────────────
def capture_attract_golden(rompath, out, seconds):
    """Fresh PINNED, INPUT-FREE attract golden for the --done completeness part (no coin/start/dig
    tape). Mirrors capture_golden's pin/lua-dir but drives no inputs. Returns True iff the capture
    produced frames + state (mame_golden's poison heuristic can flag normal screen-blanks, so its own
    STATE checks -- no_real_reset + the distinct-frame control -- are the authority, as in capture_golden)."""
    subprocess.run(
        ["python3", os.path.join(REPO, "tools", "mame_golden.py"),
         "--hardware", HW, "--lua-dir", os.path.join(GAME, "tools", "lua"),
         "--pin-entropy", PINSPEC,
         "--rompath", rompath, "--out", out, "--seconds", str(seconds)],
        capture_output=True, text=True, timeout=240)
    return (os.path.exists(os.path.join(out, "frames.rgb"))
            and os.path.exists(os.path.join(out, "state.bin")))


def render_attract_js(rompath, out, frames):
    """Render `frames` of INPUT-FREE idiomatic attract, entropy-pinned (mirrors render_js with no tape).
    Returns (ok, log); ok iff render.js produced frames (nonzero == boot gap / dropped frame)."""
    cmd = ["node", os.path.join(HERE, "render.js"), "--idiomatic", "--pin",
           "--tape-origin", str(LANDMARK), "--frames", str(frames),
           "--romset", os.path.join(rompath, DRIVER), "--frames-out", out]
    r = subprocess.run(cmd, capture_output=True, text=True)
    return os.path.exists(os.path.join(out, "frames.rgb")), r.stdout + r.stderr


def frame_count(rgb_dir):
    _, _, bpf = pixel_gate.screen_geometry(HW)
    return os.path.getsize(os.path.join(rgb_dir, "frames.rgb")) // bpf


def distinct_count(rgb_dir):
    """DISTINCT images the emitter recorded (render.js and mame_golden both write per-frame sha256)."""
    with open(os.path.join(rgb_dir, "frames.json")) as fh:
        j = json.load(fh)
    return len({f["sha256"] for f in j["frames"]})


def reconverge(js_rgb, golden_rgb):
    """convergence.mjs's drift-tolerant pixel rule, in-process (see the --done block comment for why).

    Downsample every frame on an 8px grid; score every RECON_STRIDE-th JS frame against its NEAREST
    golden frame over the WHOLE golden (alignment-free -- absorbs the ~20f boot collapse + the local
    collapse drift + the repeating attract loop); return (worst%, worst JS frame, frames over threshold,
    scored, samples). Deriving PASS from `worst` alone would read an EMPTY overlap as clean, so the caller
    also proves the run played (game_responded / distinct control) and that the render covered the golden."""
    w, h, bpf = pixel_gate.screen_geometry(HW)
    ys = np.arange(0, h, RECON_S)
    xs = np.arange(0, w, RECON_S)
    samples = len(ys) * len(xs)

    def load_grid(path):
        n = os.path.getsize(path) // bpf
        buf = np.fromfile(path, dtype=np.uint8, count=n * bpf).reshape(n, h, w, 3)
        return buf[:, ys][:, :, xs].reshape(n, samples, 3)   # (n, samples, 3)

    g = load_grid(golden_rgb)                # (ngd, samples, 3)
    j = load_grid(js_rgb)                     # (njs, samples, 3)
    njs = j.shape[0]
    worst, worst_frame, over, scored = 0.0, -1, 0, 0
    for i in range(0, njs, RECON_STRIDE):
        # nearest golden frame: min differing-sample count over the whole golden.
        d = np.any(g != j[i], axis=2).sum(axis=1)          # (ngd,) samples differing per golden frame
        mn = 100.0 * int(d.min()) / samples
        scored += 1
        if mn > RECON_PX_THRESHOLD:
            over += 1
        if mn > worst:
            worst, worst_frame = mn, i
    return worst, worst_frame, over, scored, samples


def _done_attract(work, rompath):
    """--done PART A: reconverge INPUT-FREE attract COMPLETENESS vs a fresh pinned MAME golden.
    (ok, why). Fail-closed: a capture that produced nothing, a REAL reset, a frozen screen (dead
    positive control), a short render, or any over-threshold frame -> False."""
    gdir = os.path.join(work, "attract_golden")
    if not capture_attract_golden(rompath, gdir, DONE_ATTRACT_SECONDS):
        return False, "attract: MAME golden capture produced no frames."
    ok, resets = no_real_reset(gdir)
    if not ok:
        return False, f"attract: golden shows a REAL reset (work RAM == boot at frames {resets})."
    gc = frame_count(gdir)
    jdir = os.path.join(work, "attract_js")
    want = gc - GEN_OFFSET      # render one fewer than the golden so every JS frame has a golden nearest-match
    ok, log = render_attract_js(rompath, jdir, want)
    if not ok:
        return False, f"attract: render.js produced no frames (boot gap / dropped frame).\n{log[-400:]}"

    gd, jd = distinct_count(gdir), distinct_count(jdir)
    print(f"  golden {gc} frames, {gd} distinct   render {frame_count(jdir)} frames, {jd} distinct")
    if gd < MIN_DISTINCT or jd < MIN_DISTINCT:
        return False, (f"attract: fewer than {MIN_DISTINCT} distinct frames "
                       f"(golden {gd}, render {jd}); a frozen screen proves nothing.")

    njs = frame_count(jdir)
    if njs < want - RECON_STRIDE:
        return False, f"attract: render delivered {njs} of {want} frames; the run did not cover the golden."

    jrgb, grgb = os.path.join(jdir, "frames.rgb"), os.path.join(gdir, "frames.rgb")
    worst, wf, over, scored, samples = reconverge(jrgb, grgb)
    verdict = "PASS" if over == 0 else "FAIL"
    print(f"  [attract] reconverge: worst nearest-diff {worst:.2f}% @JS frame {wf} "
          f"(threshold {RECON_PX_THRESHOLD:.0f}%, over={over}, {scored} scored, {samples} samples) -> {verdict}")
    if over:
        return False, f"attract: {over} frame(s) diverge past {RECON_PX_THRESHOLD:.0f}% (worst {worst:.2f}% @frame {wf})."
    return True, ""


def _done_gameplay(work, rompath):
    """--done PART B: tape-driven GAMEPLAY vs MAME -- the attract-blind hole. Drives the SAME coin/
    start/dig tape into both sides (capture_golden + render_js, the per-commit path's own alignment),
    reconverges the whole run AND applies the per-commit tight band over the play window. (ok, why).
    Fail-closed: no frames, a REAL reset, a golden that never coined/started/played, a short render, or
    any over-threshold / over-band frame -> False."""
    gdir = os.path.join(work, "gameplay_golden")
    if not capture_golden(rompath, gdir):
        return False, "gameplay: MAME golden capture produced no frames."
    ok, resets = no_real_reset(gdir)
    if not ok:
        return False, f"gameplay: golden shows a REAL reset (work RAM == boot at frames {resets})."

    responded = game_responded(gdir)
    for label, frames in responded.items():
        if not frames:
            return False, f"gameplay: golden shows no '{label}' -- comparing idle screens proves nothing."
        print(f"  golden: {label:26} frames {frames[0]}..{frames[-1]}")
    play_start = responded["play active (state 1)"][0]

    gc = frame_count(gdir)
    jdir = os.path.join(work, "gameplay_js")
    want = gc - GEN_OFFSET
    ok, log = render_js(rompath, jdir, want)
    if not ok:
        return False, f"gameplay: render.js produced no frames (boot gap / dropped frame).\n{log[-400:]}"
    njs = frame_count(jdir)
    if njs < want - RECON_STRIDE:
        return False, f"gameplay: render delivered {njs} of {want} frames; the run did not cover the golden."

    jrgb, grgb = os.path.join(jdir, "frames.rgb"), os.path.join(gdir, "frames.rgb")
    worst, wf, over, scored, samples = reconverge(jrgb, grgb)
    verdict = "PASS" if over == 0 else "FAIL"
    print(f"  [gameplay] reconverge: worst nearest-diff {worst:.2f}% @JS frame {wf} "
          f"(threshold {RECON_PX_THRESHOLD:.0f}%, over={over}, {scored} scored, {samples} samples) -> {verdict}")
    if over:
        return False, f"gameplay: {over} frame(s) diverge past {RECON_PX_THRESHOLD:.0f}% (worst {worst:.2f}% @frame {wf})."

    # SECOND, tighter teeth dimension: the per-commit gate's raw-pixel band over the play window (rows
    # BAND_FROM..), drift-matched at GEN_OFFSET +-DRIFT. The coarse 8px/%-reconverge above ranks the whole
    # run (gross divergence + completeness); band_worst catches a mid-size regression the % rule ranks below
    # threshold. Same render+golden -- no extra capture. (Both share the collapse-engine snapshot-vs-beam
    # floor: a sub-~floor localized single-sprite shift trips neither; a regression must exceed the moving-
    # sprite phase residual, exactly as the per-commit gate.)
    _, band = drift_diffs(jrgb, grgb)
    play_js = max(0, play_start - GEN_OFFSET)
    gp_band = band[play_js:]
    bworst = int(gp_band.max()) if gp_band.size else 0
    bover = int((gp_band > BAND_MAX_PX).sum())
    bat = play_js + int(gp_band.argmax()) if gp_band.size else None
    bverdict = "PASS" if bover == 0 else "FAIL"
    print(f"  [gameplay] tight band rows {BAND_FROM}..: worst {bworst}px @js{bat} "
          f"(budget {BAND_MAX_PX}px, over={bover}) -> {bverdict}")
    if bover:
        return False, f"gameplay: {bover} frame(s) over the {BAND_MAX_PX}px band (worst {bworst}px @js{bat})."
    return True, ""


def run_done(a):
    """--done: the ship bar. Verify the romset, then reconverge attract COMPLETENESS + tape GAMEPLAY
    vs fresh pinned MAME goldens. Fail-closed: prints `pixel_suite: PASS` ONLY when BOTH parts converge;
    if it cannot run (no mame/romset) it exits 0 WITHOUT printing PASS (the DONE gate keys on that line,
    never the exit code). --done always renders the IDIOMATIC layer (the shipped runtime)."""
    verified = verify_roms(a.rompath)
    if verified is None:
        print("pixel_suite: SKIP -- no `mame` on PATH; cannot build a golden to compare against.")
        return 0
    if not verified:
        print(f"pixel_suite: SKIP -- MAME cannot verify {DRIVER} under --rompath {a.rompath} "
              f"(BYO romset; set --rompath or $THEPIT_ROMPATH).")
        return 0

    print("  layer: IDIOMATIC (generator engine)  (--done: attract completeness + tape gameplay, "
          "pinned nearest-frame reconverge)")
    work = tempfile.mkdtemp(prefix="thepit_pixel_done_")
    with raw_dumps(work, keep=a.keep_frames, rmtree=True):
        # PART A -- attract COMPLETENESS (input-free golden, a full attract window, reconverged).
        ok, why = _done_attract(work, a.rompath)
        if not ok:
            print(f"pixel_suite: FAIL -- {why}")
            return 1
        # PART B -- tape-driven GAMEPLAY vs MAME (the attract-blind hole).
        ok, why = _done_gameplay(work, a.rompath)
        if not ok:
            print(f"pixel_suite: FAIL -- {why}")
            return 1
        print("pixel_suite: PASS")
        return 0


def run_idiomatic(a):
    print("  layer: IDIOMATIC (generator engine); golden offset "
          f"{GEN_OFFSET} +/- {DRIFT} drift (measured)")
    os.makedirs(a.work, exist_ok=True)
    go, jo = os.path.join(a.work, "golden"), os.path.join(a.work, "js")

    if not capture_golden(a.rompath, go):
        print("pixel_suite: FAIL -- MAME golden capture produced no frames")
        return 1
    ok, resets = no_real_reset(go)
    if not ok:
        print(f"pixel_suite: FAIL -- golden shows a REAL reset (work RAM == boot at frames {resets})")
        return 1

    # game_responded: the run must have coined AND started, or the comparison proves nothing.
    responded = game_responded(go)
    for label, frames in responded.items():
        if not frames:
            print(f"pixel_suite: FAIL -- golden shows no '{label}'; this run never left attract, "
                  "so a pixel match proves nothing.")
            return 1
        print(f"  golden: {label:26} frames {frames[0]}..{frames[-1]}")
    play_start = responded["play active (state 1)"][0]   # golden frame where GAME_STATE -> 1

    _, _, bpf = pixel_gate.screen_geometry(HW)
    golden_n = os.path.getsize(os.path.join(go, "frames.rgb")) // bpf
    want = golden_n - GEN_OFFSET      # one fewer than the golden so js[i] always has a golden[i+off+drift]
    ok, log = render_js(a.rompath, jo, want)
    if not ok:
        print(f"pixel_suite: FAIL -- idiomatic JS render produced no frames\n{log[-500:]}")
        return 1

    js_n = os.path.getsize(os.path.join(jo, "frames.rgb")) // bpf
    if js_n < want - 1:
        print(f"pixel_suite: INCOMPLETE -- render delivered {js_n} of {want} frames; "
              f"a comparison this short concludes nothing.\n{log[-400:]}")
        return 1

    full, band = drift_diffs(os.path.join(jo, "frames.rgb"), os.path.join(go, "frames.rgb"))
    if full.size == 0:
        print("pixel_suite: INCOMPLETE -- 0 frames compared.")
        return 1

    # js index i corresponds to golden i + GEN_OFFSET, so the play window in js terms:
    play_js = max(0, play_start - GEN_OFFSET)
    w, h, _ = pixel_gate.screen_geometry(HW)
    total = w * h
    rc = 0

    for label, frm in (("boot+attract+play", 0), ("gameplay (coin->dig)", play_js)):
        r = pixel_gate.rough_verdict(full, HW, from_frame=frm)
        print(f"  {label:22} frames={r['frames']:5d} differ={r['frames_differing']:5d} "
              f"max={r['max_pixels']:5d}px ({r['max_pct']:6.3f}%) worst@js{r['worst_frame']} "
              f"-> {r['verdict']}")
        if r["verdict"] != pixel_gate.PASS:
            rc = 1

    # Band teeth: worst band-row px on the drift-matched frame, over the gameplay window.
    gp_band = band[play_js:]
    bworst = int(gp_band.max()) if gp_band.size else 0
    bover = int((gp_band > BAND_MAX_PX).sum())
    bat = play_js + int(gp_band.argmax()) if gp_band.size else None
    bverdict = pixel_gate.PASS if bover == 0 else pixel_gate.FAIL
    print(f"  {'band rows ' + str(BAND_FROM) + '..':22} worst={bworst:5d}px (budget {BAND_MAX_PX}) "
          f"over={bover} worst@js{bat} -> {bverdict}")
    if bover:
        rc = 1

    print(f"pixel_suite: {'PASS' if rc == 0 else 'FAIL'}")
    return rc


def run_oracle(a):
    """Byte-exact ORACLE gate (port HEAD's logic): render the frozen translated layer on the cycle engine
    and assert BYTE-IDENTITY to MAME across the play window (any differing frame -> FAIL). Reuses the same
    golden, no_real_reset and game_responded proofs as the idiomatic path; only the render + diff differ."""
    print(f"  layer: ORACLE (frozen translated, cycle engine); byte-exact vs MAME at offset "
          f"{pixel_gate.FROZEN_OFFSET}")
    os.makedirs(a.work, exist_ok=True)
    go, jo = os.path.join(a.work, "golden"), os.path.join(a.work, "js")

    if not capture_golden(a.rompath, go):
        print("pixel_suite: FAIL -- MAME golden capture produced no frames")
        return 1
    ok, resets = no_real_reset(go)
    if not ok:
        print(f"pixel_suite: FAIL -- golden shows a REAL reset (work RAM == boot at frames {resets})")
        return 1

    # game_responded: the run must have coined AND started, or a byte match proves nothing.
    responded = game_responded(go)
    for label, frames in responded.items():
        if not frames:
            print(f"pixel_suite: FAIL -- golden shows no '{label}'; this run never left attract, "
                  "so a pixel match proves nothing.")
            return 1
        print(f"  golden: {label:26} frames {frames[0]}..{frames[-1]}")

    _, _, bpf = pixel_gate.screen_geometry(HW)
    golden_n = os.path.getsize(os.path.join(go, "frames.rgb")) // bpf   # render one fewer (drops power-on)
    ok, log = render_oracle(a.rompath, jo, golden_n)
    if not ok:
        print(f"pixel_suite: FAIL -- oracle JS render produced no frames\n{log[-500:]}")
        return 1

    d = pixel_gate.frame_diffs(os.path.join(jo, "frames.rgb"),
                               os.path.join(go, "frames.rgb"), HW)   # byte-exact at FROZEN_OFFSET
    window = d[ORA_DIFF_FROM:]
    gp = d[ORA_PLAY_JS:]
    w, h, _ = pixel_gate.screen_geometry(HW)
    total = w * h

    # An EMPTY window is INCOMPLETE, never PASS: a render that died before the window leaves `bad` empty
    # and would read as a clean pass over a comparison of nothing. The shared verdict guards that case.
    for label, win in (("boot+attract+play", window), ("gameplay (coin->dig)", gp)):
        if pixel_gate.rough_verdict(win, HW)["verdict"] == pixel_gate.INCOMPLETE:
            print(f"pixel_suite: {pixel_gate.INCOMPLETE} -- {label} compared 0 frames of "
                  f"{len(d)} captured; a comparison this short concludes nothing.")
            return 1

    bad = np.nonzero(window > 0)[0]
    print(f"  {'boot+attract+play':22} frames={len(window):5d} clean={int((window == 0).sum()):5d} "
          f"max={int(window.max()) if len(window) else 0:5d}px "
          f"({100 * window.max() / total if len(window) else 0:6.3f}%) "
          f"-> {'PASS' if len(bad) == 0 else 'FAIL'}")
    print(f"  {'gameplay (coin->dig)':22} frames={len(gp):5d} clean={int((gp == 0).sum()):5d} "
          f"max={int(gp.max()) if len(gp) else 0:5d}px "
          f"({100 * gp.max() / total if len(gp) else 0:6.3f}%) "
          f"-> {'PASS' if (len(gp) and gp.max() == 0) else 'FAIL'}")

    if len(bad):
        print(f"pixel_suite: FAIL -- {len(bad)} frame(s) diverge from MAME in [{ORA_DIFF_FROM}, end); "
              f"first at JS frame {int(bad[0]) + ORA_DIFF_FROM} ({int(window[bad[0]])} px)")
        return 1
    print(f"pixel_suite: PASS -- oracle JS render byte-identical to MAME across {len(window)} frames "
          f"(boot transition frames 0-{ORA_DIFF_FROM - 1} excluded, documented)")
    return 0


def main():
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--rompath",
                   default=os.environ.get("THEPIT_ROMPATH", os.path.join(GAME, "rom")),
                   help="dir CONTAINING your thepitu1 romset dir (BYO; default $THEPIT_ROMPATH or games/thepit/rom)")
    p.add_argument("--layer", choices=("idiomatic", "oracle"), default=None,
                   help="which layer to render vs MAME: 'idiomatic' (default; the shipping generator "
                        "engine, drift-tolerant) or 'oracle' (the frozen translated layer, byte-exact). "
                        "The commit gate runs BOTH; omit -> idiomatic (manifest.runtime).")
    p.add_argument("--work", default=os.path.join(GAME, "out", "pixelwork"))
    p.add_argument("--done", action="store_true",
                   help="the runbook DONE bar: attract COMPLETENESS + tape-driven GAMEPLAY vs MAME "
                        "(drift-tolerant whole-run reconverge, convergence.mjs's rule in-process), NOT "
                        "the per-commit fixed-window tripwire. Always renders the idiomatic layer.")
    p.add_argument("--keep-frames", action="store_true",
                   help="keep the raw frames.rgb / state.bin dumps after the verdict "
                        "(default: delete them; tools/raw_dumps.py).")
    a = p.parse_args()

    # --done: the ship bar (attract completeness + gameplay reconverge). Separate from the default
    # fixed-window paths below, which the per-commit pixel_gate_required.py still calls plain.
    if a.done:
        return run_done(a)

    verified = verify_roms(a.rompath)
    if verified is None:
        print("pixel_suite: SKIP -- no `mame` on PATH")
        return 0
    if not verified:
        print(f"pixel_suite: SKIP -- MAME cannot verify {DRIVER} under --rompath {a.rompath} "
              f"(BYO romset; set --rompath or $THEPIT_ROMPATH)")
        return 0

    with raw_dumps(a.work, keep=a.keep_frames):
        return run_oracle(a) if a.layer == "oracle" else run_idiomatic(a)


if __name__ == "__main__":
    sys.exit(main())
