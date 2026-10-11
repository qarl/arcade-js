#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""Idiomatic gate — the idiomatic layer must be truly idiomatic, with no old CPU/memory cruft.

Runbook goal (§5 definition of done): a finished idiomatic module names its data and control flow,
never the machine. Six kinds of cruft are counted, all of which must reach 0 for a game to be
IDIOMATIC (a hard done requirement):
  - REGISTERS: `regs.a` / ALU helpers (however spelled: `m["regs"]`, an alias, a field destructure), minus two exempt bridges — a param-default (`fn(m, x=m.regs.a)`)
    and a write riding a return (`return (m.regs.a=v)`). For a TIGHT_GAMES game the return-write
    exemption is narrower: the write must BE the return's value (a seat before a call is NOT exempt), and
    the param-default is exempt only in an exported routine's own parameter list, never as `r = m.regs`.
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
  - imports (TIGHT_GAMES): an import from outside the layer that is not on the reviewed allowlist
    (IMPORT_PURE / IMPORT_NAMED, each re-verified free of machine surface on every run).
  - for SHORT_ADDR_GAMES, `addrs` also counts an OFFSET ALIAS: `NAME +/- offset` (NAME a names.js import or a
    local alias or straight-line cursor of one; offset a literal or a module const of literal value) landing
    on a different names.js cell, and a `mem16[NAME]` whose high byte is one, unless NAME is a reviewed
    record/word base (games/<game>/idiomatic-bases.txt). names.js address exports must be 4-digit hex.
All are counted in CODE ONLY (comments stripped); only registers keep exemptions (the two bridges above).

FAIL-CLOSED ratchet: `check` enumerates EVERY games/*/idiomatic/ and holds each to a budget
(games/<game>/idiomatic-budget.txt), implicit 0 for a game not listed — so a NEW game is born idiomatic. It
blocks when a game's STAGED count EXCEEDS its budget (no NEW cruft; the allowlist only shrinks).
Fail-closed on a missing/malformed allowlist. Scope: every .js under games/<game>/idiomatic/ at any depth,
minus the test/ subdir. names.js is scanned too, minus its data consts (names_code): any function or other
code in it is held to every rule.

COMPLETENESS: `check` also enforces the game-local `idiomaticComplete: true` flag (manifest) — a game may
declare it only at 0 total cruft. Rationale: docs/comment-gate.md.

Subcommands: worklist (per-module, per-category), check (the ratchet), selftest.
"""
import argparse
import ast
import glob
import os
import posixpath
import re
import subprocess
import sys

# --- registers (data registers + ALU-op helpers); both are machine surface ---
REF = re.compile(r"\b(?:m\.)?regs\.(_?[A-Za-z][A-Za-z0-9]*)")
SIG = re.compile(r"\bfunction\s+\w+\s*\(")          # param-defaults on a signature line are exempt
# TIGHT_GAMES: only an exported routine's own parameter list is the frozen-caller bridge
SIG_TIGHT = re.compile(r"\bexport\s+(?:default\s+)?(?:async\s+)?function\s*\*?\s*([\w$]*)\s*\(")
# (TIGHT, R40 CD-1) a Z80 flag register or its pair/backing field: counted wherever it appears, a param-default
# or a return-assignment included -- the idiomatic layer returns a boolean, it never models the flags byte.
FLAG_REG = re.compile(r"_?(?:f|af|fZ|fNZ|fC|fNC|fS|fM|fP|fPE|fPO)")
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
#       with a names.js address (`fetchTableByte(m, HEADING_EDGE_POSITION_TABLE, i)` makes slot 1 an address),
#       or a PAGE SLOT (value >= 0x10): a parameter its function shifts into a page (`(hi << 8) | lo`);
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


_FUNC_HEAD = re.compile(r"\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)\s*\("
                        r"|\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(")


def page_slots(code):
    """{(callee, position, "page")} for a function of `code` whose parameter at that position is the high
    byte of a page composition (`(hi << 8) | lo`, `hi * 256`) in its body: the argument is a page."""
    out = set()
    for f in _FUNC_HEAD.finditer(code):
        o = f.end() - 1
        c = _close(code, o)
        params = [code[a:b].split("=")[0].strip() for a, b in _split(code, o + 1, c, ",")]
        body = re.match(r"\s*(?:=>)?\s*", code[c + 1:])
        start = c + 1 + body.end()
        end = _close(code, start) if code[start:start + 1] == "{" else _initializer(code, start)
        for i, p in enumerate(params):
            if re.fullmatch(r"[A-Za-z_$][\w$]*", p) and re.search(
                    r"(?<![\w$.])" + re.escape(p) + r"\s*(?:<<\s*(?:8|0[xX]0*8)|\*\s*(?:256|0[xX]0*100))(?![\w$.])"
                    r"|(?:256|0[xX]0*100)\s*\*\s*" + re.escape(p) + r"(?![\w$.])", code[start:end]):
                out.add((f.group(1) or f.group(2), i, "page"))
    return out


def address_slots(texts, names_js):
    """{(callee, position)} that some call site in `texts` fills with a names.js address (rule C), plus
    each page slot (page_slots) of any of `texts`."""
    addrs = set(_ADDR_EXPORT.findall(names_js))
    out = set()
    for text in texts:
        code = strip_comments(text)
        out |= page_slots(code)
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
        elif (f, i, "page") in slots:
            if k == "lit" and _lit_val(t) >= 0x10:
                lead_hit(k, t, p)
            elif k == "name":
                slot_leads.add(t)
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

CATEGORIES = ("registers", "calls", "pushes", "addrs", "mem", "masks", "imports")


def strip_comments(text):
    """Drop /* ... */ (incl. /** docstrings) and // line comments so cruft in prose is not counted. String-,
    template- and regex-literal-aware: a `//` or `/*` inside one is kept, with the code after it."""
    out, i, n = [], 0, len(text)
    while i < n:
        c = text[i]
        if text.startswith("//", i):
            j = text.find("\n", i)
            i = n if j < 0 else j
        elif text.startswith("/*", i):
            j = text.find("*/", i + 2)
            i = n if j < 0 else j + 2
        elif c in "'\"`":
            j = _skip_str(text, i)
            out.append(text[i:j])
            i = j
        elif c == "/" and _regex_start("".join(out[-40:])):
            j = _regex_end(text, i)
            out.append(text[i:j])
            i = j
        else:
            out.append(c)
            i += 1
    return "".join(out)


def _regex_start(prev):
    """A `/` after `prev` (the code before it) opens a regex literal, not a division."""
    p = prev.rstrip()
    return not p or p[-1] in "(,=:[!&|?{};+-*%<>~^" or bool(re.search(r"(?<![\w$.])(?:return|typeof|case|"
                                                                    r"do|else|in|of|void|yield|await)$", p))


def _regex_end(text, i):
    """End of the regex literal opening at text[i] (its flags included); i + 1 if none closes on the line."""
    j, cls = i + 1, False
    while j < len(text) and text[j] != "\n":
        c = text[j]
        if c == "\\":
            j += 2
            continue
        if c == "[":
            cls = True
        elif c == "]":
            cls = False
        elif c == "/" and not cls:
            j += 1
            while j < len(text) and (text[j].isalpha()):
                j += 1
            return j
        j += 1
    return i + 1


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


def register_hits(text, tight=False, routines=None):
    """Dispatch to the tight or the legacy register rule."""
    return register_hits_tight(text, routines) if tight else register_hits_legacy(text)


def register_hits_tight(text, routines=None):
    """Register names, minus a param-default of an EXPORTED function's parameter list (never a default of
    the bare register file, `r = m.regs`, nor a nested or non-exported helper's) and a `regs.X =` write that IS a `return`'s
    value (the load-bearing outgoing bridge `return (m.regs.a = v)` / `return [m.regs.a = x, m.regs.hl = y]`,
    single- or multi-line). A write is NOT exempt when it merely rides a return as an INPUT SEAT: a
    non-last comma operand or call argument (`return (regs.ix = X, callee(m))`, `return f((regs.de = K, m))`),
    a `void (...)` operand, or any write followed by a (non-mask) call within the same return. The
    param-default exemption covers a signature's PARAMETER LIST only, not the rest of its line, so a
    one-line body (`function f(m) { m.regs.ix = X; return g(m); }`) is counted like any other.
    `routines` (the names.js ROUTINES export names, `entry ?? name`) narrows the param-default exemption to a
    ROUTINES entry's own export: only a routine the frozen layer dispatches by address needs the register
    bridge, so a default on any other export counts (R40 CD-2). None = no narrowing (a bare unit call).
    A flag register (FLAG_REG) is never exempt."""
    sig_spans = [(s.end() - 1, _close(text, s.end() - 1)) for s in SIG_TIGHT.finditer(text)
                 if routines is None or s.group(1) in routines]
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
    return [m.group(1) for m in REF.finditer(text)
            if FLAG_REG.fullmatch(m.group(1))
            or (not (in_sig(m.start()) and m.group(1) != "file") and m.start() not in exempt)]


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
    destructure of register fields (`const { a, hl } = m.regs`), and a parameter defaulted to the file
    (`function f(r = m.regs)`)."""
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
    aliases += re.findall(r"[(,]\s*([A-Za-z_$][\w$]*)\s*=\s*(?:m\.)?regs\s*(?=[,)])", code)   # a parameter default
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


_PAGE_OPERAND = r"(0[xX][0-9a-fA-F]+|\d+|[A-Za-z_$][\w$]*)"
_PAGE = re.compile(r"(?<![\w$.])" + _PAGE_OPERAND + r"\s*(?:<<\s*(?:8|0[xX]0*8)|\*\s*(?:256|0[xX]0*100))(?![\w$.])"
                   r"|(?<![\w$.])(?:256|0[xX]0*100)\s*\*\s*" + _PAGE_OPERAND + r"(?![\w$.])")


def fold_pages(code):
    """SHORT_ADDR_GAMES: fold a page composition `lit << 8` / `lit * 256` (lit >= 0x10, any hex case or
    shift spelling, or a module const of such a literal value) into its value, so ADDR sees
    `mem8[lo | (0xad << 8)]` as 0xad00. Kept unfolded, as a mask: an operand of `&`, and outside a memory
    index the high-byte fill 0xff00 (`c ? (0xff << 8) : 0`); and a negated page (`-STEP * 256`), a signed
    step rather than an address. 0xc0 << 8 is a page (I/O), not a mask."""
    spans = list(_index_spans(code))
    consts = module_consts(code)

    def fold(d):
        t = d.group(1) or d.group(2)
        v = (int(t, 0) if t[0].isdigit() else consts.get(t, 0)) << 8
        before, after = code[:d.start()].rstrip(" (\n"), code[d.end():].lstrip(" )\n")
        and_operand = (before.endswith("&") and not before.endswith("&&")) or \
            (after.startswith("&") and not after.startswith("&&"))
        negated = before.endswith("-") and before[:-1].rstrip()[-1:] in tuple("=(,[:?&|+-*/<>!~^{;") + ("",)
        in_index = any(a <= d.start() < b for a, b in spans)
        high_mask = v == 0xFF00 and not in_index
        return d.group(0) if not 0x1000 <= v <= 0xFFFF or and_operand or high_mask or negated else f"0x{v:04x}"
    return _PAGE.sub(fold, code)


# --- SCOPE: every .js under games/<game>/idiomatic/ except test/, names.js included ---
# The layer is whatever an idiomatic module can reach without leaving it: a helper in a subdirectory
# is scanned like a top-level module, and names.js's non-data code is held to the same rules.
NAMES_FILE = "names.js"


def in_layer(path, game):
    """True for a repo-relative path inside games/<game>/idiomatic/ and outside its test/ subdir."""
    idir = f"games/{game}/idiomatic/"
    return path.startswith(idir) and not path.startswith(idir + "test/")


def strip_js(text):
    """Comments removed and '...' / "..." / plain `...` string bodies blanked, string-aware (a `//` inside
    a string is not a comment). A template literal holding `${` is kept whole: its expressions are code."""
    out, i, n = [], 0, len(text)
    while i < n:
        c = text[i]
        if text.startswith("//", i):
            j = text.find("\n", i)
            i = n if j < 0 else j
        elif text.startswith("/*", i):
            j = text.find("*/", i + 2)
            i = n if j < 0 else j + 2
            out.append(" ")
        elif c in "'\"`":
            j = _skip_str(text, i)
            body = text[i:j]
            out.append(body if c == "`" and "${" in body else c + c)
            i = j
        else:
            out.append(c)
            i += 1
    return "".join(out)


_CONST_STMT = re.compile(r"(?:(?<=^)|(?<=[\s;}]))(?:export\s+)?const\s+[A-Za-z_$][\w$]*\s*=")
_NOT_DATA = re.compile(r"\(|=>|\bfunction\b|\bclass\b|\bget\b\s*\w|\bset\b\s*\w")


def names_code(text):
    """names.js minus its DATA: comments and strings stripped (strip_js), then every top-level
    `[export] const NAME = <init>;` whose initializer has no call, arrow, function, class or accessor
    (a literal, a name, an arithmetic expression of them, or an object/array literal of them) removed --
    addresses live there by design. What remains (a function, a class, a const computed by a call, any
    other statement) is code and is counted under the full rules, raw addresses included."""
    code = strip_js(text)
    out, i, depth, n = [], 0, 0, len(code)
    while i < n:
        m = _CONST_STMT.match(code, i) if depth == 0 else None
        if m:
            j, d = m.end(), 0
            while j < n and not (d == 0 and code[j] == ";"):
                d += (code[j] in _OPEN) - (code[j] in _CLOSE)
                j += 1
            if not _NOT_DATA.search(code[m.end():j]):
                i = j + 1
                continue
        c = code[i]
        depth += (c in _OPEN) - (c in _CLOSE)
        out.append(c)
        i += 1
    return "".join(out)


# --- IMPORTS (TIGHT_GAMES): an idiomatic module may import only from the layer itself (any .js under
# games/<game>/idiomatic/ but test/, names.js included) and from this REVIEWED set outside it. Any other
# import -- a core/ or board helper, the translated layer, a bare package, a dynamic import()/require() --
# counts, because the gate cannot see what the imported code does to the machine.
#   PURE: any named import. Each must stay a leaf (no import of its own) with no machine surface, which
#   verify_import_allowlist re-checks on every run, so a CPU helper added to one later blocks.
#     core/int.js  -- u8/u16/page: integer width masks, the integer-width helpers of the layer.
#     core/bcd.js  -- bcdAddByte/bcdSubByte: packed-decimal byte add/subtract on plain values (a JS
#                     re-expression of add+daa that takes and returns numbers, never `m`).
#   NAMED: only the listed names; each must be a numeric const or an Error class in that file (checked).
#     (core/cpu/z80.js is NOT listed: its F_* flag-bit constants exist only to build a Z80 flags byte, which
#     the idiomatic layer never does -- a routine returns a boolean -- so any z80.js import counts, R40 CD-1.)
#     boards/<game>/io.js -- NotImplemented, the error class an unreached arm throws (the board's own
#                     "no answer here" marker; constructing it touches no machine state).
IMPORT_PURE = ("core/int.js", "core/bcd.js")
IMPORT_NAMED = {"boards/{game}/io.js": frozenset({"NotImplemented"})}
_IMPORT_FROM = re.compile(r"(?<![\w$.])(import|export)(?![\w$])(?!\s*\()([^;'\"`]*?)(?<![\w$.])from\s*(['\"])([^'\"]*)\3")
_IMPORT_BARE = re.compile(r"(?<![\w$.])import\s*(['\"])([^'\"]*)\1")
_IMPORT_DYN = re.compile(r"(?<![\w$.])(?:import|require)\s*\(")


def _resolve(path, spec):
    return posixpath.normpath(posixpath.join(posixpath.dirname(path), spec)) if spec.startswith(".") else spec


def _named_policy(target, game):
    for k, names in IMPORT_NAMED.items():
        if k.format(game=game) == target:
            return names
    return None


def import_hits(code, path, game):
    """Unallowed imports in comment-stripped `code` of the module at repo-relative `path`: one per
    statement from a file off the allowlist, one per unlisted name (or namespace/default import) from a
    NAMED file, one per dynamic import()/require()."""
    hits = []
    stmts = [(m.group(2), m.group(4)) for m in _IMPORT_FROM.finditer(code)]
    stmts += [(None, m.group(2)) for m in _IMPORT_BARE.finditer(code)]
    for clause, spec in stmts:
        target = _resolve(path, spec)
        if (in_layer(target, game) and target.endswith(".js")) or target in IMPORT_PURE:
            continue
        allowed = _named_policy(target, game)
        if allowed is None:
            hits.append(target)
            continue
        brace = re.fullmatch(r"\s*\{([^{}]*)\}\s*", clause or "")
        if not brace:
            hits.append(f"{target} (not a named import)")
            continue
        for part in brace.group(1).split(","):
            name = part.split(" as ")[0].strip()
            if name and name not in allowed:
                hits.append(f"{target}:{name}")
    hits += ["dynamic import"] * len(_IMPORT_DYN.findall(code))
    return hits


def verify_import_allowlist(game, from_index, read=None):
    """Problems with the reviewed allowlist itself for `game`: a PURE file that imports anything or has a
    machine surface (registers, calls, stack ops, machine members), or a NAMED name that is not a numeric
    const / Error class of its file. A missing PURE file is a problem (fail closed). `read(path)` defaults
    to the index (from_index) or the working tree."""
    read = read or (lambda path: _read(path, from_index))
    probs = []
    for path in IMPORT_PURE:
        try:
            code = strip_js(read(path))
        except (GitError, OSError):
            probs.append(f"{path}: unreadable")
            continue
        c = counts(code, game)
        if _IMPORT_FROM.search(code) or _IMPORT_BARE.search(code) or _IMPORT_DYN.search(code):
            probs.append(f"{path}: imports another file, so it is no longer a reviewed leaf")
        for k in ("registers", "calls", "pushes", "mem"):
            if c[k]:
                probs.append(f"{path}: {c[k]} {k}")
    for pattern, names in IMPORT_NAMED.items():
        path = pattern.format(game=game)
        try:
            text = read(path)
        except (GitError, OSError):
            continue  # only a file the game imports needs to exist; import_hits handles the rest
        for name in sorted(names):
            const = re.search(r"(?m)^export\s+const\s+" + name + r"\s*=\s*(?:0[xX][0-9a-fA-F]+|\d+)\s*;", text)
            cls = re.search(r"(?m)^export\s+class\s+" + name + r"\s+extends\s+Error\b", text)
            if not (const or cls) and re.search(r"\b" + name + r"\b", text):
                probs.append(f"{path}: {name} is not a numeric const or an Error class")
    return probs


# --- OFFSET ALIAS (SHORT_ADDR_GAMES): a names.js cell reached as ANOTHER cell's name plus an offset ---
# `mem8[ROUND_WON_ANIMATION_STEP + 1]` writes PLAYER_FLASH_TICK without naming it, so the reader cannot see
# which cell it is. An operand `BASE +/- offsets` counts when its value is the address of a DIFFERENT
# names.js export -- unless BASE's export is a reviewed record/word base in games/<game>/idiomatic-bases.txt
# (`NAME  SPAN  reason`) and the offset lies inside its SPAN bytes (a word's high byte, a record's field).
#   BASE: a names.js import (named, renamed or `N.X` through a namespace import), or a local bound to one --
#         an alias (`const p = NAME`, `let p = NAME + 2`) or a cursor stepped in straight-line code
#         (`p++`, `++p`, `p += K`); a step under a loop, a branch or a nested block ends the tracking.
#   offsets: literals and module consts of literal value (`const FIELD = 4`, `STRIDE * 2`, `T.length` of a
#         literal array), any sign, either order.
# A `mem16[...]` access also reaches the byte after its operand, so `mem16[NAME]` counts when NAME + 1 is
# another export (a word base is declared in idiomatic-bases.txt). A range bound (`p < BASE + N`) reaches
# no cell and does not count.
_STOP_L = set("[({,=:?&|!<>^;~")
_STOP_R = set("])},;:?=<>!&|^")
_STOP_WORDS = {"return", "case", "yield", "await", "void", "typeof", "in", "of", "instanceof", "delete",
               "throw", "else", "do", "new", "const", "let", "var"}
_CONTROL = re.compile(r"(?:if|else|for|while|do|switch)\b")
_IDENT = re.compile(r"(?<![\w$.])[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*")
_DECL = re.compile(r"(?<![\w$.])(?:const|let|var)\s+")
_ASSIGN = re.compile(r"\s*=(?![=>])")
_DECLARATOR = re.compile(r"([A-Za-z_$][\w$]*)\s*=(?![=>])")


def _names_locals(code, path, game):
    """({local name: names.js export} for `import {...} from "<names.js of this game>"`,
    {namespace local} for `import * as N from` it)."""
    out, ns = {}, set()

    def ok(spec):
        return (_resolve(path, spec) == f"games/{game}/idiomatic/{NAMES_FILE}") if path else spec == "./names.js"
    for m in re.finditer(r"\bimport\s*\{([^}]*)\}\s*from\s*['\"]([^'\"]+)['\"]", code):
        if ok(m.group(2)):
            for n in m.group(1).split(","):
                if n.strip():
                    out[n.split(" as ")[-1].strip()] = n.split(" as ")[0].strip()
    for m in re.finditer(r"\bimport\s*\*\s*as\s+([A-Za-z_$][\w$]*)\s+from\s*['\"]([^'\"]+)['\"]", code):
        if ok(m.group(2)):
            ns.add(m.group(1))
    return out, ns


_NUM_EXPORT = re.compile(r"(?m)^export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*"
                         r"(0[xX][0-9a-fA-F](?:_?[0-9a-fA-F])*|\d(?:_?\d)*)\s*;")


def names_addresses(names_js):
    """{export: address} for every scalar numeric export of names.js, however written."""
    return {m.group(1): _lit_val(m.group(2)) for m in _NUM_EXPORT.finditer(names_js)}


def nonstandard_exports(names_js):
    """Scalar numeric names.js exports not written as a 4-digit hex address (rule C and the readers of the
    registry expect that form, so a short `0xd1b` export is refused rather than half-seen)."""
    return [m.group(1) for m in _NUM_EXPORT.finditer(names_js)
            if not re.fullmatch(r"0[xX][0-9a-fA-F]{4}", m.group(2))]


def _str_mask(code):
    """bytearray: 1 inside a string/template literal."""
    mask, i, n = bytearray(len(code)), 0, len(code)
    while i < n:
        if code[i] in "'\"`":
            j = min(_skip_str(code, i), n)
            mask[i:j] = b"\x01" * (j - i)
            i = j
        else:
            i += 1
    return mask


def _brace_depths(code, mask):
    """depth[i] = `{` blocks open before code[i] (strings skipped)."""
    out, d = [0] * (len(code) + 1), 0
    for i, c in enumerate(code):
        out[i] = d
        if not mask[i]:
            d += (c == "{") - (c == "}")
    out[len(code)] = d
    return out


def _block_end(code, depth, mask, i):
    """Index of the `}` closing the block that holds code[i] (len(code) at top level)."""
    d = depth[i]
    for j in range(i, len(code)):
        if code[j] == "}" and depth[j] == d and d > 0 and not mask[j]:
            return j
    return len(code)


def _eval_const(text, consts):
    """Integer value of a literal expression (literals, module consts, + - * << >> | & ^ ~ ()), else None."""

    def sub(m):
        if m.group(0) not in consts:
            raise KeyError(m.group(0))
        return f"({consts[m.group(0)]})"
    try:
        expr = _IDENT.sub(sub, text.strip())
        tree = ast.parse(expr, mode="eval")
    except (KeyError, SyntaxError, ValueError):
        return None
    ok = (ast.Expression, ast.BinOp, ast.UnaryOp, ast.Constant, ast.Add, ast.Sub, ast.Mult, ast.LShift,
          ast.RShift, ast.BitOr, ast.BitAnd, ast.BitXor, ast.USub, ast.UAdd, ast.Invert)
    if not all(isinstance(x, ok) for x in ast.walk(tree)):
        return None
    if any(isinstance(x, ast.Constant) and type(x.value) is not int for x in ast.walk(tree)):
        return None
    try:
        return eval(compile(tree, "<const>", "eval"), {"__builtins__": {}})
    except (ArithmeticError, ValueError):
        return None


def module_consts(code):
    """{name: int} for every local `const NAME = <literal expression>` (or a `let`/`var` never written
    again) whose every declaration has the same initializer, and `NAME.length` for a literal array
    `const NAME = [...]` with no spread."""
    raw, seen, arrays, at = {}, {}, {}, set()
    for d in _DECL.finditer(code):
        i = d.end()
        while True:
            m = _DECLARATOR.match(code, i)
            if not m:
                break
            end = _initializer(code, m.end())
            name, init = m.group(1), code[m.end():end].strip()
            at.add(m.start(1))
            seen.setdefault(name, set()).add(init)
            raw[name] = init
            if init.startswith("[") and _close(init, 0) == len(init) - 1 and "..." not in init:
                inner = init[1:-1].strip()
                arrays[name] = len([1 for a, b in _split(inner, 0, len(inner), ",") if inner[a:b].strip()])
            if end < len(code) and code[end] == ",":
                i = end + 1
                while i < len(code) and code[i].isspace():
                    i += 1
                continue
            break
    written = set()
    for name in raw:
        if any(w.start() not in at for w in re.finditer(
                r"(?<![\w$.])" + re.escape(name) + r"\s*(?:\+\+|--|(?:\*\*|[-+*/%&|^]|<<|>>>?)?=(?![=>]))", code)) \
                or re.search(r"(?:\+\+|--)\s*" + re.escape(name) + r"(?![\w$])", code):
            written.add(name)
    decls = {n for n in raw if len(seen[n]) == 1}
    consts = {f"{n}.length": v for n, v in arrays.items() if n in decls and n not in written}
    changed = True
    while changed:
        changed = False
        for n in decls - set(consts) - written:
            v = _eval_const(raw[n], consts) if not raw[n].startswith("[") else None
            if v is not None:
                consts[n] = v
                changed = True
    return consts


def _scan_left(code, a, mask):
    """Start of the +/- operand holding the token at code[a], or None across a string."""
    i, depth = a - 1, 0
    while i >= 0:
        c = code[i]
        if mask[i]:
            return None
        if c in ")]}":
            depth += 1
        elif c in "([{":
            if depth == 0:
                break
            depth -= 1
        elif depth == 0:
            if c in _STOP_L:
                break
            if c == "\n":
                j = i - 1
                while j >= 0 and code[j] in " \t\r":
                    j -= 1
                if j < 0 or code[j] not in "+-*/%":
                    break
            if c.isalnum() or c in "_$":
                j = i
                while j > 0 and (code[j - 1].isalnum() or code[j - 1] in "_$"):
                    j -= 1
                if code[j:i + 1] in _STOP_WORDS and (j == 0 or code[j - 1] != "."):
                    break
                i = j
        i -= 1
    return i + 1


def _scan_right(code, b, mask):
    """End of the +/- operand holding the token that ends at code[b], or None across a string."""
    i, depth, n = b, 0, len(code)
    while i < n:
        c = code[i]
        if mask[i]:
            return None
        if c in "([{":
            depth += 1
        elif c in ")]}":
            if depth == 0:
                break
            depth -= 1
        elif depth == 0:
            if c in _STOP_R:
                break
            if c == "\n":
                prev = code[b:i].rstrip()[-1:]
                nxt = code[i + 1:].lstrip()[:1]
                if prev not in tuple("+-*/%") and nxt not in tuple("+-*/%"):
                    break
            if c.isalpha() or c in "_$":
                j = i
                while j < n and (code[j].isalnum() or code[j] in "_$"):
                    j += 1
                if code[i:j] in _STOP_WORDS and code[i - 1:i] != ".":
                    break
                i = j
                continue
        i += 1
    return i


def _terms(code, a, b):
    """[(sign, start, end)] of the top-level +/- terms of code[a:b], or None if malformed."""
    out, sign, st, last_end, operand, i = [], 1, None, a, False, a
    while i < b:
        c = code[i]
        if c.isspace():
            i += 1
            continue
        if code[i:i + 2] in ("++", "--"):
            st = i if st is None else st
            i += 2
            last_end = i
            continue
        if c in "+-":
            if operand:
                out.append((sign, st, last_end))
                sign, st, operand = (1 if c == "+" else -1), None, False
            else:
                sign = -sign if c == "-" else sign
            i += 1
            continue
        st = i if st is None else st
        if c in "([{":
            j = _close(code, i)
            if j >= b:
                return None
            i, last_end, operand = j + 1, j + 1, True
            continue
        operand = not (c in "*/%<>&|^~!=?:,;")
        i += 1
        last_end = i
    if st is None:
        return None
    return out + [(sign, st, last_end)]


def _relational(left, right):
    """The operand between `left` (its last two chars) and `right` (the next two) is a < > <= >= side."""
    lrel = (left[-1:] in ("<", ">") and left[-2:] not in ("<<", ">>", "=>")) or left[-2:] in ("<=", ">=")
    return lrel or (right[:1] in ("<", ">") and right[:2] not in ("<<", ">>"))


class _Aliases:
    """Resolves an operand of one module to (export, offset, decl offset) -- see the OFFSET ALIAS note."""

    def __init__(self, code, names, local, ns):
        self.code, self.names, self.local, self.ns = code, names, local, ns
        self.mask = _str_mask(code)
        self.depth = _brace_depths(code, self.mask)
        self.consts = module_consts(code)
        self.bindings = {}   # var -> [(start, end, export, off, events)]
        self._bind()

    # -- operands --
    def operand(self, a, b):
        """(export, offset, binding decl offset or None) of code[a:b], ("const", v) or None."""
        terms = _terms(self.code, a, b)
        if not terms:
            return None
        base, total = None, 0
        for sign, s, e in terms:
            t = self.term(s, e)
            if t is None:
                return None
            if t[0] == "const":
                total += sign * t[1]
            elif base is not None or sign < 0:
                return None
            else:
                base = t
        if base is None:
            return ("const", total)
        return (base[0], base[1] + total, base[2])

    def term(self, s, e):
        code = self.code
        text = code[s:e]
        if text[0] == "(" and _close(code, s) == e - 1:
            return self.operand(s + 1, e - 1)
        u = re.match(r"u16\s*\(", text)
        if u and _close(code, s + u.end() - 1) == e - 1:
            r = self.operand(s + u.end(), e - 1)
            return r if r and r[0] != "const" else (("const", r[1] & 0xFFFF) if r else None)
        m = re.fullmatch(r"(\+\+|--)?\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)\s*(\+\+|--)?", text)
        if m:
            b = self.base(m.group(2), s + m.start(2))
            if b:
                return b
        v = _eval_const(text, self.consts)
        return ("const", v) if v is not None else None

    def base(self, tok, pos):
        if tok in self.local and self.local[tok] in self.names:
            return (self.local[tok], 0, None)
        head, _, tail = tok.partition(".")
        if tail and head in self.ns and tail in self.names:
            return (tail, 0, None)
        best = None
        for st, en, export, off, events in self.bindings.get(tok, ()):
            if st <= pos <= en and (best is None or st > best[0]):
                best = (st, en, export, off, events)
        if not best:
            return None
        cur = best[3]
        for ep, delta, prefix in best[4]:
            if ep < pos or (ep == pos and prefix):
                if delta is None:
                    return None
                cur += delta
        return (best[2], cur, best[3])

    # -- bindings: aliases and straight-line cursors --
    def _uncertain(self, pos, dd):
        """A step at code[pos] is not straight-line from a binding at brace depth dd."""
        code = self.code
        if self.depth[pos] > dd:
            return True
        depth, i = 0, pos - 1
        while i >= 0 and not (code[i] in "{}" and depth == 0 and not self.mask[i]):
            if not self.mask[i]:
                if code[i] == ")":
                    depth += 1
                elif code[i] == "(":
                    if depth == 0:
                        if re.search(r"(?<![\w$.])(?:for|while|if|switch)\s*$", code[:i]):
                            return True
                    else:
                        depth -= 1
            i -= 1
        stmt = code[self._stmt_start(pos):pos]
        return bool(_CONTROL.match(stmt.strip())) or "?" in stmt or "&&" in stmt or "||" in stmt

    def _stmt_start(self, pos):
        """Start of the statement holding code[pos]: after the last `;`, `{` or `}` outside parens."""
        code, depth, j = self.code, 0, pos - 1
        while j >= 0:
            if not self.mask[j]:
                c = code[j]
                if c == ")":
                    depth += 1
                elif c == "(":
                    depth -= 1
                elif c in ";{}" and depth <= 0:
                    break
            j -= 1
        return j + 1

    def _bind(self):
        code = self.code
        sites = []   # (pos of var, var, rhs start, is decl)
        for d in _DECL.finditer(code):
            if self.mask[d.start()]:
                continue
            i = d.end()
            while True:
                m = _DECLARATOR.match(code, i)
                if not m:
                    break
                sites.append((m.start(1), m.group(1), m.end(), True))
                end = _initializer(code, m.end())
                if end < len(code) and code[end] == ",":
                    i = end + 1
                    while i < len(code) and code[i].isspace():
                        i += 1
                    continue
                break
        decl_pos = {p for p, *_ in sites}
        declared = set(re.findall(r"(?<![\w$.])(?:let|var)\s+([A-Za-z_$][\w$]*)\s*(?=[;,\n])", code))
        for m in _IDENT.finditer(code):
            if m.start() in decl_pos or self.mask[m.start()] or "." in m.group(0):
                continue
            a = _ASSIGN.match(code, m.end())
            if a:
                sites.append((m.start(), m.group(0), a.end(), False))
        for pos, var, rhs, is_decl in sorted(sites):
            if not is_decl and var not in self.bindings and var not in declared:
                continue
            end = self._rhs_end(rhs)
            r = self.operand(rhs, end) if end is not None else None
            dd = self.depth[pos]
            if not is_decl:
                live = [b for b in self.bindings.get(var, ()) if b[0] <= pos <= b[1]]
                straight = end is not None and live and not self._uncertain(pos, self.depth[live[-1][0]])
                self._kill(var, end if straight else pos)   # a straight-line `p = p + K` reads p first
            if r is None or r[0] == "const":
                continue
            if not is_decl and self._uncertain_assign(pos):
                continue
            scope_end = _block_end(code, self.depth, self.mask, pos)
            events = self._events(var, end, scope_end, dd)
            self.bindings.setdefault(var, []).append((end, scope_end, r[0], r[1], events))

    def _rhs_end(self, rhs):
        e = _initializer(self.code, rhs)
        return e if e > rhs else None

    def _uncertain_assign(self, pos):
        return bool(_CONTROL.match(self.code[self._stmt_start(pos):pos].strip()))

    def _kill(self, var, pos):
        for b in self.bindings.get(var, ()):
            if b[0] <= pos <= b[1]:
                b[4].append((pos, None, False))
                b[4].sort(key=lambda e: e[0])

    def _events(self, var, start, end, dd):
        code, out = self.code, []
        rx = re.compile(r"(?<![\w$.])" + re.escape(var) + r"(?![\w$])")
        for m in rx.finditer(code, start, end):
            o = m.start()
            if self.mask[o]:
                continue
            before, after = code[:o].rstrip(), code[m.end():]
            delta, prefix = None, False
            if before.endswith(("++", "--")) and not before.endswith(("+++", "---")):
                delta, prefix = (1 if before.endswith("++") else -1), True
            elif after.lstrip().startswith(("++", "--")):
                delta = 1 if after.lstrip().startswith("++") else -1
            elif re.match(r"\s*[-+]=", after):
                op = re.match(r"\s*([-+])=", after)
                rhs = m.end() + op.end()
                v = _eval_const(code[rhs:_initializer(code, rhs)], self.consts)
                if v is None:
                    out.append((o, None, False))
                    continue
                delta = v if op.group(1) == "+" else -v
            elif re.match(r"\s*(?:\*\*|[*/%&|^]|<<|>>>?)=", after):
                out.append((o, None, False))
                continue
            else:
                continue
            out.append((o, None if self._uncertain(o, dd) else delta, prefix))
        return out

    # -- sites --
    def sites(self):
        """[(export, offset, decl offset or None, position)] for every whole operand holding a base."""
        code, seen, out = self.code, set(), []
        for m in _IDENT.finditer(code):
            tok, p = m.group(0), m.start()
            if self.mask[p]:
                continue
            if not (tok in self.local or (tok.partition(".")[0] in self.ns) or tok in self.bindings):
                continue
            a = _scan_left(code, p, self.mask)
            b = _scan_right(code, m.end(), self.mask)
            if a is None or b is None or (a, b) in seen:
                continue
            seen.add((a, b))
            left = code[:a].rstrip()[-1:]
            right = code[b:b + 2]
            if left in ("", ";", "{", "}") and (right[:1] in ("", ";", "}", "\n") or b == len(code)):
                continue           # an expression statement (`p++;`) reads no cell
            if right[:1] == "=" and right[1:2] not in ("=", ">"):
                continue           # an assignment target
            if _relational(code[:a].rstrip()[-2:], code[b:b + 2]):
                continue           # a range bound (`p < BASE + N`), not a cell reached
            r = self.operand(a, b)
            if r and r[0] != "const":
                out.append(r + (a,))
        return out

    def word_sites(self):
        """[(export, offset, position)] of every `mem16[...]` operand that resolves."""
        out = []
        for x in re.finditer(r"(?<![\w$])mem16\s*\[", self.code):
            if self.mask[x.start()]:
                continue
            o = x.end() - 1
            a, b = _split(self.code, o + 1, _close(self.code, o), ",")[0]
            r = self.operand(a, b)
            if r and r[0] != "const":
                out.append((r[0], r[1], a))
        return out


def offset_alias_sites(code, names, path=None, game=None, bases=None):
    """[(base export, offset, other export, exempt, position)] for every operand in comment-stripped `code` whose
    value is another names.js export's address, and every `mem16[...]` whose high byte is one. `names` is
    names_addresses(); `bases` {NAME: span}."""
    bases = bases or {}
    local, ns = _names_locals(code, path, game)
    if not local and not ns:
        return []
    by_addr = {}
    for k, v in names.items():
        by_addr.setdefault(v, k)
    al = _Aliases(code, names, local, ns)
    out = []

    def hit(export, off, pos):
        other = by_addr.get((names[export] + off) & 0xFFFF)
        if off != 0 and other is not None and other != export:
            out.append((export, off, other, export in bases and 0 <= off < bases[export], pos))
    for export, off, decl_off, pos in al.sites():
        if decl_off is None or off != decl_off:
            hit(export, off, pos)
    for export, off, pos in al.word_sites():
        hit(export, off + 1, pos)
    return out


def parse_bases(text, path, names):
    """`NAME  SPAN  reason` lines -> {NAME: span}. Fail closed on a malformed line or a NAME that is not a
    names.js address export."""
    out = {}
    for raw in text.splitlines():
        parts = raw.split("#", 1)[0].split(None, 2)
        if not parts:
            continue
        if len(parts) < 3 or not parts[1].isdigit() or int(parts[1]) < 2:
            raise GitError(f"entry needs NAME SPAN(>=2) reason in {path}: {raw.strip()}")
        if parts[0] not in names:
            raise GitError(f"{parts[0]} in {path} is not a names.js address export")
        out[parts[0]] = int(parts[1])
    return out


def counts(text, game=None, slots=frozenset(), sizes=frozenset(), path=None, names=None, bases=None,
           routines=None):
    """Per-category cruft counts for one module's source text. The CATEGORIES keys are always-counted
    (baked into every game's budget); "stack" (m.ret/m.pop*) is a separate addend the callers apply only
    for CLOSURE_GAMES (TIGHT_GAMES fold it into "pushes"), so it is returned but excluded from total(). `slots` feeds rule C (address_slots), `sizes` rule M (read_sizes).
    `path` (repo-relative) enables the TIGHT import allowlist; `names` (names_addresses) and `bases`
    (parse_bases) enable the SHORT_ADDR offset-alias rule. names.js itself is passed through names_code first."""
    code = canon_literals(strip_comments(text))
    imports = len(import_hits(code, path, game)) if path and game in TIGHT_GAMES else 0
    aliases = (sum(1 for *_, ex, _ in offset_alias_sites(code, names, path, game, bases) if not ex)
               if names and game in SHORT_ADDR_GAMES else 0)
    if game in SHORT_ADDR_GAMES:
        code = fold_pages(code)
    if game in TIGHT_GAMES:
        calls, pushes, other = machine_hits(code, game)
    else:
        calls, pushes, other = len(CALL.findall(code)), len(PUSH.findall(code)), 0
    return {
        "registers": len(register_hits(_normalize_regs(code), tight=game in TIGHT_GAMES, routines=routines)),
        "calls": calls,
        "pushes": pushes,
        "addrs": (sum(1 for t in ADDR.findall(code) if _is_long(t))
                  + (len(short_addr_hits(code, slots, sizes)) if game in SHORT_ADDR_GAMES else 0) + aliases),
        "mem": len(MEM.findall(code)) + other,
        "masks": (len(MASK8.findall(code)) + len(MASK16.findall(code))
                  + sum(1 for n in ALIAS.findall(code) if n not in ("mem8", "mem16"))),
        "imports": imports,
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
    """Staged (index) paths of every .js under a game's idiomatic/ (any depth, names.js included), minus
    the test/ subdir. git's pathspec '*' spans '/', so subdirectories are listed."""
    idir = f"games/{game}/idiomatic"
    return [p for p in git(["ls-files", f"{idir}/*.js"]).splitlines() if p and in_layer(p, game)]


def _modules_in_tree(game):
    """The working-tree twin of _modules_in_index (the worklist view)."""
    idir = os.path.join("games", game, "idiomatic")
    out = []
    for root, dirs, files in os.walk(idir):
        dirs[:] = sorted(d for d in dirs if not (root == idir and d == "test"))
        out += [posixpath.join(root.replace(os.sep, "/"), f) for f in sorted(files) if f.endswith(".js")]
    return [p for p in out if in_layer(p, game)]


def _is_names(path, game):
    return path == f"games/{game}/idiomatic/{NAMES_FILE}"


def _game_bases(game, sources, from_index):
    """(names_addresses, bases) for a SHORT_ADDR game's offset-alias rule; ({}, {}) otherwise. Fail
    closed on a stale base: one no module offsets into another export through."""
    if game not in SHORT_ADDR_GAMES:
        return {}, {}
    names_path = f"games/{game}/idiomatic/{NAMES_FILE}"
    try:
        names = names_addresses(_read(names_path, from_index))
    except (GitError, OSError):
        return {}, {}
    odd = nonstandard_exports(_read(names_path, from_index))
    if odd:
        raise GitError(f"{names_path}: export not a 4-digit hex address: {', '.join(odd)}")
    path = f"games/{game}/idiomatic-bases.txt"
    try:
        text = _read(path, from_index)
    except (GitError, OSError):
        return names, {}
    bases = parse_bases(text, path, names)
    used = {b for p, t in sources for b, *_ in offset_alias_sites(
        canon_literals(strip_comments(t)), names, p, game, bases)}
    stale = sorted(set(bases) - used)
    if stale:
        raise GitError(f"stale entry in {path}: {', '.join(stale)}")
    return names, bases


def _layer_counts(game, sources, from_index):
    """[(path, counts)] for a game's layer sources [(path, text)]: names.js reduced to its code
    (names_code) first; rule C slots, rule M sizes and the offset-alias bases computed over the layer."""
    sources = [(p, names_code(t) if _is_names(p, game) else t) for p, t in sources]
    texts = [t for _, t in sources]
    slots, sizes = _game_slots(game, texts, from_index), _game_sizes(game, texts, from_index)
    names, bases = _game_bases(game, sources, from_index)
    routines = None
    if game in TIGHT_GAMES:
        probs = verify_import_allowlist(game, from_index)
        if probs:
            raise GitError("import allowlist: " + "; ".join(probs))
        try:
            routines = routine_exports(_read(f"games/{game}/idiomatic/{NAMES_FILE}", from_index))
        except (GitError, OSError):
            routines = frozenset()   # no names.js: no export is a ROUTINES entry, so no default is exempt
    return [(p, counts(t, game, slots, sizes, p, names, bases, routines)) for p, t in sources]


def routine_exports(names_js):
    """The export names the idiomatic runtime wires from a names.js ROUTINES map: each entry's
    `entry ?? name` (machine.js resolveAllIdiomatic)."""
    at = names_js.find("export const ROUTINES")
    if at < 0:
        return frozenset()
    out = set()
    for chunk in re.split(r"(?m)^\s*0x[0-9a-fA-F]+\s*:\s*\{", names_js[at:])[1:]:
        entry = re.search(r"(?:^|[{,\n])\s*entry\s*:\s*(['\"])([\w$]+)\1", chunk)
        name = re.search(r"(?:^|[{,\n])\s*name\s*:\s*(['\"])([\w$]+)\1", chunk)
        if entry or name:
            out.add((entry or name).group(2))
    return frozenset(out)


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
    sources = []
    for path in _modules_in_index(game):
        try:
            sources.append((path, git(["show", f":{path}"])))
        except GitError:
            continue
    for _, c in _layer_counts(game, sources, True):
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
CLOSURE_GAMES = {"frogger", "pooyan", "invaders", "centiped", "tempest", "timeplt"}
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
    closure = game in CLOSURE_GAMES
    rows = []
    idir = f"games/{game}/idiomatic/"
    sources = [(p, open(p, encoding="utf-8").read()) for p in _modules_in_tree(game)]
    try:
        per_module = _layer_counts(game, sources, False)
    except GitError as e:
        print(f"idiomatic_gate: BLOCK — {game}: {e}")
        return 1
    for path, per in per_module:
        disp_tot = total(per) + (per["stack"] if closure else 0)
        if disp_tot:
            rows.append((disp_tot, path[len(idir):], per))
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
    want("timeplt is closure-enrolled (C3)", tg in CLOSURE_GAMES, True)
    want("legacy game not TIGHT", lg in TIGHT_GAMES, False)
    # outgoing return-writes stay exempt: tuple, object, multi-line, chained through a u16 mask, ternary RHS
    for ok_src in ("return (m.regs.a = v);",
                   "return [m.regs.a = x, m.regs.hl = y];",
                   "return [\n  m.regs.a = x,\n  m.regs.hl = y,\n];",
                   "return { d: (m.regs.d = d), e: u16(m.regs.e = e) };",
                   "return (m.regs.c = x === undefined ? 1 : x);",
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
    want("tight param-default exempt", counts("export function f(m,\n  x = m.regs.a,\n) {\n  return x;\n}", tg)["registers"], 0)
    # (R40 CD-1) a flag register counts in every spelling: param-default, return-assignment, body read, backing field
    for src, n in (("export function f(m, x = m.regs.fZ) { return x; }", 1),
                   ("export function f(m, v) { return (m.regs.fC = v); }", 1),
                   ("export function f(m) { return (m.regs.fZ = rowInt === 0); }", 1),
                   ("export function f(m) { return m.regs.f & 0x40; }", 1),
                   ("export function f(m, x = m.regs._f) { return x; }", 1),
                   ("export function f(m, x = m.regs.af) { return x; }", 1)):
        want(f"tight flag register counted: {src!r}", counts(src, tg)["registers"], n)
    # (R40 CD-2) the param-default bridge is exempt only on a ROUTINES entry's own export
    rt = frozenset({"flyMotherShipOneFrame"})
    for src, n in (("export function flyMotherShipOneFrame(m, record = m.regs.ix, entry = m.regs.iy) { return record; }", 0),
                   ("export function coordinateAt(m, wholeAddr = m.regs.hl) { return wholeAddr; }", 1),
                   ("export function flyHelper(m, record = m.regs.ix, entry = m.regs.iy) { return record; }", 2)):
        want(f"tight ROUTINES-only param-default: {src[:40]!r}", len(register_hits_tight(_normalize_regs(src), rt)), n)
    want("routine_exports reads name and entry",
         routine_exports('export const ROUTINES = {\n  0x0ff1: { name: "f", why: "x" },\n'
                         '  0x1000: {\n    name: "g",\n    entry: "gEntry",\n  },\n};\n'), frozenset({"f", "gEntry"}))
    # (R40 GI-4) only an exported routine's own list is the bridge: the bare file, a nested or private helper count
    for src, n in (("export function f2(m, r = m.regs) { return r.hl; }", 2),
                   ("export function f(m) {\n  function inner(r = m.regs) { return r.a; }\n  return inner();\n}", 2),
                   ("export function f(m) {\n  function inner(x = m.regs.a) { return x; }\n  return inner();\n}", 1),
                   ("function h(m, x = m.regs.a) { return x; }", 1),
                   ("export function* g(m, x = m.regs.a) { yield x; }", 0),
                   ("export function f2(m, regs = m.regs) { return regs.hl; }", 2)):
        want(f"tight signature scope: {src!r}", counts(src, tg)["registers"], n)
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
                   ("const { regs: { a } } = m;", 1), ("if (m.regs._a === 7) return;", 1)):
        want(f"register spelling: {src!r}", counts(src, lg)["registers"], n)
    # (R40 GI-6) a // or /* inside a string or a regex literal hides nothing after it
    for src in ("const u = 'http://x'; m.call(PLAY_ACTIVE);", 'const u = "/*"; m.call(PLAY_ACTIVE);',
                "const re = /\\/\\//; m.call(PLAY_ACTIVE);", "const t = `a//b`; m.call(PLAY_ACTIVE);"):
        want(f"string-aware comments: {src!r}", counts(src, lg)["calls"], 1)
    for src, n in (("const h = a / b; // m.call(X)", 0), ("const h = (a) / 2 / c; m.call(X);", 1)):
        want(f"division is no regex: {src!r}", counts(src, lg)["calls"], n)
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
    # (R40 GI-3) uppercase hex, a hex shift count, and a module const of page value in the page position
    for src, n in (("mem8[lo | (0XAD << 8)] = 1;", 1), ("mem8[lo | (0xad << 0x8)] = 1;", 1),
                   ("const PAGE = 0xad;\nconst lo = mem8[X];\nconst at = (PAGE << 8) | lo;\nmem8[at] = 1;", 1),
                   ("const HI = 0xad;\nmem8[HI * 256 + lo] = 1;", 1), ("const HI = 0xad;\nmem8[lo + 256 * HI] = 1;", 1),
                   ("const PAGE = 0xa9 << 8;", 1),
                   ("const P = 0x10;\nconst STEP = -P * 256 + P;", 0), ("const N = 4;\nconst w = N << 8;", 0),
                   ("let PAGE = 0xad;\nPAGE = 0;\nconst at = (PAGE << 8) | lo;", 0)):
        want(f"page fold {sg}: {src!r}", counts(src, sg)["addrs"], n)
    helper = "function peek(m, hi, lo) { return m.mem8[(hi << 8) | lo]; }\n"
    want("page slot found", page_slots(helper), {("peek", 1, "page")})
    for src, n in (("const HI = 0xad;\nconst v = peek(m, HI, 0x30);", 1), ("const v = peek(m, 0xad, lo);", 1),
                   ("const v = peek(m, 3, lo);", 0), ("const v = peek(m, hi, 0xad);", 0)):
        want(f"page slot: {src!r}", counts(helper + src, sg, address_slots([helper + src], ""))["addrs"], n)
    want("page fold opt-in", counts("mem8[lo | (0xad << 8)] = 1;", lg)["addrs"], 0)
    want("pop/ret are pushes for TIGHT", counts("m.pop16(); m.pop8(); m.ret();", tg)["pushes"], 3)
    want("pop/ret not pushes for legacy", counts("m.pop16(); m.ret();", lg)["pushes"], 0)
    # SCOPE (R40 tp-r40i OPEN 1): every .js under idiomatic/ but test/ is in the layer, names.js included
    for path, n in (("games/timeplt/idiomatic/foo.js", True), ("games/timeplt/idiomatic/lib/evil.js", True),
                    ("games/timeplt/idiomatic/names.js", True), ("games/timeplt/idiomatic/test/x.test.js", False),
                    ("games/timeplt/idiomatic/test/lib/h.js", False), ("games/timeplt/machine.js", False),
                    ("core/z80ops_tmp.js", False), ("games/galaxian/idiomatic/lib/a.js", False)):
        want(f"in_layer {path}", in_layer(path, tg), n)
    # the auditor's subdirectory mutant (idiomatic/lib/evil.js) is counted like any module
    evil = "export function evil(m) {\n  m.call(0x1234); m.push16(0xad30);\n  return m.regs.a;\n}\n"
    c = counts(evil, tg, path="games/timeplt/idiomatic/lib/evil.js")
    want("lib/evil.js mutant", (c["calls"], c["pushes"], c["registers"], c["addrs"]), (1, 1, 1, 2))
    # names.js: data consts (and comment/string hex) are not code; an appended function is held to the rules
    names_src = ('/** cell 0xad30 [seen] */\nexport const PLAY_ACTIVE = 0xad30; // see 0x1234\n'
                 'export const STACK_SCRATCH = { lo: 0x01e0, hi: 0x0200 };\nexport const T = [0xad30, PLAY_ACTIVE];\n'
                 'export const ROUTINES = {\n  0x0ff1: { name: "f", why: "a // b at 0x4c99 (x) => y" },\n};\n')
    want("names.js data is no code", names_code(names_src).strip(), "")
    want("names.js data counts 0", total(counts(names_code(names_src), tg, path="games/timeplt/idiomatic/names.js")), 0)
    evil2 = names_src + "export function evil2(m) { m.call(0x1234); return m.regs.a + 0xad30; }\n"
    c = counts(names_code(evil2), tg, path="games/timeplt/idiomatic/names.js")
    want("names.js evil2 mutant", (c["calls"], c["registers"], c["addrs"]), (1, 1, 2))
    for code_src, cat in (("export const h = (m) => m.call(0x1234);", "calls"),
                          ("export const K = mk(0xad30);", "addrs"),
                          ("export const O = { get a() { return 0xad30; } };", "addrs"),
                          ("export class C { f(m) { m.push16(1); } }", "pushes"),
                          ("let L = 0xad30;", "addrs")):
        want(f"names.js code counted: {code_src!r}", counts(names_code(names_src + code_src), tg)[cat] >= 1, True)
    want("strip_js keeps code after an in-string //", strip_js('const u = "a // b"; m.call(1);'), 'const u = ""; m.call(1);')
    # IMPORTS (TIGHT): the layer, names.js and the reviewed allowlist pass; anything else counts
    mp = "games/timeplt/idiomatic/advanceAttractTowardGameStart.js"
    for src, n in (('import { a } from "./a.js";', 0), ('import { X } from "./names.js";', 0),
                   ('import { h } from "./lib/h.js";', 0), ('import { u8, u16 } from "../../../core/int.js";', 0),
                   ('import { h } from "./lib/h.mjs";', 1), ('import { h } from "./h.cjs";', 1),
                   ('import { bcdAddByte } from "../../../core/bcd.js";', 0),
                   ('import { F_Z, F_PV as P } from "../../../core/cpu/z80.js";', 1),   # R40 CD-1
                   ('import { NotImplemented } from "../../../boards/timeplt/io.js";', 0),
                   ('import { helper } from "../../../core/z80ops_tmp.js";', 1),         # the auditor's core mutant
                   ('import { Regs } from "../../../core/cpu/z80.js";', 1),
                   ('import { F_Z, Z80 } from "../../../core/cpu/z80.js";', 1),
                   ('import * as z from "../../../core/cpu/z80.js";', 1),
                   ('import { LATCH_NMI_ENABLE } from "../../../boards/timeplt/io.js";', 1),
                   ('import { NotImplemented } from "../../../boards/dkong/io.js";', 1),
                   ('import { loc_15b6 } from "../translated/loc_15b6.js";', 1),
                   ('import { poison } from "./test/_deadAtExit.js";', 1),
                   ('import { x } from "../machine.js";', 1), ('import fs from "node:fs";', 1),
                   ('import "../../../core/side-effect.js";', 1), ('export * from "../../../core/frame-stepped.js";', 1),
                   ('const z = await import("./a.js");', 1), ('const z = require("./a.js");', 1),
                   ('import {\n  helper,\n} from "../../../core/z80ops_tmp.js";', 1)):
        want(f"imports {tg}: {src!r}", counts(src, tg, path=mp)["imports"], n)
    want("imports opt-in: legacy game", counts('import { h } from "../../../core/z80ops_tmp.js";', lg,
                                               path="games/galaxian/idiomatic/a.js")["imports"], 0)
    want("imports need a path", counts('import { h } from "../../../core/z80ops_tmp.js";', tg)["imports"], 0)
    want("reviewed import allowlist holds", verify_import_allowlist(tg, False), [])
    real = lambda path: _read(path, False)
    for path, extra, n in (("core/int.js", "export const peek = (m) => m.regs.a;\n", 1),
                           ("core/bcd.js", "export function h(m) { m.ldirAt(1, 2); }\n", 1),
                           ("core/bcd.js", 'import { Z80 } from "./cpu/z80.js";\n', 1),
                           ("core/cpu/z80.js", "export function F_ZZ() {}\n", 0),
                           ("boards/timeplt/io.js", "", 0)):
        fake = lambda p, path=path, extra=extra: real(p) + extra if p == path else real(p)
        want(f"allowlist re-check: {path} + {extra!r}", len(verify_import_allowlist(tg, False, fake)), n)
    swapped = lambda p: (real(p).replace("export class NotImplemented extends Error", "export function NotImplemented()")
                         if p == "boards/timeplt/io.js" else real(p))
    want("allowlist re-check: NotImplemented turned executable", len(verify_import_allowlist(tg, False, swapped)), 1)
    # OFFSET ALIAS (SHORT_ADDR, R40 tp-r40i OPEN 2): NAME +/- lit landing on ANOTHER names.js export counts
    nm = names_addresses("export const PLAY_ACTIVE = 0xad30;\nexport const PLAYER_ONE_ERA_INDEX = 0xad14;\n"
                         "export const STEP = 0xa9f0;\nexport const TICK = 0xa9f1;\nexport const CUR = 0xa9f7;\n"
                         "export const POS = 0xa9e3;\nexport const CELL = 0xa9e4;\nexport const NEXT = 0xa9e5;\n")
    imp = 'import { PLAY_ACTIVE, STEP, POS, CUR as C } from "./names.js";\n'
    for src, n in (("mem8[PLAY_ACTIVE - 0x1c] = 1;", 1),            # the auditor's mutant: 0xAD14
                   ("mem8[STEP + 0x1] = 0;", 1), ("mem8[STEP + 1] = 0;", 1), ("mem8[(STEP + 1)] = 0;", 1),
                   ("f(m, 1 + STEP);", 1), ("f(m, STEP + 1);", 1), ("const p = STEP + 1;", 1),
                   ("return STEP + 1;", 1), ("mem8[C - 7] = 0;", 1), ("mem8[u16(STEP + 1)] = 0;", 1),
                   ("mem8[STEP + 5] = 0;", 0),                       # 0xA9F5: no export there
                   ("mem8[STEP + 0] = 0;", 0), ("mem8[STEP + 1 + i] = 0;", 0), ("mem8[i + STEP + 1] = 0;", 0),
                   ("f(m, 2 * STEP + 1);", 0), ("mem8[CUR + 1] = 0;", 0),   # CUR not imported under that name
                   ("mem8[POS + 1] = 0;", 1), ("mem8[POS + 2] = 0;", 1)):
        want(f"offset alias {sg}: {src!r}", counts(imp + src, sg, names=nm)["addrs"], n)
    for src, n in (("mem8[POS + 1] = 0;", 0), ("mem8[POS + 2] = 0;", 1)):   # a declared 2-byte word base
        want(f"offset alias word base: {src!r}", counts(imp + src, sg, names=nm, bases={"POS": 2})["addrs"], n)
    want("offset alias opt-in: legacy game", counts(imp + "mem8[STEP + 1] = 0;", lg, names=nm)["addrs"], 0)
    # (R40 GI-1, CD-3) a named offset: a module const of literal value, alone or in a literal expression
    for src, n in (("const FIELD = 1;\nmem8[STEP + FIELD] = 0;", 1), ("const FIELD = 0x01;\nf(m, FIELD + STEP);", 1),
                   ("const W = 1;\nmem8[POS + 2 * W] = 0;", 1), ("const S = 0x10;\nconst F = S >> 4;\nmem8[STEP + F] = 0;", 1),
                   ("let FIELD = 1;\nmem8[STEP + FIELD] = 0;", 1), ("const T = [1];\nmem8[STEP + T.length] = 0;", 1),
                   ("const FIELD = 1;\nconst at = () => STEP + FIELD;", 1), ("const at = () => STEP + 1;", 1),
                   ("let FIELD = 1;\nFIELD = 2;\nmem8[STEP + FIELD] = 0;", 0), ("const K = 1;\nconst K2 = 1;\nmem8[STEP + K + i] = 0;", 0),
                   ("const FIELD = 5;\nmem8[STEP + FIELD] = 0;", 0), ("function f() { const K = 1; }\nfunction g() { const K = 2; }\nmem8[STEP + K] = 0;", 0)):
        want(f"offset alias named offset: {src!r}", counts(imp + src, sg, names=nm)["addrs"], n)
    ms = names_addresses("export const MOTHER_SHIP_STATE = 0xa8a0;\nexport const MOTHER_SHIP_HITS_TO_ABSORB = 0xa8a4;\n"
                         "export const CRAFT_RECORD_SLOT6 = 0xa8b0;\nexport const DEFERRED_WRITE_CURSOR = 0xae00;\n"
                         "export const DEFERRED_WRITE_LIST = 0xae04;\n")
    msi = 'import { MOTHER_SHIP_STATE, DEFERRED_WRITE_CURSOR } from "./names.js";\n'
    for src, n in (("const RECORD_STRIDE = 0x10;\nconst FIRE_BYTE = 0x04;\nconst FIRE_ARMED = 0x07;\n"
                    "if ((mem8[MOTHER_SHIP_STATE] | mem8[MOTHER_SHIP_STATE + RECORD_STRIDE]) !== 0) return;\n"
                    "mem8[MOTHER_SHIP_STATE + FIRE_BYTE] = FIRE_ARMED;", 2),
                   ("const FIRST_ENTRY = 4;\nm.mem16[DEFERRED_WRITE_CURSOR] = DEFERRED_WRITE_CURSOR + FIRST_ENTRY;\n"
                    "return (m.regs.hl = DEFERRED_WRITE_CURSOR + FIRST_ENTRY);", 2)):
        want(f"offset alias shipped form: {src[:40]!r}", counts(msi + src, sg, names=ms)["addrs"], n)
    # (R40 GI-2) an aliased base, a namespace import, a straight-line cursor, a word access, an arrow body
    for src, n in (("const intro = STEP;\nmem8[intro + 1] = 0;", 1), ("let intro = STEP;\nmem8[intro + 1] = 0;", 1),
                   ("const v = STEP + 1;\nmem8[v] = 0;", 1), ("const v = STEP;\nconst w = v + 1;\nmem8[w] = 0;", 1),
                   ("let p = STEP;\np++;\nmem8[p] = 0;", 1), ("let p = STEP;\nmem8[++p] = 0;", 1),
                   ("let p = STEP;\nmem8[p++] = 1;\nmem8[p] = 0;", 1), ("let p = STEP;\np += 1;\nmem8[p] = 0;", 1),
                   ("let p;\np = STEP;\np++;\nmem8[p] = 0;", 1), ("let p = STEP;\np++;\np++;", 0),
                   ("let p = STEP;\np = p + 1;\nmem8[p] = 0;", 1), ("let p = STEP;\np = 1 + p;\nmem8[p] = 0;", 1),
                   ("let p = STEP;\np++;\np = STEP;\nmem8[p] = 0;", 0), ("let p = q;\np = STEP + 1;", 1),
                   ("if (p < STEP + 1) f();", 0), ("if (p === STEP + 1) f();", 1), ("mem8[STEP + 1] = 0;\nn++;", 1),
                   ("let p = STEP;\np = q;\nmem8[p + 1] = 0;", 0), ("let p = STEP;\nif (c) p++;\nmem8[p] = 0;", 0),
                   ("let p = STEP;\nfor (let i = 0; i < 4; i++) mem8[p++] = 0;\nmem8[p] = 0;", 0),
                   ("let p = STEP;\nfor (let i = 0; i < 4; i++) { mem8[p] = 0; p++; }", 0),
                   ("let p = STEP;\nwhile (n--) mem8[p++] = 0;", 0), ("let p = STEP;\np += k;\nmem8[p] = 0;", 0),
                   ("for (let p = STEP; c; p++) mem8[p] = 0;", 0),
                   ("m.mem16[STEP] = v;", 1), ("const w = mem16[POS];", 1), ("const w = mem16[POS + 1];", 2),
                   ("const w = mem16[CUR];", 0)):
        want(f"offset alias {sg}: {src!r}", counts(imp + src, sg, names=nm)["addrs"], n)
    nsi = 'import * as N from "./names.js";\n'
    want("offset alias namespace import", counts(nsi + "mem8[N.STEP + 1] = 0;", sg, names=nm)["addrs"], 1)
    want("offset alias namespace control", counts(nsi + "mem8[N.STEP] = 0;", sg, names=nm)["addrs"], 0)
    want("offset alias word base", counts(imp + "const w = mem16[POS];", sg, names=nm, bases={"POS": 2})["addrs"], 0)
    want("names.js short export refused", nonstandard_exports("export const A = 0xad30;\nexport const EVIL_TABLE = 0xd1b;\n"),
         ["EVIL_TABLE"])
    want("names.js short export still an address", names_addresses("export const EVIL_TABLE = 0xd1b;\n"), {"EVIL_TABLE": 0xd1b})
    want("subdir module's ../names.js import", counts('import { STEP } from "../names.js";\nmem8[STEP + 1] = 0;', sg,
                                                    path="games/timeplt/idiomatic/lib/a.js", names=nm)["addrs"], 1)
    for bad in ("POS\n", "POS 2\n", "POS 1 a byte\n", "NOPE 2 not an export\n", "POS x reason\n"):
        try:
            parse_bases(bad, "x", nm)
            want(f"malformed base entry blocks: {bad!r}", "parsed", "GitError")
        except GitError:
            pass
    want("base entry parsed", parse_bases("# c\nPOS  2  a word\n", "x", nm), {"POS": 2})
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
