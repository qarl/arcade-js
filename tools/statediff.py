#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""State-diff the translated JS RAM against MAME golden state dumps.

This is the FAST feedback loop, and it is available before any renderer exists.
It also separates two failure domains:

  * RAM matches but pixels differ  -> the CPU translation is correct; the bug is
    in the hardware/video model.
  * RAM already differs            -> it is the translation itself, and the
    renderer is irrelevant.

A pixel diff alone conflates those, and that conflation can cost hours debugging
a renderer when the real bug was a mistranslated ADD. A RAM divergence also
localizes better: it names an exact CPU ADDRESS, not a wrong-looking region.

NO OFFSET HERE. Both sides sample state at the same defined point -- the frame
boundary BEFORE that frame's CPU execution -- so state[N] <-> state[N] directly.
(The +1 offset in framediff.py is one frame of render latency in MAME's video
pipeline and does not apply to memory dumps.)

Usage:
  statediff.py --golden golden/boot --actual out/emit
  statediff.py --golden golden/boot --actual out/emit --max-bytes 40
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import scope  # noqa: E402
import stateio  # noqa: E402

# Exit codes mirror framediff.py. PARTIAL is distinct from OK on purpose: an
# incomplete comparison is inconclusive, and CI keying on rc==0 must never
# mistake it for a pass.
EXIT_OK = 0
EXIT_FAIL = 1
EXIT_NOTHING = 2
EXIT_PARTIAL = 3


def byte_diffs(golden_buf: bytes, actual_buf: bytes, limit: int):
    """Every differing byte, resolved to its region and real CPU address."""
    out = []
    for i, (gb, ab) in enumerate(zip(golden_buf, actual_buf)):
        if gb != ab:
            region, addr = stateio.region_of(i)
            out.append((region, addr, gb, ab))
            if len(out) >= limit:
                break
    return out


def summarize_regions(golden_buf: bytes, actual_buf: bytes):
    """Per-region differing-byte counts -- tells you which subsystem drifted."""
    counts = {}
    pos = 0
    for name, _start, length in stateio.REGIONS:
        g = golden_buf[pos : pos + length]
        a = actual_buf[pos : pos + length]
        counts[name] = sum(1 for x, y in zip(g, a) if x != y)
        pos += length
    return counts


def main():
    p = argparse.ArgumentParser(description="State-diff JS RAM vs MAME golden")
    p.add_argument("--golden", required=True, help="dir with MAME state.bin/state.json")
    p.add_argument("--actual", required=True, help="dir with JS state.bin/state.json")
    p.add_argument(
        "--max-bytes",
        type=int,
        default=32,
        help="max differing bytes to list (default 32)",
    )
    p.add_argument("--max-frames", type=int, help="stop after comparing this many")
    p.add_argument(
        "--must-reach",
        help="GATE rather than warn: require the compared range to observe this "
        "landmark (substring, e.g. 'NMI') or raw cycle. FAILS if it does not. "
        "A SCOPE line informs and can be skipped; this one cannot.",
    )
    p.add_argument(
        "--allow-short",
        action="store_true",
        help="permit the JS side to cover fewer frames than golden (NOT a pass)",
    )
    args = p.parse_args()

    golden = stateio.StateSet(args.golden)
    actual = stateio.StateSet(args.actual)

    expected = golden.count
    n = min(expected, actual.count)
    if args.max_frames is not None:
        n = min(n, args.max_frames)
    if n <= 0:
        sys.stderr.write(
            f"nothing to compare: golden={golden.count} actual={actual.count}\n"
        )
        return EXIT_NOTHING

    print(
        f"[statediff] golden frames={golden.count} js frames={actual.count} "
        f"comparing={n}"
    )

    # COMPLETENESS, both directions -- see framediff.py for the full reasoning.
    # Deliberately NOT conditioned on --max-frames: gating it on that flag makes
    # any `--max-frames N` a silent bypass of the whole check.
    if actual.count != expected and not args.allow_short:
        if actual.count < expected:
            print(
                f"\n[statediff] FAIL -- incomplete: JS emitted {actual.count} state "
                f"frames but golden has {expected}.\n"
                f"  Missing {expected - actual.count}. A short run is not a pass."
            )
        else:
            print(
                f"\n[statediff] FAIL -- golden too short: JS emitted {actual.count} "
                f"state frames but golden only has {expected}.\n"
                f"  Capture a longer reference; a short golden is not a pass."
            )
        print("  --allow-short inspects a partial run and can never report PASS.")
        return EXIT_FAIL

    partial = n < expected or actual.count != expected

    # A check that produces a WARNING still depends on attention; a
    # check that produces a FAILURE does not. The SCOPE line below states what a
    # verdict cannot establish -- but a warning like that is easy to print and
    # skip over. So callers who
    # DEPEND on coverage assert it here and get a failure, not a note.
    if args.must_reach:
        lm = scope.find_landmark(args.must_reach)
        if lm is None:
            names = ", ".join(repr(n) for n, _c, _p in scope.LANDMARKS)
            print(
                f"[statediff] FAIL -- --must-reach {args.must_reach!r} matched no "
                f"landmark. Known: {names}, or a raw cycle number."
            )
            return EXIT_FAIL
        name, cyc, _prov = lm
        if not scope.covers(n, cyc):
            need = scope.frames_needed_to_cover(cyc)
            print(
                f"\n[statediff] FAIL -- coverage assertion not met.\n"
                f"  You asserted this run reaches: {name} @ cycle {cyc:,}\n"
                f"  It compares {n} frames, last sample at cycle "
                f"{scope.last_sample_cycle(n):,}.\n"
                f"  state[N] is the (N+1)th frame, so {need} emitted frames are "
                f"needed (state[0..{need - 1}]).\n"
                f"  This run CANNOT establish anything about that landmark."
            )
            return EXIT_FAIL

    # Free assertion: power-on RAM is all zero (verified on real MAME).
    if actual.read(0) != b"\x00" * stateio.BYTES_PER_FRAME:
        print(
            "  NOTE: js state[0] is not all-zero. Power-on RAM is verified "
            "all-0x00 on MAME; init is wrong before any opcode is translated."
        )

    first_bad = None
    for i in range(n):
        # Compare BYTES, not stored hashes -- see framediff.py. Trusting an
        # artifact's own index makes the artifact its own trust root.
        abuf = actual.read(i)
        gbuf = golden.read(i)
        if abuf != gbuf:
            first_bad = i
            break
        if actual.hashes is not None and stateio.frame_sha256(abuf) != actual.hashes[i]:
            print(
                f"\n[statediff] FAIL -- JS state.json is inconsistent with state.bin "
                f"at frame {i}. The artifact is corrupt; the diff is meaningless."
            )
            return 1

    if first_bad is None:
        if partial:
            print(
                f"[statediff] PARTIAL -- {n} of {expected} state frames identical, "
                f"byte-for-byte\n"
                f"  NOT A PASS: {expected - n} frames were never compared. "
                f"Exit code {EXIT_PARTIAL}."
            )
            print(scope.report(n))
            return EXIT_PARTIAL
        print(f"[statediff] PASS -- all {n} state frames identical, byte-for-byte")
        # A green is evidence only about the code it executed.
        # A bare PASS invites the inference that everything works.
        print(scope.report(n))
        return EXIT_OK

    gbuf = golden.read(first_bad)
    abuf = actual.read(first_bad)
    counts = summarize_regions(gbuf, abuf)
    diffs = byte_diffs(gbuf, abuf, args.max_bytes)
    total = sum(1 for x, y in zip(gbuf, abuf) if x != y)

    print(f"\n[statediff] FAIL -- first divergence at state frame {first_bad}")
    print(
        f"  state[{first_bad}] is the state AFTER frames 0..{first_bad - 1} executed, "
        f"so frame {first_bad - 1} is the suspect."
        if first_bad > 0
        else "  state[0] is the POWER-ON state -- this is an init bug, not a translation bug."
    )
    print(f"  differing bytes  : {total} / {stateio.BYTES_PER_FRAME}")
    print("  by region        : " + ", ".join(f"{k}={v}" for k, v in counts.items()))
    print(f"\n  first {len(diffs)} differing bytes:")
    print("    addr    region  golden  actual")
    for region, addr, gb, ab in diffs:
        print(f"    0x{addr:04X}  {region:<6}  0x{gb:02X}    0x{ab:02X}")
    if total > len(diffs):
        print(f"    ... {total - len(diffs)} more")

    print(scope.report(n))

    # Printed at the point of temptation -- same reasoning as
    # the SCOPE line. This report gives WHERE and HOW MUCH. It deliberately does
    # not license changing code until the numbers agree: iterated diff-driven
    # patching IS fitting to the oracle, byte by byte, and every individual
    # round-trip looks legitimate. A fix whose only justification is "it made the
    # diff go green" is oracle-derived -- the ROM was never consulted -- which is
    # the exact failure this method exists to avoid, arriving disguised as debugging.
    print(
        "\n  The FIX must trace to an independently-verifiable ROM fact.\n"
        "  This is evidence that something is wrong and where -- NOT a\n"
        "  specification of what the code should produce."
    )
    return EXIT_FAIL


if __name__ == "__main__":
    sys.exit(main())
