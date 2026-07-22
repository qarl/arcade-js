#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""Audit every m.step() target in games/<id>/translated/ against the ROM's own
instruction boundaries.

WHY THIS EXISTS. A translated routine can be byte-perfect, pass the state gate,
pass the pixel gate and pass the write gate while charging the wrong T-states,
because:

  * state-diff compares memory at frame boundaries -- a cycle error that does
    not move a write is invisible to it;
  * the pixel gate only sees a cycle error that moves a VRAM write across a
    scanline;
  * writediff currently runs SEQUENCE ONLY -- it compares the ordered
    (addr, value) pairs and NOT the cycles, so a write that arrives 7 cycles
    late is not a divergence to it.

That is not hypothetical. The not-taken `jr z` at 0x0D7F shipped with no
m.step() at all: 7 T-states unaccounted, PC skipping 0x0D81. Emitting with and
without the fix gave IDENTICAL state.bin and IDENTICAL frames.rgb, and a
writes.txt whose only difference was one write moving by exactly 7 cycles --
which sequence-only mode does not compare. A byte-diff and all three gates
passed it.

**DEFAULT MODE WOULD NOT HAVE CAUGHT THAT ONE**, and saying otherwise here was
the first thing written into this file. A MISSING step has no wrong target to
find; --draft is the mode that catches it, by comparing the step SEQUENCE
against the listing. Stating it because a tool's docstring is exactly the
unchecked claim that gets believed.

WHAT IT CHECKS, and what it deliberately does not:

  default   every literal m.step(0xADDR, ...) in games/<id>/translated/ targets the START of
            a decoded instruction. Stepping into the middle of an instruction
            is always wrong. Finds MISAIMED steps; blind to missing ones.
            A target inside a known-unreached span (out/unreached.txt) is
            reported as a COVERAGE GAP, not a defect -- the tracer simply never
            decoded that byte, so there is no instruction-start record to hit.
  --draft   the stronger check, on one draft: the step sequence must match the
            listing's instruction sequence one for one, so a missing or extra
            step is caught. Works because a draft's listing order is known and
            linear. NOT usable on integrated source -- see the note in main().
  NOT       that a cycle count is right. That needs the current PC, which the
            source does not carry (this verifies a proxy).

So a clean default run is NOT a proof the cycle accounting is right. It rules
out one specific failure mode and is blind to the one that actually shipped.

Run:  python3 tools/stepcheck.py                     (needs `make trace`)
      python3 tools/stepcheck.py --selftest          (proves it can fail)
      python3 tools/stepcheck.py --draft FILE.md
"""
import argparse
import glob
import os
import re
import sys


def instruction_starts(asm_text):
    """Addresses dk.asm decoded as instruction starts, and their mnemonics."""
    starts = {}
    for line in asm_text.split("\n"):
        m = re.match(r"\s*(\S.*?);\s*([0-9a-f]{4})\s+((?:[0-9a-f]{2} ?)+)", line)
        if m:
            starts[int(m.group(2), 16)] = m.group(1).strip()
    return starts


def steps_in(path):
    """(line_no, addr) for every literal m.step(0x...) in a source file."""
    out = []
    for i, line in enumerate(open(path), 1):
        for hit in re.finditer(r"m\.step\(\s*(?:[^,()]*\?\s*)?(0x[0-9a-f]+)"
                               r"(?:\s*:\s*(0x[0-9a-f]+))?", line):
            for g in hit.groups():
                if g:
                    out.append((i, int(g, 16)))
    return out


def unreached_spans(text):
    """[(lo, hi)] inclusive byte ranges the tracer never proved reachable.

    Parsed from out/unreached.txt (written by `make trace`). A step target that
    lands inside one of these has no decoded instruction start simply because
    that byte was never reached -- a static-coverage gap, not a bad target.
    """
    spans = []
    for line in text.split("\n"):
        m = re.match(r"\s*0x([0-9a-f]+)\s*-\s*0x([0-9a-f]+)", line)
        if m:
            spans.append((int(m.group(1), 16), int(m.group(2), 16)))
    return spans


def check_draft(path):
    """Sequence-check a draft's skeleton against its own listing.

    THE STRONG CHECK, and it only works here. A draft carries its listing and
    its skeleton side by side in known linear order, so step #i must target the
    successor of instruction #i -- which makes a MISSING step visible as a
    misalignment of everything after it. Integrated source has loops, computed
    step targets and helper-carried successors, and none of that survives a
    positional comparison.

    A `call nn` is the one exception to "target the successor": it steps to the
    CALLEE and pushes the return address instead. Verified against integrated
    code -- state0.js loc_0fd7 has `m.push16(0x0fef); m.step(0x122a, 17)` for
    the `call 0x122a` at 0x0FEC.
    """
    draft = open(path).read()

    addrs = []
    for line in draft.split("\n"):
        m = re.match(r"\s*([a-z].*?);\s*([0-9a-f]{4})\s+((?:[0-9a-f]{2} ?)+)", line)
        if m:
            mnem, ad, bs = m.group(1).strip(), m.group(2), m.group(3)
        else:
            m = re.match(r"^([0-9a-f]{4})\s+((?:[0-9a-f]{2} )+)\s*([a-z].*)", line)
            if not m:
                continue
            mnem, ad, bs = m.group(3).strip(), m.group(1), m.group(2)
        ad, n = int(ad, 16), len(bs.split())
        if not addrs or ad != addrs[-1][0]:
            addrs.append((ad, n, mnem))

    js = re.search(r"```js\n(.*?)```", draft, re.S)
    if not addrs or not js:
        print(f"FAIL: {path} has no listing and/or no ```js skeleton")
        return 2

    calls = {}
    for ad, n, mnem in addrs:
        mc = re.match(r"call 0x([0-9a-f]+)", mnem)
        if mc:
            calls[ad] = int(mc.group(1), 16)

    steps = []
    for line in js.group(1).split("\n"):
        m = re.search(r"m\.step\(\s*[^,()]*\?\s*(0x[0-9a-f]+)\s*:\s*(0x[0-9a-f]+)", line)
        if m:
            steps.append(("cond", int(m.group(1), 16), int(m.group(2), 16)))
            continue
        m = re.search(r"m\.step\((0x[0-9a-f]+),", line)
        if m:
            steps.append(("plain", int(m.group(1), 16), None))

    # DEFAULT CLOSED, and the third state is the point. A skeleton may
    # carry its step targets as VARIABLES rather than literals -- sub_11d3
    # unrolls its four gathers through a `for...of` over a literal table, so
    # only 2 of its 14 steps are parseable here. Positional comparison then
    # misaligns and reports defects in a draft that is correct.
    #
    # Reporting INCONCLUSIVE rather than either verdict: claiming CLEAN would
    # be the silent-pass this file exists to prevent, and claiming DEFECT would
    # be a false FAIL, which costs an investigation and teaches people
    # to ignore the tool. "I cannot read this skeleton" is the true answer.
    all_steps = len(re.findall(r"m\.step\(", js.group(1)))
    if all_steps != len(steps):
        print(f"{path}: {all_steps} m.step calls but only {len(steps)} have "
              f"literal targets -- {all_steps - len(steps)} are computed")
        print("DRAFT STEPS INCONCLUSIVE -- verify this skeleton by hand")
        return 2

    expected = [calls.get(ad, ad + n) for ad, n, _ in addrs]
    pushes = [ad + n for ad, n, _ in addrs if ad in calls]
    got_pushes = [int(x, 16) for x in re.findall(r"m\.push16\((0x[0-9a-f]+)\)", js.group(1))]
    listed = {ad for ad, _, _ in addrs}

    bad = 0
    gaps = [(addrs[i][0], addrs[i + 1][0]) for i in range(len(addrs) - 1)
            if addrs[i][0] + addrs[i][1] != addrs[i + 1][0]]
    if gaps:
        print(f"  listing is NOT contiguous: {gaps}")
        bad += 1

    # The last instruction is the `ret`, whose successor is dynamic (ret(m)).
    if len(steps) != len(addrs) - 1:
        print(f"  step COUNT {len(steps)} != {len(addrs) - 1} instructions before "
              f"the final {addrs[-1][2]!r} -- a missing or extra m.step")
        bad += 1

    for i, s in enumerate(steps):
        if i >= len(expected):
            print(f"  step #{i} is past the end of the listing")
            bad += 1
            continue
        want = expected[i]
        if s[0] == "plain":
            if s[1] != want:
                print(f"  step #{i} targets 0x{s[1]:04x}, listing says 0x{want:04x}")
                bad += 1
        else:
            if s[2] != want:
                print(f"  step #{i} fall-through 0x{s[2]:04x} != 0x{want:04x}")
                bad += 1
            if s[1] not in listed:
                print(f"  step #{i} loop target 0x{s[1]:04x} is not a listed address")
                bad += 1

    if pushes != got_pushes:
        print(f"  push16 return addresses {[hex(x) for x in got_pushes]} != "
              f"{[hex(x) for x in pushes]}")
        bad += 1

    print(f"{path}: {len(addrs)} instructions, {len(steps)} m.step, "
          f"{len(calls)} call(s)")
    print("DRAFT STEPS CLEAN" if bad == 0 else f"{bad} STEP DEFECT(S)")
    return 0 if bad == 0 else 1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--asm", default="games/dkong/out/dk.asm")
    ap.add_argument("--src", default="games/dkong/translated/*.js")
    ap.add_argument("--unreached", default=None,
                    help="unreached-span list (default: unreached.txt beside --asm)")
    ap.add_argument("--selftest", action="store_true",
                    help="inject a known-bad target and require it to be caught")
    ap.add_argument("--draft", help="sequence-check one draft's skeleton")
    a = ap.parse_args()

    if a.draft:
        return check_draft(a.draft)

    starts = instruction_starts(open(a.asm).read())
    if len(starts) < 1000:
        print(f"FAIL: {a.asm} yielded only {len(starts)} instruction starts -- "
              f"run `make trace` first")
        return 2

    if a.selftest:
        # Prove the check can return a non-trivial answer, against an
        # answer known in advance. 0x0D80 is the SECOND byte of the two-byte
        # `jr z,0x0d8b` at 0x0D7F, so it can never be an instruction start.
        bad = 0x0d80
        if bad in starts:
            print(f"SELFTEST INCONCLUSIVE: 0x{bad:04x} is a real start")
            return 2
        print(f"selftest: 0x{bad:04x} (mid-instruction) correctly NOT a start -- "
              f"the check has teeth")
        return 0

    # Coverage gaps vs. real defects. The recursive-descent tracer only proves
    # ~77% of the ROM reachable; a step whose target lands inside a known-unreached
    # span (out/unreached.txt) has no instruction-start record simply because that
    # byte was never decoded. That is a static-coverage gap, NOT a mistranslated
    # target, and it must not fail the audit. A target that misses a start OUTSIDE
    # every unreached span IS a real defect.
    unreached_path = a.unreached or os.path.join(os.path.dirname(a.asm), "unreached.txt")
    if os.path.exists(unreached_path):
        spans = unreached_spans(open(unreached_path).read())
    else:
        spans = []
        print(f"  NOTE: {unreached_path} not found -- run `make trace` first so "
              f"coverage gaps can be told apart from real defects")

    def in_unreached(addr):
        return any(lo <= addr <= hi for lo, hi in spans)

    bad = 0
    gaps = 0
    files = sorted(glob.glob(a.src))
    total = 0
    for path in files:
        for line_no, addr in steps_in(path):
            total += 1
            if addr not in starts:
                if in_unreached(addr):
                    gaps += 1
                else:
                    print(f"  {path}:{line_no}: m.step(0x{addr:04x}) is NOT an "
                          f"instruction start")
                    bad += 1

    print(f"CHECK 1 -- targets: {total} m.step targets across {len(files)} "
          f"file(s), {len(starts)} decoded instruction starts")
    if gaps:
        print(f"  {gaps} target(s) inside known-unreached spans "
              f"(coverage gaps, not defects)")
    print("  CLEAN" if bad == 0 else f"  {bad} BAD TARGET(S)")

    # ---- CHECK 2 (COVERAGE) WAS ATTEMPTED AND IS NOT SHIPPED -------------
    # Recorded so the next person does not rebuild it and reach the same wall.
    #
    # Check 1 finds a step aimed at the wrong place. It CANNOT find a step that
    # is missing entirely -- which is what the 0x0D7F defect actually was, and
    # is the more dangerous form, because it silently drops T-states instead of
    # moving the PC somewhere visibly wrong.
    #
    # The obvious check is coverage: every instruction start in a routine's
    # declared ROM range must be reachable as some successor recorded in the
    # body. Implemented, it reported 207 findings against code that passes all
    # three gates. Weakening it to "the address appears as any hex literal in
    # the body" still left 122. Both figures are the INSTRUMENT, not the code:
    # successors are legitimately carried as helper arguments
    # (`ldirAt(m, 0x0054, 0x0056)`), as entries in literal tables (sub_11d3's
    # gather list), and as COMPUTED expressions (`m.step(afterLoad + 1, 7)`) --
    # and the NMI entry advances with tick() rather than step() in places.
    #
    # Deciding a boundary is unaccounted for therefore requires evaluating
    # arbitrary JS expressions, which a regex cannot do. A checker emitting 122
    # false positives is worse than none: a false FAIL costs an
    # investigation, and one that cries wolf at that rate gets ignored, taking
    # its true positives with it.
    #
    # THE GAP IS REAL AND REMAINS OPEN. A missing m.step passes a byte-diff and
    # all three gates. The check that DOES catch it compares the step SEQUENCE
    # against the listing's instruction sequence, which works on a draft (whose
    # listing order is known and linear) and not on integrated source. Use
    # --draft for that, and treat integrated code as uncovered for this class.

    total_bad = bad
    if total_bad == 0:
        if gaps:
            print(f"STEP AUDIT CLEAN ({gaps} target(s) in known-unreached spans -- "
                  f"coverage gaps, not defects)")
        else:
            print("STEP AUDIT CLEAN")
    else:
        print(f"{total_bad} DEFECT(S)")
    return 0 if total_bad == 0 else 1


sys.exit(main())
