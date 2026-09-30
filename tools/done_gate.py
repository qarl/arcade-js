#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""Definition-of-done gate - "done" means a named gate ran and passed, never "it looks finished".

A game is shippable only when EVERY completion subsystem is green under its own gate AND the adversarial
done-audit has landed as a committed games/<game>/DONE.md (runbook §5, reviewer-rule R40): subsystem-green
is the PRE-FILTER, never sufficient on its own. This runs the subsystems for one game and reports
per-subsystem; exit 0 iff all pass AND the DONE.md record is committed. It exists because frogger was
declared "done" three times over with grounding, registers, and audio all still open - each a
subsystem with no gate guarding the done-claim. Subsystems:
  idiomatic   - tools/idiomatic_gate.py: the idiomatic layer holds ZERO CPU/memory cruft — no
                registers, no m.call, no m.push*, no raw 0xHHHH addresses.
  grounding   - no ungrounded [code]/[guess] proposals remain in names.js (the registry).
  naming      - tools/naming_gate.py: every grounded idiomatic routine has a descriptive name, not loc_.
  comments    - tools/comment_gate.py floor: a cleaned game's idiomatic files carry verbose comments.
  audio       - tools/audio_gate.py: a wired, tested audio layer.
  pixel       - the game's idiomatic pixel suite matches MAME golden.
  whole-game  - the standing whole-game tests (boot/attract, tape, transition) pass.
Slow subsystems (pixel, suite) are fine: this is a ship-time gate, not per-commit. A subsystem whose
tooling is absent or errors is reported RED (fail-closed), never silently skipped.

Subcommands: check --game <game>; selftest; strict-report --game <game> (read-only R16 per-cell tag
accounting for any game, enrolled in STRICT_TAG_GAMES or not).
"""
import argparse
import glob
import json
import os
import re
import subprocess
import sys


def run(cmd):
    """Return (returncode, combined_output). rc=-1 on launch failure (fail-closed)."""
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=2400)
        return r.returncode, (r.stdout + r.stderr)
    except (OSError, subprocess.SubprocessError) as e:
        return -1, f"launch failed: {e}"


def check_idiomatic(game):
    rc, out = run(["python3", "tools/idiomatic_gate.py", "worklist", game])
    if rc != 0:
        return False, "idiomatic_gate worklist errored"
    m = re.search(rf"{re.escape(game)}:\s*total\s+(\d+)", out)
    if not m:
        return False, "could not read idiomatic cruft count"
    n = int(m.group(1))
    return (n == 0), (f"{n} CPU/memory cruft refs remain (registers + m.call + m.push* + raw 0xHHHH)"
                      if n else "0 cruft — the layer is idiomatic")


FIRST_TAG = re.compile(r"\[(seen|code|guess)\]")
GND_ARROW = re.compile(r"\[code\]\s*(?:->|→)\s*\[seen\]")  # "was [code], now [seen]" = grounded
CERT_ANY = re.compile(r'\bcert:\s*"')                       # a ROUTINES entry line (graded by its cert field)
CERT_UNGROUNDED = re.compile(r'\bcert:\s*"(code|guess)"')   # an ungrounded routine
CELL_CONST = re.compile(r"^export const [A-Z0-9_]+\s*=\s*(0x[0-9a-f]+)\s*;")  # a named cell -> its address
ROUT_ADDR = re.compile(r"^\s*(0x[0-9a-f]+):")                                  # a ROUTINES entry -> its address


def _line_ungrounded(ln):
    # Evidence = the FIRST bracketed tag; [code]/[guess] there = ungrounded (the `[code] not [seen]`
    # idiom keeps [code] first, so a trailing [seen] must NOT exempt). Skip the legend + [code]->[seen].
    # A `//` line comment (a section divider `// == Batch ... [code] ==` or prose) is NEVER a cell's
    # JSDoc tag -- a cell tag lives in a /** ... */ block -- so its stray [code] has no cell and must
    # not be counted as one (else the divider is a phantom ungrounded cell that can never be grounded).
    if ln.lstrip().startswith("//"):
        return False
    if "evidence tag" in ln or GND_ARROW.search(ln):
        return False
    m = FIRST_TAG.search(ln)
    return bool(m and m.group(1) in ("code", "guess"))


def _count_grounding(lines):
    # Two kinds of claim in names.js, graded by DIFFERENT signals: a CELL by the [code]/[guess]/[seen]
    # bracket tag in its JSDoc; a ROUTINE by its ROUTINES-entry `cert:` field (which carries no bracket
    # tag). Count them separately -- a cert line is a routine even if its role prose holds a stray tag.
    # Also collect each ungrounded item's ADDRESS (a cell's is on the `export const` line below its
    # JSDoc; a routine's is on the cert line) so check_grounding can subtract the accounted-for allowlist.
    cells = routines = 0
    cell_addrs, rout_addrs = [], []
    # A ROUTINES entry may be MULTI-LINE (`0xADDR: {` opens it, `cert:` sits on a later line), so the
    # cert line itself carries no address. Track the enclosing entry opener and use it as the address
    # fallback -- else the entry counts as ungrounded but is un-allowlistable (grounding-debt can't
    # subtract an addr the counter reports as None, and check_grounding wrongly flags such debt "stale").
    entry_opener = re.compile(r"^\s*(0x[0-9a-fA-F]+)\s*:\s*\{")
    cur_entry = None
    for i, ln in enumerate(lines):
        om = entry_opener.match(ln)
        if om:
            cur_entry = int(om.group(1), 16)
        if CERT_ANY.search(ln):
            if CERT_UNGROUNDED.search(ln):
                routines += 1
                m = ROUT_ADDR.match(ln)
                rout_addrs.append(int(m.group(1), 16) if m else cur_entry)
        elif _line_ungrounded(ln):
            cells += 1
            a = None
            # An INLINE tag (`export const X = 0xADDR; // [code] ...`) carries the address on its OWN line;
            # a JSDoc-block tag sits above the const, so scan forward for it. Prefer the self match.
            mc_self = CELL_CONST.match(ln)
            if mc_self:
                a = int(mc_self.group(1), 16)
            else:
                for j in range(i + 1, min(i + 8, len(lines))):
                    mc = CELL_CONST.match(lines[j])
                    if mc:
                        a = int(mc.group(1), 16)
                        break
            cell_addrs.append(a)
    return cells, routines, cell_addrs, rout_addrs


def _read_grounding_debt(game):
    # games/<game>/grounding-debt.txt accounts for the honestly-IRREDUCIBLE ungrounded items -- a role
    # that can never terminate in a MAME observation on a good ROM (an anti-tamper clone that runs only on
    # a tampered ROM; a ROM constant read only by the checksum sweep). One "0xADDR  reason" per line
    # (# comments / blank lines ignored). done_gate SUBTRACTS these so the gate enforces the runbook's
    # "accounted-for by a reasoned note" rule -- and stays honest: a reasonless entry, or one whose address
    # is NOT actually ungrounded, BLOCKS (check_grounding). Each entry is reviewer-verified as genuinely
    # irreducible, proposer != confirmer (reviewer-rules R39).
    path = f"games/{game}/grounding-debt.txt"
    debt = {}
    if not os.path.exists(path):
        return debt
    for ln in open(path, encoding="utf-8", errors="replace"):
        ln = ln.split("#", 1)[0].strip()
        if not ln:
            continue
        parts = ln.split(None, 1)
        try:
            a = int(parts[0], 16)
        except ValueError:
            continue
        debt[a] = parts[1].strip() if len(parts) > 1 else ""
    return debt


# ---- strict per-cell tag mode (reviewer-rules R16, runbook §4) --------------------------------------
# The legacy counter above grades TAGS it happens to see: a cell with NO tag is invisible to it, so a
# names.js with hundreds of unrated cells reads "fully grounded". R16 is the opposite contract: every
# `export const NAME = 0x…` carries a rating in ITS OWN comment -- its inline `// …` or the /** … */ block
# directly above it; a `//` section header never counts. Opt-in per game (like idiomatic_gate TIGHT_GAMES)
# so enrolling a game is a deliberate, reviewed step, never a silent reddening of a shipped game's status.
STRICT_TAG_GAMES = {"timeplt"}
STRICT_CONST = re.compile(r"^export const ([A-Za-z_$][\w$]*)\s*=\s*(0x[0-9a-fA-F]+)\s*;")
ROUTINE_ALIAS = re.compile(r"^[a-z][A-Za-z0-9]*_ADDR$")   # <routineName>_ADDR: a code address used as a value


def _own_tag(text):
    """Evidence grade of a cell's own comment text, or None if untagged. Fail-closed across the WHOLE text:
    ANY [code]/[guess] anywhere in it wins (the first such), even after a leading [seen] -- a trailing
    "...; the X role is [code]" clause is an ungrounded claim, not a grounded cell. The completion arrow
    `[code]->[seen]` (or `→`) is rewritten to [seen] FIRST, so a promotion record still counts as seen."""
    tags = FIRST_TAG.findall(GND_ARROW.sub("[seen]", text))
    for t in tags:
        if t in ("code", "guess"):
            return t
    return "seen" if tags else None


def _strict_cells(lines):
    """Every `export const NAME = 0x…` cell with its OWN tag. Returns (cells, aliases): cells is a list of
    (name, addr, tag|None); aliases the <routine>_ADDR consts whose address IS a ROUTINES key -- those are
    graded by that routine's cert (counted as a routine), so they are not cells. An _ADDR alias whose
    address is NOT a ROUTINES entry has no cert to inherit and is graded as a cell (fail-closed)."""
    rkeys, in_rout = set(), False
    for ln in lines:
        if ln.startswith("export const ROUTINES"):
            in_rout = True
            continue
        if in_rout:
            if ln.startswith("};"):
                in_rout = False
                continue
            m = re.match(r"^\s*(0x[0-9a-fA-F]+)\s*:", ln)
            if m:
                rkeys.add(int(m.group(1), 16))
    cells, aliases = [], []
    for i, ln in enumerate(lines):
        m = STRICT_CONST.match(ln)
        if not m:
            if re.match(r"^export const [A-Za-z_$][\w$]*\s*=\s*(0x|$)", ln):  # multi-line/compound hex const: fail-closed
                cells.append((ln.split()[2].split("=")[0], None, None))
            continue
        name, addr = m.group(1), int(m.group(2), 16)
        if ROUTINE_ALIAS.match(name) and addr in rkeys:
            aliases.append((name, addr))
            continue
        tags = []
        rest = ln[m.end():]
        if "//" in rest:                                   # inline comment on the const line
            tags.append(_own_tag(rest.split("//", 1)[1]))
        j = i - 1                                          # the /** … */ block directly above (blank lines ok)
        while j >= 0 and not lines[j].strip():
            j -= 1
        if j >= 0 and lines[j].rstrip().endswith("*/"):
            k = j
            while k >= 0 and "/*" not in lines[k]:
                k -= 1
            block = "".join(lines[max(k, 0):j + 1])
            if "evidence tag" not in block:                # the file legend is nobody's own comment
                tags.append(_own_tag(block))
        tags = [t for t in tags if t]
        if not tags:
            tag = None
        elif any(t in ("code", "guess") for t in tags):    # fail-closed: any own [code]/[guess] wins
            tag = next(t for t in tags if t in ("code", "guess"))
        else:
            tag = "seen"
        cells.append((name, addr, tag))
    return cells, aliases


def _strict_grounding(lines, debt):
    """Strict R16 accounting. Returns a dict: untagged (names), code/guess (names), debt-covered (names),
    ungrounded cell count, alias count. Untagged cells are ungrounded REGARDLESS of grounding-debt.txt
    (R16: every cell carries a rating, no exception); a [code]/[guess] cell is subtracted iff its address
    is a debt entry."""
    cells, aliases = _strict_cells(lines)
    r = {"total": len(cells), "aliases": len(aliases), "untagged": [], "code": [], "guess": [],
         "debt_covered": [], "seen": 0, "ung_addrs": set()}
    for name, addr, tag in cells:
        if tag is None:
            r["untagged"].append(name)
        elif tag == "seen":
            r["seen"] += 1
        else:
            r["ung_addrs"].add(addr)
            (r["debt_covered"] if addr in debt else r[tag]).append(name)
    r["ungrounded"] = len(r["untagged"]) + len(r["code"]) + len(r["guess"])
    return r


def check_grounding(game):
    # names.js (the registry) is the authoritative grounding artifact; mechanisms.md `[code]` are
    # accounted-for prose, not counted here. grounding-debt.txt subtracts the honestly-irreducible tail.
    path = f"games/{game}/idiomatic/names.js"
    if not os.path.exists(path):
        return False, "no names.js"
    lines = open(path, encoding="utf-8", errors="replace").readlines()
    cells, routines, cell_addrs, rout_addrs = _count_grounding(lines)
    debt = _read_grounding_debt(game)
    noreason = sorted(a for a, r in debt.items() if not r)
    if noreason:
        return False, "grounding-debt.txt: entries need a reason -> " + ", ".join(hex(a) for a in noreason)
    if game in STRICT_TAG_GAMES:
        return _check_grounding_strict(lines, rout_addrs, debt)
    ung = {a for a in cell_addrs + rout_addrs if a is not None}
    stale = sorted(set(debt) - ung)
    if stale:
        return False, ("grounding-debt.txt: stale (already-grounded / not an ungrounded claim) -> "
                       + ", ".join(hex(a) for a in stale))
    acc_cells = sum(1 for a in cell_addrs if a is not None and a in debt)
    acc_rout = sum(1 for a in rout_addrs if a is not None and a in debt)
    rem_cells, rem_rout = cells - acc_cells, routines - acc_rout
    acc = acc_cells + acc_rout
    tail = f" ({acc} accounted-for via grounding-debt.txt)" if acc else ""
    if rem_cells + rem_rout == 0:
        return True, "fully grounded" + tail
    return False, f"{rem_cells} ungrounded cells + {rem_rout} ungrounded routines" + tail


def _check_grounding_strict(lines, rout_addrs, debt):
    # STRICT_TAG_GAMES: cells graded per-cell (R16) by _strict_grounding; routines by the same cert rule.
    st = _strict_grounding(lines, debt)
    stale = sorted(set(debt) - st["ung_addrs"] - {a for a in rout_addrs if a is not None})
    if stale:
        return False, ("grounding-debt.txt: stale (not a [code]/[guess] cell or ungrounded routine) -> "
                       + ", ".join(hex(a) for a in stale))
    acc_rout = sum(1 for a in rout_addrs if a is not None and a in debt)
    rem_rout = len(rout_addrs) - acc_rout
    acc = acc_rout + len(st["debt_covered"])
    tail = f" ({acc} accounted-for via grounding-debt.txt)" if acc else ""
    if st["ungrounded"] + rem_rout == 0:
        return True, "fully grounded, every cell carries its own tag [strict R16]" + tail
    detail = (f"{st['ungrounded']} ungrounded cells ({len(st['untagged'])} untagged, {len(st['code'])} [code], "
              f"{len(st['guess'])} [guess]) + {rem_rout} ungrounded routines [strict R16]" + tail)
    for label in ("untagged", "code", "guess"):
        if st[label]:
            detail += f"\n      {label}: " + " ".join(st[label])
    return False, detail


def strict_report(game):
    """Read-only: the strict R16 cell accounting for ANY game (enrolled or not) -- the rollout measurement."""
    path = f"games/{game}/idiomatic/names.js"
    if not os.path.exists(path):
        print(f"{game}: no names.js"); return 1
    st = _strict_grounding(open(path, encoding="utf-8", errors="replace").readlines(),
                           _read_grounding_debt(game))
    print(f"{game}: cells={st['total']} seen={st['seen']} untagged={len(st['untagged'])} "
          f"code={len(st['code'])} guess={len(st['guess'])} debt-covered={len(st['debt_covered'])} "
          f"routine-aliases-excluded={st['aliases']} strict={'yes' if game in STRICT_TAG_GAMES else 'no'}")
    for label in ("untagged", "code", "guess", "debt_covered"):
        for n in st[label]:
            print(f"  {label} {n}")
    return 0


def check_audio(game):
    rc, out = run(["python3", "tools/audio_gate.py", "check", "--game", game])
    line = out.strip().splitlines()[-1] if out.strip() else ""
    return (rc == 0), line[:120]


def check_pixel(game):
    # The DONE gate runs the FULL pixel path (--done), NOT the bare attract-prefix default the per-commit
    # tripwire (tools/pixel_gate_required.py) runs: --done adds attract COMPLETENESS past the former crash
    # frames + tape-driven GAMEPLAY vs the MAME golden, closing the green-but-blind hole where gameplay was
    # pixel-validated NOWHERE (runbook 5: an attract-only gate must NOT count green for done). PASS is the
    # literal `pixel_suite: PASS` line, never the exit code (the suite exits 0 when it CANNOT run -- no
    # mame/romset); a suite that does not accept --done is a stale attract-only gate and must not pass.
    suite = f"games/{game}/tools/pixel_suite.py"
    if not os.path.exists(suite):
        return False, "no pixel_suite.py"
    # DISTANT-STATE TAPES FIRST, on BOTH branches below (a legacy game is NOT excused from them): every
    # games/<g>/tapes/*.poke.json through the game's distant_suite.py on the shipped layer. Red on any
    # tape short of its own literal `distant_suite: PASS -- <name>` line (SKIP/INCOMPLETE/FAIL/crash).
    ok, dnote = check_distant(game)
    if not ok:
        return False, dnote
    # Legacy pre-runbook ports (runbook "Legacy games": do not retrofit) are grandfathered on the attract
    # pixel gate; the --done gameplay bar is the go-forward standard for games ported under the runbook.
    LEGACY_ATTRACT_ONLY = {"timeplt", "thepit"}
    if "--done" not in open(suite, encoding="utf-8", errors="replace").read():
        if game not in LEGACY_ATTRACT_ONLY:
            return False, "pixel_suite.py has no --done mode (attract-only gate is blind to gameplay)"
        rc, out = run(["python3", suite, "--layer", "idiomatic"])
        ok = rc == 0 and re.search(r"^pixel_suite: PASS", out, re.M) is not None
        return ok, (f"PASS (legacy attract-only, grandfathered; {dnote})" if ok else "pixel suite FAILED")
    rc, out = run(["python3", suite, "--layer", "idiomatic", "--done"])
    passed = rc == 0 and re.search(r"^pixel_suite: PASS", out, re.M) is not None
    if passed:
        return True, f"PASS (--done: attract completeness + gameplay vs MAME; {dnote})"
    last = next((ln for ln in reversed(out.splitlines()) if ln.strip()), "")
    return False, "pixel --done FAILED: " + last[:90]


def check_distant(game):
    """(ok, detail) for every distant-state tape of `game`; ok with a note when it has none."""
    dsuite = f"games/{game}/tools/distant_suite.py"
    tapes = sorted(glob.glob(f"games/{game}/tapes/*.poke.json"))
    if not os.path.exists(dsuite):
        return True, "no distant_suite.py"
    if not tapes:
        return False, "distant_suite.py exists but no tapes/*.poke.json"
    for t in tapes:
        try:
            with open(t, encoding="utf-8") as fh:
                name = json.load(fh).get("name")
        except (OSError, ValueError) as e:
            return False, f"distant tape {t} unreadable: {e}"
        rc, out = run(["python3", dsuite, "--schedule", t, "--layer", "idiomatic"])
        pat = r"^distant_suite: PASS -- " + re.escape(str(name)) + r"$"
        if rc != 0 or re.search(pat, out, re.M) is None:
            last = next((ln for ln in reversed(out.splitlines()) if ln.strip()), "")
            return False, f"distant tape {os.path.basename(t)} not PASS: " + last[:80]
    return True, "distant tapes PASS"


def check_wholegame(game):
    tests = sorted(glob.glob(f"games/{game}/test/*.test.js"))
    standing = [t for t in tests if re.search(r"(idiomatic|tape|transition)\.test\.js$", t)]
    if not standing:
        return False, "no standing whole-game tests found"
    rc, out = run(["node", "--test", *standing])
    return (rc == 0), ("PASS" if rc == 0 else "whole-game tests FAILED")


def check_wiring(game):
    """The repo-wide wiring invariants: every idiomatic module is DISPATCHED (registry-coverage), no
    idiomatic routine m.call()s an already-decompiled callee (no-stale-mcall), and no idiomatic module
    imports+calls the FROZEN copy of a routine that has an idiomatic twin (no-frozen-twin-call). These
    live in tools/test/, OUTSIDE the game tree, so check_wholegame's games/<g>/test glob never reaches
    them -- a done-authority that omits wiring is a check that cannot fail at the top of the stack, and
    every one of them runs the idiomatic layer as designed only if the wiring is sound. The gates are
    repo-wide (they discover their own games), so a wiring break in ANY game blocks the ship: the
    invariant is global, not per-game."""
    gates = ["registry-coverage", "no-stale-mcall", "no-frozen-twin-call"]
    for g in gates:
        path = f"tools/test/{g}.test.js"
        if not os.path.exists(path):
            return False, f"missing wiring gate {g}"
        rc, _ = run(["node", "--test", path])
        if rc != 0:
            return False, f"wiring gate {g} FAILED"
    return True, "PASS (registry-coverage, no-stale-mcall, no-frozen-twin-call)"


def check_naming(game):
    """Every grounded (cert:"seen") idiomatic ROUTINE must carry a descriptive EFFECT name, not loc_<addr>
    (runbook §4-end cleanup: it RENAMES loc_->descriptive leaf-first, it does not only comment). Enforced by
    tools/naming_gate.py -- legacy pre-runbook ports grandfathered; a reviewed games/<game>/names-debt.txt
    allowlist subtracts a genuinely-effect-unnameable routine. Wired here so a game cannot reach DONE while
    the RENAME half of the cleanup is skipped -- the exact gap that once let a sweep ship comment-only."""
    rc, out = run(["python3", "tools/naming_gate.py", "check", "--game", game])
    summary = next((ln for ln in out.splitlines() if ln.startswith(f"naming [{game}]:")), "")
    detail = summary.split(":", 1)[1].strip() if summary else ("PASS" if rc == 0 else "grounded loc_ routines remain")
    return (rc == 0), detail[:120]


def check_comment_floor(game):
    """The COMMENT half of the §4-end cleanup, symmetric to check_naming's RENAME half: every idiomatic
    file of a cleaned (idiomaticComplete) game must carry verbose comments (>= code // 2 + 3 lines).
    Enforced by tools/comment_gate.py floor; a reviewed games/<game>/comment-debt.txt allowlist subtracts a
    genuinely-trivial file. Wired here because the density CAP steps aside for idiomaticComplete games with
    nothing then requiring the comments -- the exact gap that let invaders ship DONE at a 0.27 comment ratio."""
    rc, out = run(["python3", "tools/comment_gate.py", "floor", "--game", game])
    line = next((ln for ln in out.splitlines() if ln.strip()), "")
    detail = re.sub(rf"^comment_gate floor \[{re.escape(game)}\]:\s*", "", line) or (
        "OK" if rc == 0 else "idiomatic files below the comment floor")
    return (rc == 0), detail[:120]


def check_browser(game):
    """The web-worker boot the shared player runs -- construction via the SAME factory (web/machine-factory.js)
    the worker uses, worker-form input keying, a rendered NON-uniform frame, and a live sound seam -- exercised
    in node (web/test/games-boot.test.js). This is the class every OTHER gate is blind to: none construct the
    board Inputs or boot the worker loop, so a game passed everything and was UNPLAYABLE (invaders: no Inputs
    export; galaxian: black screen from a gfx key + an input crash-loop). Wired here so DONE fail-closes on it
    BEFORE the R40 DONE.md lands. Node CANNOT exercise the browser audio/canvas RUNTIME (the galaxian synth-404
    + Safari 0-input bugs were runtime-only), so a human browser confirm remains a DONE step; this gate covers
    construction/render/seam. A SKIP (ROM absent / §2 skeleton) is NOT verified -> RED."""
    rc, out = run(["node", "--test", "--test-reporter", "tap", "web/test/games-boot.test.js"])
    line = next((ln for ln in out.splitlines() if re.search(rf" - {re.escape(game)}: boots", ln)), "")
    if line.startswith("ok") and "skip" not in line.lower():
        return True, "PASS (worker-form construct+render+input+sound seam; browser runtime = human confirm)"
    if "skip" in line.lower():
        return False, "games-boot SKIPPED (ROM absent or §2 skeleton) -- browser boot NOT verified"
    return False, "games-boot FAILED (worker-form boot broke)"


SUBSYSTEMS = [
    ("idiomatic", check_idiomatic),
    ("wiring", check_wiring),
    ("grounding", check_grounding),
    ("naming", check_naming),
    ("comments", check_comment_floor),
    ("audio", check_audio),
    ("pixel", check_pixel),
    ("whole-game", check_wholegame),
    ("browser", check_browser),
]


def done_record_committed(game, tracked=None):
    """True iff games/<game>/DONE.md is a COMMITTED (git-tracked) file -- the landed, reviewer-verified
    adversarial done-audit (runbook §5, reviewer-rule R40). review_gate refuses that commit without an
    independent PASS, so a committed record IS the proof an independent agent agreed the game is done; a
    green pre-filter alone is never sufficient. An untracked working-tree DONE.md has not passed review,
    so it does not count. `tracked` is a test seam (a set of paths) that bypasses git."""
    path = f"games/{game}/DONE.md"
    if tracked is not None:
        return path in tracked
    rc, _ = run(["git", "ls-files", "--error-unmatch", path])
    return rc == 0


def check(game):
    print(f"definition-of-done [{game}]:")
    all_ok = True
    for name, fn in SUBSYSTEMS:
        ok, detail = fn(game)
        all_ok = all_ok and ok
        print(f"  [{'OK ' if ok else 'RED'}] {name:<11} {detail}")
    if not all_ok:
        print(f"\n{game}: NOT DONE — a subsystem gate is red (above). The ship is refused.", file=sys.stderr)
        return 1
    if done_record_committed(game):
        print(f"\n{game}: DONE — every subsystem gate passed and the adversarial done-audit is on "
              f"record (games/{game}/DONE.md).")
        return 0
    print(f"\n{game}: NOT DONE — subsystem gates are green (pre-filter), but no committed "
          f"games/{game}/DONE.md: the adversarial done-audit (runbook §5, reviewer-rule R40) has not "
          f"landed. A green pre-filter is necessary, never sufficient.", file=sys.stderr)
    return 1


def selftest():
    # the register-count regex and the grounding legend/proposal split are the only non-shell logic.
    ok = True
    if not re.search(r"register-elimination:\s*(\d+)\s+references", "register-elimination: 12 references across 3 modules"):
        print("selftest FAIL: register count regex", file=sys.stderr); ok = False
    cases = [
        (" * Names carry an evidence tag: [code] understood ...; [seen] observed", False),  # legend
        ('  role: "does X. [code] not [seen]: readers agree",', True),   # trailing [seen] must NOT exempt
        ('  role: "[code] (axis per the [seen] block)",', True),         # [code] first, [seen] justifies
        ('  role: "does X", cert: "seen",', False),                      # grounded
        ('  // 0x80 was [code]->[seen] once the tap fired', False),      # completion arrow
        ('  mem8[x] = 1;', False),                                       # no tag
        ('// == Batch: leaves-first decompile cells [code] (pending) ==', False),  # phantom divider
        ('// observation ...; [code] role read from the translated', False),       # phantom prose
        ('/** [code] a real ungrounded cell */', True),                 # a genuine JSDoc cell tag
    ]
    for ln, exp in cases:
        if _line_ungrounded(ln) != exp:
            print(f"selftest FAIL: grounding {ln!r} -> {_line_ungrounded(ln)} want {exp}", file=sys.stderr); ok = False
    # the cells/routines split + address extraction: a cell is graded by its bracket tag (address on the
    # export const below it), a routine by its cert field (address on the cert line).
    cells, routines, cell_addrs, rout_addrs = _count_grounding([
        "/** [code] (unobservable) FOO bias */",                             # ungrounded cell
        "export const FOO = 0x8800;",
        "/** [seen] (golden: 0->1 at f302) BAR credit */",                   # grounded cell
        '  0x0714: { name: "loc_0714", role: "copy loop", cert: "code" },',  # ungrounded routine
        '  0x0a25: { name: "loc_0a25", role: "tile paint", cert: "seen" },', # grounded routine
    ])
    if (cells, routines, cell_addrs, rout_addrs) != (1, 1, [0x8800], [0x0714]):
        print(f"selftest FAIL: grounding split -> {(cells, routines, cell_addrs, rout_addrs)} "
              "want (1, 1, [0x8800], [0x0714])", file=sys.stderr); ok = False
    # accounting: a grounding-debt entry subtracts an ungrounded item by ADDRESS (0x8800 here -> 1 accounted).
    if sum(1 for a in cell_addrs + rout_addrs if a in {0x8800}) != 1:
        print("selftest FAIL: grounding accounting arithmetic", file=sys.stderr); ok = False
    # strict R16 per-cell tags (STRICT_TAG_GAMES): drive the REAL check_grounding over a synthetic game, once
    # enrolled and once not. Each case names the cell it is about; the untagged list must name it.
    import tempfile
    strict_src = [
        "/**\n", " * legend: every name carries an evidence tag: [seen] [code] [guess]\n", " */\n", "\n",
        "export const UNTAGGED_CELL = 0xa001;\n",                            # (a) no tag at all
        "// ── Section header [seen]\n",
        "export const HEADER_ONLY_CELL = 0xa002; // role prose, no tag\n",   # (b) tag only on a // header
        "/** [seen] watched under MAME */\n",
        "export const SEEN_CELL = 0xa003;\n",                                # (c) own JSDoc [seen]
        "export const SEEN_INLINE = 0xa004; // [seen] watched\n",           # (c') own inline [seen]
        "/**\n", " * [code] role read from the routines\n", " */\n",
        "export const DEBT_CELL = 0xa005;\n",                                # (d) own [code], debt-covered
        "export const fooBar_ADDR = 0x1234; // entry address of routine 0x1234\n",  # routine alias
        "export const ROUTINES = {\n", '  0x1234: { name: "fooBar", role: "r", cert: "seen" },\n', "};\n",
    ]
    real_strict, cwd = set(STRICT_TAG_GAMES), os.getcwd()
    with tempfile.TemporaryDirectory() as root:
        os.makedirs(os.path.join(root, "games", "sg", "idiomatic"))
        with open(os.path.join(root, "games", "sg", "idiomatic", "names.js"), "w") as fh:
            fh.writelines(strict_src)
        with open(os.path.join(root, "games", "sg", "grounding-debt.txt"), "w") as fh:
            fh.write("0xa005  [anti-tamper] test reason\n")
        try:
            os.chdir(root)
            STRICT_TAG_GAMES.discard("sg")
            ok_legacy, det_legacy = check_grounding("sg")                  # (e) not enrolled -> legacy verdict
            STRICT_TAG_GAMES.add("sg")
            ok_s, det_s = check_grounding("sg")
            st = _strict_grounding(strict_src, {0xa005: "r"})
            st_nodebt = _strict_grounding(strict_src, {})
        finally:
            STRICT_TAG_GAMES.clear(); STRICT_TAG_GAMES.update(real_strict)
            os.chdir(cwd)
    for label, got, want in [
        ("(e) non-strict game keeps the legacy verdict", (ok_legacy, det_legacy),
         (True, "fully grounded (1 accounted-for via grounding-debt.txt)")),
        ("strict game is red", ok_s, False),
        ("(a) untagged cell counted + named", "UNTAGGED_CELL" in st["untagged"], True),
        ("(b) //-header-only cell counted + named", "HEADER_ONLY_CELL" in st["untagged"], True),
        ("(a)+(b) listed in the failure output", all(n in det_s for n in ("UNTAGGED_CELL", "HEADER_ONLY_CELL")), True),
        ("(c) [seen] cells not counted", any(n in det_s for n in ("SEEN_CELL", "SEEN_INLINE")), False),
        ("(d) debt-covered [code] cell not counted", ("DEBT_CELL" in st["debt_covered"], st["ungrounded"]), (True, 2)),
        ("(d') same [code] cell without debt IS counted", ("DEBT_CELL" in st_nodebt["code"], st_nodebt["ungrounded"]), (True, 3)),
        ("routine alias graded by its ROUTINES cert, not as a cell", (st["aliases"], st["total"]), (1, 5)),
    ]:
        if got != want:
            print(f"selftest FAIL: strict grounding {label} -> {got!r} want {want!r}", file=sys.stderr); ok = False
    # fail-closed edges: an _ADDR alias with NO ROUTINES entry is a cell; a debt entry cannot excuse an
    # UNTAGGED cell (R16: rated first) -- it is reported stale instead.
    if _strict_cells(["export const orphan_ADDR = 0x9999;\n"]) != ([("orphan_ADDR", 0x9999, None)], []):
        print("selftest FAIL: strict grounding orphan _ADDR alias not graded as a cell", file=sys.stderr); ok = False
    if _strict_cells(["/** [code] from the routines */\n", "export const MIX = 0xa006; // [seen]\n"])[0] != [("MIX", 0xa006, "code")]:
        print("selftest FAIL: strict grounding an own [seen] masked an own [code] (fail-closed precedence)", file=sys.stderr); ok = False
    # mixed tags in ONE own comment (R40 timeplt OPEN 1): a leading [seen] must not mask a later [code]/[guess]
    # clause, inline or in the JSDoc block; the `[code]->[seen]` promotion arrow alone still reads seen.
    for label, src, want in [
        ("inline '[seen] ... [code]'", ["export const MI = 0xa007; // [seen] values; the reader role is [code]\n"], "code"),
        ("JSDoc '[seen] ... [code]'", ["/**\n", " * X byte. [seen]\n", " * Values [seen]; the reader role is [code].\n", " */\n",
                                        "export const MJ = 0xa008;\n"], "code"),
        ("JSDoc '[seen] ... [guess]'", ["/** [seen] block; the role is [guess] */\n", "export const MG = 0xa009;\n"], "guess"),
        ("'[code]->[seen]' promotion", ["/** [seen] (MAME: [code]->[seen]. read at PC 0x2231) */\n", "export const MP = 0xa00a;\n"], "seen"),
        ("'[code] → [seen]' promotion (arrow glyph)", ["export const MQ = 0xa00b; // lifted [code] → [seen] by capture\n"], "seen"),
    ]:
        got = _strict_cells(src)[0][0][2]
        if got != want:
            print(f"selftest FAIL: strict grounding mixed own tags {label} -> {got!r} want {want!r}", file=sys.stderr); ok = False
    ok_u, det_u = _check_grounding_strict(["export const U = 0xa001;\n"], [], {0xa001: "r"})
    if ok_u or "stale" not in det_u:
        print(f"selftest FAIL: strict grounding debt excused an untagged cell -> {det_u!r}", file=sys.stderr); ok = False
    # done-record: subsystem-green is only the PRE-FILTER; "done" also needs a COMMITTED DONE.md. The
    # helper counts a record only when git-tracked (an untracked working-tree DONE.md has not been reviewed).
    if not done_record_committed("x", tracked={"games/x/DONE.md"}):
        print("selftest FAIL: done_record_committed missed a tracked DONE.md", file=sys.stderr); ok = False
    if done_record_committed("x", tracked=set()):
        print("selftest FAIL: done_record_committed counted an absent DONE.md", file=sys.stderr); ok = False
    # check_distant: every tape needs ITS OWN anchored PASS line; SKIP, the header, another tape's
    # PASS, or PASS-then-crash is red. Drives the real function over a synthetic game dir.
    import tempfile
    global run
    real_run, cwd = run, os.getcwd()
    with tempfile.TemporaryDirectory() as root:
        os.makedirs(os.path.join(root, "games", "g", "tapes"))
        os.makedirs(os.path.join(root, "games", "g", "tools"))
        with open(os.path.join(root, "games", "g", "tapes", "t1.poke.json"), "w") as fh:
            json.dump({"name": "t1"}, fh)
        try:
            os.chdir(root)
            ok_none = check_distant("g")[0]  # no distant_suite.py yet -> nothing to run
            open(os.path.join("games", "g", "tools", "distant_suite.py"), "w").close()
            for label, fake, want in [
                ("PASS (control)", (0, "distant_suite: tape t1 -- d\ndistant_suite: PASS -- t1\n"), True),
                ("SKIP exit 0", (0, "distant_suite: SKIP -- no `mame` on PATH\n"), False),
                ("header only", (0, "distant_suite: tape t1 -- d\n"), False),
                ("another tape's PASS", (0, "distant_suite: PASS -- t2\n"), False),
                ("PASS then exit 1", (1, "distant_suite: PASS -- t1\n"), False),
            ]:
                run = lambda cmd, fake=fake: fake
                if check_distant("g")[0] != want:
                    print(f"selftest FAIL: check_distant {label} -> want {want}", file=sys.stderr); ok = False
        finally:
            run = real_run
            os.chdir(cwd)
    if not ok_none:
        print("selftest FAIL: check_distant red for a game with no distant_suite.py", file=sys.stderr); ok = False
    print("selftest OK" if ok else "selftest FAILED")
    return 0 if ok else 1


def main():
    ap = argparse.ArgumentParser(description="Definition-of-done gate: every subsystem must pass.")
    ap.add_argument("cmd", choices=("check", "selftest", "strict-report"))
    ap.add_argument("--game", default="frogger")
    args = ap.parse_args()
    if args.cmd == "strict-report":
        return strict_report(args.game)
    return selftest() if args.cmd == "selftest" else check(args.game)


if __name__ == "__main__":
    sys.exit(main())
