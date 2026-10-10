#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""Idiomatic gate — the idiomatic layer must be truly idiomatic, with no old CPU/memory cruft.

Runbook goal (§5 definition of done): a finished idiomatic module names its data and control flow,
never the machine. Six kinds of cruft are counted, all of which must reach 0 for a game to be
IDIOMATIC (a hard done requirement):
  - REGISTERS: `regs.a` / ALU helpers, minus two exempt bridges — a param-default (`fn(m, x=m.regs.a)`)
    and a write riding a return (`return (m.regs.a=v)`). For a TIGHT_GAMES game the return-write
    exemption is narrower: the write must BE the return's value (a seat before a call is NOT exempt).
  - m.call(...) — dissolve to a direct JS call (or `yield*`). m.push16/* — Z80 stack trampolines.
    (m.ret / m.pop* are Z80 stack primitives too, but counted CLOSURE-only — like `unlifted` below —
    so a frozen legacy game's budget is not re-baselined by the gate newly seeing them.)
  - raw 0xHHHH — a bare address; use a named import from names.js. For a SHORT_ADDR_GAMES game (e.g.
    timeplt) an address written short (0xd1b, decimal) is counted too, but only in address position: the
    whole index of a memory access, or a literal-only table const that reaches one (short_addr_hits).
  - mem.read8/write8/read16/write16(...) — the low-level API; idiomatic is the indexed view `mem8[addr]`.
  - a redundant width-mask on a mem assignment (`mem8[x]=..&0xff` / `mem16[x]=..&0xffff`): the write already
    truncates, so it's noise. Counted with it: a non-canonical `const foo=m.mem8` alias that would hide one.
All six are counted in CODE ONLY (comments stripped); the last five have NO exemptions (registers keep the two bridges above).

FAIL-CLOSED ratchet: `check` enumerates EVERY games/*/idiomatic/ and holds each to a budget
(games/<game>/idiomatic-budget.txt), implicit 0 for a game not listed — so a NEW game is born idiomatic. It
blocks when a game's STAGED count EXCEEDS its budget (no NEW cruft; the allowlist only shrinks).
Fail-closed on a missing/malformed allowlist. Scope: games/<game>/idiomatic/*.js, minus names.js and
the test/ subdir.

COMPLETENESS: `check` also enforces the game-local `idiomaticComplete: true` flag (manifest) — a game may
declare it only at 0 total cruft. Rationale: docs/comment-gate.md.

Subcommands: worklist (per-module, per-category), check (the ratchet), selftest.
"""
import argparse
import glob
import os
import re
import subprocess
import sys

# --- registers (data registers + ALU-op helpers); both are machine surface ---
REF = re.compile(r"\b(?:m\.)?regs\.([A-Za-z][A-Za-z0-9]*)")
SIG = re.compile(r"\bfunction\s+\w+\s*\(")          # param-defaults on a signature line are exempt
RET = re.compile(r"\breturn\b")
WRITE = re.compile(r"\b(?:m\.)?regs\.[A-Za-z][A-Za-z0-9]*\s*=(?!=)")  # write riding a return is exempt

# --- control/stack/address cruft, counted in comment-stripped CODE, no exemptions ---
CALL = re.compile(r"\bm\.call\(")
PUSH = re.compile(r"\bm\.push\w*\(")
# m.ret / m.pop* are Z80 stack primitives too (a fully idiomatic layer uses JS control flow, not the
# machine stack). Counted CLOSURE-only (like `unlifted`): the games being driven to zero primitives,
# so a legacy game's frozen budget is not re-baselined by making the gate newly see them.
STACK = re.compile(r"\bm\.(?:ret|pop\w*)\(")
ADDR = re.compile(r"0x[0-9a-fA-F]{4}\b")
MEM = re.compile(r"\bmem\.(?:read|write)(?:8|16)\(")  # low-level machine API; idiomatic form is mem8[addr]
# Redundant width-mask on a mem assignment: mem8[..]=..&0xff (write8 truncates) / mem16[..]=..&0xffff
# (write16 truncates). The mask must be the outermost op on the RHS (right before `;`), width-matched.
MASK8 = re.compile(r"\bmem8\[[^\]]*\]\s*=[^;=]*&\s*0x[fF][fF]\s*;")
MASK16 = re.compile(r"\bmem16\[[^\]]*\]\s*=[^;=]*&\s*0x[fF]{4}\s*;")
# A non-canonical whole-view alias (`const foo = m.mem8;`) would hide `foo[x]=..&0xff` masks; forbid it.
# The `const {mem8,mem16} = m` destructure and byte reads `const v = m.mem8[x]` do not match.
ALIAS = re.compile(r"\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*m\.mem(?:8|16)\s*;")

# --- a raw address written SHORT (1-3 hex digits, or decimal), which ADDR's 4-digit form cannot see ---
# Dropping a leading zero (0x0d1b -> 0xd1b) must not hide an address, but a bare "any short hex" rule
# would count every mask, count, size and plane offset (0x7f, 0x100, 0x400 ...: timeplt alone holds
# twenty-odd such sizes/offsets >= 0x100). So a short literal is counted only in ADDRESS POSITION,
# decided by where the value goes, never by its magnitude:
#   (A) it IS the whole index of a memory access: mem8[0xd1b], mem16[907], mem.read8(0x7d3, ..);
#   (B) it is a constant TABLE entry -- the initializer of a const/let is nothing but literals and names
#       (`const RECORDS = 0xd1b`, `const SOURCES = [CELL_A, 0xa9c, 0x7d3]`) -- and that name reaches a
#       whole memory index, directly (mem8[NAME], mem8[NAME[i]]) or through one plain alias
#       (`let p = NAME; ... mem16[p]`, `for (const s of NAME) mem8[s]`).
# Arithmetic is never an address position: an offset added to a named base (mem8[BASE + 0x400]), a mask
# (x & 0x7f), a loop bound, a size or an initializer like `BASE + 8` is not counted. A 4-digit hex literal
# is ADDR's, so it is excluded here (no double count). Opt-in per game (SHORT_ADDR_GAMES), like TIGHT_GAMES.
_NUM = r"(?:0x[0-9a-fA-F]{1,3}(?![0-9a-fA-F])|\d+)(?![\w$.])"
_SHORT_LIT = re.compile(r"(?<![\w$.])(?:0x[0-9a-fA-F]{1,3}|\d+)(?![\w$.])")
_IDX_LIT = re.compile(r"\bmem(?:8|16)\[\s*(" + _NUM + r")\s*\]"
                      r"|\b(?:mem|m)\.(?:read|write)(?:8|16)\(\s*(" + _NUM + r")\s*[,)]")
_DECL = re.compile(r"\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=(?!=)")
_TABLE_INIT = re.compile(r"^[\s\w$\[\],]*$")   # literals, names, commas and brackets only -- no operator


def _idx_use(code, name):
    """True when `name` (or name[...]) is the WHOLE index of a memory access somewhere in `code`."""
    n = re.escape(name)
    return bool(re.search(r"\bmem(?:8|16)\[\s*" + n + r"\s*(?:\]|\[[^\]]*\]\s*\])", code)
                or re.search(r"\b(?:mem|m)\.(?:read|write)(?:8|16)\(\s*" + n + r"\s*(?:[,)]|\[)", code))


def _reaches_index(code, name):
    """`name` reaches a whole memory index directly, or through one plain alias binding."""
    if _idx_use(code, name):
        return True
    n = re.escape(name)
    alias = (r"\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?:=(?!=)\s*" + n + r"\s*[;,\n]"
             r"|\s+of\s+" + n + r"\s*\))")
    return any(_idx_use(code, m.group(1)) for m in re.finditer(alias, code))


def _initializer(code, i):
    """End index of the initializer starting at code[i]: the first top-level `;`, `,` or newline."""
    depth = 0
    while i < len(code):
        c = code[i]
        if c in "'\"`":
            i = _skip_str(code, i)
            continue
        depth += (c in _OPEN) - (c in _CLOSE)
        if depth < 0 or (depth == 0 and c in ";,\n"):
            return i
        i += 1
    return i


def short_addr_hits(code):
    """Short-written raw addresses in comment-stripped `code` (rules A and B above): list of literals."""
    hits = [m.group(1) or m.group(2) for m in _IDX_LIT.finditer(code)]
    for d in _DECL.finditer(code):
        init = code[d.end():_initializer(code, d.end())]
        lits = _SHORT_LIT.findall(init)
        if lits and _TABLE_INIT.match(init) and _reaches_index(code, d.group(1)):
            hits.extend(lits)
    return hits


# Games whose `addrs` count also includes short-written addresses (short_addr_hits). Opt-in per game.
SHORT_ADDR_GAMES = {"timeplt"}

CATEGORIES = ("registers", "calls", "pushes", "addrs", "mem", "masks")


def strip_comments(text):
    """Drop /* ... */ (incl. /** docstrings) and // line comments so cruft in prose is not counted.
    String/template-literal-unaware (a naive regex): a // or /* occurring INSIDE a string strips the
    code after it on that line — a narrow false-negative the ratchet tolerates, since idiomatic cruft
    is not authored behind an in-string comment marker."""
    text = re.sub(r"/\*[\s\S]*?\*/", "", text)
    text = re.sub(r"//[^\n]*", "", text)
    return text


_OPEN, _CLOSE = "([{", ")]}"
_WRITE_AT = re.compile(r"(?:m\.)?regs\.[A-Za-z][A-Za-z0-9]*\s*=(?!=)")
_CALL_AT = re.compile(r"(?<![\w$.])([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\(")
_PURE = {"u8", "u16"}  # width-mask wrappers: value-preserving, never an input-seat consumer
_NOT_CALL = {"if", "for", "while", "switch", "return", "function", "catch", "typeof", "void", "new"}


def _skip_str(s, i):
    q, i = s[i], i + 1
    while i < len(s) and s[i] != q:
        i += 2 if s[i] == "\\" else 1
    return i + 1


def _close(s, i):
    """Index of the bracket closing the opener at s[i]."""
    depth = 0
    while i < len(s):
        c = s[i]
        if c in "'\"`":
            i = _skip_str(s, i)
            continue
        depth += (c in _OPEN) - (c in _CLOSE)
        if depth == 0:
            return i
        i += 1
    return len(s) - 1


def _split(s, a, b, sep):
    """Top-level `sep`-separated (start, end) spans of s[a:b]."""
    out, depth, st, i = [], 0, a, a
    while i < b:
        c = s[i]
        if c in "'\"`":
            i = _skip_str(s, i)
            continue
        depth += (c in _OPEN) - (c in _CLOSE)
        if c == sep and depth == 0:
            out.append((st, i))
            st = i + 1
        i += 1
    return out + [(st, b)]


def _ternary(s, a, b):
    """(q, colon) of a top-level `?:` in s[a:b] (not `?.`/`??`), else None."""
    depth, q, nest, i = 0, None, 0, a
    while i < b:
        c = s[i]
        if c in "'\"`":
            i = _skip_str(s, i)
            continue
        depth += (c in _OPEN) - (c in _CLOSE)
        if depth == 0 and c == "?" and s[i + 1:i + 2] not in (".", "?") and s[i - 1:i] != "?":
            nest += q is not None
            q = i if q is None else q
        elif depth == 0 and c == ":" and q is not None:
            if nest == 0:
                return q, i
            nest -= 1
        i += 1
    return None


def _value_writes(s, a, b, out):
    """Append the (start, end) span of every `regs.X =` write that IS the value of the expression s[a:b]:
    the whole expression, inside parens, the LAST comma operand, an array element, an object property
    value, a ?: branch, the argument of a pure u8()/u16() mask, or a chained assignment's RHS. NOT a
    `void` operand, a non-last comma operand, a call argument, or a ternary condition."""
    while a < b and s[a].isspace():
        a += 1
    while b > a and s[b - 1].isspace():
        b -= 1
    seg = s[a:b]
    if not seg or re.match(r"void\b", seg):
        return
    parts = _split(s, a, b, ",")
    if len(parts) > 1:
        return _value_writes(s, *parts[-1], out)
    w = _WRITE_AT.match(seg)
    if w and not (a and (s[a - 1].isalnum() or s[a - 1] in "_$.")):
        out.append((a, b))
        return _value_writes(s, a + w.end(), b, out)
    t = _ternary(s, a, b)
    if t:
        _value_writes(s, t[0] + 1, t[1], out)
        return _value_writes(s, t[1] + 1, b, out)
    if seg[0] in _OPEN and _close(s, a) == b - 1:
        for pa, pb in ([(a + 1, b - 1)] if seg[0] == "(" else _split(s, a + 1, b - 1, ",")):
            if seg[0] == "{":
                kv = _split(s, pa, pb, ":")
                if len(kv) >= 2:
                    _value_writes(s, kv[1][0], pb, out)
            else:
                _value_writes(s, pa, pb, out)
        return
    u = re.match(r"(?:u8|u16)\s*\(", seg)
    if u and _close(s, a + u.end() - 1) == b - 1:
        _value_writes(s, a + u.end(), b - 1, out)


def _return_end(s, i):
    """End of the return expression starting at s[i] (`;`, an unmatched closer, or an ASI newline)."""
    depth, n = 0, len(s)
    j = i
    while j < n:
        c = s[j]
        if c in "'\"`":
            j = _skip_str(s, j)
            continue
        if c in _OPEN:
            depth += 1
        elif c in _CLOSE:
            if depth == 0:
                return j
            depth -= 1
        elif c == ";" and depth == 0:
            return j
        elif c == "\n" and depth == 0:
            prev, nxt = s[i:j].rstrip(), s[j + 1:].lstrip()[:1]
            if not prev or (prev[-1] not in ",(?:=+-*/&|<>![{" and nxt not in ".?:+-*/&|,)]}"):
                return j
        j += 1
    return n


def register_hits_legacy(text):
    """Register names, minus a param-default (signature line) and a `regs.X =` write after the first
    `return` on a line (the exempt outgoing bridge `return (m.regs.a = v)`). The rule for every game
    NOT in TIGHT_GAMES — it also exempts an INPUT SEAT riding a return (`return (regs.ix = X, f(m))`)."""
    hits = []
    for line in text.splitlines():
        if SIG.search(line):
            continue
        m = RET.search(line)
        if m:
            line = line[:m.end()] + WRITE.sub("", line[m.end():])
        hits.extend(REF.findall(line))
    return hits


# Games held to the TIGHTENED return-write exemption (register_hits_tight). Opt-in per game; every other
# game keeps register_hits_legacy until it is re-baselined under the tight rule.
TIGHT_GAMES = {"timeplt"}


def register_hits(text, tight=False):
    """Dispatch to the tight or the legacy register rule."""
    return register_hits_tight(text) if tight else register_hits_legacy(text)


def register_hits_tight(text):
    """Register names, minus a param-default (signature line) and a `regs.X =` write that IS a `return`'s
    value (the load-bearing outgoing bridge `return (m.regs.a = v)` / `return [m.regs.a = x, m.regs.hl = y]`,
    single- or multi-line). A write is NOT exempt when it merely rides a return as an INPUT SEAT: a
    non-last comma operand or call argument (`return (regs.ix = X, callee(m))`, `return f((regs.de = K, m))`),
    a `void (...)` operand, or any write followed by a (non-mask) call within the same return. The
    param-default exemption covers a signature's PARAMETER LIST only, not the rest of its line, so a
    one-line body (`function f(m) { m.regs.ix = X; return g(m); }`) is counted like any other."""
    sig_spans = [(s.end() - 1, _close(text, s.end() - 1)) for s in SIG.finditer(text)]
    in_sig = lambda o: any(x <= o <= y for x, y in sig_spans)
    exempt = set()
    for r in RET.finditer(text):
        if in_sig(r.start()):
            continue
        end = _return_end(text, r.end())
        spans = []
        _value_writes(text, r.end(), end, spans)
        for wa, wb in spans:
            later = [c for c in _CALL_AT.finditer(text, wb, end)
                     if c.group(1) not in _PURE and c.group(1) not in _NOT_CALL]
            if not later:
                exempt.add(wa)
    return [m.group(1) for m in REF.finditer(text) if not in_sig(m.start()) and m.start() not in exempt]


def counts(text, game=None):
    """Per-category cruft counts for one module's source text. The CATEGORIES keys are always-counted
    (baked into every game's budget); "stack" (m.ret/m.pop*) is a separate closure-only addend the
    callers apply only for CLOSURE_GAMES, so it is returned but excluded from total()."""
    code = strip_comments(text)
    return {
        "registers": len(register_hits(code, tight=game in TIGHT_GAMES)),
        "calls": len(CALL.findall(code)),
        "pushes": len(PUSH.findall(code)),
        "addrs": len(ADDR.findall(code)) + (len(short_addr_hits(code)) if game in SHORT_ADDR_GAMES else 0),
        "mem": len(MEM.findall(code)),
        "masks": (len(MASK8.findall(code)) + len(MASK16.findall(code))
                  + sum(1 for n in ALIAS.findall(code) if n not in ("mem8", "mem16"))),
        "stack": len(STACK.findall(code)),
    }


def total(c):
    return sum(c[k] for k in CATEGORIES)


class GitError(RuntimeError):
    """A git invocation failed — callers turn this into a BLOCK (fail closed)."""


def git(args):
    r = subprocess.run(["git", *args], capture_output=True, text=True)
    if r.returncode != 0:
        raise GitError(r.stderr.strip() or f"git {' '.join(args)} failed")
    return r.stdout


def _modules_in_index(game):
    """Staged (index) idiomatic module paths for a game, minus names.js and the test/ subdir."""
    idir = f"games/{game}/idiomatic"
    out = []
    for path in git(["ls-files", f"{idir}/*.js"]).splitlines():
        if not path or os.path.basename(path) == "names.js":
            continue
        if os.path.dirname(path) != idir:  # git pathspec '*' spans '/'; keep only top-level modules
            continue
        out.append(path)
    return out


def count_in_index(game):
    """Total cruft in the STAGED content, matching the other gates. Returns (total, per_category, stack)
    where stack (m.ret/m.pop*) is a closure-only addend the caller applies, not part of total()."""
    agg = {k: 0 for k in CATEGORIES}
    stk = 0
    for path in _modules_in_index(game):
        try:
            blob = git(["show", f":{path}"])
        except GitError:
            continue
        c = counts(blob, game)
        for k in CATEGORIES:
            agg[k] += c[k]
        stk += c["stack"]
    return total(agg), agg, stk


def read_budgets():
    """Per-game budget from games/<game>/idiomatic-budget.txt -> {game: max_allowed}. Each file is a
    single integer (first non-comment line; # comments allowed) — a shrinking ratchet toward 0. Absent
    -> implicit 0 (a NEW game is born idiomatic). Fail closed on a malformed/empty file."""
    budgets = {}
    for path in sorted(glob.glob("games/*/idiomatic-budget.txt")):
        game = os.path.basename(os.path.dirname(path))
        val = None
        for raw in open(path, encoding="utf-8"):
            line = raw.split("#", 1)[0].strip()
            if not line:
                continue
            if not line.isdigit():
                raise GitError(f"malformed budget in {path}: {raw.rstrip()}")
            val = int(line)
            break
        if val is None:
            raise GitError(f"empty budget file {path}")
        budgets[game] = val
    return budgets


def all_games():
    return sorted(
        os.path.basename(os.path.dirname(d))
        for d in glob.glob("games/*/idiomatic")
    )


# --- reachability closure: a reachable routine still served by the translated oracle is cruft too ---
# reachable (translated `_registry.generated.js`, graph-closed) - overridden (idiomatic ROUTINES) -
# boundary = the still-frozen routines, counted alongside CPU cruft so the total can't reach 0 while
# anything reachable is oracle-served. Only ENROLLED games are counted; legacy opts in when worked.
CLOSURE_GAMES = {"frogger", "pooyan", "invaders", "centiped", "tempest"}
BOUNDARY_FILE = "tools/idiomatic-boundaries.txt"
REG_ENTRY = re.compile(r"^\s*\[\s*0x([0-9a-fA-F]+)\s*,")     # _registry.generated.js address->fn rows
ROUTINE_KEY = re.compile(r"^\s*0x([0-9a-fA-F]+)\s*:\s*\{")   # names.js ROUTINES map keys

# The game-local CLEANUP flag (manifest); enforced below so it can't be set at nonzero cruft. Line-anchored
# so a commented-out flag does not match. docs/comment-gate.md.
COMPLETE_RE = re.compile(r"(?m)^\s*idiomaticComplete\s*:\s*true\b")


def declares_complete(game):
    try:
        return bool(COMPLETE_RE.search(git(["show", f":games/{game}/manifest.js"])))
    except GitError:
        return False


def is_completeness_violation(declares, tot):
    """A game may not declare idiomaticComplete while any cruft (tot, incl. unlifted) remains."""
    return declares and tot != 0


def _read(path, from_index):
    """Read a tracked file's STAGED (index) content to match the ratchet, or the working tree."""
    if from_index:
        return git(["show", f":{path}"])
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def _registry_addrs(game, from_index):
    text = _read(f"games/{game}/translated/_registry.generated.js", from_index)
    return {int(m.group(1), 16) for m in map(REG_ENTRY.match, text.splitlines()) if m}


def _override_addrs(game, from_index):
    text = _read(f"games/{game}/idiomatic/names.js", from_index)
    out, in_routines = set(), False
    for line in text.splitlines():
        if "export const ROUTINES" in line:
            in_routines = True
        if in_routines:
            m = ROUTINE_KEY.match(line)
            if m:
                out.add(int(m.group(1), 16))
    return out


def boundary_dispositions(game):
    """`{addr: disposition}` from tools/idiomatic-boundaries.txt for one game (dead / boundary + reason).
    Every entry is a REVIEWED decision that a reachable routine legitimately stays translated (a genuine
    oracle boundary) or is dead (callers dissolved). Fail closed on a malformed line."""
    out = {}
    if not os.path.exists(BOUNDARY_FILE):
        return out
    for raw in open(BOUNDARY_FILE, encoding="utf-8"):
        line = raw.split("#", 1)[0].strip()
        if not line:
            continue
        parts = line.split()
        if len(parts) < 3 or not parts[1].startswith("0x") or parts[2] not in ("dead", "boundary"):
            raise GitError(f"malformed boundary line: {raw.rstrip()}")
        if parts[0] == game:
            out[int(parts[1], 16)] = parts[2]
    return out


def unlifted_addrs(game, from_index):
    """Reachable routines with no idiomatic override and no boundary disposition — the frozen worklist."""
    if game not in CLOSURE_GAMES:
        return []
    return sorted(_registry_addrs(game, from_index)
                  - _override_addrs(game, from_index)
                  - set(boundary_dispositions(game)))


def check():
    """Ratchet: no game's staged idiomatic layer may exceed its budget. Returns process exit code."""
    try:
        budgets = read_budgets()
    except GitError as e:
        print(f"idiomatic_gate: BLOCK — {e}")
        return 1
    worst = 0
    rows = []
    lied = []  # games that declare idiomaticComplete while cruft remains
    for game in all_games():
        try:
            tot, per, stk = count_in_index(game)
            unl = len(unlifted_addrs(game, True))
        except GitError as e:
            print(f"idiomatic_gate: BLOCK — {game}: {e}")
            return 1
        stk = stk if game in CLOSURE_GAMES else 0  # m.ret/m.pop counted only for closure-enrolled games
        tot += unl + stk  # a reachable routine still served by the oracle + stack primitives are cruft
        budget = budgets.get(game, 0)
        worst = max(worst, tot - budget)
        flag = "OK " if tot <= budget else "OVER"
        tag = "" if game in budgets else " (implicit 0)"
        brk = " ".join(f"{k[:4]}={per[k]}" for k in CATEGORIES)
        if game in CLOSURE_GAMES:
            brk += f" stack={stk} unlifted={unl}"
        complete = declares_complete(game)
        if is_completeness_violation(complete, tot):
            lied.append((game, tot))
        rows.append(f"  [{flag}] {game}: {tot} cruft (budget {budget}{tag})  [{brk}]"
                    + ("  <- IDIOMATIC" if tot == 0 else "")
                    + ("  [idiomaticComplete]" if complete else ""))
    for r in rows:
        print(r)
    if lied:
        for game, tot in lied:
            print(f"\nBLOCK: {game}/manifest.js declares idiomaticComplete: true but its idiomatic layer "
                  f"still holds {tot} cruft (a complete port must be 0). Finish the port or drop the flag.")
        return 1
    if worst > 0:
        print("\nBLOCK: a game's idiomatic layer holds MORE CPU/memory cruft (registers, m.call, "
              "m.push*, m.ret/m.pop*, raw 0xHHHH) than its budget. The allowlist only shrinks — dissolve "
              f"the new cruft or it does not land. Over budget by {worst}.")
        return 1
    return 0


def worklist(game):
    """Per-module, per-category breakdown from the WORKING TREE (the burndown view)."""
    idir = os.path.join("games", game, "idiomatic")
    closure = game in CLOSURE_GAMES
    rows = []
    for path in sorted(glob.glob(os.path.join(idir, "*.js"))):
        if os.path.basename(path) == "names.js":
            continue
        per = counts(open(path, encoding="utf-8").read(), game)
        disp_tot = total(per) + (per["stack"] if closure else 0)
        if disp_tot:
            rows.append((disp_tot, os.path.basename(path), per))
    rows.sort(reverse=True)
    grand = {k: 0 for k in CATEGORIES}
    gstk = 0
    for tot, name, per in rows:
        for k in CATEGORIES:
            grand[k] += per[k]
        gstk += per["stack"]
        brk = " ".join(f"{k[:4]}={per[k]}" for k in CATEGORIES)
        if closure:
            brk += f" stack={per['stack']}"
        print(f"  {tot:4}  {name:44}  " + brk)
    unl = unlifted_addrs(game, False)
    if closure:
        disp = boundary_dispositions(game)  # noqa: F841 (kept for a future disposition column)
        print(f"\n  UNLIFTED — {len(unl)} reachable routine(s) still served by the translated oracle:")
        for a in unl:
            print(f"    loc_{a:04x}")
    gtot = total(grand) + (gstk + len(unl) if closure else 0)
    brk = " ".join(f"{k}={grand[k]}" for k in CATEGORIES)
    if closure:
        brk += f" stack={gstk} unlifted={len(unl)}"
    print(f"\n  {game}: total {gtot}  [{brk}]")
    return 0


def selftest():
    """Positive controls: each category is counted; register exemptions and comment-stripping hold."""
    ok = True

    def want(label, got, exp):
        nonlocal ok
        if got != exp:
            ok = False
            print(f"  FAIL {label}: got {got}, expected {exp}")

    # registers: 2 body refs; a param-default and a return-write are exempt
    reg = "function f(m, x = m.regs.a) {\n  const y = m.regs.b + regs.c;\n  return (m.regs.hl = y);\n}"
    want("registers", counts(reg)["registers"], 2)
    # TIGHT rule (TIGHT_GAMES, e.g. timeplt): a return-write is exempt only when it IS the returned value.
    tg, lg = "timeplt", "galaxian"   # a TIGHT game, and a game on the legacy rule
    want("TIGHT_GAMES holds the tight game", tg in TIGHT_GAMES, True)
    want("legacy game not TIGHT", lg in TIGHT_GAMES, False)
    # outgoing return-writes stay exempt: tuple, object, multi-line, chained through a u16 mask, ternary RHS
    for ok_src in ("return (m.regs.a = v);",
                   "return [m.regs.a = x, m.regs.hl = y];",
                   "return [\n  m.regs.a = x,\n  m.regs.hl = y,\n];",
                   "return { d: (m.regs.d = d), e: u16(m.regs.e = e) };",
                   "return (m.regs.fC = x === undefined ? true : x);",
                   "return c ? (m.regs.a = 1) : (m.regs.a = 2);"):
        want(f"tight return-write exempt: {ok_src!r}", counts(ok_src, tg)["registers"], 0)
    # an INPUT SEAT riding a return is counted: seat-before-call, call argument, void, non-returned comma operand
    for src, n in (("return (regs.ix = X, regs.iy = Y, callee(m));", 2),
                   ("return (\n  regs.ix = X,\n  callee(m)\n);", 1),
                   ("return callee(m, m.regs.de = K);", 1),
                   ("return callee((m.regs.de = K, m));", 1),
                   ("return [regs.c = 1, gather(m, 16)];", 1),
                   ("return void (regs.hl = c, regs.a = s);", 2),
                   ("return (m.regs.ix = r, m.regs.b = n, undefined);", 2),
                   ("return (m.regs.a = v) ? 1 : 0;", 1),
                   ("function f(m) { m.regs.ix = X; return g(m); }", 1),
                   ("function f(m) { return (m.regs.ix = X, g(m)); }", 1)):
        want(f"tight input seat counted: {src!r}", counts(src, tg)["registers"], n)
    # the tight param-default exemption still covers a (multi-line) parameter list
    want("tight param-default exempt", counts("function f(m,\n  x = m.regs.a,\n) {\n  return x;\n}", tg)["registers"], 0)
    # LEGACY rule (every other game) keeps its old result: any write after `return` on the line is exempt,
    # INCLUDING the input seat; the tight rule does not leak to it.
    for src, n in (("return (m.regs.a = v);", 0),
                   ("return [m.regs.a = x, m.regs.hl = y];", 0),
                   ("return (regs.ix = X, regs.iy = Y, callee(m));", 0),
                   ("return callee(m, m.regs.de = K);", 0),
                   ("return void (regs.hl = c, regs.a = s);", 0),
                   ("return (\n  regs.ix = X,\n  callee(m)\n);", 1)):
        want(f"legacy {lg} rule: {src!r}", counts(src, lg)["registers"], n)
        want(f"no-game = legacy rule: {src!r}", counts(src)["registers"], n)
    # m.call + m.push* counted; m.ret/m.pop* counted as stack primitives; a coroutine yield* is not
    ctl = "function g(m) { m.push16(0x0232); m.call(0x1a55); m.pop16(); yield* h(m); return m.ret(); }"
    c = counts(ctl)
    want("calls", c["calls"], 1)
    want("pushes", c["pushes"], 1)          # m.push16 only; ret/pop are NOT pushes
    want("stack", c["stack"], 2)            # m.pop16 + m.ret; m.push16 is NOT stack; yield* uncounted
    # raw 0xHHHH counted in code; a 2-digit value and a hex in a comment are not
    adr = "const K = 0x8040; // see 0x1234 and 0x2673\nmem8[0xa808] = 0x0f;"
    a = counts(adr)
    want("addrs", a["addrs"], 2)  # 0x8040 + 0xa808; 0x0f is 2-digit; the comment ones stripped
    # short-written addresses (SHORT_ADDR_GAMES only): counted in address position, never as a mask/size/offset
    sg = "timeplt"
    want("SHORT_ADDR_GAMES holds timeplt", sg in SHORT_ADDR_GAMES, True)
    for src, n in (("mem8[0xd1b] = 1;", 1),                                   # whole index, leading zero dropped
                   ("const v = mem16[0x7d3];", 1),
                   ("const w = m.mem.read8(0xc78);", 1),
                   ("const RECORDS = 0xd1b;\nlet r = RECORDS;\nconst s = mem16[r];", 1),   # table const via alias
                   ("const SRC = [CELL_A, 0xa9c, 0xc78, 0x7d3];\nfor (const s of SRC) f(m, mem8[s]);", 3),
                   ("const T = 0x7d3;\nconst x = mem8[T];", 1),
                   ("mem8[0x0d1b] = 1;", 1),                                  # 4-digit: ADDR's alone, no double count
                   ("const y = x & 0x7f;", 0),                                # mask
                   ("mem8[BASE + 0x400] = 1;", 0),                            # plane offset off a named base
                   ("const N = 0x800;\nfor (let i = 0; i < N; i++) mem8[BASE + i] = 0;", 0),   # size
                   ("const c = BASE + 8;\nmem8[c] = 1;", 0),                 # arithmetic initializer
                   ("const K = 0x100;\nlet p = K + BASE;\nmem8[p] = 0;", 0)):   # not a plain alias
        want(f"short addr {sg}: {src!r}", counts(src, sg)["addrs"], n)
    want("short addr opt-in: legacy game not counted", counts("mem8[0xd1b] = 1;", lg)["addrs"], 0)
    # closure parsing: a translated-registry row and a ROUTINES key are recognised; a plain const is not
    want("registry-row", bool(REG_ENTRY.match("  [0x0ff1, loc_0ff1],")), True)
    want("routine-key", bool(ROUTINE_KEY.match('  0x0ff1: { name: "renderX" },')), True)
    want("not-a-routine-key", bool(ROUTINE_KEY.match("  const K = 0x8040;")), False)
    # idiomaticComplete flag parsing: only a `: true` declaration counts (false/absent do not)
    want("complete-true", bool(COMPLETE_RE.search("  idiomaticComplete: true,")), True)
    want("complete-false", bool(COMPLETE_RE.search("  idiomaticComplete: false,")), False)
    want("complete-absent", bool(COMPLETE_RE.search('  runtime: "idiomatic",')), False)
    want("complete-commented", bool(COMPLETE_RE.search("  // idiomaticComplete: true")), False)
    want("lie: complete+cruft", is_completeness_violation(True, 5), True)
    want("lie: complete+clean", is_completeness_violation(True, 0), False)
    want("lie: dirty+unflagged", is_completeness_violation(False, 5), False)
    if ok:
        print("idiomatic_gate selftest: OK")
    return 0 if ok else 1


def main():
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("check")
    w = sub.add_parser("worklist")
    w.add_argument("game")
    sub.add_parser("selftest")
    args = p.parse_args()
    if args.cmd == "check":
        return check()
    if args.cmd == "worklist":
        return worklist(args.game)
    if args.cmd == "selftest":
        return selftest()
    return 2


if __name__ == "__main__":
    sys.exit(main())
