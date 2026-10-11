#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""Names-consistency gate - names.js is the single source of truth for whether a work-RAM
cell is named; no prose may contradict it. Two rules, both under `check`:

  (A) PROSE-vs-registry: no staged clause may call a names.js-NAMED work-RAM cell hex/unnamed.
      Binds to the INDEX, runs per staged game; checks mechanisms.md (all lines) and idiomatic
      routine files (comment lines only). Block- then clause-scoped: a run of relevant lines is
      joined (so a claim wrapped across a line-break is caught), split into clauses, and a named
      address is flagged only if its clause does NOT also spell that address's registry name (so
      an honest raw/different-role use ("BOARD_MODE (0x8057), reused raw") passes). The work-RAM
      window is DERIVED per game (manifest board -> boards/<board>/memory.js WORK_RAM_BASE/SIZE),
      never hardcoded: a hardcoded 0x8000-0x87FF once matched nothing for DK (0x6000-0x6BFF) and
      the gate passed while inspecting nothing.

  (B) IDIOMATIC loc_ CELL rule (reviewer-rules.md R31): per Karl's cell-naming rule a role-UNDERSTOOD
      cell owes a DESCRIPTIVE name and only a role-UNKNOWN cell may take a `loc_<addr>` name -- and then
      only as an enumerated (game, addr) entry in tools/names-debt.txt, so a top-level
      `export const loc_<hex> = 0x<hex>;` NOT on that allowlist is a violation. Scans the WORKING
      TREE across ALL games (not just staged); routine modules and ROUTINES-map entries are out
      of scope. The allowlist is tools/names-debt.txt
      - each non-blank, non-`#` line exactly `<game> 0x<addr>`, a shrinking set; fail-closed if
      that file is missing or malformed.

  (C) TAG rule: in an enrolled game (TAG_GAMES), every `NAME [tag]` citation in an idiomatic routine's
      comments -- whole-line or trailing -- names a names.js cell or ROUTINES entry, and its tag equals that
      entry's own tag (a cell's JSDoc/inline tag, a routine's cert). A tag the prose carries is a COPY of the
      registry's; a stale copy is a contradiction. In a HEADER_GAMES game, every ROUTINES module's header
      also names the routine's own ROM address and carries its cert as a `[tag]`. Binds to the INDEX, per
      staged game.

Fail-closed on any git error. Rules (A) and (C) are VACUOUS when no games/ file is staged; trailing
comments escape is_comment() so rule (A) never scans them. Subcommands: check (the hook), tags --game <g>
(rule C on the working tree, for done_gate), selftest (fixtures for rules B and C).
"""
import functools
import glob
import os
import re
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import done_gate  # noqa: E402  (the strict R16 per-cell tag reader is the one definition of a cell's tag)


class GitError(RuntimeError):
    """A git invocation failed — callers turn this into a BLOCK (fail closed)."""


def git(args):
    r = subprocess.run(["git", *args], capture_output=True, text=True)
    if r.returncode != 0:
        raise GitError(r.stderr.strip() or f"git {' '.join(args)} failed")
    return r.stdout


def repo_root():
    r = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True)
    if r.returncode != 0 or not r.stdout.strip():
        raise GitError(r.stderr.strip() or "not inside a git work tree")
    return r.stdout.strip()


@functools.lru_cache(maxsize=None)  # one process sees one index; rules (A) and (C) read the same modules
def blob(ref, path):
    """Staged (ref=':0') or committed (ref='HEAD') content, or '' if absent. Use ':0' not ':' - a bare ':' would make a broken '::path'."""
    r = subprocess.run(["git", "show", f"{ref}:{path}"], capture_output=True, text=True)
    return r.stdout if r.returncode == 0 else ""


HEX_CLAIM = re.compile(
    r"no names\.?js name|not in names\.?js|stays? hex|kept? hex|keep (?:it|them) hex|stays? local|unnamed",
    re.I,
)
ADDR = re.compile(r"0x[0-9a-f]{4}", re.I)
# re.I on EXPORT is load-bearing: without it an uppercase-hex cell decl (`= 0x601A`) is missed,
# read as UNNAMED, and every false "0x601a stays hex" about it then passes. ADDR always had re.I.
EXPORT = re.compile(r"^export const ([A-Z_0-9]+) = (0x[0-9a-f]{4});", re.M | re.I)

# Rule (B): a top-level idiomatic CELL const `loc_<hex>`. Anchored (re.M) so only decls match - not
# a comment mention or a ROUTINES-map key - and NOT address-windowed (loc_ is invalid at any addr).
EXPORT_LOC = re.compile(r"^export const (loc_[0-9a-f]+)\s*=\s*(0x[0-9a-f]+)\s*;", re.M | re.I)

BOARD = re.compile(r"^\s*board:\s*[\"']([A-Za-z0-9_]+)[\"']", re.M)
RAM_BASE = re.compile(r"^export const WORK_RAM_BASE = (0x[0-9a-f]+);", re.M | re.I)
RAM_SIZE = re.compile(r"^export const WORK_RAM_SIZE = (0x[0-9a-f]+);", re.M | re.I)


def workram_window(game):
    """(lo, hi) inclusive work-RAM bounds for `game`, from its board's memory.js; None if unreadable (caller SKIPS, never guesses)."""
    manifest = blob(":0", f"games/{game}/manifest.js") or blob("HEAD", f"games/{game}/manifest.js")
    m = BOARD.search(manifest or "")
    if not m:
        return None
    mem = blob(":0", f"boards/{m.group(1)}/memory.js") or blob("HEAD", f"boards/{m.group(1)}/memory.js")
    base, size = RAM_BASE.search(mem or ""), RAM_SIZE.search(mem or "")
    if not (base and size):
        return None
    lo = int(base.group(1), 16)
    return (lo, lo + int(size.group(1), 16) - 1)


def named_workram(ram_text, window):
    """{addr_int: NAME} for every names.js const inside this game's work-RAM window."""
    lo, hi = window
    out = {}
    for name, addr in EXPORT.findall(ram_text):
        a = int(addr, 16)
        if lo <= a <= hi:
            out[a] = name
    return out


def is_comment(line):
    s = line.lstrip()
    return s.startswith("*") or s.startswith("//") or s.startswith("/*")


def _mentions(name, text):
    return re.search(rf"(?<![A-Za-z0-9_]){re.escape(name)}(?![A-Za-z0-9_])", text) is not None


COMMENT_MARK = re.compile(r"^\s*(?:/\*+|\*/|\*|//)\s?")


def scan(text, named, comments_only):
    """Violations: a hex-claim clause that calls a names.js-NAMED address hex/unnamed WITHOUT also
    spelling that address's registry name in the same clause (an honest name-acknowledged raw use passes)."""
    hits = []
    lines = text.splitlines()
    n = len(lines)
    i = 0
    while i < n:
        relevant = is_comment(lines[i]) if comments_only else bool(lines[i].strip())
        if not relevant:
            i += 1
            continue
        block_start = i  # 0-based index of the block's first line
        parts = []
        while i < n and (is_comment(lines[i]) if comments_only else bool(lines[i].strip())):
            parts.append(COMMENT_MARK.sub("", lines[i]) if comments_only else lines[i])
            i += 1
        block = " ".join(parts)
        if not HEX_CLAIM.search(block):
            continue
        for clause in re.split(r";|\.\s", block):
            if not HEX_CLAIM.search(clause):
                continue
            bad = [int(a, 16) for a in ADDR.findall(clause)
                   if int(a, 16) in named and not _mentions(named[int(a, 16)], clause)]
            if bad:
                tok = "0x%04x" % bad[0]
                srcline = next((j + 1 for j in range(block_start, i) if tok in lines[j].lower()), block_start + 1)
                hits.append((srcline, bad, clause.strip()))
    return hits


# Rule (C). A citation is an identifier shaped like a routine (camelCase), a loc_<addr> or a cell
# (UPPER_SNAKE), then optionally its address -- `(0xA9C1)`, `(ROM 0x52AA-...)` or ` 0xA9C1` -- and an
# optional `is`/`stays`/`remains`, then the tag. `[code]->[seen]` reads as [seen] (done_gate.GND_ARROW).
TAG_CITE = re.compile(
    r"(?<![A-Za-z0-9_])([A-Za-z_][A-Za-z0-9_]*)`?\**\s*"
    r"(?:\((?:ROM\s+)?0x[0-9A-Fa-f]+[^)\n]*\)\s*|0x[0-9A-Fa-f]+\s*)?"
    r"(?:(?:is|stays|remains)\s+)?\**\s*\[(seen|code|guess)\](\s*(?:->|→)\s*\[seen\])?")
CITE_SHAPE = re.compile(r"^(?:[a-z][a-z0-9]*[A-Z][A-Za-z0-9_]*|loc_[0-9a-fA-F]{4}|[A-Z][A-Z0-9]*_[A-Z0-9_]+)$")
# Opted in game by game; frogger is out until setUpBoardOrContinueLife.js stops citing HUD_STAMP_BASE [code].
TAG_GAMES = {"centiped", "dkong", "galaxian", "invaders", "pooyan", "tempest", "thepit", "timeplt"}


def tag_citations(text):
    """[(tag_offset, name, tag)] for every routine/cell-shaped `NAME [tag]` citation in `text`; tag_offset
    is the index of the tag's `[`."""
    out = []
    for m in TAG_CITE.finditer(text):
        if CITE_SHAPE.match(m.group(1)):
            out.append((m.start(2) - 1, m.group(1), "seen" if m.group(3) else m.group(2)))
    return out


def registry_tags(names_text):
    """{name: (addr, tag)} from names.js: every cell with its own tag (done_gate._strict_cells, None when
    untagged), every ROUTINES entry with its cert, and every <routine>_ADDR alias with its routine's cert."""
    lines = names_text.splitlines(True)
    cells, aliases = done_gate._strict_cells(lines)
    reg = {name: (addr, tag) for name, addr, tag in cells}
    routines = _routine_entries(lines)
    for addr, (name, cert) in routines.items():
        if name:
            reg[name] = (addr, cert)
    for name, addr in aliases:
        reg[name] = (addr, routines.get(addr, [None, None])[1])
    return reg


def routine_certs(names_text):
    """{module name: (addr, cert)} for every names.js ROUTINES entry (the module file is `<name>.js`)."""
    return {name: (addr, cert) for addr, (name, cert) in _routine_entries(names_text.splitlines(True)).items()
            if name}


def _routine_entries(lines):
    """{addr: [name, cert]} from the names.js ROUTINES map."""
    routines, cur, in_rout = {}, None, False
    for ln in lines:
        if ln.startswith("export const ROUTINES"):
            in_rout = True
            continue
        if not in_rout:
            continue
        if ln.startswith("};"):
            break
        m = re.match(r"^\s*(0x[0-9a-fA-F]+)\s*:", ln)
        if m:
            cur = int(m.group(1), 16)
            routines[cur] = [None, None]
        nm = re.search(r'\bname:\s*"([^"]+)"', ln)
        if nm and cur in routines:
            routines[cur][0] = nm.group(1)
        cm = re.search(r'\bcert:\s*"([^"]+)"', ln)
        if cm and cur in routines:
            routines[cur][1] = cm.group(1)
    return routines


# Rule (C) header half (R40 CC-2), opt-in per game: a ROUTINES module's header -- every comment line before
# its first statement, imports skipped -- names the routine's own ROM address and carries the routine's
# names.js cert as a `[tag]`. A header that drops its address or its tag no longer says which ROM routine
# it lifts or how far that reading is grounded.
HEADER_GAMES = {"timeplt"}


def module_header(text):
    """[(lineno, line)] of the comment lines before a module's first statement (import statements skipped)."""
    out, in_block, in_import = [], False, False
    for i, ln in enumerate(text.splitlines(), 1):
        s = ln.strip()
        if in_import:
            in_import = not re.search(r"\bfrom\s*['\"]", s)
            continue
        if in_block:
            out.append((i, ln))
            in_block = "*/" not in s
            continue
        if not s:
            continue
        if re.match(r"import\b", s):
            in_import = not re.search(r"\bfrom\s*['\"]|^import\s*['\"]", s)
            continue
        if s.startswith("//"):
            out.append((i, ln))
            continue
        if s.startswith("/*"):
            out.append((i, ln))
            in_block = "*/" not in s[2:]
            continue
        break
    return out


def module_header_problems(path, text, addr, cert):
    """[(path, line, message)] when a ROUTINES module's header lacks its own address or its cert tag."""
    head = module_header(text)
    body = "\n".join(ln for _, ln in head)
    first = head[0][0] if head else 1
    hits = []
    if not re.search(r"0x0*%x(?![0-9a-fA-F])" % addr, body, re.I):
        hits.append((path, first, f"module header does not name its ROM address 0x{addr:04X}"))
    if cert and f"[{cert}]" not in body:
        hits.append((path, first, f"module header does not carry its names.js cert [{cert}]"))
    return hits


def header_mismatches(game, names_text, read):
    """Rule (C) header half over every ROUTINES module of `game`; read(path) returns a module's text or ''."""
    hits = []
    for name, (addr, cert) in sorted(routine_certs(names_text).items()):
        path = f"games/{game}/idiomatic/{name}.js"
        text = read(path)
        if text:
            hits += module_header_problems(path, text, addr, cert)
    return hits


def comment_text(text):
    """Each line's comment part (whole-line comment, or the text after a trailing `//`), else ''."""
    out = []
    for ln in text.splitlines():
        if is_comment(ln):
            out.append(ln)
        elif "//" in ln:
            out.append(ln.split("//", 1)[1])
        else:
            out.append("")
    return out


def module_tag_mismatches(reg, path, text):
    """Rule (C) core: [(path, line, message)] for each comment citation whose name is not in names.js or
    whose tag differs from the registry's."""
    hits = []
    for i, ln in enumerate(comment_text(text), 1):
        for _o, name, tag in tag_citations(ln):
            if name not in reg:
                hits.append((path, i, f"`{name} [{tag}]` cites a name names.js does not define"))
            elif reg[name][1] != tag:
                have = f"[{reg[name][1]}]" if reg[name][1] else "no tag"
                hits.append((path, i, f"`{name} [{tag}]` but names.js gives it {have}"))
    return hits


def games_touched():
    out = git(["diff", "--cached", "--name-only"])
    gs = set()
    for p in out.splitlines():
        m = re.match(r"^games/([^/]+)/", p)
        if m:
            gs.add(m.group(1))
    return gs


NAMING_DEBT_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "names-debt.txt")


def load_naming_debt(path=NAMING_DEBT_FILE):
    """{(game, addr_int)} grandfathered loc_ cell consts from tools/names-debt.txt. Each non-blank,
    non-`#` line must be exactly `<game> 0x<addr>`; a missing or malformed file raises GitError (fail-closed)."""
    try:
        text = open(path, encoding="utf-8").read()
    except OSError as e:
        raise GitError(f"cannot read naming-debt allowlist {path}: {e}")
    debt = set()
    for i, raw in enumerate(text.splitlines(), 1):
        line = raw.split("#", 1)[0].strip()
        if not line:
            continue
        parts = line.split()
        if len(parts) != 2 or not re.fullmatch(r"0x[0-9a-f]+", parts[1], re.I):
            raise GitError(f"malformed naming-debt line {i} in {path}: {raw!r}")
        debt.add((parts[0], int(parts[1], 16)))
    return debt


def loc_cell_violations_in_text(game, text, allowlist):
    """[(identifier, addr_int, lineno)] for each top-level `export const loc_<hex> = 0x<hex>;` whose (game, addr) is not grandfathered."""
    hits = []
    for m in EXPORT_LOC.finditer(text):
        addr = int(m.group(2), 16)
        if (game, addr) in allowlist:
            continue
        lineno = text.count("\n", 0, m.start()) + 1
        hits.append((m.group(1), addr, lineno))
    return hits


def loc_cell_check():
    """Rule (B): no un-grandfathered idiomatic loc_ CELL const anywhere in the WORKING TREE (all games, not the index)."""
    root = repo_root()
    debt = load_naming_debt()
    failures = []
    for f in sorted(glob.glob(os.path.join(root, "games", "*", "idiomatic", "names.js"))):
        rel = os.path.relpath(f, root)
        game = rel.split(os.sep)[1]
        try:
            text = open(f, encoding="utf-8").read()
        except OSError as e:
            raise GitError(f"cannot read {rel}: {e}")
        for name, addr, ln in loc_cell_violations_in_text(game, text, debt):
            failures.append(f"    {rel}:{ln}  {name} = 0x{addr:04x}  (game {game})")
    if failures:
        sys.stderr.write(
            "\nCOMMIT BLOCKED — names-consistency gate, idiomatic loc_ cell rule\n"
            "  (docs/runbook.md \"A cell earns its DESCRIPTIVE identifier…\" / reviewer-rules.md R31):\n"
            "  A role-UNDERSTOOD cell owes a DESCRIPTIVE name; only a role-UNKNOWN cell may take a\n"
            "  `loc_<addr>` name, and only as an enumerated (game, addr) entry in tools/names-debt.txt.\n"
            "  These idiomatic names.js loc_ cell consts are NOT on that allowlist:\n\n"
            + "\n".join(failures)
            + "\n\n  Fix: if the role is READABLE, rename each to a DESCRIPTIVE name (value-identical — the\n"
            "  address never changes) and update its importers. If the role is genuinely UNKNOWN after\n"
            "  tracing, allowlist it in tools/names-debt.txt. Do NOT --no-verify around this.\n\n"
        )
        return 1
    return 0


def check():
    # Rule (B) first: it scans the whole tree and must NOT sit behind the `if not games` early-return below.
    rc = loc_cell_check()
    games = games_touched()
    if not games:
        return rc
    failures = []
    unwindowed = []
    for game in sorted(games):
        window = workram_window(game)
        if window is None:
            # No guessed fallback range: inspecting the wrong window is what made this gate vacuous for DK.
            unwindowed.append(game)
            continue
        ram = blob(":0", f"games/{game}/idiomatic/names.js") or blob("HEAD", f"games/{game}/idiomatic/names.js")
        named = named_workram(ram, window)
        if not named:
            continue
        targets = [(f"games/{game}/mechanisms.md", False)]
        listing = git(["ls-files", "--", f"games/{game}/idiomatic/"]).splitlines()
        for p in listing:
            if p.endswith(".js") and not p.endswith("/names.js"):
                targets.append((p, True))
        for path, comments_only in targets:
            text = blob(":0", path) or blob("HEAD", path)
            if not text:
                continue
            for ln, addrs, clause in scan(text, named, comments_only):
                names = ", ".join(f"{named[a]} (0x{a:04x})" for a in addrs)
                failures.append(f"    {path}:{ln}  calls {names} hex/unnamed — but names.js names it.\n        “{clause}”")
    tag_failures = []
    for game in sorted(games & TAG_GAMES):
        names_js = f"games/{game}/idiomatic/names.js"
        reg = registry_tags(blob(":0", names_js) or blob("HEAD", names_js))
        for p in git(["ls-files", "--", f"games/{game}/idiomatic/"]).splitlines():
            if p.endswith(".js") and not p.endswith("/names.js"):
                for path, ln, msg in module_tag_mismatches(reg, p, blob(":0", p) or blob("HEAD", p)):
                    tag_failures.append(f"    {path}:{ln}  {msg}")
        if game in HEADER_GAMES:
            staged = set(git(["ls-files", "--", f"games/{game}/idiomatic/"]).splitlines())
            for path, ln, msg in header_mismatches(game, blob(":0", names_js) or blob("HEAD", names_js),
                                                   lambda p: blob(":0", p) if p in staged else ""):
                tag_failures.append(f"    {path}:{ln}  {msg}")
    if unwindowed:
        sys.stderr.write(
            "COMMIT BLOCKED — names-consistency gate: could not derive the work-RAM window for "
            + ", ".join(unwindowed)
            + ".\n  Expected games/<game>/manifest.js to declare `board: \"<name>\"` and\n"
            "  boards/<name>/memory.js to export WORK_RAM_BASE and WORK_RAM_SIZE.\n"
            "  Failing closed rather than inspecting a guessed address range.\n"
        )
        return 1
    if tag_failures:
        sys.stderr.write(
            "\nCOMMIT BLOCKED — names-consistency gate, tag rule (C) (tools/names_consistency.py):\n"
            "  names.js is the single source of a cell's or routine's tag; a module comment copies it.\n\n"
            + "\n".join(tag_failures)
            + "\n\n  Fix the comment's tag (or name) to match names.js. Do NOT --no-verify around this.\n\n"
        )
        rc = 1
    if failures:
        sys.stderr.write(
            "\nCOMMIT BLOCKED — names-consistency gate (tools/names_consistency.py):\n"
            "  names.js is the single source of truth for whether a cell is named; prose must not\n"
            "  contradict it. These clauses call a names.js-NAMED address unnamed/hex:\n\n"
            + "\n".join(failures)
            + "\n\n  Fix the prose to name the cell (or, if it is really unnamed, name it in names.js).\n"
            "  Do NOT --no-verify around this.\n\n"
        )
        return 1
    return rc  # rule (A) clean; propagate rules (B) and (C)


def tags_report(game):
    """Rule (C) over the WORKING TREE for one game (done_gate's call). A game outside TAG_GAMES is info, rc 0."""
    root = repo_root()
    if game not in TAG_GAMES:
        print(f"names_consistency tags [{game}]: not enrolled in TAG_GAMES (info only)")
        return 0
    names_js = os.path.join(root, "games", game, "idiomatic", "names.js")
    try:
        reg = registry_tags(open(names_js, encoding="utf-8").read())
    except OSError as e:
        raise GitError(f"cannot read {names_js}: {e}")
    hits = []
    for f in sorted(glob.glob(os.path.join(root, "games", game, "idiomatic", "*.js"))):
        if f.endswith(os.sep + "names.js"):
            continue
        hits += module_tag_mismatches(reg, os.path.relpath(f, root), open(f, encoding="utf-8").read())
    if game in HEADER_GAMES:
        def read(path):
            try:
                return open(os.path.join(root, path), encoding="utf-8").read()
            except OSError:
                return ""
        hits += header_mismatches(game, open(names_js, encoding="utf-8").read(), read)
    if hits:
        print(f"names_consistency tags [{game}]: FAIL")
        for path, ln, msg in hits:
            print(f"    {path}:{ln}  {msg}")
        return 1
    print(f"names_consistency tags [{game}]: PASS")
    return 0


def _selftest_tags(failures):
    """Rule (C) fixtures: the controls must fail, the faithful copies must pass."""
    names_js = (
        "/** Coins accepted. [seen] */\n"
        "export const COIN_COUNT = 0xa982;\n"
        "export const DIP_COPY = 0xa9ad; // [code] read only\n"
        "export const ROUTINES = {\n"
        '  0x4984: { name: "pulseCoinCounter", role: "r", cert: "seen" },\n'
        "  0x0167: {\n"
        '    name: "loc_0167",\n'
        '    cert: "code",\n'
        "  },\n"
        "};\n"
    )
    reg = registry_tags(names_js)
    want = {"COIN_COUNT": (0xa982, "seen"), "DIP_COPY": (0xa9ad, "code"),
            "pulseCoinCounter": (0x4984, "seen"), "loc_0167": (0x0167, "code")}
    if reg != want:
        failures.append(f"registry_tags: want {want}, got {reg}")
    cases = [
        ("faithful cell", " * COIN_COUNT (0xA982) [seen] counts coins", 0),
        ("faithful routine", "  // then pulseCoinCounter [seen] runs", 0),
        ("faithful [code]", " * the trap loc_0167 (0x0167, a data run) [code]", 0),
        ("promotion arrow", " * DIP_COPY [code] -> [seen]", 1),
        ("stale cell tag", " * COIN_COUNT 0xA982 [code] counts coins", 1),
        ("stale routine cert", " * pulseCoinCounter is [code]", 1),
        ("trailing comment", "x = 1; // COIN_COUNT [guess]", 1),
        ("unknown name", " * pulseCoinCountr [seen]", 1),
        ("plain word ignored", " * the role is [code]", 0),
        ("code line ignored", 'const s = "COIN_COUNT [code]";', 0),
    ]
    for label, text, n in cases:
        got = len(module_tag_mismatches(reg, "m.js", text))
        if got != n:
            failures.append(f"rule C {label}: want {n} hit(s), got {got} on {text!r}")
    # header half (CC-2): the faithful header passes; a dropped address or tag is one hit each
    good = ('// SPDX-License-Identifier: GPL-3.0-only\nimport { A,\n  B } from "./names.js";\n'
            "/** pulseCoinCounter -- pulse the counter.\n * ROM 0x4984-0x4990. Grounding: [seen]. */\n"
            "export function pulseCoinCounter(m) {}\n// 0x0167 [code] after the code is not header\n")
    hcases = [("faithful header", good, 0),
              ("dropped address", good.replace("ROM 0x4984-0x4990. ", ""), 1),
              ("dropped tag", good.replace("Grounding: [seen]", "Grounding:"), 1),
              ("stale tag", good.replace("[seen]", "[code]"), 1),
              ("address only after code", good.replace("ROM 0x4984-0x4990. ", "").replace("0x0167", "0x4984"), 1)]
    for label, text, n in hcases:
        got = len(module_header_problems("m.js", text, 0x4984, "seen"))
        if got != n:
            failures.append(f"rule C header {label}: want {n} hit(s), got {got}")
    mods = {"games/g/idiomatic/pulseCoinCounter.js": good.replace("ROM 0x4984-0x4990. ", "")}
    got = len(header_mismatches("g", names_js, lambda p: mods.get(p, "")))
    if got != 1:
        failures.append(f"rule C header_mismatches: want 1 hit for a header that lost its address, got {got}")
    if "timeplt" not in HEADER_GAMES:
        failures.append("rule C header half: timeplt must be enrolled in HEADER_GAMES")


def selftest():
    """Synthetic fixtures for rule (B); loc_cell_violations_in_text is the pure, tree-independent core."""
    G = "selftestgame"
    failures = []

    hits = loc_cell_violations_in_text(G, "export const loc_1234 = 0x1234;\n", set())
    if [(n, a) for n, a, _ in hits] != [("loc_1234", 0x1234)]:
        failures.append(f"un-listed loc_ cell: want [('loc_1234', 0x1234)], got {[(n, a) for n, a, _ in hits]}")

    if loc_cell_violations_in_text(G, "export const loc_1234 = 0x1234;\n", {(G, 0x1234)}):
        failures.append("allowlisted loc_ cell must PASS")

    if not loc_cell_violations_in_text("othergame", "export const loc_1234 = 0x1234;\n", {(G, 0x1234)}):
        failures.append("allowlist must be per-game: loc_1234 in othergame must FAIL when only (selftestgame,0x1234) is listed")

    if loc_cell_violations_in_text(G, "export const HIGH_SCORE = 0x83ef;\n", set()):
        failures.append("descriptive-named cell must PASS")

    routine = (
        'export const ROUTINES = {\n'
        '  0x1234: { name: "loc_1234", cert: "code" },\n'
        '};\n'
        '// loc_5678 masks this against 2\n'
    )
    if loc_cell_violations_in_text(G, routine, set()):
        failures.append("ROUTINES-map entry / comment loc_ mention must PASS (not a cell const)")

    multi = "// header\nexport const HIGH_SCORE = 0x83ef;\nexport const loc_9abc = 0x9abc;\n"
    if loc_cell_violations_in_text(G, multi, set()) != [("loc_9abc", 0x9abc, 3)]:
        failures.append(f"line attribution: want [('loc_9abc', 0x9abc, 3)], got {loc_cell_violations_in_text(G, multi, set())}")

    if not loc_cell_violations_in_text(G, "export const loc_130b = 0x130b;\n", set()):
        failures.append("a loc_ cell at a ROM address must FAIL (rule B is not work-RAM-windowed)")

    try:
        debt = load_naming_debt()
        if not all(isinstance(g, str) and isinstance(a, int) for g, a in debt):
            failures.append("names-debt.txt parsed to a non (str, int) tuple")
    except GitError as e:
        failures.append(f"names-debt.txt failed to parse: {e}")

    _selftest_tags(failures)

    if failures:
        sys.stderr.write("names_consistency selftest: FAIL\n")
        for f in failures:
            sys.stderr.write(f"  {f}\n")
        return 1
    sys.stdout.write("names_consistency selftest: PASS (rule B: teeth, allowlist, per-game, absent, scope, line#, "
                     "ROM addr, debt-file well-formed; rule C: registry read, faithful copies, stale tags, unknown name, scope, "
                     "module header address + cert)\n")
    return 0


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in ("check", "selftest", "tags"):
        sys.stderr.write("usage: names_consistency.py {check|selftest|tags --game <game>}\n")
        return 2
    if sys.argv[1] == "tags" and (len(sys.argv) != 4 or sys.argv[2] != "--game"):
        sys.stderr.write("usage: names_consistency.py tags --game <game>\n")
        return 2
    # selftest is pure-logic (synthetic fixtures + the debt file); no git tree, so it runs before repo_root.
    if sys.argv[1] == "selftest":
        return selftest()
    try:
        repo_root()
    except GitError:
        sys.stderr.write("COMMIT BLOCKED — names-consistency gate: not in a git work tree (failing closed).\n")
        return 1
    try:
        return tags_report(sys.argv[3]) if sys.argv[1] == "tags" else check()
    except GitError as e:
        sys.stderr.write(f"COMMIT BLOCKED — names-consistency gate git error (failing closed): {e}\n")
        return 1


if __name__ == "__main__":
    sys.exit(main())
