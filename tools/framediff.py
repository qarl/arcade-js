#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""Pixel-diff the translated JS output against MAME golden frames.

Reports the FIRST differing frame and where it differs. That is the signal the
method runs on: a divergence points straight at the routine that just
ran. Nobody should be debugging frame 900 when frame 12 already differs.

THE FROZEN OFFSET (docs/04-integration-testing.md):

    JS frame M  <->  AVI frame M+1      (offset 1)

The MAME AVI writer LAGS ONE FRAME: AVI[N] is the image of emulated frame N-1.

DERIVED BY THREE ROUTES, NO TWO SHARING AN INSTRUMENT, none a goodness-of-fit.

  1. GOLDEN-SIDE, RENDERS NOTHING (this is the decisive one).
     Compare WHEN VRAM changes against WHEN the image changes. VRAM content
     changes at frames {3,4,5,6,7}; golden AVI changes at {4,5,6,7,8}. A clean
     +1 bijection, no extras, no gaps. Two IMPOSSIBLE-VALUE arguments carry it,
     and BOTH REASONS BELOW WERE RESTATED AFTER REVIEW -- the conclusions held
     but the stated grounds did not, which is worth as much attention as a
     wrong conclusion would be:

         frame 3: the 49 VISIBLE cells change via writes that land in FRAME 2's
                  VBLANK -- after frame 2's beam has finished and before frame
                  3's has begun. So under offset 0 (AVI[3] = image of frame 3)
                  every scanline of that frame is painted from VRAM that already
                  contains them. AVI[3] is BYTE-IDENTICAL to AVI[2]. Refuted.

                  The original wording was "a visible change must alter that
                  image", which is SNAPSHOT semantics: under raster, writes
                  landing after the beam passes those rows do NOT alter the
                  frame -- the very mechanism frame 3's closing invokes below.
                  The vblank timing is what makes this raster-safe.

         frame 8: ZERO VRAM cells change, yet AVI[8] DIFFERS from AVI[7].

                  The original wording claimed sprite RAM is zero "so nothing
                  else drives it". THAT PREMISE IS FALSE. Every frame from 6 on
                  carries 14 hardware writes (7800-7803, 7808, 7D84, 7D85), and
                  the control latches drive the image with no VRAM change at all.

                  It survives for a different reason: frames 8, 9, 10 and 11
                  have BYTE-IDENTICAL write patterns, yet AVI changes at 8 and
                  NOT at 9, 10 or 11. A repeating pattern cannot explain a
                  one-off image change, so the change at 8 must come from
                  frame 7's VRAM edit -- which is offset 1.

     Neither renders a pixel, so neither could be voided by the geometry bug
     that voided every other argument made that night. AN ARGUMENT THAT DOES NOT
     USE THE BROKEN COMPONENT CANNOT BE BROKEN BY IT -- when instruments are
     under suspicion, prefer the argument with the smallest instrument surface.

  2. THE JS CODE PATH, stated before comparing. *** THIS ROUTE'S BASIS HAS
     SINCE CHANGED AND THE ROUTE IS RETAINED ONLY AS HISTORY. *** It read:
     JS[N] and state[N] are pushed in the same loop iteration, so JS[N] is
     render(state[N]) -- true of the SNAPSHOT renderer. The renderer is now a
     RASTER one, where JS[N] means "the image painted during frame N", a
     different quantity. The value 1 is unchanged and raster is what makes the
     match exact (no snapshot can reproduce a straddled frame at ANY offset),
     but the sentence ruled on no longer describes the code. Recorded because a
     constant that is right for a reason that has silently changed is the exact
     shape that has cost us four re-derivations.

  3. PIXEL SWEEP on fresh artifacts: JS[4] vs AVI[5] = 0 differing bytes of
     172032, with 154 lit over 7 DISTINCT cells. Non-uniform, so unlike every
     earlier "match" it constrains WHERE cells go, not merely how many.

*** THE PREVIOUS DERIVATION (offset 0) IS VOID AS ARITHMETIC, NOT MERELY AS A ***
*** CONCLUSION. Every number in it was computed through VISIBLE_Y0 = 32, a    ***
*** wrong tilemap origin. The margin is 2 ROWS AT EACH END, not 128 contiguous ***
*** slots at the start. Do not reason from those figures.                     ***

The whole family of earlier arguments shared one defect, worth naming because it
recurred three times with different numbers:

    896 visible cells x 24 lit px = 21504 = exactly the lit count of frames 0-3.

A perfect score, cited for hours as confirmation of position. Its twin, from the
transition test that set 2 and then 1: offsets +0 and +1 BOTH scored 11/11, and
34/34 was read as strength when it was SATURATION.

*** BUT THE OBVIOUS READING OF THAT IS WRONG, AND ALL THREE OF US HELD IT. ***

"Every visible cell holds tile 0x00, so ANY margin and ANY orientation give the
identical image" -- FALSE, refuted by mutation. Hardcoding flip breaks frames
0-2 by 35392 pixels each. The tile PATTERN is uniform; the COLOUR is not. The
colour index is charColour[col + 32*(row>>2)], and v-5e's eight 32-byte bands
are byte-identical, so the ROW term is inert and colour depends on COLUMN ALONE.
Flip mirrors the column, so a uniform screen of tile 0x00 renders as MIRRORED
COLOUR STRIPES -- a completely different image with an IDENTICAL LIT COUNT.

    A uniform screen constrains the COLUMN mapping STRONGLY
    and the ROW mapping NOT AT ALL.

That is why frames 0-2 could not tell VISIBLE_Y0 16 from 32 (a row-only change,
colour term inert) yet slam the door on a wrong orientation. Both halves were
invisible under "uniform frames prove nothing" -- which was too coarse in one
direction and too generous in the other. Lit count was the wrong summary
statistic the whole time: it is exactly the statistic a mirror preserves.

    "First difference" is not "first informative difference".

Frames 0-3 are byte-identical (unfalsifiable); frame 3 is the frame whose rows
2..3 the bad geometry concealed. offset_discriminating() below exists so a green
run over that region can never again be read as support.

FRAME 3'S DISSENT IS CLOSED, and the closing is worth reading because the
re-open condition did real work. Frame 3 scored better at offset 0, and the
condition set was: reopen if frame 3's cause implicates ALIGNMENT rather than
RENDERING, and any explanation must ALSO predict frame 4 matching byte-exactly.

It is rendering, and the mechanism is more specific than "torn": 7D82 <- 01
lands 28262 cycles into frame 3 -- SCANLINE 147 of 224 -- so frame 3's image is
its top unflipped and its bottom flipped, composited in one frame. Frame 4 has
no orientation change, which is exactly why 949 mid-frame writes rendered clean.
One mechanism, both frames, no free parameters. A raster renderer that paints
each scanline from VRAM and orientation as they stand when the beam arrives took
frame 3 from 20380 differing pixels to 0, with frames 2 and 4 unmoved.

The arithmetic at offset 0 was also exact: 49 visible cells cleared x 24 lit px
per tile-0x00 cell = 1176, the observed difference. Offset 0's "better" score
was THE SIZE OF A KNOWN CLEAR, not a residue of alignment.

HISTORY of the earlier values, retained because the state-dumper fix inside it
is still load-bearing:
The original +2 was "AVI frame 0 is the init framebuffer (+1), plus render
latency (+1)". The init framebuffer is REAL -- it is what makes the AVI frame
count ceil(refresh*seconds)+1. What was wrong is that it was DOUBLE-COUNTED: an
off-by-one in the state dumper this constant was derived from. MAME's Lua frame
notifier fires at the END of frame N, so sampling only on the notifier made
state[0] mean "after one frame" instead of "power-on". Re-basing state[] to
power-on fixed the state dumper. The conclusion drawn from it at the time --
that state[0] and AVI frame 0 are the same instant -- IS SUPERSEDED: AVI[N] is
the image of frame N-1 (see the derivation above). The dumper fix is real and
still load-bearing; the offset conclusion built on it is not. Measured directly: the frame-0 notifier fires at
t=0.0165s = 50688 cycles = exactly one frame period.

This was a CORRECTION, not a re-fit, and the distinction matters:
  * The trigger was not a failing diff -- nothing was red. It was two INDEPENDENT
    DERIVATIONS DISAGREEING (Z80 instruction timings vs this
    instrument). Nobody needed this to go green.
  * The root cause was measured directly and independently of our JS.
  * An UNRELATED ANOMALY VANISHED: state/AVI counts went 183/182 -> 183/183 and
    1517/1516 -> 1517/1517. The delta-1 previously documented as a "quirk" was
    this same bug. A real fix makes unexplained discrepancies disappear.
    CAVEAT ADDED ON REVIEW: equal state/AVI counts are expected under offset 1
    as well (729/729 here), so this no longer DISCRIMINATES between the values.
    It remains evidence the dumper bug was real; it is not evidence for 0.
  * The model got SIMPLER: two effects -> one, and the effect that disappeared
    was the artifact. Fewer free parameters, same fit.
The proof rests on the direct measurement and the vanished anomaly, NOT on the
cycles/byte ratio that prompted the investigation (5233 bytes is not the clear
loop's byte count, so that comparison is loose).

*** This constant is an INPUT, never an output. It is NEVER re-fitted to make a
*** failing diff pass. A failing diff means the JS is wrong until proven
*** otherwise. --offset exists for contract-change investigation under
*** explicit sign-off, and it warns loudly. There is deliberately no --calibrate:
*** fitting the reference to the implementation is how a hard gate goes soft.

Usage:
  framediff.py --hardware boards/dkong/hardware.json --golden golden/boot --actual out/emit --report diffout/
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import hardware  # noqa: E402
import frameio  # noqa: E402
import scope  # noqa: E402

# Frozen. See module docstring and docs/04-integration-testing.md.
# 2 -> 1 -> 0 -> 1. The value is not what kept being wrong; THE BASIS WAS WRONG
# EVERY TIME. 2 and 1 came from a transition test that scored 100% for both
# candidates; 0 came from a frame whose arithmetic ran through a wrong tilemap
# origin. Ruled to 1 on three independent routes (see docstring).
FROZEN_OFFSET = 1

# Exit codes. PARTIAL is distinct from OK on purpose: an incomplete comparison is
# inconclusive, and CI keying on rc==0 must never mistake it for a pass.
EXIT_OK = 0
EXIT_FAIL = 1
EXIT_NOTHING = 2
EXIT_PARTIAL = 3


def _golden_hash(golden, idx, cache):
    """Hash of golden frame `idx`, computed from BYTES WE READ.

    Never golden.hashes[idx]. The compare loop below refuses to trust the stored
    index because it makes the artifact its own trust root; a function that
    decides whether evidence EXISTS must be held to at least that bar. Reviewed
    and demonstrated: a golden frames.json carrying fabricated distinct hashes
    over a byte-uniform frames.rgb made this function report affirmative evidence
    and suppressed the disclaimer -- the exact false-confidence the guard exists
    to prevent, reintroduced by the guard.
    """
    h = cache.get(idx)
    if h is None:
        h = frameio.frame_sha256(golden.read(idx))
        cache[idx] = h
    return h


def offset_discriminating(golden, lo, hi, candidates=(0, 1, 2)):
    """Map JS FRAME INDEX -> the set of candidate-offset PAIRS that frame separates.

    *** INDICES ARE JS FRAME INDICES, NOT GOLDEN INDICES. *** JS frame m is
    compared against golden[m + c] under candidate offset c, so m ranges over
    [0, frames_compared). An earlier version was called with golden indices and
    was therefore correct ONLY at offset 0 -- it skipped the first `offset` JS
    frames (precisely the boot frames this guard exists for) and evaluated tail
    frames that were never compared. Caught in review while the contract was
    mid-flight from 0 to 1, which is exactly when it would have misfired.

    Returning PAIRS rather than a bare "discriminating" flag is load-bearing.
    OR-ing the pairs together answers "could this run distinguish SOMETHING",
    which is not the question anyone has. On the real boot artifact frame 2
    separates 0-vs-2 but has ZERO power on 0-vs-1 -- and 0-vs-1 is the live
    dispute. Reporting frame 2 as "the first discriminating frame" would send a
    reader to a frame that cannot answer the question being asked: the same
    green-thing-read-as-support pattern this guard was written to break.

    WHY THIS EXISTS -- it is the check that would have caught the worst call I
    have made on this project.

    A frame M tests offset A against offset B only if golden[M+A] and golden[M+B]
    actually DIFFER. When they are byte-identical, M matches under both, and a
    green result there is not weak evidence for the offset -- it is ZERO evidence.
    Boot frames 0-2 are exactly this: the screen is uniform, every candidate
    golden frame is the same bytes, and the comparison is unfalsifiable by
    construction.

    That trap fired across FOUR settings: 2, then 1, then 0, then 1. The first
    two came from a transition test that scored identically for BOTH values, and
    saturation was read as strength. The 1 -> 0 ruling was fitted on boot frame
    3, whose arithmetic ran through a wrong tilemap origin (VISIBLE_Y0 = 32) --
    that is the root cause of THAT error. Separately, frame 3 is also TORN: its
    image cannot be reproduced from any single VRAM snapshot, verified under both
    orientations. Provenance for the tearing numbers: lua/vram_writes.lua, which
    is a DIAGNOSTIC capture and not a tracked artifact -- golden/boot/writes.txt
    is the hardware-register trace and contains no VRAM, so the write counts
    quoted here cannot be reproduced from it.

    "First frame that differs" is not "first frame that is informative". Those
    came apart here and the tooling said nothing, so I am making it say something.

    This detects the unfalsifiable case, which is derivable from the golden
    artifact alone and therefore always available. It does NOT detect tearing --
    that needs a cycle-stamped write trace (lua/vram_writes.lua). A frame absent
    from this map is known-uninformative; PRESENCE IS NECESSARY, NOT SUFFICIENT.
    On the real boot artifact the keys are {2,3,4,5,6,7}, and 3, 5 and 6 are
    TORN -- they fit no snapshot under either orientation. So this map must never
    be read as "compare here": it rules frames OUT, it does not rule them in.
    """
    cache = {}
    out = {}
    for m in range(lo, hi):
        live = [c for c in candidates if 0 <= m + c < golden.count]
        seps = set()
        for i, a in enumerate(live):
            for b in live[i + 1 :]:
                if _golden_hash(golden, m + a, cache) != _golden_hash(
                    golden, m + b, cache
                ):
                    seps.add((a, b))
        if seps:
            out[m] = seps
    return out


def analyze(golden_buf: bytes, actual_buf: bytes):
    """Locate and characterize the differences within a single frame."""
    import numpy as np

    g = np.frombuffer(golden_buf, dtype=np.uint8).reshape(
        frameio.HEIGHT, frameio.WIDTH, 3
    )
    a = np.frombuffer(actual_buf, dtype=np.uint8).reshape(
        frameio.HEIGHT, frameio.WIDTH, 3
    )

    diff = (g != a).any(axis=2)
    ys, xs = diff.nonzero()
    n = len(ys)
    total = frameio.WIDTH * frameio.HEIGHT

    info = {
        "differing_pixels": int(n),
        "total_pixels": total,
        "pct": 100.0 * n / total,
    }
    if n:
        y0, y1 = int(ys.min()), int(ys.max())
        x0, x1 = int(xs.min()), int(xs.max())
        info["bbox"] = {
            "x0": x0,
            "y0": y0,
            "x1": x1,
            "y1": y1,
            "w": x1 - x0 + 1,
            "h": y1 - y0 + 1,
        }
        # Scanline order: the first pixel that differs, top-left-most.
        order = np.lexsort((xs, ys))
        fy, fx = int(ys[order[0]]), int(xs[order[0]])
        info["first_pixel"] = {
            "x": fx,
            "y": fy,
            "golden_rgb": [int(v) for v in g[fy, fx]],
            "actual_rgb": [int(v) for v in a[fy, fx]],
        }
        # A tile-granular hint: DK's tilemap is 8x8, so report which tile cells
        # are touched. A bug in one routine usually lights up a coherent region.
        tiles = sorted({(int(x) // 8, int(y) // 8) for x, y in zip(xs, ys)})
        info["tiles_touched"] = len(tiles)
        info["tile_sample"] = [list(t) for t in tiles[:12]]
    return info, diff


def diagnose_whole_frame(golden_buf, actual_buf):
    """Name the WHOLE-FRAME failure modes a first real run is likely to hit.

    framediff has been validated against synthetic pairs but has never run
    against a real renderer. When it first does, BOTH sides are unproven at once
    -- and the raw report cannot tell these apart: a channel swap, an all-black
    frame and a row shift all produce a similar differing-pixel count and a
    full-frame bounding box. The distinguishing evidence sits in one pixel value
    that a reader has to notice, which is exactly the "warning depends on
    attention" failure.

    So test the likely hypotheses explicitly and NAME the one that fits. Each is
    a real, documented trap:
      * R/B swap    -- MAME's AVI is bgr24; getting the conversion wrong is the
                       classic gotcha, and it makes every pixel differ.
      * uniform     -- a renderer wired up but drawing nothing.
      * row shift   -- an off-by-one in row stride or the first scanline.
      * vertical flip -- DK has a real flipscreen latch, so this is a plausible
                       genuine bug rather than only a plumbing error.
    Returns a list of human-readable findings, empty if none fit.
    """
    import numpy as np

    g = np.frombuffer(golden_buf, dtype=np.uint8).reshape(
        frameio.HEIGHT, frameio.WIDTH, 3
    )
    a = np.frombuffer(actual_buf, dtype=np.uint8).reshape(
        frameio.HEIGHT, frameio.WIDTH, 3
    )
    out = []
    if np.array_equal(a, g[:, :, ::-1]):
        out.append(
            "ACTUAL IS THE GOLDEN FRAME WITH R AND B SWAPPED. The frame contract "
            "is RGB888; MAME's AVI is bgr24. This is a channel-order bug, not a "
            "rendering bug -- the pixels are right."
        )
    uniq = np.unique(a.reshape(-1, 3), axis=0)
    if len(uniq) == 1:
        out.append(
            f"ACTUAL IS A UNIFORM FRAME, every pixel {tuple(int(v) for v in uniq[0])}. "
            f"The renderer produced output but drew nothing."
        )
    if np.array_equal(a, g[::-1, :, :]):
        out.append(
            "ACTUAL IS THE GOLDEN FRAME FLIPPED VERTICALLY. Note DK has a real "
            "flipscreen latch (0x7D82) -- this may be a genuine emulation bug "
            "rather than a plumbing one."
        )
    for shift in (1, -1, 8, -8):
        if np.array_equal(a, np.roll(g, shift, axis=0)):
            out.append(
                f"ACTUAL IS THE GOLDEN FRAME SHIFTED BY {shift} ROW(S). Row stride "
                f"or first-scanline off-by-one."
            )
            break
    return out


def write_report(report_dir, idx, golden_buf, actual_buf, diff_mask):
    """Write golden/actual/diff PNGs so a human can eyeball the divergence."""
    try:
        import numpy as np
        from PIL import Image
    except ImportError:
        return None
    os.makedirs(report_dir, exist_ok=True)
    g = np.frombuffer(golden_buf, dtype=np.uint8).reshape(
        frameio.HEIGHT, frameio.WIDTH, 3
    )
    a = np.frombuffer(actual_buf, dtype=np.uint8).reshape(
        frameio.HEIGHT, frameio.WIDTH, 3
    )
    Image.fromarray(g).save(os.path.join(report_dir, f"frame{idx:06d}_golden.png"))
    Image.fromarray(a).save(os.path.join(report_dir, f"frame{idx:06d}_actual.png"))
    # Magenta where they differ, dimmed golden elsewhere, so the eye goes to the bug.
    overlay = (g // 3).copy()
    overlay[diff_mask] = [255, 0, 255]
    Image.fromarray(overlay).save(os.path.join(report_dir, f"frame{idx:06d}_diff.png"))
    return report_dir


def main():
    p = argparse.ArgumentParser(description="Pixel-diff JS output vs MAME golden")
    hardware.add_hardware_arg(p)
    p.add_argument(
        "--golden", required=True, help="dir with MAME frames.rgb/frames.json"
    )
    p.add_argument("--actual", required=True, help="dir with JS frames.rgb/frames.json")
    p.add_argument("--report", help="dir to write golden/actual/diff PNGs into")
    p.add_argument(
        "--offset",
        type=int,
        default=None,
        help="OVERRIDE the frozen AVI offset. Contract change -- needs maintainer sign-off.",
    )
    p.add_argument("--max-frames", type=int, help="stop after comparing this many")
    p.add_argument(
        "--allow-short",
        action="store_true",
        help="permit the JS side to cover fewer frames than golden (NOT a pass)",
    )
    args = p.parse_args()

    # Load the board's hardware map and configure the shared modules from it,
    # before any use of frameio geometry / scope landmarks.
    hw = hardware.load_from_args(args)
    frameio.configure(hw)
    scope.configure(hw)

    offset = FROZEN_OFFSET
    if args.offset is not None and args.offset != FROZEN_OFFSET:
        offset = args.offset
        sys.stderr.write(
            f"\n*** WARNING: overriding the FROZEN offset {FROZEN_OFFSET} with {offset}.\n"
            f"*** The offset is never re-fitted to make a failing diff pass.\n"
            f"*** If this makes a red diff go green, the JS is still wrong.\n\n"
        )

    golden = frameio.FrameSet(args.golden)
    actual = frameio.FrameSet(args.actual)

    # JS frame M maps to golden frame M+offset; compare where both exist.
    expected = golden.count - offset
    n = min(actual.count, expected)
    if args.max_frames is not None:
        n = min(n, args.max_frames)
    if n <= 0:
        sys.stderr.write(
            f"nothing to compare: js={actual.count} golden={golden.count} offset={offset}\n"
        )
        return EXIT_NOTHING

    print(
        f"[framediff] js frames={actual.count} golden frames={golden.count} "
        f"offset=+{offset} comparing={n}"
    )

    # COMPLETENESS, both directions.
    #
    # JS short of golden: a run that dies after one frame writes a self-consistent
    # 1-frame artifact, and without this check the differ reports PASS -- making
    # "emit fewer frames" the cheapest route to a green gate.
    #
    # JS longer than golden: the GOLDEN is short, which moves that same cheap
    # route to "capture a shorter reference." Equally disqualifying.
    #
    # Note this is deliberately NOT conditioned on --max-frames. Gating it on that
    # flag turns any `--max-frames N` into a silent bypass of the whole check.
    if actual.count != expected and not args.allow_short:
        if actual.count < expected:
            print(
                f"\n[framediff] FAIL -- incomplete: JS emitted {actual.count} frames but "
                f"golden covers {expected} (offset +{offset}).\n"
                f"  Missing {expected - actual.count} frames. A short run is not a pass."
            )
        else:
            print(
                f"\n[framediff] FAIL -- golden too short: JS emitted {actual.count} frames "
                f"but golden only covers {expected} (offset +{offset}).\n"
                f"  Capture a longer reference; a short golden is not a pass."
            )
        print("  --allow-short inspects a partial run and can never report PASS.")
        return EXIT_FAIL

    # Any run that does not cover the full expected range is INCONCLUSIVE, not a
    # pass -- whether shortened by --allow-short or capped by --max-frames. It
    # gets its own exit code so CI keying on rc==0 can never read it as green.
    partial = n < expected or actual.count != expected

    first_bad = None
    for m in range(n):
        # Compare BYTES, not the stored hashes. The index is written by whichever
        # tool produced the artifact, so trusting it makes the artifact's own
        # self-report the trust root -- a frames.rgb full of garbage carrying
        # golden's hashes would report PASS. Reading is required to hash anyway,
        # so byte comparison costs nothing and removes the hole entirely.
        abuf = actual.read(m)
        gbuf = golden.read(m + offset)
        if abuf != gbuf:
            first_bad = m
            break
        # Free integrity check now that the bytes are in hand: a self-inconsistent
        # artifact is a bug in the producer and must not read as a clean PASS.
        if frameio.frame_sha256(abuf) != actual.hashes[m]:
            print(
                f"\n[framediff] FAIL -- JS frames.json is inconsistent with frames.rgb "
                f"at frame {m}: index says {actual.hashes[m][:16]}..., bytes hash to "
                f"{frameio.frame_sha256(abuf)[:16]}...\n"
                f"  The artifact is corrupt or the writer is buggy; the diff is meaningless."
            )
            return 1

    if first_bad is None:
        where = (
            f"(js 0..{n - 1} vs golden {offset}..{n - 1 + offset}, offset=+{offset})"
        )
        if partial:
            print(
                f"[framediff] PARTIAL -- {n} of {expected} frames identical, "
                f"byte-for-byte {where}\n"
                f"  NOT A PASS: {expected - n} frames were never compared. "
                f"Exit code {EXIT_PARTIAL}."
            )
            return EXIT_PARTIAL
        print(f"[framediff] PASS -- all {n} frames identical, byte-for-byte {where}")
        # A pass is a pass for pixel equality. It is NOT automatically evidence
        # that the offset is right, and conflating those is how this constant
        # moved twice on measurements that had no power. Say so explicitly rather
        # than letting a green line imply more than it earned.
        # Candidates are the CURRENT offset and its neighbours: the live question
        # is always "could this run tell the frozen value from the one next to
        # it", never "from some absolute value". Indices below are JS frames.
        cands = tuple(sorted({c for c in (offset - 1, offset, offset + 1) if c >= 0}))
        disc = offset_discriminating(golden, 0, n, candidates=cands)
        neighbours = [
            (a, b) for a in cands for b in cands if a < b and offset in (a, b)
        ]
        by_pair = {
            pr: [m for m, seps in disc.items() if pr in seps] for pr in neighbours
        }
        blind = [pr for pr, ms in by_pair.items() if not ms]
        if not disc:
            print(
                f"\n  *** THIS RUN IS NO EVIDENCE ABOUT THE OFFSET. Every golden frame\n"
                f"  *** compared hashes identically to its neighbours at offsets {cands},\n"
                f"  *** so all {n} frames match under any of them. The pixels agree;\n"
                f"  *** the pairing is UNTESTED. Compare frames that differ."
            )
        else:
            for pr, ms in sorted(by_pair.items()):
                if ms:
                    print(
                        f"  offset evidence  : {len(ms)} of {n} frames separate "
                        f"+{pr[0]} from +{pr[1]} (first JS frame: {ms[0]})"
                    )
            for pr in sorted(blind):
                print(
                    f"  *** NO frame in this run separates +{pr[0]} from +{pr[1]}. "
                    f"That pairing is untested here."
                )
        print(scope.report(n))
        return EXIT_OK

    g_idx = first_bad + offset
    gbuf = golden.read(g_idx)
    abuf = actual.read(first_bad)
    info, mask = analyze(gbuf, abuf)

    print(
        f"\n[framediff] FAIL -- first divergence at JS frame {first_bad} "
        f"(golden AVI frame {g_idx})"
    )
    print(
        f"  differing pixels : {info['differing_pixels']} / {info['total_pixels']} "
        f"({info['pct']:.3f}%)"
    )
    if info["differing_pixels"]:
        b = info["bbox"]
        print(
            f"  bounding box     : x {b['x0']}..{b['x1']}  y {b['y0']}..{b['y1']} "
            f"({b['w']}x{b['h']})"
        )
        fp = info["first_pixel"]
        print(
            f"  first bad pixel  : ({fp['x']},{fp['y']}) "
            f"golden={tuple(fp['golden_rgb'])} actual={tuple(fp['actual_rgb'])}"
        )
        print(
            f"  8x8 tiles touched: {info['tiles_touched']}  e.g. {info['tile_sample']}"
        )

    # Diagnose whole-frame modes BEFORE the PNG report: on a first real run the
    # cause is far more likely to be one of these than a subtle pixel error, and
    # naming it turns "read the numbers carefully" into "the differ told you".
    for finding in diagnose_whole_frame(gbuf, abuf):
        print(f"\n  *** {finding}")

    if args.report:
        out = write_report(args.report, first_bad, gbuf, abuf, mask)
        print(
            f"  report written   : {out}"
            if out
            else "  (PNG report skipped: numpy/PIL unavailable)"
        )

    print(
        f"\n  The routine that ran on frame {first_bad} is the suspect. "
        f"Do not debug later frames first."
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
