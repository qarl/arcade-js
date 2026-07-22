#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""Diff hardware write traces: JS vs MAME golden.

Gates the surface the state dump never covered -- control latches (flipscreen,
sprite bank, palette bank), i8257 programming, and the sound latch. A latch WRITE
is an action the CPU takes, so this is TRANSLATION correctness and is checkable
now; the latch's resulting STATE needs a renderer and is a separate question.

Also closes the within-region DMA blind spot: a reversed DMA is invisible to a
region diff (both regions end up wrong) but is plain in the programming writes --
and unlike the post-transfer registers, writes are what the ROM DOES rather than
device-internal state no instruction can ever read.

PHASES:
  * default    -- compare the ordered (addr, value) stream. Works before the JS
                  side's cycle accounting is exact.
  * --cycles   -- also require cycles to match. Use once DMA cycle costs land.

Usage:
  writediff.py --hardware boards/dkong/hardware.json --golden golden/boot --actual out/emit
  writediff.py --hardware boards/dkong/hardware.json --golden golden/boot --actual out/emit --cycles
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import hardware  # noqa: E402
import writeio  # noqa: E402

EXIT_OK = 0
EXIT_FAIL = 1
EXIT_NOTHING = 2
# PARTIAL is distinct from OK on purpose, matching framediff/statediff: an
# incomplete comparison is inconclusive and CI keying on rc==0 must never read
# it as a pass.
EXIT_PARTIAL = 3


def context(trace, i, before=3, after=1):
    lines = []
    for j in range(max(0, i - before), min(len(trace), i + after + 1)):
        cyc, addr, val = trace.entries[j]
        mark = ">>" if j == i else "  "
        cs = f"{cyc:>9}" if cyc is not None else "        -"
        lines.append(
            f"    {mark} [{j}] cycle {cs}  {addr:04X} <- {val:02X}"
            f"  ({writeio.region_of(addr)})"
        )
    return "\n".join(lines)


def main():
    p = argparse.ArgumentParser(description="Diff hardware write traces vs MAME")
    hardware.add_hardware_arg(p)
    p.add_argument("--golden", required=True)
    p.add_argument("--actual", required=True)
    p.add_argument(
        "--allow-short",
        action="store_true",
        help="permit the JS trace to be a PREFIX of golden -- reports PARTIAL "
        "(exit 3), never PASS. For a translation legitimately shorter than golden.",
    )
    p.add_argument(
        "--cycles",
        action="store_true",
        help="also require cycles to match (phase 2; needs exact JS cycle accounting)",
    )
    args = p.parse_args()

    # Load the board's hardware map and configure writeio's RANGES from it,
    # before any region_of() call.
    writeio.configure(hardware.load_from_args(args))

    golden = writeio.WriteTrace(args.golden)
    actual = writeio.WriteTrace(args.actual)

    # An empty trace is not a pass. A capture path that emits no writes has
    # verified nothing, and absence must never read as success.
    if len(golden) == 0:
        print("[writediff] FAIL -- golden write trace is EMPTY. Nothing was captured,")
        print("  so this cannot verify anything. Not a pass.")
        return EXIT_FAIL
    if len(actual) == 0:
        print("[writediff] FAIL -- JS write trace is EMPTY. Nothing was emitted,")
        print("  so this cannot verify anything. Not a pass.")
        return EXIT_FAIL

    with_cycles = args.cycles
    if with_cycles and not (golden.has_cycles() and actual.has_cycles()):
        print("[writediff] FAIL -- --cycles requested but a trace lacks cycle data.")
        return EXIT_FAIL

    mode = "sequence+cycles" if with_cycles else "sequence only"
    print(
        f"[writediff] golden writes={len(golden)} js writes={len(actual)} mode={mode}"
    )

    i = writeio.first_divergence(golden, actual, with_cycles)

    # A JS trace that is a strict PREFIX of golden and matches throughout: under
    # --allow-short this is the informative partial result rather than a bare
    # FAIL, but it is still not a pass -- the uncovered writes were never checked.
    if args.allow_short and len(actual) < len(golden) and i == len(actual):
        print(
            f"[writediff] PARTIAL -- all {len(actual)} emitted writes match golden, "
            f"in order.\n"
            f"  NOT A PASS: golden has {len(golden)}; {len(golden) - len(actual)} "
            f"writes were never compared. Exit code {EXIT_PARTIAL}."
        )
        nxt = golden.entries[len(actual)]
        print(
            f"  next unverified write: {nxt[1]:04X} <- {nxt[2]:02X} "
            f"({writeio.region_of(nxt[1])})"
        )
        return EXIT_PARTIAL

    if i is None:
        print(f"[writediff] PASS -- all {len(golden)} writes identical, in order")
        if not with_cycles:
            # THE LIMIT TRAVELS WITH THE RESULT, not in a doc nobody re-reads.
            #
            # "All N writes match golden, in order" reads as stronger than it is.
            # This mode compares (addr, value) SEQUENCE and never looks at the
            # cycle column, so a write landing at the RIGHT PLACE at the WRONG
            # TIME passes here.
            #
            # DEMONSTRATED, not hypothesised: a not-taken `jr z` at 0x0D7F that
            # emitted no step at all -- 7 T-states unaccounted -- left state.bin
            # IDENTICAL, frames.rgb IDENTICAL, and moved exactly one write from
            # cycle 26370164 to 26370171. The divergence was IN THIS TRACE, in
            # the column this mode does not read. All three gates passed.
            #
            # Phase 1 was scoped deliberately (the JS side's DMA cycle accounting
            # is not exact), so this is a KNOWN limit and not a defect. But a
            # check whose passing feels like evidence about something it never
            # examined is the failure this harness exists to refuse.
            print(
                "  *** SCOPE: this compared (addr, value) ORDER ONLY. The cycle\n"
                "  *** column was NOT examined. A write at the right place and the\n"
                "  *** wrong time passes here -- measured: a 7-cycle omission moved\n"
                "  *** one write and state, pixels and this gate all stayed green.\n"
                "  *** Re-run with --cycles once JS cycle accounting is exact."
            )
        return EXIT_OK

    print(f"\n[writediff] FAIL -- first divergence at write #{i}")
    if i >= len(golden.sequence) or i >= len(actual.sequence):
        # One trace ran out. A prefix is not a pass.
        longer, label = (
            (golden, "golden") if len(golden) > len(actual) else (actual, "js")
        )
        print(
            f"  the {'js' if longer is golden else 'golden'} trace ENDS here while "
            f"{label} continues ({len(golden)} vs {len(actual)} writes)."
        )
        print(f"  next in {label}:")
        print(context(longer, i, before=2, after=2))
    else:
        gc, ga, gv = golden.entries[i]
        ac, aa, av = actual.entries[i]
        print(f"  golden: {ga:04X} <- {gv:02X}  ({writeio.region_of(ga)})")
        print(f"  actual: {aa:04X} <- {av:02X}  ({writeio.region_of(aa)})")
        if (ga, gv) == (aa, av) and with_cycles:
            print(
                f"  same write, different cycle: golden {gc}, actual {ac} "
                f"(delta {ac - gc:+d})"
            )
        print("\n  golden context:")
        print(context(golden, i))
        print("\n  actual context:")
        print(context(actual, i))

    print(
        "\n  Order is part of the contract: boot writes latches as xor a / three\n"
        "  stores / inc a / one store, so the first three carry A=0 and the fourth\n"
        "  A=1. A reordered trace is a real divergence, not an equivalent one.\n"
        "\n  The FIX must trace to an independently-verifiable ROM fact.\n"
        "  This is evidence that something is wrong and where -- NOT a\n"
        "  specification of what the code should write."
    )
    return EXIT_FAIL


if __name__ == "__main__":
    sys.exit(main())
