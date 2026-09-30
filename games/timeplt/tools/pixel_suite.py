#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""Time Pilot gameplay pixel gate: JS render vs MAME, through coin -> start -> play. Attract takes
no input, so a golden captures itself and proves little; this drives the same tape into both.

THE TAPE OFFSET IS +1, MEASURED. Both tapes press at frame 400; the first frame the coin alters RAM
is JS 401 and MAME 402, 13 bytes each side. Discriminating: at +1 the state diff is byte-for-byte
over all 1802 frames, at +2 it fails at 402. Re-derive if the tape's timing changes.
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

HW = os.path.join(REPO, "boards", "timeplt", "hardware.json")
DRIVER = "timeplt"
SECONDS = 30
GOLDEN_FRAMES = 1802          # floor(60.0 * 30) + 2, the capture's own length

# ★★ THE SHARP CRITERION, because the loose one has no teeth: a live wrong twin (one bit flipped in
# the shape byte `refreshSpriteFromHeading` stores, changing 630 of 1801 frames) reaches only 2.99%
# and PASSES the 5%. Below BAND_FROM a correct layer is nearly exact -- 31 of 1566 frames, worst
# 33px, against 408 frames / 490px for that twin. BAND_MAX_PX is 3x the CORRECT layer's floor, NOT
# fitted to the twin; scroll-pace and bar-phase twins also go red here.
BAND_FROM = 113
BAND_MAX_PX = 100

LUA_COIN, LUA_START = 400, 500
TAPE_OFFSET = 1               # measured; see the module docstring
HOLD = 8

LANDMARK = 235
GEN_OFFSET = LANDMARK + 1

DIFF_FROM = 0

# ★★ WHAT THE IDIOMATIC PATH COSTS, SO A PASS IS NOT READ AS PARITY. (1) The first GEN_OFFSET
# golden frames are NOT compared -- boot produces none on a yield clock, and rendering further
# cannot extend coverage: the length is golden_frames - offset. (2) A scanline-compositing residual
# above BAND_FROM, because MAME paints as the beam descends while a yield clock snapshots FINAL RAM
# for every row. ⛔ SO ROWS 0..BAND_FROM-1 ARE WEAKLY GUARDED -- a HOLE, not an artifact: only the
# 5% covers them and the residual spends 2.309% of it, leaving ~1543px/frame of slack. Injected
# top-band defects all PASS with the band unmoved at 33px (one tile 2.420%, one sprite 2.755%, FOUR
# sprites 4.095%), so a top-of-screen regression under ~1500px is invisible here.

INPUT_LATCH = 0xA9AE   # raw IN0 mirror, rewritten every NMI: 0x01 coin held, 0x08 start held
COIN_TAKEN = 0xA981    # 0 -> non-zero when the machine ACCEPTS the coin (debounced rising edge)
PLAY_ACTIVE = 0xAD30   # explicit flag: stored 0xFF when play begins, cleared with xor a

# ══ --done: the runbook DONE BAR (attract COMPLETENESS + tape-driven GAMEPLAY vs MAME) ══════════
# The default main() path below is the per-commit fixed-offset gameplay TRIPWIRE that tools/
# pixel_gate_required.py invokes plain. --done is the go-forward SHIP bar: it reconverges the WHOLE
# run with the drift-tolerant "nearest-golden-frame" rule (docs/pixel-gate.md, tools/convergence.mjs),
# adding the attract COMPLETENESS pass an attract-blind gate structurally lacks (runbook 5: an
# attract-only gate must NOT count green for done) AND the tape-driven GAMEPLAY-vs-MAME pass.
#
#   ★ WHY THIS SUITE RECONVERGES IN-PROCESS INSTEAD OF SHELLING `node tools/convergence.mjs`:
#   convergence.mjs's pixel mode renders the machine through its OWN generic renderRun, which snapshots
#   with m.renderFrame() -- the POST-NMI whole-frame image (2810px vs MAME here). Time Pilot's idiomatic
#   layer ships a SCANLINE-band renderer that must snapshot at the VBLANK YIELD (finishBeamFrame(),
#   1324px vs MAME), which ONLY games/timeplt/tools/render.js's runGeneratorFrames produces -- render.js's
#   own header proves the yield instant is the correct one and the post-NMI instant is not. So --done
#   renders through render.js exactly as the default path does, then applies convergence.mjs's OWN
#   reconverge rule here, byte-for-byte: an 8px downsample grid, each scored JS frame matched to its
#   NEAREST golden frame over the WHOLE golden, PASS iff none diverges past a FIXED %-threshold. The
#   threshold is convergence.mjs's default and is NEVER tuned; --done tunes only seconds/origin/tape.
#
# Time Pilot is DETERMINISTIC without a pin (module docstring: the coin tape reconverges byte-for-byte
# over all 1802 state frames), so both parts run UNpinned -- there is no spin-counter RNG to fork the way
# DK's does, and nothing to pin on either side.
DONE_ATTRACT_SECONDS = 30        # a full attract window (title/demo/score), reconverged
DONE_GAMEPLAY_SECONDS = SECONDS  # coin -> start -> play, the same 30s window the default gate drives
RECON_STRIDE = 15                # score every 15th JS frame (convergence.mjs default --frame-stride)
RECON_S = 8                      # 8px downsample grid (convergence.mjs default sample stride)
RECON_PX_THRESHOLD = 5.0         # FIXED %-floor (convergence.mjs default --px-threshold); NEVER tuned here
MIN_DISTINCT = 10                # positive control: a frozen/black screen proves nothing -- require motion


def lua_tape(path):
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(f"""-- Generated by pixel_suite.py -- coin then 1P start on IN0.
local IN0 = manager.machine.ioport.ports[":IN0"]
assert(IN0, "no :IN0")
local coin, start = IN0.fields["Coin 1"], IN0.fields["1 Player Start"]
assert(coin and start, "missing Coin 1 / 1 Player Start")
local f = 0
_G.__pt = emu.add_machine_frame_notifier(function()
  f = f + 1
  coin:set_value((f >= {LUA_COIN} and f < {LUA_COIN + HOLD}) and 1 or 0)
  start:set_value((f >= {LUA_START} and f < {LUA_START + HOLD}) and 1 or 0)
end)
""")
    return path


def capture_golden(rompath, out, tape):
    subprocess.run(
        [sys.executable, os.path.join(REPO, "tools", "mame_golden.py"),
         "--hardware", HW, "--lua-dir", os.path.join(HERE, "lua"),
         "--rompath", rompath, "--out", out, "--seconds", str(SECONDS),
         "--tape", tape],
        check=True)


def band_worst(js_rgb, golden_rgb, offset, from_frame):
    """Worst per-frame pixel count in rows BAND_FROM.. , and how many frames are over budget."""
    w, h, bpf = pixel_gate.screen_geometry(HW)
    n = min(os.path.getsize(js_rgb) // bpf, os.path.getsize(golden_rgb) // bpf - offset)
    worst, over, worst_at = 0, 0, None
    with open(js_rgb, "rb") as jf, open(golden_rgb, "rb") as gf:
        for i in range(from_frame, n):
            jf.seek(i * bpf)
            gf.seek((i + offset) * bpf)
            a = np.frombuffer(jf.read(bpf), dtype=np.uint8).reshape(h, w, 3)[BAND_FROM:]
            b = np.frombuffer(gf.read(bpf), dtype=np.uint8).reshape(h, w, 3)[BAND_FROM:]
            c = int(np.any(a != b, axis=2).sum())
            if c > BAND_MAX_PX:
                over += 1
            if c > worst:
                worst, worst_at = c, i
    return worst, over, worst_at


def runtime():
    """Which layer the player runs, read from the manifest rather than assumed."""
    r = subprocess.run(
        ["node", "-e",
         f'import("{os.path.join(GAME, "manifest.js")}").then(m => console.log(m.default.runtime))'],
        capture_output=True, text=True, check=True)
    return r.stdout.strip()


def render_js(out, frames, idiomatic):
    cmd = ["node", os.path.join(HERE, "render.js"), "--frames", str(frames),
           "--input", f"0xc300=0x01@{LUA_COIN + TAPE_OFFSET}:hold{HOLD}",
           "--input", f"0xc300=0x08@{LUA_START + TAPE_OFFSET}:hold{HOLD}",
           "--frames-out", out]
    if idiomatic:
        cmd += ["--idiomatic", "--tape-origin", str(LANDMARK)]
    subprocess.run(cmd, check=True)


def state_column(golden_dir, addr):
    """Every frame's value of one work-RAM cell, read out of the golden's state dump.

    Geometry comes from the same hardware.json the capture used, which already checks its
    regions sum to the declared frame size -- so a layout change cannot silently mis-index.
    """
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

    path = os.path.join(golden_dir, "state.bin")
    with open(path, "rb") as fh:
        blob = fh.read()
    if len(blob) % frame_bytes:
        raise SystemExit(f"pixel_suite: {path} is {len(blob)} bytes, not a multiple of "
                         f"{frame_bytes} -- the dumped state regions have changed")
    return blob[off::frame_bytes]


def game_responded(golden_dir):
    """Did the golden take the coin, and did the game then start?

    Without this, a tape that never reaches the machine leaves both sides in attract, every frame
    matches, and the gate PASSes over a run that played nothing. The input latch alone is not
    enough -- rewritten from the port every NMI, it proves the bits arrived, not that the machine
    acted. The two state cells prove the response.
    """
    latch = state_column(golden_dir, INPUT_LATCH)
    return {
        "coin bits delivered": [f for f, v in enumerate(latch) if v & 0x01],
        "start bits delivered": [f for f, v in enumerate(latch) if v & 0x08],
        "coin accepted": [f for f, v in enumerate(state_column(golden_dir, COIN_TAKEN)) if v],
        "play active": [f for f, v in enumerate(state_column(golden_dir, PLAY_ACTIVE)) if v],
    }


# ── Raw-capture cleanup ────────────────────────────────────────────────────────────────────────
# tools/raw_dumps.py deletes the raw frames.rgb / state.bin once the verdict is in (PASS, FAIL, crash
# or SIGTERM). What stays: frames.json hashes, tape.lua, reach.json, and summary.json -- the verdict
# plus, on FAIL, the worst frames and their pixel counts. --keep-frames keeps the raw dumps.
def worst_frames(diffs, from_frame=0, k=10):
    """The `k` worst JS frames at or after `from_frame` as [[frame, differing_px], ...], worst first."""
    window = np.asarray(diffs[from_frame:], dtype=np.int64)
    order = np.argsort(window, kind="stable")[::-1][:k]
    return [[int(i) + from_frame, int(window[i])] for i in order if window[i] > 0]


# ── --done helpers ─────────────────────────────────────────────────────────────────────────────
def done_capture(rompath, out, seconds, tape=None):
    """Fresh certified MAME golden for one --done part. `tape` (a lua tape) composes coin/start for
    the gameplay golden; omitted, it is the input-free attract golden. Time Pilot is deterministic
    without a pin, so neither side pins. Returns True iff mame_golden CERTIFIED the capture -- its
    nonzero exit on a poisoned capture (watchdog reset, unverified DSW/reset) IS the poison guard, so
    a poisoned golden fails closed here."""
    cmd = [sys.executable, os.path.join(REPO, "tools", "mame_golden.py"),
           "--hardware", HW, "--lua-dir", os.path.join(HERE, "lua"),
           "--rompath", rompath, "--out", out, "--seconds", str(seconds)]
    if tape:
        cmd += ["--tape", tape]
    return subprocess.run(cmd).returncode == 0


def render_attract(out, frames, idiomatic):
    """Render `frames` of INPUT-FREE attract for the chosen layer (mirrors render_js but with no coin/
    start tape). Idiomatic rides the golden's numbering via --tape-origin LANDMARK, exactly as the
    gameplay render does. Returns True iff render.js exited clean (nonzero == boot gap / dropped frame)."""
    cmd = ["node", os.path.join(HERE, "render.js"), "--frames", str(frames), "--frames-out", out]
    if idiomatic:
        cmd += ["--idiomatic", "--tape-origin", str(LANDMARK)]
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
    golden frame over the WHOLE golden (alignment-free -- absorbs the +236 boot gap and the repeating
    attract loop without a hardcoded offset); return (worst%, worst JS frame, frames over threshold,
    scored, samples). Deriving PASS from `worst` alone would read an EMPTY overlap as clean, so the
    caller also proves the run played (game_responded / distinct control) and that the render covered
    the golden's content."""
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


def _done_part(work, name, rompath, seconds, idiomatic, offset, tape=None, gameplay=False):
    """Capture a golden and reconverge one --done part; returns (ok, why). Fail-closed: a poisoned
    capture, a short render, a dead positive control, or any over-threshold frame -> False. The JS render
    is capped to `gc - offset` frames so its content never advances PAST the golden's last frame (the
    +236 boot gap would otherwise leave the tail JS frames with no golden match); nearest-frame absorbs
    the offset itself. Prints the reconverge line for the record."""
    gdir = os.path.join(work, name + "_golden")
    if not done_capture(rompath, gdir, seconds, tape=tape):
        return False, f"{name}: mame_golden refused to certify the capture (poisoned golden)."
    gc = frame_count(gdir)
    jdir = os.path.join(work, name + "_js")
    want = gc - offset          # render.js paints want-1 frames; last content = golden gc-1-offset+offset
    try:
        if gameplay:
            render_js(jdir, want, idiomatic)
        elif not render_attract(jdir, want, idiomatic):
            return False, f"{name}: render.js stopped early (boot gap / dropped frame); a short artifact must not be diffed."
    except subprocess.CalledProcessError:
        return False, f"{name}: render.js stopped early (boot gap / dropped frame); a short artifact must not be diffed."

    # positive control -- prove the golden is a LIVE run, not two idle/frozen screens.
    if gameplay:
        for label, frames in game_responded(gdir).items():
            if not frames:
                return False, f"{name}: golden shows no '{label}' -- comparing idle screens proves nothing."
            print(f"  golden: {label:22} frames {frames[0]}..{frames[-1]}")
    else:
        gd, jd = distinct_count(gdir), distinct_count(jdir)
        print(f"  golden {gc} frames, {gd} distinct   render {frame_count(jdir)} frames, {jd} distinct")
        if gd < MIN_DISTINCT or jd < MIN_DISTINCT:
            return False, (f"{name}: fewer than {MIN_DISTINCT} distinct frames "
                           f"(golden {gd}, render {jd}); a frozen screen proves nothing.")

    _, _, bpf = pixel_gate.screen_geometry(HW)
    njs = os.path.getsize(os.path.join(jdir, "frames.rgb")) // bpf
    if njs < want - 1 - RECON_STRIDE:
        return False, f"{name}: render delivered {njs} of ~{want - 1} frames; the run did not cover the golden."

    jrgb, grgb = os.path.join(jdir, "frames.rgb"), os.path.join(gdir, "frames.rgb")
    worst, wf, over, scored, samples = reconverge(jrgb, grgb)
    verdict = "PASS" if over == 0 else "FAIL"
    print(f"  [{name}] reconverge: worst nearest-diff {worst:.2f}% @JS frame {wf} "
          f"(threshold {RECON_PX_THRESHOLD:.0f}%, over={over}, {scored} scored, {samples} samples) -> {verdict}")
    if over:
        return False, f"{name}: {over} frame(s) diverge past {RECON_PX_THRESHOLD:.0f}% (worst {worst:.2f}% @frame {wf})."

    # Gameplay carries a SECOND, tighter teeth dimension: the default gate's raw-pixel band over rows
    # BAND_FROM.. (the whole-frame reconverge weakly-guards the top band -- MAME paints as the beam
    # descends while the yield clock snapshots FINAL RAM, a structural residual that spends ~2.3% of the
    # 5%). The coarse 8px/%-downsample reconverge ranks the whole run (gross divergence + completeness);
    # band_worst measures RAW differing px per frame in rows BAND_FROM.., catching a mid-size regression
    # the % rule ranks below threshold. Same render+golden -- no extra capture. (Both share the top-band
    # hole: a sub-~floor localized shift inside rows 0..BAND_FROM-1 trips neither; a GROSS/global
    # regression exceeds the band, exactly as the per-commit gate.)
    if gameplay:
        bworst, bover, bat = band_worst(jrgb, grgb, offset, DIFF_FROM)
        bverdict = "PASS" if bover == 0 else "FAIL"
        print(f"  [{name}] tight band rows {BAND_FROM}..: worst {bworst}px @frame {bat} "
              f"(budget {BAND_MAX_PX}px, over={bover}) -> {bverdict}")
        if bover:
            return False, f"{name}: {bover} frame(s) over the {BAND_MAX_PX}px band (worst {bworst}px @frame {bat})."
    return True, ""


def run_done(a):
    """--done: the ship bar. Verify the romset, then reconverge attract COMPLETENESS + tape GAMEPLAY vs
    fresh MAME goldens. Fail-closed: prints `pixel_suite: PASS` ONLY when BOTH parts converge; if it
    cannot run (no mame/romset) it exits WITHOUT printing PASS (the DONE gate keys on that line, never
    the exit code)."""
    try:
        verified = subprocess.run(["mame", "-rompath", a.rompath, "-verifyroms", DRIVER],
                                  capture_output=True, text=True).returncode == 0
    except FileNotFoundError:
        print("pixel_suite: SKIP -- no `mame` on PATH; cannot build a golden to compare against.")
        return 0
    if not verified:
        print(f"pixel_suite: SKIP -- romset {DRIVER} not found under {a.rompath}.")
        return 0

    idiomatic = (a.layer == "idiomatic") if a.layer else (runtime() == "idiomatic")
    offset = GEN_OFFSET if idiomatic else FROZEN_OFFSET
    print(f"  layer: {'IDIOMATIC (generator engine)' if idiomatic else 'oracle (cycle-driven)'}"
          f"  (--done: attract completeness + tape gameplay, nearest-frame reconverge)")
    work = tempfile.mkdtemp(prefix="timeplt_pixel_done_")
    with raw_dumps(work, keep=a.keep_frames, rmtree=True):
        # PART A -- attract COMPLETENESS (input-free golden, a full attract window, reconverged).
        ok, why = _done_part(work, "attract", a.rompath, DONE_ATTRACT_SECONDS, idiomatic, offset)
        if not ok:
            print(f"pixel_suite: FAIL -- {why}")
            return 1
        # PART B -- tape-driven GAMEPLAY vs MAME (the attract-blind hole).
        tape = lua_tape(os.path.join(work, "tape.lua"))
        ok, why = _done_part(work, "gameplay", a.rompath, DONE_GAMEPLAY_SECONDS, idiomatic, offset,
                             tape=tape, gameplay=True)
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
                        "(drift-tolerant whole-run reconverge), NOT the per-commit fixed-offset tripwire.")
    p.add_argument("--keep-frames", action="store_true",
                   help="keep the raw frames.rgb / state.bin dumps in the work dir after the verdict "
                        "(default: delete them, keeping frames.json hashes and summary.json).")
    a = p.parse_args()

    # --done: the ship bar (attract completeness + gameplay reconverge). Separate from the default
    # fixed-offset path below, which the per-commit pixel_gate_required.py still calls plain.
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

    os.makedirs(a.work, exist_ok=True)
    summary = {"suite": "pixel_suite", "verdict": "CRASH"}
    with raw_dumps(a.work, keep=a.keep_frames, summary=summary):
        return gameplay_gate(a, summary)


def gameplay_gate(a, summary):
    """The default per-commit gameplay tripwire. Records its verdict (and, on FAIL, where it went
    wrong) in `summary`; the caller deletes the raw dumps afterwards."""
    go, jo = os.path.join(a.work, "golden"), os.path.join(a.work, "js")
    idiomatic = (a.layer == "idiomatic") if a.layer else (runtime() == "idiomatic")
    offset = GEN_OFFSET if idiomatic else FROZEN_OFFSET
    src = "--layer" if a.layer else "manifest.runtime"
    print(f"  layer: {'IDIOMATIC (generator engine)' if idiomatic else 'oracle (cycle-driven)'}"
          f"; golden offset {offset} (from {src})")
    capture_golden(a.rompath, go, lua_tape(os.path.join(a.work, "tape.lua")))
    render_js(jo, a.frames, idiomatic)

    for label, frames in game_responded(go).items():
        if not frames:
            print(f"pixel_suite: FAIL -- golden shows no '{label}'; this run compares two "
                  "attract screens, which proves nothing.")
            summary.update(verdict="FAIL", why=f"golden shows no '{label}'")
            return 1
        print(f"  golden: {label:22} frames {frames[0]}..{frames[-1]}")

    _, _, bpf = pixel_gate.screen_geometry(HW)
    got = os.path.getsize(os.path.join(jo, "frames.rgb")) // bpf
    if got < a.frames - 1:
        print(f"pixel_suite: INCOMPLETE -- render delivered {got} of {a.frames - 1} frames; "
              "a comparison this short concludes nothing.")
        summary.update(verdict="INCOMPLETE", why=f"render delivered {got} of {a.frames - 1} frames")
        return 1

    d = pixel_gate.frame_diffs(os.path.join(jo, "frames.rgb"),
                               os.path.join(go, "frames.rgb"), HW, offset=offset)
    rc = 0
    summary["windows"] = {}
    coin_js = LUA_COIN + TAPE_OFFSET + FROZEN_OFFSET - offset
    for label, frm in (("boot+attract+play", DIFF_FROM),
                       ("gameplay (coin on)", coin_js)):
        r = pixel_gate.rough_verdict(d, HW, from_frame=frm)
        print(f"  {label:20} frames={r['frames']:5d} differ={r['frames_differing']:5d} "
              f"max={r['max_pixels']:5d}px ({r['max_pct']:6.3f}%) "
              f"worst@{r['worst_frame']} -> {r['verdict']}")
        summary["windows"][label] = r
        if r["verdict"] != pixel_gate.PASS:
            rc = 1
    bw, bover, bat = band_worst(os.path.join(jo, "frames.rgb"),
                                os.path.join(go, "frames.rgb"), offset, DIFF_FROM)
    bverdict = pixel_gate.PASS if bover == 0 else pixel_gate.FAIL
    print(f"  {'band rows ' + str(BAND_FROM) + '..':20} worst={bw:5d}px (budget {BAND_MAX_PX}) "
          f"over={bover} worst@{bat} -> {bverdict}")
    if bover:
        rc = 1
    summary["band"] = {"worst_px": bw, "worst_frame": bat, "over": bover, "budget": BAND_MAX_PX}
    summary["verdict"] = "PASS" if rc == 0 else "FAIL"
    if rc:
        summary["worst_frames"] = worst_frames(d, DIFF_FROM)

    print(f"pixel_suite: {'PASS' if rc == 0 else 'FAIL'}")
    return rc


if __name__ == "__main__":
    sys.exit(main())
