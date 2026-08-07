#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""Author-run check for the mechanically-decidable prose defects, before submitting for review.

Review rounds here keep turning on prose rather than code, and a share of those findings need no
judgement at all. A reviewer catching them costs a round trip; catching them here costs a second.

★ THIS IS ADVISORY AND IS DELIBERATELY NOT A GIT HOOK. `docs/reviewer-rules.md` says the always-on
hooks are fixed and that a new requirement belongs in the rules as a RULE, not as another gate.
That instruction is right, and the reason is measurable: wire a prose check into `pre-commit` and
replay it over this repository's own history, and it refuses most of it -- largely on header forms
the rules themselves mandate. A hard gate that rejects compliant work teaches people to bypass
gates. So this one advises the author and binds nobody. **Do not wire it in.**

Run it yourself before handing a diff to a reviewer:  python3 tools/presubmit.py

★ WHAT THIS CANNOT SEE. A clean run is not evidence a diff is clean:
  - It reads only ADDED lines of the staged diff, so a defect in an untouched line is invisible.
  - It sees comment text and .md prose. Prose inside a STRING -- a registry `why:` or `role:`
    field, an assertion message -- is code to it and passes silently. A naming pass puts most of
    its prose exactly there, so this is weakest where that unit is densest.
  - A PYTHON docstring is a string, so a defect in one reads clean even though the identical
    sentence in a `#` comment is caught. A JSDoc block is NOT affected -- it is a comment and is
    scanned, which is most of the prose in the idiomatic layer.
  - ★ THE DETECTOR IS DELIBERATELY NARROW AND SO IT MISSES A LOT. It fires only on phrasings that
    are measurements by construction. Survey counts written any other way -- "seven call sites in
    five routines", "all three callers", "169 entries" -- sail straight through, and that shape is
    common in test headers deriving a live-out from callers. Precision was chosen over recall on
    purpose, because the recall-first version refused compliant work; the cost is that a reviewer
    still has to read for counts.
  - THE COMMIT MESSAGE IS NEVER READ, and the rules govern it equally. Check it by eye.
  - It cannot tell a true count from a false one, only that a phrase is a measurement and so will
    rot when the thing it measured changes.
  - Judgement findings -- an overreaching absolute, a citation that says the opposite of the
    claim, a mechanism asserted as cause where the evidence shows correlation -- are entirely
    outside it, and are most of what a review actually finds.
Treat a clean run as "the mechanical half found nothing", never as "the prose is sound".
"""

import re
import subprocess
import sys

# R20: prose citing a predecessor revision of itself.
#
# ★ THE VERB LIST AFTER "used to" IS DELIBERATELY TINY. Bare `used to \w+` is tempting and wrong:
# decompilation prose is full of "the scratch byte used to hold the sum", "the pointer used to
# read the table", "the port used to open the latch" -- ordinary verbs where nothing is being
# said about a previous draft. Only verbs of SPEECH indicate a claim about what the text was.
# Anything broader was measured against the tree and produced more false alarms than findings.
R20 = re.compile(
    r"(earlier|previous|prior|older) (draft|version|wording|revision) of (this|the)|"
    r"previously (said|read|claimed|stated)|"
    r"used to (say|claim|state)\b|"
    r"an earlier (draft|version) (said|read|gave)|"
    r"the old text|is withdrawn|is retracted|has been retracted|"
    r"★ CORRECTION|^\s*\W*CORRECTION\b",
    re.I,
)

# A MEASUREMENT in prose is true once and nothing re-verifies it.
#
# ★ THERE IS NO EXEMPTION LIST HERE, ON PURPOSE, AND ADDING ONE IS A MISTAKE. The tempting design
# -- flag any number next to a plural noun, then exempt the ones fixed by hardware -- puts every
# hard case in the exemption, and an exemption is a blind spot aimed exactly where the tool is
# meant to look. Measured failure modes of that shape: hyphenated spellings fall through inverted,
# an exempt phrase early in a line shields a rotting count later on it, and widening the exemption's
# noun list silently disables the detector while every test stays green.
#
# So the detector matches only phrasings that are MEASUREMENTS BY CONSTRUCTION -- a survey of the
# code, a tally, a coverage claim. "24 bytes" and "eight slots" describe the machine and cannot
# rot; "used across 24 routines" is a survey and rots the day someone adds one. Precision over
# recall: the misses are handled by a reviewer, the false alarms would get this switched off.
MEASURED = re.compile(
    r"\b(used|called|referenced|dispatched|reached|covered|touched|shared)\s+"
    r"(across|by|from|in|at)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|"
    r"twelve|thirteen|fourteen|fifteen|sixteen|twenty|thirty|forty|fifty)\b|"
    r"\bat\s+(\d+|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|"
    r"forty|fifty)\s+(sites?|call sites?|places?|points?)\b|"
    r"\bacross\s+(\d+|two|three|four|five|six|seven|eight|nine|ten)\s+"
    r"(batches|passes|rounds|commits|games|files|routines|modules)\b|"
    # A tally, but only of CODE ARTEFACTS. "there are two lines, one per axis" counts the
    # machine and cannot rot; "there are four readers" is a survey and rots when a fifth lands.
    r"\b(a total of|totalling|there are|we have)\s+(\d+|one|two|three|four|five|six|"
    r"seven|eight|nine|ten|eleven|twelve)\s+"
    r"(routines?|callers?|readers?|writers?|files?|modules?|sites?|tests?|gates?|"
    r"commits?|batches|passes|agents?)\b",
    re.I,
)

# Two files necessarily quote the shapes they forbid, so scanning them reports each as a
# violation of itself: the rules document, whose own written recipe carries the same exclusion,
# and this tool, whose comments have to give examples of what it detects.
EXCLUDED_PATHS = ("docs/reviewer-rules.md", "tools/presubmit.py")


def staged_added_lines():
    """(path, lineno, text) for every line the staged diff ADDS."""
    r = subprocess.run(
        ["git", "diff", "--cached", "-U0"], capture_output=True, text=True, check=True
    )
    path, lineno, in_hunk, out = None, 0, False, []
    for line in r.stdout.split("\n"):
        if line.startswith("diff --git "):
            path, in_hunk = None, False
        elif line.startswith("+++ ") and not in_hunk:
            # Only a header while we are between hunks; inside one, "+++ x" is added content.
            # Strip "+++ b/" normally, but under `diff.noprefix` the header is a bare path.
            # Keying only on "b/" leaves path None, which silently unscans .md prose.
            rest = line[4:]
            path = (
                None
                if rest == "/dev/null"
                else (rest[2:] if rest.startswith("b/") else rest)
            )
        elif line.startswith("@@"):
            m = re.search(r"\+(\d+)", line)
            lineno, in_hunk = (int(m.group(1)) if m else 0), True
        elif in_hunk and line.startswith("+"):
            out.append((path, lineno, line[1:]))
            lineno += 1
    return out


def prose_of(path, text):
    """The prose in a line, or None. Handles trailing comments, not just whole-line ones."""
    if path and path.endswith(".md"):
        return text
    t = text.lstrip()
    if t.startswith(("//", "*", "/*", "#", "--")):
        return t
    # A trailing comment is where the registry keeps most of its prose, so it must be read.
    for marker in ("//", " # ", " -- "):
        i = text.find(marker)
        if i > 0:
            return text[i:]
    return None


# Cases this must get right. A regex checked by nobody is not known to work, and BOTH directions
# matter: the True cases are the detector, the False cases are what keeps it usable. Every False
# case below is real prose shape from this repository.
MEASURED_SELFTEST = [
    ("used across 17 routines", True),
    ("referenced by three files", True),
    ("at 55 sites", True),
    ("at twelve call sites", True),
    ("across three batches", True),
    ("a total of nine modules", True),
    ("there are four readers", True),
    # Facts about the machine. None of these can rot, and flagging them is what makes a
    # count-any-number design unusable against the repository's own mandated header forms.
    ("LIVE-OUT: memory only -- four bytes", False),
    ("lay one byte across a fixed run of thirteen cells", False),
    ("8 sprites x 4 bytes", False),
    ("the deferred category-1 cells", False),
    ("64 bytes, so 32 two-byte entries", False),
    ("a five-entry table", False),
    ("two components a quarter turn apart", False),
    ("about ten routines", False),
    ("the ring: 64 bytes, so 32 two-byte entries", False),
    ("one cell is 32 addresses back down the tilemap", False),
]

R20_SELFTEST = [
    ("an earlier draft said otherwise", True),
    ("the previous version of this header", True),
    ("this used to say something else", True),
    # One case per alternation, or a mutation deletes a clause and the suite stays green.
    ("previously said the opposite", True),
    ("the old text has it the other way", True),
    ("the claim is withdrawn", True),
    ("that citation is retracted", True),
    ("the note has been retracted", True),
    ("★ CORRECTION: the figure above is wrong", True),
    ("CORRECTION: the figure above is wrong", True),
    # Pins the `of (this|the)` anchor. Without it, prose about a previous version of some other
    # THING -- an emulator, a ROM revision -- fires, and that is ordinary technical writing.
    ("a previous version of MAME rendered it differently", False),
    # Ordinary prose. "used" as a plain verb, and time words describing the CODE rather than the
    # text, must never fire -- a check that cries wolf gets switched off, which is worse than
    # not having it.
    ("the scratch byte used to hold the running sum", False),
    ("the pointer used to read the table", False),
    ("the register used to carry the carry flag", False),
    ("the port used to open the coin door latch", False),
    ("the routine reads an earlier slot", False),
    ("the shot retires prior to the target", False),
    ("the previous header row is skipped", False),
    ("a cursor used to walk character cells", False),
]


def selftest():
    bad = []
    for probe, want in MEASURED_SELFTEST:
        if bool(MEASURED.search(probe)) != want:
            bad.append(f"MEASURED: {probe!r} matched={not want} wanted={want}")
    for probe, want in R20_SELFTEST:
        if bool(R20.search(probe)) != want:
            bad.append(f"R20: {probe!r} matched={not want} wanted={want}")
    # The diff parser has the subtlest failure modes, so it is exercised here too.
    for text, want in [
        ("# x", "# x"),
        ("code(); // note", "// note"),
        ("code();", None),
    ]:
        if prose_of("a.js", text) != want:
            bad.append(
                f"prose_of({text!r}) -> {prose_of('a.js', text)!r}, wanted {want!r}"
            )
    if bad:
        print("presubmit selftest: FAILED", file=sys.stderr)
        for b in bad:
            print(f"  {b}", file=sys.stderr)
        return 1
    print("presubmit selftest: OK")
    return 0


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "selftest":
        return selftest()
    if selftest() != 0:
        print(
            "presubmit: refusing to report -- its own checks are broken",
            file=sys.stderr,
        )
        return 2

    try:
        lines = staged_added_lines()
    except (subprocess.CalledProcessError, OSError) as e:
        # Exit 2, not 1: "could not look" must never be confused with "looked and found nothing",
        # and must not be mistaken for "found something" either.
        print(f"presubmit: could not read the staged diff -- {e}", file=sys.stderr)
        return 2

    findings = []
    for path, lineno, text in lines:
        if path and path.startswith(EXCLUDED_PATHS):
            continue
        prose = prose_of(path, text)
        if prose is None:
            continue
        if R20.search(prose):
            findings.append(
                (path, lineno, "R20: cites a predecessor revision", text.strip())
            )
        m = MEASURED.search(prose)
        if m:
            findings.append(
                (
                    path,
                    lineno,
                    f"measurement in prose: {m.group(0).strip()!r}",
                    text.strip(),
                )
            )

    if not findings:
        print("presubmit: no mechanically-decidable prose defects in the staged diff")
        print(
            "  (this is advisory and shallow -- see the module docstring for what it misses)"
        )
        return 0
    print("presubmit: shapes a reviewer would raise. Advisory -- judge each one.\n")
    for path, lineno, why, text in findings:
        print(f"  {path}:{lineno}  {why}")
        print(f"      {text[:100]}")
    print(
        "\nA measurement in prose is true once. Say what is true structurally instead."
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
