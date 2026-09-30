#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""Donkey Kong gameplay pixel gate: JS render vs MAME, driven coin -> start -> real Mario play.

Attract takes no input, so a golden captures itself and proves little; this drives the SAME
coin/1P-start/joystick tape into both sides and compares the frames the game actually plays.
It renders the LAYER the manifest ships (`--layer idiomatic`, the generator engine web/worker.js
runs) or the frozen cycle-driven oracle (`--layer oracle`), against a MAME golden.

WHY THIS IS BUILT THE WAY IT IS (all four numbers MEASURED, see the block comments):

  * ENTROPY-PINNED, BOTH SIDES. DK's RNG is a main-loop spin counter (0x6019) raced against the
    vblank NMI; unpinned, JS and MAME fork within ~9 frames and every RNG-driven sprite drifts.
    The pin (manifest.entropyPin, mirrored on MAME by tools/lua/pin_entropy.lua) makes the whole
    RNG working set deterministic and identical on both sides — TEST-ONLY, never the shipped game.
    Without it there is no stable frame-to-frame comparison at all.

  * DRIFT-TOLERANT OFFSET, NOT A SINGLE FIXED ONE. Even pinned, the JS<->MAME frame offset is NOT
    globally constant: it grows across the long "how high"/Kong-carries-Pauline intro because of
    the accepted DMA-timing artifact (0x601A carries +-1 cutscene jitter). Measured: the boot/state
    offset is 3, and it has drifted to ~7 by the time Mario is playing. So the comparison is
    align-tolerant — each JS frame is scored against the BEST of a small window of golden offsets
    (GEN_OFFSET +- DRIFT) — exactly the drift-tolerant convergence DK's validation mandates, never a
    fixed offset. A +-1-frame align window shifts a moving sprite by ~1px; it cannot absorb the
    wrong twin below (a 64px barrel displacement), so the teeth survive the tolerance.

  * THE GATE WINDOW IS REAL MARIO GAMEPLAY. After start the game plays a ~1000-frame intro before
    Mario spawns (~JS frame 1176); the tape then holds P1 Right so he walks the 25m girders while
    barrels roll. The window [GATE_FROM, GATE_TO) is that walk — moving Mario + moving barrels,
    the content a rendering regression actually corrupts. game_responded() proves, from the
    golden's own state, that the coin was ACCEPTED and play STARTED and Mario is ACTIVE in the
    window, so the gate can never pass over an attract screen or a frozen intro.

  * NO ROW BAND EXCLUSION. Time Pilot's gate weakly-guards its top rows because its idiomatic path
    composites scanline bands against a beam. DK's idiomatic runtime renders a WHOLE-FRAME snapshot
    (machine.renderFrame(), the shipped serviceIdiomaticFrame call), so there is no scanline-descent
    residual and the WHOLE frame is guarded — BAND_FROM is 0. The idiomatic floor is instead a
    moving-sprite phase residual (snapshot vs MAME's beam), which is what sets the band.
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.dirname(HERE)
REPO = os.path.dirname(os.path.dirname(GAME))
sys.path.insert(0, os.path.join(REPO, "tools"))

import numpy as np  # noqa: E402
import pixel_gate  # noqa: E402
from framediff import FROZEN_OFFSET  # noqa: E402
from hardware import Hardware  # noqa: E402
from raw_dumps import raw_dumps  # noqa: E402

HW = os.path.join(REPO, "boards", "dkong", "hardware.json")
DRIVER = "dkong"
SECONDS = 30
GOLDEN_FRAMES = 1820          # floor(60.606061 * 30) + 2, the capture's own length

# ── THE INPUT TAPE, in the GOLDEN's (MAME) frame numbering ────────────────────────────────────
# coin then 1P start then P1 Right held so Mario walks once he spawns. Same events on both sides.
LUA_COIN, LUA_START, LUA_WALK = 120, 180, 1180
# ★ TAPE_ORIGIN = 3, MEASURED. On the coroutine engine boot burns NO frames; MAME spends 3 (its
# RAM-clear) before the same first vblank wait, so idiomatic state[i] == golden state[i+3] at boot
# (measured: at offset 3 the only work cells that differ are the inert spin counter 0x6019 and two
# frame-sync timers; sprite+video RAM are byte-exact). applyInputs is called at (idiomaticFrame +
# TAPE_ORIGIN) so the tape rides the golden's numbering and the coin lands on the same game frame.
# The oracle (cycle-driven, boots like MAME) needs no origin shift — it uses the emit N+1 convention.
TAPE_ORIGIN = 3

# ── THE GAMEPLAY GATE WINDOW (JS frames.rgb indices) ─────────────────────────────────────────
# Mario spawns ~1176 and walks right to a ladder by ~1500; barrels roll throughout. Earlier frames
# are boot + the how-high/Kong intro (torn snapshot-vs-raster transition frames) and are NOT gated.
GATE_FROM, GATE_TO = 1176, 1500
BAND_FROM = 0                 # whole frame guarded — the snapshot renderer has no scanline band

# ── PER-LAYER ALIGNMENT + BAND, each MEASURED in the gate window ──────────────────────────────
# idiomatic (generator engine, renderFrame snapshot): the offset has drifted to 7 by the gate
#   window; align-tolerance +-1 (offsets {6,7,8}). CORRECT-LAYER FLOOR = 180px worst frame (0 frames
#   over 400) — the moving-sprite snapshot-vs-beam phase residual. BAND_MAX_PX = 540 = 3x the floor,
#   NOT fitted to the twin.
# oracle (cycle-driven, boots like MAME): no cutscene drift, so offset is the frozen +1 and align
#   tolerance is 0. CORRECT-LAYER FLOOR = 7px worst frame (near byte-exact, pinned). BAND_MAX_PX = 30
#   (~4x the 7px floor, a hair of run-to-run headroom); any real oracle regression is hundreds of px.
LAYER = {
    "idiomatic": dict(gen_offset=7, drift=1, band_max_px=540, tape_origin=TAPE_ORIGIN,
                      idiomatic=True, input_shift=0),
    "oracle":    dict(gen_offset=FROZEN_OFFSET, drift=0, band_max_px=30, tape_origin=0,
                      idiomatic=False, input_shift=1),
}

# ── game_responded state cells (work RAM), MEASURED against an attract-only golden ────────────
CREDITS = 0x6001     # 0 in attract forever; -> nonzero the frame the machine ACCEPTS the coin
GAME_MODE = 0x6005   # 0x01 attract -> 0x02 credit screen (coin) -> 0x03 in play (start). Never 0x03 in attract.
MARIO_X = 0x6203     # 0 until Mario spawns into the board; nonzero == Mario is on the playfield

# ══ --done: the runbook DONE BAR (attract COMPLETENESS + tape-driven GAMEPLAY vs MAME) ══════════
# The default path (below) is the per-commit fixed-window gameplay TRIPWIRE that tools/pixel_gate_
# required.py invokes. --done is the go-forward SHIP bar: it reconverges the WHOLE run with the
# drift-tolerant "nearest-golden-frame" rule (docs/pixel-gate.md, tools/convergence.mjs), adding the
# attract COMPLETENESS pass an attract-blind gate structurally lacks (runbook 5: an attract-only gate
# must NOT count green for done) AND the tape-driven GAMEPLAY-vs-MAME pass.
#
#   ★ WHY THIS SUITE RECONVERGES IN-PROCESS INSTEAD OF SHELLING `node tools/convergence.mjs`:
#   convergence.mjs's pixel mode CANNOT construct a DK machine. It loads ONE gfx image (gfx.bin /
#   gfx1.bin) and hands it to Machine.create as `gfx`, but DK's Machine takes SPLIT tile+sprite ROMs
#   (gfx1 tiles, gfx2 sprites) and reads NEITHER `gfx` nor pre-decoded tiles/sprites -- so
#   renderFrame() throws "renderFrame needs gfx1 and proms" before a single frame is scored (verified).
#   The DK renderer that DOES build the split-gfx video is games/dkong/tools/render.js (the shipped
#   coroutine engine, machine.renderFrame snapshot). So --done renders through render.js exactly as the
#   default path does, then applies convergence.mjs's OWN reconverge rule here, byte-for-byte: an 8px
#   downsample grid, each scored JS frame matched to its NEAREST golden frame over the WHOLE golden,
#   PASS iff none diverges past a FIXED %-threshold. The threshold is convergence.mjs's default and is
#   NEVER tuned; --done tunes only seconds/origin/tape. (A one-line gfx2 fix to convergence.mjs would
#   let a future suite call it directly -- flagged to the lead; convergence.mjs is out of edit scope.)
#
# Both parts PIN entropy on BOTH sides (mirrors the default path): DK's spin-counter RNG forks JS from
# MAME within ~9 frames unpinned, so an UNpinned reconverge would diverge on RNG alone, not on a real
# rendering regression. The pin is TEST-ONLY (never the shipped game).
DONE_ATTRACT_SECONDS = 20        # a full attract window (title/how-high/score/demo), reconverged unpinned-of-window
DONE_GAMEPLAY_SECONDS = 30       # coin -> start -> Mario spawns (~f1176) -> walks the 25m girder; barrels roll
DONE_TAPE_ORIGIN = TAPE_ORIGIN   # idiomatic boots ~3 frames ahead of MAME; the tape rides the golden numbering
RECON_STRIDE = 15                # score every 15th JS frame (convergence.mjs default --frame-stride)
RECON_S = 8                      # 8px downsample grid (convergence.mjs default sample stride)
RECON_PX_THRESHOLD = 5.0         # FIXED %-floor (convergence.mjs default --px-threshold); NEVER tuned here
MIN_DISTINCT = 10                # positive control: a frozen/black screen proves nothing -- require motion


def lua_tape(path):
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(f"""-- Generated by pixel_suite.py -- coin, 1P start, then P1 Right held so Mario walks.
local M = manager.machine
local I2 = M.ioport.ports[":IN2"]
local I0 = M.ioport.ports[":IN0"]
assert(I2 and I0, "missing :IN2 / :IN0")
local coin, start = I2.fields["Coin 1"], I2.fields["1 Player Start"]
local right = I0.fields["P1 Right"]
assert(coin and start and right, "missing Coin 1 / 1 Player Start / P1 Right")
local f = 0
_G.__pt = emu.add_machine_frame_notifier(function()
  f = f + 1
  coin:set_value((f >= {LUA_COIN} and f < {LUA_COIN + 1}) and 1 or 0)
  start:set_value((f >= {LUA_START} and f < {LUA_START + 1}) and 1 or 0)
  right:set_value((f >= {LUA_WALK}) and 1 or 0)
end)
""")
    return path


def pin_spec():
    """The MAME entropy-pin ROM-patch spec, derived from manifest.entropyPin so it cannot drift
    from the JS pin. Uses core/entropy-pin.js's entropyPinRomSpec -- the one source of truth."""
    r = subprocess.run(
        ["node", "-e",
         'import("%s").then(async(ep)=>{const m=(await import("%s")).default;'
         'process.stdout.write(ep.entropyPinRomSpec(m.entropyPin));})'
         % (os.path.join(REPO, "core", "entropy-pin.js"), os.path.join(GAME, "manifest.js"))],
        capture_output=True, text=True, check=True)
    return r.stdout.strip()


def capture_golden(rompath, out, tape):
    subprocess.run(
        [sys.executable, os.path.join(REPO, "tools", "mame_golden.py"),
         "--hardware", HW, "--lua-dir", os.path.join(HERE, "lua"),
         "--rompath", rompath, "--out", out, "--seconds", str(SECONDS),
         "--tape", tape, "--pin-entropy", pin_spec()],
        check=True)


def render_js(out, frames, cfg):
    """Render the chosen layer through games/dkong/tools/render.js, pinned, same tape."""
    shift = cfg["input_shift"]  # oracle uses the emit N+1 convention; idiomatic rides the origin
    cmd = ["node", os.path.join(HERE, "render.js"),
           "--pin-entropy", "--frames", str(frames), "--frames-out", out,
           "--input", f"0x7d00=0x80@{LUA_COIN + shift}:once",
           "--input", f"0x7d00=0x04@{LUA_START + shift}:once",
           "--input", f"0x7c00=0x01@{LUA_WALK + shift}:hold"]
    if cfg["idiomatic"]:
        cmd += ["--idiomatic", "--tape-origin", str(cfg["tape_origin"])]
    subprocess.run(cmd, check=True)


def band_worst(js_rgb, golden_rgb, cfg):
    """Drift-tolerant per-frame worst differing-pixel count over the gate window.

    Each JS frame i in [GATE_FROM, GATE_TO) is scored against the BEST-aligning golden frame in
    i + {gen_offset - drift .. gen_offset + drift} (rows BAND_FROM..). Returns (worst, over, at):
    the worst per-frame count, how many frames exceed BAND_MAX_PX, and where the worst sits.
    Deriving PASS from `worst` alone would read an EMPTY window as clean, so the caller must also
    check the window is non-empty (game_responded proves the golden actually played)."""
    w, h, bpf = pixel_gate.screen_geometry(HW)
    offs = [cfg["gen_offset"] + d for d in range(-cfg["drift"], cfg["drift"] + 1)]
    njs = os.path.getsize(js_rgb) // bpf
    ngd = os.path.getsize(golden_rgb) // bpf
    worst, over, worst_at = 0, 0, None
    with open(js_rgb, "rb") as jf, open(golden_rgb, "rb") as gf:
        for i in range(GATE_FROM, min(GATE_TO, njs)):
            jf.seek(i * bpf)
            a = np.frombuffer(jf.read(bpf), dtype=np.uint8).reshape(h, w, 3)[BAND_FROM:]
            best = None
            for k in offs:
                if not 0 <= i + k < ngd:
                    continue
                gf.seek((i + k) * bpf)
                b = np.frombuffer(gf.read(bpf), dtype=np.uint8).reshape(h, w, 3)[BAND_FROM:]
                c = int(np.any(a != b, axis=2).sum())
                best = c if best is None else min(best, c)
            if best is None:
                continue
            if best > cfg["band_max_px"]:
                over += 1
            if best > worst:
                worst, worst_at = best, i
    return worst, over, worst_at


def state_column(golden_dir, addr):
    """Every frame's value of one work-RAM cell, read out of the golden's state dump."""
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
    return blob[off::frame_bytes]


def game_responded(golden_dir):
    """Did the golden take the coin, start play, and reach Mario on the board?

    Without this a tape that never reaches the machine leaves both sides in attract, every frame
    matches, and the gate PASSes over a run that played nothing. Read from the golden's own state:
      * coin accepted  -- CREDITS (0x6001) goes nonzero (stays 0 in attract forever).
      * play started   -- GAME_MODE (0x6005) reaches 0x03 in-play (never 0x03 in attract).
      * Mario on board -- MARIO_X (0x6203) is nonzero somewhere in the GATED window, so the pixels
                          being compared are real gameplay, not the how-high/intro screen.
    """
    credits = state_column(golden_dir, CREDITS)
    mode = state_column(golden_dir, GAME_MODE)
    marx = state_column(golden_dir, MARIO_X)
    return {
        "coin accepted": [f for f, v in enumerate(credits) if v],
        "play started (mode==0x03)": [f for f, v in enumerate(mode) if v == 0x03],
        "Mario on board in gate window":
            [f for f in range(GATE_FROM, min(GATE_TO, len(marx))) if marx[f]],
    }


def runtime():
    """Which layer the player runs, read from the manifest rather than assumed."""
    r = subprocess.run(
        ["node", "-e",
         f'import("{os.path.join(GAME, "manifest.js")}").then(m => console.log(m.default.runtime))'],
        capture_output=True, text=True, check=True)
    return r.stdout.strip()


# ── --done helpers ───────────────────────────────────────────────────────────────────────────
def done_capture(rompath, out, seconds, tape=None):
    """Fresh PINNED MAME golden for one --done part. `tape` (a tapes/*.lua driver) composes coin/
    start/walk for the gameplay golden; omitted, it is the input-free attract golden. Both sides
    pin so the spin-counter RNG cannot fork JS from MAME. Returns True iff mame_golden CERTIFIED the
    capture -- its nonzero exit on a poisoned capture (watchdog reset, unverified DSW/reset) IS the
    poison guard, so a poisoned golden fails closed here."""
    cmd = [sys.executable, os.path.join(REPO, "tools", "mame_golden.py"),
           "--hardware", HW, "--lua-dir", os.path.join(HERE, "lua"),
           "--rompath", rompath, "--out", out, "--seconds", str(seconds),
           "--pin-entropy", pin_spec()]
    if tape:
        cmd += ["--tape", tape]
    return subprocess.run(cmd).returncode == 0


def render_attract(out, frames, cfg):
    """Render `frames` of INPUT-FREE attract for the chosen layer, pinned (mirrors render_js but
    with no tape). Returns True iff render.js exited clean (nonzero == boot gap / dropped frame)."""
    cmd = ["node", os.path.join(HERE, "render.js"),
           "--pin-entropy", "--frames", str(frames), "--frames-out", out]
    if cfg["idiomatic"]:
        cmd += ["--idiomatic", "--tape-origin", str(cfg["tape_origin"])]
    return subprocess.run(cmd).returncode == 0


def frame_count(dir):
    with open(os.path.join(dir, "frames.json")) as fh:
        return json.load(fh)["count"]


def distinct_count(dir):
    """DISTINCT images the emitter recorded (render.js and mame_golden both write per-frame sha256)."""
    with open(os.path.join(dir, "frames.json")) as fh:
        j = json.load(fh)
    return len({f["sha256"] for f in j["frames"]})


def reconverge(js_rgb, golden_rgb):
    """convergence.mjs's drift-tolerant pixel rule, in-process (see the --done block comment for why).

    Downsample every frame on an 8px grid; score every RECON_STRIDE-th JS frame against its NEAREST
    golden frame over the WHOLE golden (alignment-free -- absorbs the small +3..+7 boot/DMA drift and
    the repeating attract loop); return (worst%, worst JS frame, frames over threshold, scored, samples).
    Deriving PASS from `worst` alone would read an EMPTY overlap as clean, so the caller also proves the
    run played (game_responded / distinct-frame control) and that the render covered the golden."""
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
    ngd, njs = g.shape[0], j.shape[0]
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


def _done_part(work, name, rompath, seconds, cfg, tape=None, gameplay=False):
    """Capture a pinned golden and reconverge one --done part; returns (ok, why). Fail-closed: a
    poisoned capture, a short render, a dead positive control, or any over-threshold frame -> False.
    Prints the reconverge line for the record."""
    gdir = os.path.join(work, name + "_golden")
    if not done_capture(rompath, gdir, seconds, tape=tape):
        return False, f"{name}: mame_golden refused to certify the pinned capture (poisoned golden)."
    gc = frame_count(gdir)
    jdir = os.path.join(work, name + "_js")
    # render_js uses check=True (raises on a boot gap / dropped frame); render_attract returns a bool.
    try:
        if gameplay:
            render_js(jdir, gc, cfg)
        elif not render_attract(jdir, gc, cfg):
            return False, f"{name}: render.js stopped early (boot gap / dropped frame); a short artifact must not be diffed."
    except subprocess.CalledProcessError:
        return False, f"{name}: render.js stopped early (boot gap / dropped frame); a short artifact must not be diffed."

    # positive control -- prove the golden is a LIVE run, not two idle/frozen screens.
    if gameplay:
        for label, frames in game_responded(gdir).items():
            if not frames:
                return False, f"{name}: golden shows no '{label}' -- comparing idle screens proves nothing."
            print(f"  golden: {label:32} frames {frames[0]}..{frames[-1]}")
    else:
        gd, jd = distinct_count(gdir), distinct_count(jdir)
        print(f"  golden {gc} frames, {gd} distinct   render {frame_count(jdir)} frames, {jd} distinct")
        if gd < MIN_DISTINCT or jd < MIN_DISTINCT:
            return False, (f"{name}: fewer than {MIN_DISTINCT} distinct frames "
                           f"(golden {gd}, render {jd}); a frozen screen proves nothing.")

    _, _, bpf = pixel_gate.screen_geometry(HW)
    njs = os.path.getsize(os.path.join(jdir, "frames.rgb")) // bpf
    if njs < gc - RECON_STRIDE:
        return False, f"{name}: render delivered {njs} frames, golden {gc}; the run did not cover the golden."

    jrgb, grgb = os.path.join(jdir, "frames.rgb"), os.path.join(gdir, "frames.rgb")
    worst, wf, over, scored, samples = reconverge(jrgb, grgb)
    verdict = "PASS" if over == 0 else "FAIL"
    print(f"  [{name}] reconverge: worst nearest-diff {worst:.2f}% @JS frame {wf} "
          f"(threshold {RECON_PX_THRESHOLD:.0f}%, over={over}, {scored} scored, {samples} samples) -> {verdict}")
    if over:
        return False, f"{name}: {over} frame(s) diverge past {RECON_PX_THRESHOLD:.0f}% (worst {worst:.2f}% @frame {wf})."

    # Gameplay carries a SECOND, tighter teeth dimension: the per-commit gate's raw-pixel band over the
    # Mario-walks window [GATE_FROM,GATE_TO). The coarse 8px/%-downsample reconverge above ranks the whole
    # run (gross divergence + completeness); band_worst measures RAW differing px per frame in the moving-
    # sprite window, catching a mid-size regression the % rule ranks below threshold. Same render+golden --
    # no extra capture. (Both share the idiomatic snapshot-vs-beam floor: a sub-~floor localized shift trips
    # neither; a regression must exceed the moving-sprite phase residual, exactly as the per-commit gate.)
    if gameplay:
        bworst, bover, bat = band_worst(jrgb, grgb, cfg)
        bverdict = "PASS" if bover == 0 else "FAIL"
        print(f"  [{name}] tight band [{GATE_FROM}:{GATE_TO}]: worst {bworst}px @frame {bat} "
              f"(budget {cfg['band_max_px']}px, over={bover}) -> {bverdict}")
        if bover:
            return False, f"{name}: {bover} frame(s) over the {cfg['band_max_px']}px band (worst {bworst}px @frame {bat})."
    return True, ""


def run_done(a):
    """--done: the ship bar. Verify the romset, then reconverge attract COMPLETENESS + tape GAMEPLAY
    vs fresh pinned MAME goldens. Fail-closed: prints `pixel_suite: PASS` ONLY when BOTH parts converge;
    if it cannot run (no mame/romset) it exits WITHOUT printing PASS (the DONE gate keys on that line,
    never the exit code)."""
    try:
        verified = subprocess.run(["mame", "-rompath", a.rompath, "-verifyroms", DRIVER],
                                  capture_output=True, text=True).returncode == 0
    except FileNotFoundError:
        print("pixel_suite: SKIP -- no `mame` on PATH; cannot build a golden to compare against.")
        return 0
    if not verified:
        print(f"pixel_suite: SKIP -- romset {DRIVER} not found under {a.rompath}.")
        return 0

    layer = a.layer or runtime()
    cfg = LAYER[layer]
    print(f"  layer: {'IDIOMATIC (generator engine, renderFrame snapshot)' if cfg['idiomatic'] else 'oracle (cycle-driven)'}"
          f"  (--done: attract completeness + tape gameplay, pinned reconverge)")
    work = tempfile.mkdtemp(prefix="dkong_pixel_done_")
    with raw_dumps(work, keep=a.keep_frames, rmtree=True):
        # PART A -- attract COMPLETENESS (input-free golden, a full attract window, reconverged).
        ok, why = _done_part(work, "attract", a.rompath, DONE_ATTRACT_SECONDS, cfg)
        if not ok:
            print(f"pixel_suite: FAIL -- {why}")
            return 1
        # PART B -- tape-driven GAMEPLAY vs MAME (the attract-blind hole).
        tape = lua_tape(os.path.join(work, "tape.lua"))
        ok, why = _done_part(work, "gameplay", a.rompath, DONE_GAMEPLAY_SECONDS, cfg, tape=tape, gameplay=True)
        if not ok:
            print(f"pixel_suite: FAIL -- {why}")
            return 1
        print("pixel_suite: PASS")
        return 0


def main():
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--rompath", default=os.path.join(GAME, "rom"))
    p.add_argument("--frames", type=int, default=GOLDEN_FRAMES - 1)
    p.add_argument("--work", default=os.path.join(GAME, "out", "pixelwork"))
    p.add_argument("--layer", choices=("idiomatic", "oracle"), default=None,
                   help="which layer to render vs MAME. Default reads manifest.runtime; the pixel "
                        "gate passes this explicitly, chosen from which layer's files changed.")
    p.add_argument("--done", action="store_true",
                   help="the runbook DONE bar: attract COMPLETENESS + tape-driven GAMEPLAY vs MAME "
                        "(drift-tolerant whole-run reconverge), NOT the per-commit fixed-window tripwire.")
    p.add_argument("--keep-frames", action="store_true",
                   help="keep the raw frames.rgb / state.bin dumps after the verdict "
                        "(default: delete them; tools/raw_dumps.py).")
    a = p.parse_args()

    # --done: the ship bar (attract completeness + gameplay reconverge). Separate from the default
    # fixed-window gameplay path below, which the per-commit pixel_gate_required.py still calls plain.
    if a.done:
        return run_done(a)

    try:
        verified = subprocess.run(["mame", "-rompath", a.rompath, "-verifyroms", DRIVER],
                                  capture_output=True, text=True).returncode == 0
    except FileNotFoundError:
        print("pixel_suite: SKIP -- no `mame` on PATH")
        return 0
    if not verified:
        print(f"pixel_suite: SKIP -- romset {DRIVER} not found under {a.rompath}")
        return 0

    layer = a.layer or runtime()
    cfg = LAYER[layer]
    src = "--layer" if a.layer else "manifest.runtime"
    print(f"  layer: {'IDIOMATIC (generator engine, renderFrame snapshot)' if cfg['idiomatic'] else 'oracle (cycle-driven)'}"
          f"; golden offset {cfg['gen_offset']} +-{cfg['drift']}, band {cfg['band_max_px']}px (from {src})")

    os.makedirs(a.work, exist_ok=True)
    with raw_dumps(a.work, keep=a.keep_frames):
        go, jo = os.path.join(a.work, "golden"), os.path.join(a.work, layer)
        capture_golden(a.rompath, go, lua_tape(os.path.join(a.work, "tape.lua")))
        render_js(jo, a.frames, cfg)

        rc = 0
        resp = game_responded(go)
        for label, frames in resp.items():
            if not frames:
                print(f"pixel_suite: FAIL -- golden shows no '{label}'; this run compares two "
                      "attract/idle screens, which proves nothing.")
                return 1
            print(f"  golden: {label:32} frames {frames[0]}..{frames[-1]}")

        _, _, bpf = pixel_gate.screen_geometry(HW)
        njs = os.path.getsize(os.path.join(jo, "frames.rgb")) // bpf
        if njs < GATE_TO:
            print(f"pixel_suite: INCOMPLETE -- render delivered {njs} frames; the gate window ends at "
                  f"{GATE_TO}, so the comparison never reached gameplay.")
            return 1

        worst, over, at = band_worst(os.path.join(jo, "frames.rgb"),
                                     os.path.join(go, "frames.rgb"), cfg)
        verdict = pixel_gate.PASS if over == 0 else pixel_gate.FAIL
        print(f"  gameplay [{GATE_FROM}:{GATE_TO}] worst={worst:5d}px (budget {cfg['band_max_px']}) "
              f"over={over} worst@{at} -> {verdict}")
        if over:
            rc = 1

        print(f"pixel_suite: {'PASS' if rc == 0 else 'FAIL'}")
        return rc


if __name__ == "__main__":
    sys.exit(main())
