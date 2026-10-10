#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""Idiomatic gate — the idiomatic layer must be truly idiomatic, with no old CPU/memory cruft.

Runbook goal (§5 definition of done): a finished idiomatic module names its data and control flow,
never the machine. Six kinds of cruft are counted, all of which must reach 0 for a game to be
IDIOMATIC (a hard done requirement):
  - REGISTERS: `regs.a` / ALU helpers (however spelled: `m["regs"]`, an alias, a field destructure), minus two exempt bridges — a param-default (`fn(m, x=m.regs.a)`)
    and a write riding a return (`return (m.regs.a=v)`). For a TIGHT_GAMES game the return-write
    exemption is narrower: the write must BE the return's value (a seat before a call is NOT exempt).
  - m.call(...) — dissolve to a direct JS call (or `yield*`). m.push16/* — Z80 stack trampolines.
    (m.ret / m.pop* are Z80 stack primitives too, but counted only for CLOSURE games (as `stack`) and
    TIGHT_GAMES (as pushes), so a frozen legacy game's budget is not re-baselined by the gate newly seeing them.)
    For a TIGHT game this is a WHITELIST (machine_hits): a Machine PRIMITIVE named on any receiver in any
    spelling counts, and any other member of a machine parameter outside SANCTIONED[game] counts as `mem`.
  - raw 0xHHHH — a bare address (any case, zero-padded or `_`-separated, or any other JS numeric spelling of
    its value: canon_literals); use a named import from names.js. SHORT_ADDR games also fold `lit << 8` pages.
    For a SHORT_ADDR_GAMES game (e.g. timeplt) an address written short (0xd1b, decimal) is counted too, in
    address position: an index base, a call's address slot, a binding reaching either, or 0x100+ (short_addr_hits).
  - mem.read8/write8/read16/write16(...) — the low-level API; idiomatic is the indexed view `mem8[addr]`
    (plus, for a TIGHT game, an unsanctioned machine member).
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
# machine stack). Counted for CLOSURE games and TIGHT_GAMES only: galaxian, dkong and thepit still hold
# some, and their frozen budgets are not re-baselined by making the gate newly see them.
STACK = re.compile(r"\bm\.(?:ret|pop\w*)\(")
# 4+ hex digits of a 16-bit value, case-blind and however padded: 0xad30, 0XAD30, 0x0ad30, 0x0_d1b.
ADDR = re.compile(r"(?<![0-9A-Za-z$])0[xX](?:_?[0-9a-fA-F])+(?![\w$])")
MEM = re.compile(r"\bmem\.(?:read|write)(?:8|16)\(")  # low-level machine API; idiomatic form is mem8[addr]
# Redundant width-mask on a mem assignment: mem8[..]=..&0xff (write8 truncates) / mem16[..]=..&0xffff
# (write16 truncates). The mask must be the outermost op on the RHS (right before `;`), width-matched.
MASK8 = re.compile(r"\bmem8\[[^\]]*\]\s*=[^;=]*&\s*0x[fF][fF]\s*;")
MASK16 = re.compile(r"\bmem16\[[^\]]*\]\s*=[^;=]*&\s*0x[fF]{4}\s*;")
# A non-canonical whole-view alias (`const foo = m.mem8;`) would hide `foo[x]=..&0xff` masks; forbid it.
# The `const {mem8,mem16} = m` destructure and byte reads `const v = m.mem8[x]` do not match.
ALIAS = re.compile(r"\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*m\.mem(?:8|16)\s*;")

# --- a raw address written SHORT (1-3 hex digits, or decimal), which ADDR's 4-digit form cannot see ---
# A bare "any short hex" rule would count every mask, count, size and plane offset, so a short literal
# counts only where an address goes (per SHORT_ADDR_GAMES game; a 4+-digit literal is ADDR's, never both):
#   (A) the LEFTMOST operand of a memory index -- the base, not the offset: mem8[0xd1b], mem8[(0xd1b) | 0],
#       mem8[0x7d3 + i], mem.read8(0xc78);
#   (B) a binding (value >= 0x10) whose value starts with a literal (`let p = (0xd1b)`, `p = 0xd1b + 2`, `{ base: 0xd1b }`),
#       or a literal-and-names table (`const SRC = [CELL_A, 0xa9c]`), that reaches an address position --
#       an index base or an address slot below -- itself, as `.base`, or through one plain alias;
#   (C) a call argument in an ADDRESS SLOT: a (callee, position) that some call site in the game fills
#       with a names.js address (`fetchTableByte(m, HEADING_SHAPE_TABLE, i)` makes slot 1 an address);
#   (M) any value 0x100..0xffff that is not a size/mask shape (2^k, 2^k-1), anywhere -- except the whole
#       initializer of `const NAME = <lit>` whose NAME and value are in the reviewed idiomatic-sizes.txt.
# An offset added to a base (mem8[record + 0x0e]), a mask, a loop bound and a 2^k size never count.
# Residual: a value below 0x100 reached only through derived bindings (rec = 0x7d + 4*s; mem8[rec + 1]) is not tracked.
_LIT = re.compile(r"(?<![\w$.])(?:0[xX][0-9a-fA-F](?:_?[0-9a-fA-F])*|\d(?:_?\d)*)(?![\w$.])")
_TOK = re.compile(r"[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*")
_IDX_OPEN = re.compile(r"\bmem(?:8|16)\[|\b(?:mem|m)\.(?:read|write)(?:8|16)\(")
_BIND = re.compile(r"(?<![\w$.])([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*(=(?![=>])|:(?!:))")
_SIZE_DECL = re.compile(r"(\bexport\s+)?\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*"
                        r"(0[xX][0-9a-fA-F](?:_?[0-9a-fA-F])*|\d(?:_?\d)*)\s*;")
_TABLE_INIT = re.compile(r"^[\s\w$\[\],]*$")   # literals, names, commas and brackets only -- no operator
_NAMES_IMPORT = re.compile(r"\bimport\s*\{([^}]*)\}\s*from\s*[\"']\./names\.js[\"']")
_ADDR_EXPORT = re.compile(r"^export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*0[xX][0-9a-fA-F]{4}\s*;", re.M)


def _lit_val(t):
    t = t.replace("_", "")
    return int(t, 16) if t[:2] in ("0x", "0X") else int(t)


def _is_long(t):
    """ADDR's form: 4+ hex digits (zero-padding, `0X` and `_` separators included) of a 16-bit value."""
    d = t.replace("_", "")
    return d[:2] in ("0x", "0X") and len(d) >= 6 and int(d, 16) <= 0xFFFF


def _big(v):
    return 0x100 <= v <= 0xFFFF and v & (v - 1) and (v + 1) & v


def _lead(s, a, b):
    """(kind, text, pos) of the leftmost primary of s[a:b], through parens, unary +/- and u8()/u16()."""
    while True:
        while a < b and (s[a].isspace() or s[a] in "(+-"):
            a += 1
        u = re.compile(r"(?:u8|u16)\s*\(").match(s, a, b)
        if not u:
            break
        a = u.end()
    for kind, rx in (("lit", _LIT), ("name", _TOK)):
        m = rx.match(s, a, b)
        if m:
            return kind, m.group(0), m.start()
    return None, "", a


def _arg_spans(code):
    """(callee, position, start, end) of every call argument (a u8()/u16() mask is no callee)."""
    for c in _CALL_AT.finditer(code):
        if c.group(1) in _NOT_CALL or c.group(1) in _PURE:
            continue
        o = c.end() - 1
        for i, (pa, pb) in enumerate(_split(code, o + 1, _close(code, o), ",")):
            yield c.group(1), i, pa, pb


def _index_spans(code):
    for x in _IDX_OPEN.finditer(code):
        o = x.end() - 1
        yield o + 1, (_split(code, o + 1, _close(code, o), ",")[0][1])


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


def address_slots(texts, names_js):
    """{(callee, position)} that some call site in `texts` fills with a names.js address (rule C)."""
    addrs = set(_ADDR_EXPORT.findall(names_js))
    out = set()
    for text in texts:
        code = strip_comments(text)
        local = {n.split(" as ")[-1].strip(): n.split(" as ")[0].strip()
                 for g in _NAMES_IMPORT.findall(code) for n in g.split(",")}
        for f, i, pa, pb in _arg_spans(code):
            kind, tok, _ = _lead(code, pa, pb)
            if kind == "name" and local.get(tok) in addrs:
                out.add((f, i))
    return out


def short_addr_hits(code, slots=frozenset(), sizes=frozenset()):
    """Short-written raw addresses in comment-stripped `code` (rules A, B, C, M above): list of literals."""
    hits = {}
    leads, slot_leads, arg_leads = set(), set(), set()

    def lead_hit(kind, tok, pos):
        if kind == "lit" and not _is_long(tok):
            hits[pos] = tok

    idx_text = []
    for a, b in _index_spans(code):
        idx_text.append(code[a:b])
        k, t, p = _lead(code, a, b)
        lead_hit(k, t, p) if k == "lit" else leads.add(t)
    for f, i, pa, pb in _arg_spans(code):
        k, t, p = _lead(code, pa, pb)
        if (f, i) in slots:
            lead_hit(k, t, p) if k == "lit" else slot_leads.add(t)
        if k == "name":
            arg_leads.add(t)

    def reaches(name, pool):
        hit = lambda t: t == name or (name[0] == "." and t.endswith(name))
        if any(hit(t) for t in pool):
            return True
        if name[0] == ".":
            return False
        alias = r"\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?:=(?!=)|\s+of\b)"
        for d in re.finditer(alias, code):
            init = code[d.end():_initializer(code, d.end())]
            if re.search(r"(?<![\w$.])" + re.escape(name) + r"(?![\w$])", init) and \
                    set(_TOK.findall(init)) <= {name, "u8", "u16"} and d.group(1) in pool:
                return True
        return False

    named_sizes = {m.start(3) for m in _SIZE_DECL.finditer(code) if not m.group(1) and (m.group(2), _lit_val(m.group(3))) in sizes}
    for d in _BIND.finditer(code):
        name, end = d.group(1), _initializer(code, d.end())
        if d.group(2) == ":" or "." in name:
            name = "." + name.rsplit(".", 1)[-1]
        init = code[d.end():end]
        k, t, p = _lead(code, d.end(), end)
        lits = [(m.start() + d.end(), m.group(0)) for m in _LIT.finditer(init)
                if not _is_long(m.group(0)) and _lit_val(m.group(0)) >= 0x10]
        table = init.strip().startswith("[") and _TABLE_INIT.match(init)
        if not (k == "lit" or table) or not lits:
            continue
        if reaches(name, leads | slot_leads):
            for pos, tok in (lits if table else [(p, t)]):
                if not _is_long(tok) and _lit_val(tok) >= 0x10:
                    hits[pos] = tok
    for m in _LIT.finditer(code):
        if m.start() not in named_sizes and not _is_long(m.group(0)) and _big(_lit_val(m.group(0))):
            hits[m.start()] = m.group(0)
    return list(hits.values())


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


# --- TIGHT_GAMES machine surface: a WHITELIST, so a primitive added to a Machine later is still seen ---
# The CPU-level operations of every games/*/machine.js Machine class and of core/cpu's register files: a
# member mention of one of these names counts on ANY receiver (`mc.call`, `m['push16']`, `{ ret } = m`).
PRIMITIVES = frozenset({
    "call", "ret", "rti", "step", "tick", "ldi", "ldir", "ldirAt", "lddrAt", "fireNmi", "fireIrq", "fireInt",
    "restartMain", "push8", "push16", "pop16", "pull8", "pull16", "exAf", "exx", "exDeHl", "ldAI", "djnz",
    "daa", "cpi", "cpir", "rlca", "rrca", "rla", "rra", "addHl", "adcHl", "sbcHl", "addIx", "addIy",
    "incMem8", "decMem8", "add16", "scf", "ccf", "cpl"})
_PRIM_FAMILY = re.compile(r"(?:push|pop|pull)\d+|ldir\w*|lddr\w*")
# What an idiomatic module may touch on its machine parameter. `regs` is policed by the register rule.
SANCTIONED = {"timeplt": frozenset({"mem8", "mem16", "regs", "beamPlan", "paintBeamBand"})}
_ID = r"[A-Za-z_$][\w$]*"
_MEMBER = re.compile(r"(" + _ID + r")?\s*(?<!\.)(?:\?\.|\.(?!\.))\s*(" + _ID + r")"
                     r"|(" + _ID + r")?\s*(?:\?\.)?\s*\[\s*(['\"`])(" + _ID + r")\4\s*\]")
_DESTRUCTURE = re.compile(r"\{([^{}]*)\}\s*=(?![=>])\s*(" + _ID + r")?")
MACHINE_NAMES = frozenset({"m", "mc", "machine"})
_PLAIN_ALIAS = re.compile(r"(?:\b(?:const|let|var)\s+|,\s*)(" + _ID + r")\s*=\s*(" + _ID + r")\s*(?=[;,\n])")
_MACHINE_PARAM = re.compile(r"\bexport\s+(?:default\s+)?(?:async\s+)?(?:function\s*\*?\s*" + _ID
                            + r"\s*\(|const\s+" + _ID + r"\s*=\s*(?:async\s*)?(?:function\s*\*?\s*)?\(?)\s*(" + _ID + ")")


def member_mentions(code):
    """(receiver or None, member) for every `.x` / `?.x` (whitespace and newlines allowed), string-keyed
    `["x"]`, and destructured key `{ x } = expr` in comment-stripped `code`."""
    out = [(d.group(1) or d.group(3), d.group(2) or d.group(5)) for d in _MEMBER.finditer(code)]
    for d in _DESTRUCTURE.finditer(code):
        for part in d.group(1).split(","):
            key = part.split(":")[0].strip().lstrip(".").strip()
            if re.fullmatch(_ID, key):
                out.append((d.group(2), key))
    return out


def is_primitive(name):
    return name in PRIMITIVES or bool(_PRIM_FAMILY.fullmatch(name))


def machine_hits(code, game):
    """(calls, pushes, unsanctioned) for a TIGHT game: primitive mentions on any receiver (`call` is a call,
    the rest stack/CPU ops), plus any other member of a machine -- an exported function's first parameter,
    any `m`/`mc`/`machine`, or a plain alias of one -- outside SANCTIONED[game]."""
    params = set(_MACHINE_PARAM.findall(code)) | MACHINE_NAMES
    while True:
        more = {a for a, b in _PLAIN_ALIAS.findall(code) if b in params} - params
        if not more:
            break
        params |= more
    allowed = SANCTIONED.get(game, frozenset({"mem8", "mem16", "regs"}))
    calls = pushes = other = 0
    for recv, name in member_mentions(code):
        if is_primitive(name):
            calls += name == "call"
            pushes += name != "call"
        elif recv in params and name not in allowed:
            other += 1
    return calls, pushes, other


def _normalize_regs(code):
    """Rewrite hidden register-file spellings to `regs.X` so the register rule sees them: `m["regs"]`,
    `regs["a"]`, `?.`, an alias (`const r = m.regs` / `{ regs: r } = m`; the escape itself counts), and a
    destructure of register fields (`const { a, hl } = m.regs`)."""
    code = re.sub(r"\b(" + _ID + r")\s*\??\.?\s*\[\s*(['\"`])regs\2\s*\]", r"\1.regs", code)
    code = re.sub(r"\b(m|regs)\s*\?\.\s*", r"\1.", code)
    code = re.sub(r"\bregs\s*\.\s*", "regs.", code)
    code = re.sub(r"\bregs\s*\[\s*(['\"`])([A-Za-z]\w*)\1\s*\]", r"regs.\2", code)
    code = re.sub(r"\bregs\s*\[", "regs.dynamic[", code)
    code = re.sub(r"\{([^{}]*)\}(\s*=\s*(?:m\.)?regs\b(?!\.))",
                  lambda d: "{" + ", ".join("regs." + f.split(":")[0].strip()
                                            for f in d.group(1).split(",") if f.strip()) + "}" + d.group(2), code)
    code = re.sub(r"\bregs\s*:\s*\{([^{}]*)\}", lambda d: "regs: {" + ", ".join(
        "regs." + f.split(":")[0].strip() for f in d.group(1).split(",") if f.strip()) + "}", code)
    aliases = re.findall(r"\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:m\.)?regs\s*(?=[;,\n)])", code)
    aliases += re.findall(r"\{[^{}]*\bregs\s*:\s*([A-Za-z_$][\w$]*)[^{}]*\}\s*=\s*m\b", code)
    code = re.sub(r"\bm\.regs\b(?!\.)", "m.regs.file", code)
    for a in set(aliases) - {"regs"}:
        code = re.sub(r"(?<![\w$.])" + re.escape(a) + r"\s*(?:\.|(?=\[))\s*", "regs.", code)
    return re.sub(r"\bregs\.\[", "regs.dynamic[", code)


_NUMTOK = re.compile(r"(?<![\w$.])(?:0[xX][0-9a-fA-F_]+|0[oObB][0-9_]+|(?:\d[\d_]*(?:\.[\d_]*)?|\.\d[\d_]*)"
                     r"(?:[eE][+-]?\d+)?)n?(?![\w$.])")


def canon_literals(code):
    """Rewrite every JS numeric spelling that _LIT/ADDR cannot read -- 0o/0b, legacy octal, a fraction or
    exponent, a BigInt `n` -- to the hex of its integer value (a non-integer is left alone)."""
    def canon(t):
        s = t.group(0)
        b = (s[:-1] if s.endswith("n") else s).replace("_", "")
        if b == s.replace("_", "") and (b[:2] in ("0x", "0X") or re.fullmatch(r"[1-9]\d*|0", b)):
            return s
        try:
            v = int(b, 0) if b[:2].lower() in ("0x", "0o", "0b") else int(b, 8) if re.fullmatch(r"0[0-7]+", b) \
                else float(b)
        except ValueError:
            return s
        return s if v != int(v) else f"0x{int(v):x}"
    return _NUMTOK.sub(canon, code)


_PAGE = re.compile(r"(?<![\w$.])(0x[0-9a-fA-F]+|\d+)\s*(?:<<\s*8|\*\s*(?:256|0x100))(?![\w$.])"
                   r"|(?<![\w$.])(?:256|0x100)\s*\*\s*(0x[0-9a-fA-F]+|\d+)(?![\w$.])")


def fold_pages(code):
    """SHORT_ADDR_GAMES: fold a page composition `lit << 8` / `lit * 256` (lit >= 0x10) into its value, so
    ADDR sees `mem8[lo | (0xad << 8)]` as 0xad00. Kept unfolded, as a mask: an operand of `&`, and outside
    a memory index the high-byte fill 0xff00 (`c ? (0xff << 8) : 0`). 0xc0 << 8 is a page (I/O), not a mask."""
    spans = list(_index_spans(code))

    def fold(d):
        v = int(d.group(1) or d.group(2), 0) << 8
        before, after = code[:d.start()].rstrip(" (\n"), code[d.end():].lstrip(" )\n")
        and_operand = (before.endswith("&") and not before.endswith("&&")) or \
            (after.startswith("&") and not after.startswith("&&"))
        in_index = any(a <= d.start() < b for a, b in spans)
        high_mask = v == 0xFF00 and not in_index
        return d.group(0) if not 0x1000 <= v <= 0xFFFF or and_operand or high_mask else f"0x{v:04x}"
    return _PAGE.sub(fold, code)


def counts(text, game=None, slots=frozenset(), sizes=frozenset()):
    """Per-category cruft counts for one module's source text. The CATEGORIES keys are always-counted
    (baked into every game's budget); "stack" (m.ret/m.pop*) is a separate addend the callers apply only
    for CLOSURE_GAMES (TIGHT_GAMES fold it into "pushes"), so it is returned but excluded from total(). `slots` feeds rule C (address_slots), `sizes` rule M (read_sizes)."""
    code = canon_literals(strip_comments(text))
    if game in SHORT_ADDR_GAMES:
        code = fold_pages(code)
    if game in TIGHT_GAMES:
        calls, pushes, other = machine_hits(code, game)
    else:
        calls, pushes, other = len(CALL.findall(code)), len(PUSH.findall(code)), 0
    return {
        "registers": len(register_hits(_normalize_regs(code), tight=game in TIGHT_GAMES)),
        "calls": calls,
        "pushes": pushes,
        "addrs": (sum(1 for t in ADDR.findall(code) if _is_long(t))
                  + (len(short_addr_hits(code, slots, sizes)) if game in SHORT_ADDR_GAMES else 0)),
        "mem": len(MEM.findall(code)) + other,
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


def _game_slots(game, texts, from_index):
    """Rule C's address slots for a SHORT_ADDR game (empty otherwise, or with no names.js)."""
    if game not in SHORT_ADDR_GAMES:
        return frozenset()
    try:
        names_js = _read(f"games/{game}/idiomatic/names.js", from_index)
    except (GitError, OSError):
        return frozenset()
    return address_slots(texts, names_js)


def read_sizes(game, from_index):
    """{(NAME, value): reason} from games/<game>/idiomatic-sizes.txt (rule M's reviewed sizes); {} if absent.
    Fail closed on a malformed line."""
    path = f"games/{game}/idiomatic-sizes.txt"
    try:
        text = _read(path, from_index)
    except (GitError, OSError):
        return {}
    return parse_sizes(text, path)


def parse_sizes(text, path):
    """`NAME  VALUE  reason` lines: the entry pins the value, so the const cannot later be re-pointed."""
    out = {}
    for raw in text.splitlines():
        parts = raw.split("#", 1)[0].split(None, 2)
        if parts and (len(parts) < 3 or not _LIT.fullmatch(parts[1])):
            raise GitError(f"entry needs NAME VALUE reason in {path}: {raw.strip()}")
        if parts:
            out[(parts[0], _lit_val(parts[1]))] = parts[2].strip()
    return out


def stale_sizes(sizes, texts):
    """Entries that no module declares as `const NAME = VALUE` (VALUE 0x100..0xffff, not 2^k/2^k-1)."""
    live = {(m.group(2), _lit_val(m.group(3))) for t in texts for m in _SIZE_DECL.finditer(strip_comments(t))
            if not m.group(1) and _big(_lit_val(m.group(3)))}
    return sorted(f"{n}={v}" for n, v in set(sizes) - live)


def _game_sizes(game, texts, from_index):
    sizes = read_sizes(game, from_index)
    stale = stale_sizes(sizes, texts)
    if stale:
        raise GitError(f"stale entry in games/{game}/idiomatic-sizes.txt: {', '.join(stale)}")
    return frozenset(sizes) if game in SHORT_ADDR_GAMES else frozenset()


def count_in_index(game):
    """Total cruft in the STAGED content, matching the other gates. Returns (total, per_category, stack)
    where stack (m.ret/m.pop*) is a closure-only addend the caller applies, not part of total()."""
    agg = {k: 0 for k in CATEGORIES}
    stk = 0
    blobs = []
    for path in _modules_in_index(game):
        try:
            blobs.append(git(["show", f":{path}"]))
        except GitError:
            continue
    slots, sizes = _game_slots(game, blobs, True), _game_sizes(game, blobs, True)
    for blob in blobs:
        c = counts(blob, game, slots, sizes)
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
    paths = [p for p in sorted(glob.glob(os.path.join(idir, "*.js"))) if os.path.basename(p) != "names.js"]
    texts = [open(p, encoding="utf-8").read() for p in paths]
    try:
        slots, sizes = _game_slots(game, texts, False), _game_sizes(game, texts, False)
    except GitError as e:
        print(f"idiomatic_gate: BLOCK — {game}: {e}")
        return 1
    for path, text in zip(paths, texts):
        per = counts(text, game, slots, sizes)
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
    # every game: ADDR is case-blind and sees zero-padding and `_` separators; 0x10000 is no 16-bit address
    for src, n in (("mem8[0XAD30] = 1;", 1), ("mem8[0x0ad30] = 1;", 1), ("f(m, 0x0_d1b);", 1),
                   ("g(m, 0X3C84, i);", 1), ("const W = 0x10000;", 0), ("const B = 0x000ff;", 1)):
        want(f"addr any game: {src!r}", counts(src, lg)["addrs"], n)
    # the R40 mutants: a short base in an index, a call's address slot, a literal-based binding, magnitude
    names = "export const CAPTION_RECORD_TABLE = 0x0c50;\nexport const PEN = 0xad0c;\n"
    caller = 'import { CAPTION_RECORD_TABLE } from "./names.js";\nconst r = fetchWideTableWord(m, CAPTION_RECORD_TABLE, i);'
    slots = address_slots([caller], names)
    want("address slot found", slots, {("fetchWideTableWord", 1)})
    want("a shadowing local is no slot", address_slots(["const PEN = 16;\npaint(m, x, PEN);"], names), set())
    for src, n in (("const r = fetchWideTableWord(m, 0xc50, i);", 1),
                   ("const r = fetchWideTableWord(m, 0x50, i);", 1),         # small value, but an address slot
                   ("const T = 0x50;\nconst r = fetchWideTableWord(m, T, i);", 1),
                   ("const r = fetchWideTableWord(m, (0xc50) | 0, i);", 1),
                   ("const r = fetchWideTableWord(m, 3152, i);", 1),
                   ("const v = mem8[0x7d3 + i];", 1), ("const v = mem8[i + 0x7d3];", 1),
                   ("const v = mem8[u16(0x7d + i)];", 1), ("const v = mem8[0xd1b | 0];", 1),
                   ("let p;\np = 0xd1b;\nconst v = mem8[p];", 1), ("let r = (0x7d);\nconst v = mem8[r];", 1),
                   ("const ZL = 0xd1b + 2;", 1), ("const ZL = 0x7d + 2;\nmem8[ZL] = 0;", 1),
                   ("const T = { base: 0x7d };\nconst v = mem8[T.base + i];", 1),
                   ("t.base = 0x7d;\nconst v = mem8[t.base];", 1), ("const R = 0x7d | 0;\nmem8[R] = 1;", 1),
                   ("const STEP = 384;\nf(m, STEP);", 1),                     # a non-2^k "size" passed raw
                   ("const RECORDS = 0xd1b;\nconst p = RECORDS + i;\nreturn mem8[p];", 1),
                   ("const RECORDS = 0xd1b;\nconst a = RECORDS + 4 * slot;\nconst hi = mem8[a + 1];", 1),
                   ("const RECORDS = 0xd1b;\nreturn mem8[i + RECORDS];", 1), ("export const RECORDS = 0xd1b;", 1),
                   ("const W = 768;\nfor (; i < W;) i++;", 1),                # not allowlisted
                   ("let p = 0;\nconst v = mem8[p];", 0),                      # rule B ignores values < 0x10
                   ("let p = 1 + 0x40;\nconst v = mem8[p];", 0),
                   ("const v = mem8[record + 0x0e];", 0), ("const v = mem8[u16(iy + 0x31)];", 0),
                   ("const r = fetchWideTableWord(m, CAPTION_RECORD_TABLE, 7);", 0),   # index slot, not base
                   ("paint(m, x, 0x10);", 0), ("const y = (x & 0x3ff) + 0x400;", 0),
                   ("const T = { n: 0x7d };\nf(T.n);", 0), ("const S = 0x7d;\nf(m, S);", 0)):
        want(f"short addr {sg} (slots): {src!r}", counts(src, sg, slots)["addrs"], n)
    # rule M needs no inference: a derived address counts however it travels (the reviewer's chains)
    for tail in ("const rec = BASE + 4 * s;\nconst hi = rec + 1;\nreturn mem8[hi];",
                 "const rec = BASE + 4 * s;\nconst hi = rec + 1;\nreturn f(m, hi);",
                 "let p = i;\np += BASE;\nreturn mem8[p];",
                 "const [p, q] = [BASE + i, BASE + i + 1];\nreturn mem8[p];",
                 "const addrs = [BASE, BASE + 2];\nfor (const a of addrs) mem8[a] = 0;",
                 "function at(i) { return BASE + 2 * i; }\nreturn mem8[at(i)];"):
        want(f"rule M chain: {tail!r}", counts("const BASE = 0xd1b;\n" + tail, sg, slots)["addrs"], 1)
    sizes = {("STEP", 384), ("LEN", 768)}
    for src, n in (("const STEP = 384;\nx += STEP;", 0), ("const LEN = 768;\nfor (; i < LEN;) i++;", 0),
                   ("export const STEP = 384;", 1), ("let STEP = 384;", 1), ("const STEP = 384 + 0;", 1),
                   ("const STEP = 0xd1b;", 1), ("const STEP =\n  0xd1b;", 1), ("const LEN = 3355;", 1)):
        want(f"size allowlist: {src!r}", counts(src, sg, slots, sizes)["addrs"], n)
    want("stale size entry", stale_sizes({("STEP", 384): "r", ("GONE", 384): "r"}, ["const STEP = 384;"]), ["GONE=384"])
    want("re-pointed size is stale", stale_sizes({("STEP", 384): "r"}, ["const STEP = 0xd1b;"]), ["STEP=384"])
    for bad in ("STEP\n", "STEP   # reason only in a comment\n", "STEP 384\n", "STEP a velocity\n"):
        try:
            parse_sizes(bad, "x")
            want(f"malformed size entry blocks: {bad!r}", "parsed", "GitError")
        except GitError:
            pass
    want("size entry parsed", parse_sizes("# c\nSTEP  384  a velocity\n", "x"), {("STEP", 384): "a velocity"})
    want("a 2^k const is no size entry", stale_sizes({("N", 0x400): "r"}, ["const N = 0x400;"]), ["N=1024"])
    # hidden register-file spellings are counted for every game; m.pop*/m.ret count as pushes for TIGHT_GAMES
    for src, n in (('const v = m["regs"].a;', 1), ("const r = m.regs;\nconst v = r.a;", 2),
                   ("const { a, hl } = m.regs;", 3), ("const { regs: q } = m;\nq.a = 1;", 1),
                   ("const v = m.regs['a'] + m?.regs?.b + regs [k];", 3), ("const { regs, mem8 } = m;", 0),
                   ("const { regs: { a } } = m;", 1)):
        want(f"register spelling: {src!r}", counts(src, lg)["registers"], n)
    # TIGHT machine surface: a primitive on any receiver/spelling counts; an unsanctioned member of the
    # exported function's machine parameter counts as `mem`; an Array method or a sanctioned member does not
    fn = "export function f(m) {\n  %s\n}"
    for src, cat, n in (("m.ldirAt(f, NEXT);", "pushes", 1), ("m.lddrAt(f, NEXT);", "pushes", 1),
                        ("m.ldi(NEXT);", "pushes", 1), ("m.step(NEXT, 7);", "pushes", 1), ("m.tick(7);", "pushes", 1),
                        ("m.fireNmi();", "pushes", 1), ("m['call'](X);", "calls", 1), ("m.call?.(X);", "calls", 1),
                        ("m\n    .call(X);", "calls", 1), ("const { call } = m;", "calls", 1),
                        ("m.call.apply(m, [X]);", "calls", 1), ("const c = m.call.bind(m);", "calls", 1),
                        ("m.push16 (X);", "pushes", 1), ("m['push16'](X);", "pushes", 1), ("m.ret ();", "pushes", 1),
                        ("m?.pop16();", "pushes", 1), ("m.exx();", "pushes", 1), ("o.step += 1;", "pushes", 1),
                        ("m.io.write(1, 2);", "mem", 1), ("m.cycles += 4;", "mem", 1), ("const { pc } = m;", "mem", 1),
                        ("m.halt();", "mem", 1), ("m?.cycles;", "mem", 1), ("m\n    .cycles;", "mem", 1), ("m['halt']();", "mem", 1),
                        ("const { mem8, mem16, regs } = m;", "mem", 0), ("if (m.beamPlan) m.beamPlan.push(e);", "pushes", 0),
                        ("m.paintBeamBand(r);", "mem", 0), ("xs.map(f).push(1); xs.pop();", "pushes", 0)):
        want(f"machine surface {tg}: {src!r}", counts(fn % src, tg)[cat], n)
    for src in ("function h(mc) { return mc.io.read(1); }", "function h(mc) { return mc.vpos(); }",
                "const h = (mc) => mc.cycles;", "const mm = m;\nmm.io.write(1);", "const a = m, b = a;\nb.cycles;",
                "function h(machine) { return machine.frames; }"):
        want(f"machine alias/helper: {src!r}", counts(src, tg)["mem"], 1)
    want("non-machine local", counts("const o = { io: 1 };\nconst v = o.io + q.cycles;", tg)["mem"], 0)
    want("helper machine param", counts("function h(mc) { mc.call(X); mc.push16(Y); }", tg)["calls"], 1)
    want("helper mc['regs']", counts("function h(mc) { return mc['regs'].a; }", tg)["registers"], 1)
    want("machine surface opt-in", counts(fn % "m.step(1, 2); m.io.x = 1;", lg)["pushes"], 0)
    # every JS numeric spelling is read as its value; SHORT_ADDR page compositions fold to their address
    for src, n in (("mem8[0o126460] = 1;", 1), ("mem8[0b1010110100110000] = 1;", 1), ("mem8[44336.0] = 1;", 1),
                   ("mem8[4.4336e4] = 1;", 1), ("const A = 0xad30n;", 1), ("mem8[0O126460] = 1;", 1),
                   ("const h = 0.5 * x;", 0), ("const n = 12;", 0)):
        want(f"literal spelling: {src!r}", counts(src, lg)["addrs"], n)
    for src, n in (("mem8[lo | (0xad << 8)] = 1;", 1), ("mem8[lo + 0xad * 256] = 1;", 1),
                   ("const at = hi | (0xad << 8);", 1), ("mem8[0x100 * 0xad + lo] = 1;", 1),
                   ("const hb = c ? (0xff << 8) : 0;", 0), ("const p = x & (0xf0 << 8);", 0),
                   ("return m.mem8[i + (0x3c << 8)];", 1), ("return m.mem8[i | 0x3c << 8];", 1),
                   ("return m.mem8[i + 0x3c * 256];", 1), ("const at = lo | (0x3c << 8);\nreturn m.mem8[at];", 1),
                   ("return m.mem8[(0xc0 << 8) | i];", 1), ("const io = (0xc0 << 8) | 0x20;", 1),
                   ("return m.mem8[(point & (0xff << 8)) | u8(point - 1)];", 0),
                   ("const PAGE_MASK = 0xff << 8;", 0),
                   ("return m.mem8[i | (0xff << 8)];", 1),
                   ("const c = 0x04 << 8;", 0), ("const w = (7 << 8) | 1;", 0)):
        want(f"page fold {sg}: {src!r}", counts(src, sg)["addrs"], n)
    want("page fold opt-in", counts("mem8[lo | (0xad << 8)] = 1;", lg)["addrs"], 0)
    want("pop/ret are pushes for TIGHT", counts("m.pop16(); m.pop8(); m.ret();", tg)["pushes"], 3)
    want("pop/ret not pushes for legacy", counts("m.pop16(); m.ret();", lg)["pushes"], 0)
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
