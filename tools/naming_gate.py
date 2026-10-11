#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""Naming gate -- a grounded (cert:"seen") idiomatic ROUTINE must have a descriptive EFFECT name, never loc_.

runbook §4: 'loc_ is reserved for an UNCLEAR mechanism' + 'Name by EFFECT'. A cert:"seen" routine is
MAME-grounded -- its mechanism is OBSERVED -- so it must be named by effect; a surviving name:"loc_<addr>"
on a seen routine is the exact naming debt this gate blocks (documented-is-not-enforced: a rule with no gate
gets skipped). A cert:"code"/"guess" routine (role genuinely unclear) may stay loc_. The frozen TRANSLATED
layer is always loc_<addr> and is OUT OF SCOPE -- this reads only the idiomatic registry
games/<game>/idiomatic/names.js ROUTINES map. Legacy pre-runbook ports are grandfathered.

A genuinely-seen-but-effect-unnameable routine (rare) is accounted for in games/<game>/names-debt.txt (one
'loc_<addr>  <why the effect is unnameable despite grounding>' per line), reviewer-verified
(proposer!=confirmer) and SUBTRACTED here. The gate stays honest, exactly like done_gate's grounding-debt:
a reasonless entry, or one whose routine is NOT actually a cert:"seen" loc_ in names.js, BLOCKS.

Subcommands: check [--game <g>] (exit 0 iff no unaccounted cert:seen loc_ routine), selftest.
"""
import argparse
import glob
import os
import re
import sys

# Pre-runbook ports keep their loc_ routine names (runbook 'Legacy games: do not retrofit'). A game born under
# this runbook (pooyan onward), or a legacy port once it passes the full rule (timeplt), is enforced.
LEGACY = {"dkong", "frogger", "thepit"}

# A ROUTINES entry starts at a line-anchored `0xADDR: {`. Delimit an entry by the NEXT such start, NOT by a
# brace: a role string legitimately contains `{` (a dispatch-table description like "{0 init, 1 run}"), and a
# `\{[^{}]*?\}` matcher chokes on it and SILENTLY SKIPS that entry -- a false negative exactly at the green
# boundary (the one grounded loc_ left un-flagged then reaches DONE). Anchoring the start to line-start also
# keeps a role's mid-line "0xNN: {" from being mistaken for an entry.
ENTRY_START = re.compile(r'^[ \t]*0x[0-9a-fA-F]+\s*:\s*\{', re.M)
NAME = re.compile(r'name:\s*"(loc_[0-9a-f]+)"')
CERT_SEEN = re.compile(r'cert:\s*"seen"')


def read_text(path):
    try:
        return open(path, encoding="utf-8", errors="replace").read()
    except OSError:
        return ""


def seen_loc_routines(names_js_text):
    """Return the set of loc_<addr> routine names in the ROUTINES map that are cert:"seen".

    Entries are delimited by their line-anchored `0xADDR: {` starts (each span runs to the next start),
    never brace-matched -- a `{` inside a role string must not hide the entry."""
    out = set()
    starts = [m.start() for m in ENTRY_START.finditer(names_js_text)]
    for i, s in enumerate(starts):
        end = starts[i + 1] if i + 1 < len(starts) else len(names_js_text)
        blk = names_js_text[s:end]
        nm = NAME.search(blk)
        if nm and CERT_SEEN.search(blk):
            out.add(nm.group(1))
    return out


def read_names_debt(base):
    """games/<game>/names-debt.txt: 'loc_<addr>  <reason>' per line (# comments / blanks ignored)."""
    path = f"{base}/names-debt.txt"
    debt = {}
    if not os.path.exists(path):
        return debt
    for ln in open(path, encoding="utf-8", errors="replace"):
        ln = ln.split("#", 1)[0].strip()
        if not ln:
            continue
        parts = ln.split(None, 1)
        if re.fullmatch(r"loc_[0-9a-f]+", parts[0]):
            debt[parts[0]] = parts[1].strip() if len(parts) > 1 else ""
    return debt


def routine_loc_names(names_js_text):
    """Every loc_<addr> that IS a ROUTINES entry (any cert) -- the registry accounts for it."""
    return set(re.findall(r'name:\s*"(loc_[0-9a-f]+)"', names_js_text))


def loc_module_files(base):
    """Basenames of games/<game>/idiomatic/loc_*.js FILES -- each is a routine that must be named or debt-listed."""
    return {os.path.splitext(os.path.basename(f))[0] for f in glob.glob(f"{base}/idiomatic/loc_*.js")}


def check(game, base=None):
    base = base or f"games/{game}"
    names_js = f"{base}/idiomatic/names.js"
    if not os.path.exists(names_js):
        print(f"naming [{game}]: OK (no idiomatic/names.js -- nothing to enforce)")
        return 0
    names_text = read_text(names_js)
    seen_locs = seen_loc_routines(names_text)      # cert:seen loc_ ROUTINES entries
    routine_locs = routine_loc_names(names_text)   # ALL loc_ ROUTINES entries (any cert)
    loc_files = loc_module_files(base)             # every idiomatic/loc_*.js FILE
    if game in LEGACY:
        print(f"naming [{game}]: OK (legacy pre-runbook port grandfathered; {len(loc_files)} loc_ modules not retrofitted)")
        return 0
    debt = read_names_debt(base)
    # Honesty checks on names-debt: every entry needs a reason AND must be REAL -- either a cert:seen loc_
    # ROUTINE in names.js, or an actual idiomatic/loc_<addr>.js FILE. Reasonless or stale/false (no such
    # routine AND no such file) BLOCKS.
    bad_debt = []
    for loc, reason in debt.items():
        if not reason:
            bad_debt.append(f"{loc} (no reason)")
        elif loc not in seen_locs and loc not in loc_files:
            bad_debt.append(f"{loc} (neither a cert:seen loc_ routine in names.js nor a loc_*.js file -- stale/false)")
    if bad_debt:
        print(f"naming [{game}]: BLOCK -- names-debt.txt has invalid entries:", file=sys.stderr)
        for x in bad_debt:
            print(f"  - {x}", file=sys.stderr)
        return 1
    # (A) a cert:seen loc_ ROUTINES entry must be renamed or debt-listed. (B) every idiomatic loc_*.js FILE
    # must be a ROUTINES entry (any cert) or debt-listed -- (B) catches a grounded loc_ module the ROUTINES-map
    # check (A) is blind to (a file with no ROUTINES entry). Either way the fix is a rename or a reasoned debt line.
    unaccounted = sorted((seen_locs - set(debt)) | (loc_files - routine_locs - set(debt)))
    if unaccounted:
        print(f"naming [{game}]: BLOCK -- {len(unaccounted)} routine(s) named loc_ with no descriptive name and no "
              f"names-debt.txt reason (name by EFFECT; runbook §4-end). loc_ is for a genuinely-unclear mechanism:", file=sys.stderr)
        for loc in unaccounted[:20]:
            print(f"  - {loc}", file=sys.stderr)
        if len(unaccounted) > 20:
            print(f"  ... and {len(unaccounted) - 20} more", file=sys.stderr)
        return 1
    extra = f" ({len(debt)} accounted in names-debt.txt)" if debt else ""
    print(f"naming [{game}]: OK (no grounded routine left as loc_{extra})")
    return 0


def check_all():
    rc = 0
    for names_js in sorted(glob.glob("games/*/idiomatic/names.js")):
        game = names_js.split("/")[1]
        rc |= check(game)
    return rc


def selftest():
    import contextlib
    import io as _io
    import shutil
    import tempfile
    ok = True

    def fail(msg):
        nonlocal ok
        print(f"selftest FAIL: {msg}", file=sys.stderr)
        ok = False

    # seen_loc_routines: flags a cert:seen loc_ entry, ignores a named-seen and a cert:code loc_.
    js = ('export const ROUTINES = {\n'
          '  0x0001: { name: "loc_0001", role: "x", cert: "seen" },\n'   # flagged
          '  0x0002: { name: "advanceThing", role: "y", cert: "seen" },\n'  # named -> ok
          '  0x0003: { name: "loc_0003", role: "z", cert: "code" },\n'    # unclear -> ok to be loc_
          '};\n')
    got = seen_loc_routines(js)
    if got != {"loc_0001"}:
        fail(f"seen_loc_routines -> {got}, want {{'loc_0001'}}")

    # regression: a `{` inside a role string must NOT hide a seen loc_ entry (a brace-matched ENTRY skipped it).
    brace_js = ('export const ROUTINES = {\n'
                '  0x0abc: { name: "loc_0abc", role: "dispatch table {0 init, 1 run, 2 done}", cert: "seen" },\n'
                '};\n')
    if seen_loc_routines(brace_js) != {"loc_0abc"}:
        fail(f"seen_loc_routines missed a loc_ with a brace in its role -> {seen_loc_routines(brace_js)}")

    def silent_check(game, base):
        with contextlib.redirect_stdout(_io.StringIO()), contextlib.redirect_stderr(_io.StringIO()):
            return check(game, base=base)

    tmp = tempfile.mkdtemp(prefix="naming_gate_selftest_")
    try:
        def tree(sub, names, debt=None, loc_files=()):
            b = f"{tmp}/{sub}"
            os.makedirs(f"{b}/idiomatic", exist_ok=True)
            open(f"{b}/idiomatic/names.js", "w").write(names)
            for lf in loc_files:
                open(f"{b}/idiomatic/{lf}.js", "w").write(f"// {lf} [seen]\nexport function {lf}(m) {{}}\n")
            if debt is not None:
                open(f"{b}/names-debt.txt", "w").write(debt)
            return b

        # a non-legacy game with a cert:seen loc_ -> BLOCK (teeth).
        if silent_check("synth", tree("bad", js)) == 0:
            fail("a cert:seen loc_ routine did not BLOCK")
        # cleaned (no seen loc_) -> OK.
        clean = 'export const ROUTINES = {\n  0x0002: { name: "advanceThing", role: "y", cert: "seen" },\n};\n'
        if silent_check("synth", tree("clean", clean)) != 0:
            fail("a fully-named registry was blocked")
        # cert:code loc_ only -> OK (unclear mechanism may stay loc_).
        codeonly = 'export const ROUTINES = {\n  0x0003: { name: "loc_0003", role: "z", cert: "code" },\n};\n'
        if silent_check("synth", tree("codeonly", codeonly)) != 0:
            fail("a cert:code loc_ routine was wrongly blocked")
        # legacy game with a seen loc_ -> OK (grandfathered).
        if silent_check("frogger", tree("legacy", js)) != 0:
            fail("a legacy game with a seen loc_ was blocked (should be grandfathered)")
        # names-debt accounts for the seen loc_ -> OK.
        if silent_check("synth", tree("debted", js, debt="loc_0001  effect genuinely ambiguous after read+callers\n")) != 0:
            fail("a valid names-debt entry did not clear the gate")
        # reasonless names-debt -> BLOCK.
        if silent_check("synth", tree("noreason", js, debt="loc_0001\n")) == 0:
            fail("a reasonless names-debt entry did not BLOCK")
        # stale/false names-debt (routine not a seen loc_ and no such loc_*.js file) -> BLOCK.
        if silent_check("synth", tree("stale", clean, debt="loc_9999  bogus\n")) == 0:
            fail("a stale/false names-debt entry did not BLOCK")
        # (B) a grounded loc_*.js FILE with NO ROUTINES entry and NO debt -> BLOCK (the widened file-level check).
        if silent_check("synth", tree("locfile", clean, loc_files=["loc_abcd"])) == 0:
            fail("a loc_*.js file with no ROUTINES entry and no names-debt did not BLOCK")
        # same file, debt-listed with a reason -> OK.
        if silent_check("synth", tree("locfiledebt", clean, debt="loc_abcd  dissolved loop tail, no standalone effect\n", loc_files=["loc_abcd"])) != 0:
            fail("a valid file-based names-debt entry did not clear the gate")
        # the real timeplt registry (enforced, not grandfathered): clean as committed; a grounded routine
        # renamed back to loc_, or a stray loc_ module, BLOCKS.
        real = "games/timeplt"
        if os.path.exists(f"{real}/idiomatic/names.js"):
            names = read_text(f"{real}/idiomatic/names.js")
            debt = read_text(f"{real}/names-debt.txt")
            locs = sorted(loc_module_files(real))
            if silent_check("timeplt", tree("tp", names, debt=debt, loc_files=locs)) != 0:
                fail("the committed timeplt registry did not pass un-grandfathered")
            mut = names.replace('name: "serviceEra2EnemyCraftSlot"', 'name: "loc_2984"', 1)
            if mut == names:
                fail("timeplt mutant: serviceEra2EnemyCraftSlot not found in names.js (vacuous mutant)")
            elif silent_check("timeplt", tree("tpmut", mut, debt=debt, loc_files=locs)) == 0:
                fail("timeplt with a grounded routine renamed back to loc_2984 did not BLOCK")
            if silent_check("timeplt", tree("tpstray", names, debt=debt, loc_files=locs + ["loc_9999"])) == 0:
                fail("timeplt with a stray idiomatic/loc_9999.js did not BLOCK")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    print("selftest OK" if ok else "selftest FAILED")
    return 0 if ok else 1


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("check")
    c.add_argument("--game", default=None)
    sub.add_parser("selftest")
    a = ap.parse_args()
    if a.cmd == "selftest":
        return selftest()
    return check(a.game) if a.game else check_all()


if __name__ == "__main__":
    sys.exit(main())
