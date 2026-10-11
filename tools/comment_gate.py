#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""Comment gate — two mechanical rules; rationale, history, and known limitations: docs/comment-gate.md.

DENSITY: comment lines may not exceed code // DENSITY_DIVISOR + DENSITY_FLOOR, in .js/.mjs/.py/.lua
under boards/ games/ tools/ core/ web/ (minus node_modules); a line with code and a trailing comment
counts as both. NOTHING is exempt by KIND (not this file); one file is exempt by POSITION --
games/<game>/idiomatic/names.js. WHOLE-FILE: an over-cap file is frozen against every edit, so bring
it under the cap as its own prerequisite unit and do not park the fix.

REFERENCE (games/<game>/idiomatic/ only): a comment describes the file it sits in, not the ROM, MAME,
the oracle, a sibling, a test, a doc, or a to-do. Exempt: translated/**, names.js, tests.

CLEANUP PHASE: a game that declares `idiomaticComplete: true` (its manifest) has BOTH rules step aside for
its idiomatic/**, so cleaned routines carry verbose comments. Game-local flag, enforced by idiomatic_gate;
rationale and the whole design below in docs/comment-gate.md.

  check              STAGED files pass both rules (the pre-commit hook)
  scan / density     that rule over the working tree [PATH ...]
  selftest           known-bad and known-good cases

FAIL CLOSED on git error or an unlexable file; `check` is VACUOUS with nothing staged. Counting uses a
real lexer (Python tokenize, Lua _scan_lua, shell excluded); JS regex-vs-division is scanned both ways.
"""
import argparse
import io
import os
import re
import subprocess
import sys
import tokenize


class GitError(RuntimeError):
    """A git invocation failed — callers turn this into a BLOCK (fail closed)."""


class LexError(RuntimeError):
    """The scanner cannot decide — callers turn this into a BLOCK (fail closed). Two triggers, both
    DETECTED not guessed: an unterminated `'`/`"` string, and a `/` at an ambiguous position whose
    two readings disagree. Neither judges the prose; no verdict is defensible, so none is given.
    """


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


def blob(ref, path):
    """Staged content (ref ':0'). RAISES rather than returning '' -- an empty string scans clean (fail-OPEN)."""
    r = subprocess.run(["git", "show", f"{ref}:{path}"], capture_output=True, text=True)
    if r.returncode != 0:
        raise GitError(r.stderr.strip() or f"cannot read {ref}:{path}")
    return r.stdout


# ── what a comment may not name ───────────────────────────────────────────────────────────────
# (label, regex): the label names the RULE broken, not the token. Four hex digits is an address, two data.
FORBIDDEN = [
    ("cites an address", re.compile(r"0x[0-9a-f]{4}", re.I)),
    ("cites an address", re.compile(r"\$[0-9a-f]{4}(?![0-9a-f])", re.I)),
    ("cites an address", re.compile(r"(?<![0-9a-zA-Z_])[0-9a-f]{4}h(?![A-Za-z0-9])", re.I)),
    ("cites another routine", re.compile(r"(?<![A-Za-z0-9_])loc_[0-9a-f]{4}(?![A-Za-z0-9_])", re.I)),
    ("cites the ROM", re.compile(r"(?<![A-Za-z])ROMs?(?![A-Za-z])", re.I)),
    ("cites MAME", re.compile(r"(?<![A-Za-z])MAME(?![A-Za-z])", re.I)),
    ("restores a repealed header block", re.compile(r"(?<![A-Za-z])(?:GATE|NAMES)\s*:")),
    ("restores a repealed header block", re.compile(r"memory[- ]equivalent", re.I)),
    ("cites the frozen oracle", re.compile(r"(?<![A-Za-z])oracles?(?![A-Za-z])", re.I)),
    ("cites another file", re.compile(r"[A-Za-z0-9_./-]*\.(?:js|mjs|md|py|lua|cpp)(?![A-Za-z0-9])")),
    ("cites another directory", re.compile(r"(?<![A-Za-z0-9_])(?:\.\./|translated/|idiomatic/)")),
    # A to-do claims work not done; the loc_<addr> filename already says it and cannot self-contradict.
    ("carries a to-do", re.compile(r"(?<![A-Za-z])(?:TODO|FIXME|XXX)(?![A-Za-z])")),
    ("carries a to-do", re.compile(r"promote once|once corroborated|a later understanding pass|for a later understanding pass|name kept neutral", re.I)),
    # Status words describe the PORT not the code. UNWIRED is case-SENSITIVE (lowercase = ordinary English).
    ("cites the port's state", re.compile(r"(?<![A-Za-z])(?:still[- ](?:un)?translated|untranslated|not yet (?:wired|translated|decompiled|named|promoted)|still[- ]oracle)(?![A-Za-z])", re.I)),
    ("cites the port's state", re.compile(r"(?<![A-Za-z])UNWIRED(?![A-Za-z])")),
]

# Exempt by exact position, not basename -- a basename test would exempt a future idiomatic/sub/names.js.
EXEMPT_LEAF = "names.js"

# The game-local CLEANUP flag: games/<game>/manifest.js `idiomaticComplete: true`. Read from the INDEX, so
# verbose mode takes effect only once the flag is committed. Line-anchored so a commented-out `//
# idiomaticComplete: true` does not match. docs/comment-gate.md.
_COMPLETE_RE = re.compile(r"(?m)^\s*idiomaticComplete\s*:\s*true\b")
_complete_cache = {}


def _game_idiomatic_complete(game):
    if game not in _complete_cache:
        try:
            _complete_cache[game] = bool(_COMPLETE_RE.search(blob(":0", f"games/{game}/manifest.js")))
        except GitError:
            _complete_cache[game] = False
    return _complete_cache[game]


def _cleanup_exempt(path):
    """True for an idiomatic ROUTINE file whose game declares idiomaticComplete -- both rules step aside.
    test/ is NOT exempt: test harnesses keep the density discipline even in a complete game."""
    parts = path.split("/")
    return (len(parts) >= 3 and parts[0] == "games" and parts[2] == "idiomatic"
            and "test" not in parts[3:] and _game_idiomatic_complete(parts[1]))


def in_scope(path):
    """True for a file this gate governs: games/<game>/idiomatic/**.js, minus the registry, tests, and translated/."""
    parts = path.split("/")
    if len(parts) < 4 or parts[0] != "games" or parts[2] != "idiomatic":
        return False
    if not path.endswith(".js"):
        return False
    if "test" in parts[3:]:
        return False
    if _cleanup_exempt(path):
        return False
    return parts[3:] != [EXEMPT_LEAF]


# ── density: prose may not exceed code // DENSITY_DIVISOR + DENSITY_FLOOR ──────────────────────────────

DENSITY_DIVISOR = 2  # comment lines allowed = code lines // DENSITY_DIVISOR + DENSITY_FLOOR
DENSITY_FLOOR = 8  # >=8 comment lines always allowed. Cap history (0.50 -> /4+4 -> 2x both, /2+8 Karl
# 2026-08-19) and why cutting elaboration catches false claims no gate can see: docs/comment-gate.md.
# Checks STAGED files only.

_ROOTS = ("boards", "games", "tools", "core", "web")
# Counting needs a real lexer: Python tokenize, Lua _scan_lua, shell excluded. Why: docs/comment-gate.md.
_EXTS = (".js", ".mjs", ".py", ".lua")
# A closed STRING ends a value, so `"10" / 2` is division and its trailing `//` a comment.
_REGEX_OK_BEFORE = re.compile("[)\\]}A-Za-z0-9_$'\"`]$")
# Keywords a VALUE may follow, so `/` after one opens a REGEX. `)`/`]`/`}` are settled by scanning
# both ways instead (see `_both_ways`). Test is on token SPELLING; `in`/`of` are left out as
# ordinary identifiers. Details: docs/comment-gate.md.
_VALUE_KEYWORDS = frozenset(
    "return typeof instanceof delete void throw new yield await case".split()
)


def _regex_reading_possible(text, i):
    """Could the `/` at `i` plausibly OPEN a regex literal? Only asked at ambiguous positions
    (`)`, `]`, `}`); without it, `(a+b) / c; // x` reads ambiguous and the gate would refuse
    ordinary division with a trailing comment. Two cheap facts settle almost every line: a regex
    must CLOSE on its own line, and never opens on whitespace (`/ c` is division). Details: docs/comment-gate.md.
    """
    eol = text.find("\n", i)
    eol = len(text) if eol < 0 else eol
    if i + 1 >= eol or text[i + 1] in " \t=":
        return False
    return "/" in text[i + 1 : eol]


def density_scope(path):
    """True for a source file the density rule governs. Nothing is exempt by KIND (translated/,
    generated files, and this file included). ONE file is exempt by POSITION:
    games/<game>/idiomatic/names.js, the address-to-name map, whose comments are each entry's own
    content, not commentary on code -- see docs/comment-gate.md.
    """
    parts = path.split("/")
    if parts[0] not in _ROOTS or "node_modules" in parts:
        return False
    if len(parts) == 4 and parts[0] == "games" and parts[2] == "idiomatic" and parts[3] == EXEMPT_LEAF:
        return False
    if _cleanup_exempt(path):
        return False
    return os.path.splitext(path)[1] in _EXTS


def _scan(path, text, amb_regex):
    """(code, comment, spans) for one JS file, from a string-aware left-to-right scan.

    `amb_regex` decides the ONE case a scanner cannot: a `/` after `)`, `]` or `}` (regex in
    `if (x) /re/`, division in `(a+b) / c`); callers run both ways and refuse on disagreement.
    A line is COMMENT if any comment sits on it and CODE if any non-comment text does (both if both);
    a shebang and one SPDX line are neither. Why prefix matching fails: docs/comment-gate.md.
    """
    nlines = len(text.splitlines())
    is_comment = [False] * (nlines + 1)
    is_code = [False] * (nlines + 1)

    def mark(flags, a, b=None):
        # Clamp to the LAST line: a construct running to EOF counts one newline too
        # many, which would invent a line that is not there.
        for r in range(a, min(b if b is not None else a, nlines - 1) + 1):
            if 0 <= r < nlines:
                flags[r] = True

    i, n, ln = 0, len(text), 0
    at_line_start = True
    prev = ""
    word = ""  # the last COMPLETE identifier token, for the regex-vs-division test
    word_open = False  # still accumulating it? whitespace ends the token, it does not clear it
    spdx_free = [True]
    spans = []  # (1-based lineno, comment text) — what the REFERENCE rule reads

    def is_spdx(body):
        if not body.lstrip().startswith("SPDX-License-Identifier") or not spdx_free[0]:
            return False
        spdx_free[0] = False
        return True

    while i < n:
        ch = text[i]
        if ch == "\n":
            ln += 1
            at_line_start = True
            i += 1
            continue
        if ch in " \t\r\ufeff":
            word_open = False  # ends the token; `return /re/` must still see "return"
            i += 1
            continue

        if ln == 0 and at_line_start and text.startswith("#!", i):
            end = text.find("\n", i)
            i = n if end < 0 else end
            continue

        if text.startswith("//", i):
            end = text.find("\n", i)
            end = n if end < 0 else end
            body = text[i + 2 : end]
            spans.append((ln + 1, body))
            if not is_spdx(body):
                mark(is_comment, ln)
            i = end
            continue

        if text.startswith("/*", i):
            end = text.find("*/", i + 2)
            closed = end >= 0
            end = n if not closed else end + 2
            for off, raw in enumerate(text[i:end].splitlines()):
                spans.append((ln + 1 + off, _MARKER.sub("", raw)))
            mark(is_comment, ln, ln + text.count("\n", i, end))
            ln += text.count("\n", i, end)
            i = end
            at_line_start = False
            continue

        # `++`/`--` end a VALUE, so the `/` after them is division. A single `+`/`-`
        # does not, so `a + /re/.test(s)` still reads as a regex. A keyword ends in a
        # LETTER but does not end a value, so `return /re/` is a regex too -- testing
        # only the previous character read it as division and fell open.
        if ch == "/" and (
            (amb_regex and prev[-1:] in (")", "]", "}") and _regex_reading_possible(text, i))
            or (
                (not _REGEX_OK_BEFORE.search(prev) or word in _VALUE_KEYWORDS)
                and prev not in ("++", "--")
            )
        ):
            j = i + 1
            while j < n and text[j] != "\n":
                if text[j] == "\\":
                    j += 2
                    continue
                if text[j] == "[":
                    while j < n and text[j] not in "]\n":
                        j += 2 if text[j] == "\\" else 1
                if text[j] == "/":
                    j += 1
                    break
                j += 1
            mark(is_code, ln)
            i = j
            at_line_start = False
            prev, word = "/", ""
            continue

        if ch in "'\"`":
            q, i, start_ln = ch, i + 1, ln
            closed = False
            while i < n:
                if text[i] == "\\":
                    i += 2
                    continue
                if text[i] == "\n":
                    if q != "`":
                        break
                    ln += 1
                if text[i] == q:
                    i += 1
                    closed = True
                    break
                i += 1
            if not closed:
                raise LexError(
                    f"{path}:{start_ln + 1}: a {q} string opens and never closes. Either the "
                    "file does not parse, or this scanner mistook a regex literal for "
                    "division and read its body as code. Refusing to judge the file."
                )
            mark(is_code, start_ln, ln)
            at_line_start = False
            prev, word = q, ""
            continue

        mark(is_code, ln)
        at_line_start = False
        prev = (prev[-1] + ch) if ch in "+-" and prev[-1:] == ch else ch
        if ch.isalnum() or ch in "_$":
            word, word_open = (word + ch if word_open else ch), True
        else:
            word, word_open = "", False
        i += 1

    # Blank lines are neither, INCLUDING inside a block comment or a template literal. The
    # module docstring says so and the Python scanner already did it; JS was charging them,
    # which penalised exactly the JSDoc headers the idiomatic layer is made of.
    for r, raw in enumerate(text.splitlines()):
        if not raw.strip():
            is_code[r] = is_comment[r] = False
    return sum(is_code), sum(is_comment), spans


def _scan_python(path, text):
    """(code, comment, spans) for one .py file, via the stdlib `tokenize` -- the same lexer the
    interpreter uses, so no ambiguity to resolve. A triple-quoted string is PROSE as a docstring
    (opens a statement) and CODE as a value; a line carrying both is charged to both.
    """
    comment, code, prose = set(), set(), set()
    spdx_free = [True]
    try:
        toks = list(tokenize.generate_tokens(io.StringIO(text).readline))
    except (tokenize.TokenError, IndentationError, SyntaxError) as e:
        raise LexError(f"{path}: python tokenizer refused the file ({e})")

    spans, opens_stmt = [], True
    for t in toks:
        if t.type == tokenize.COMMENT:
            body = t.string.lstrip("#")
            spans.append((t.start[0], body))
            if body.lstrip().startswith("SPDX-License-Identifier") and spdx_free[0]:
                spdx_free[0] = False
            elif not (t.start[0] == 1 and t.string.startswith("#!")):
                comment.add(t.start[0])
        elif t.type == tokenize.STRING and opens_stmt:
            for r in range(t.start[0], t.end[0] + 1):
                prose.add(r)
            spans += [(t.start[0] + i, ln) for i, ln in enumerate(t.string.splitlines())]
        elif t.type not in (
            tokenize.NL, tokenize.NEWLINE, tokenize.INDENT,
            tokenize.DEDENT, tokenize.ENDMARKER, tokenize.COMMENT,
        ):
            for r in range(t.start[0], t.end[0] + 1):
                code.add(r)
        if t.type not in (tokenize.NL, tokenize.COMMENT):
            opens_stmt = t.type in (tokenize.NEWLINE, tokenize.INDENT, tokenize.DEDENT)

    blank = {i + 1 for i, ln in enumerate(text.splitlines()) if not ln.strip()}
    return len(code - prose - blank), len((comment | prose) - blank), spans


_LUA_LONG = re.compile(r"\[(=*)\[")


def _scan_lua(path, text):
    """(code, comment, spans) for one .lua file.

    Lua comments: `--` to EOL, `--[=*[ ... ]=*]` long comment; strings `'`/`"`/`[=*[...]=*]`. The
    long bracket is what a naive scanner gets both ways -- a `[[...]]` STRING with `--` is not a
    comment, a `--[==[...]==]` comment is not one line -- handled by matching the closing bracket
    at the opening `=` level. Hand-written (no third-party Python); the corpus/Pygments cross-check,
    its limits, and Pygments' EOF `--[[` bug this scanner is right on: docs/comment-gate.md.
    """
    n, i, ln = len(text), 0, 1
    comment, code, spans = set(), set(), []
    if text.startswith("#!"):  # neither, like the SPDX line and a blank -- JS and Python agree
        i = text.find("\n")
        if i < 0:
            return 0, 0, []
        ln, i = 2, i + 1
    while i < n:
        ch = text[i]
        if ch == "\n":
            ln += 1
            i += 1
            continue
        if ch in " \t\r":
            i += 1
            continue
        if text.startswith("--", i):
            m = _LUA_LONG.match(text, i + 2)
            if m:  # long comment: runs to the matching close at the same level
                close = "]" + "=" * len(m.group(1)) + "]"
                end = text.find(close, m.end())
                end = n if end < 0 else end + len(close)
                for off, raw in enumerate(text[i:end].splitlines()):
                    comment.add(ln + off)
                    spans.append((ln + off, raw))
                ln += text.count("\n", i, end)
                i = end
                continue
            end = text.find("\n", i)
            end = n if end < 0 else end
            body = text[i + 2 : end]
            spans.append((ln, body))
            if not body.lstrip().startswith("SPDX-License-Identifier"):
                comment.add(ln)
            i = end
            continue
        m = _LUA_LONG.match(text, i)
        if m:  # a long-bracket STRING is code, whatever it contains
            close = "]" + "=" * len(m.group(1)) + "]"
            end = text.find(close, m.end())
            end = n if end < 0 else end + len(close)
            for off in range(text.count("\n", i, end) + 1):
                code.add(ln + off)
            ln += text.count("\n", i, end)
            i = end
            continue
        if ch in "'\"":
            q, i, start = ch, i + 1, ln
            while i < n:
                if text[i] == "\\":
                    i += 2
                    continue
                if text[i] == "\n" or text[i] == q:
                    break
                i += 1
            if i < n and text[i] == q:
                i += 1
            code.add(start)
            continue
        code.add(ln)
        i += 1
    blank = {k + 1 for k, l in enumerate(text.splitlines()) if not l.strip()}
    return len(code - blank), len(comment - blank), spans


def _both_ways(path, text):
    """Scan twice, resolving the ambiguous `/` each way, and REFUSE if the readings differ. Where
    they agree the ambiguity did not matter; where they disagree no answer is defensible, so the
    file is refused. Both rules go through here, so neither can be fixed without the other. Python
    takes none of it (`tokenize` is exact). The apostrophe-parity bug this replaced: docs/comment-gate.md.
    """
    ext = os.path.splitext(path)[1]
    if ext == ".py":
        return _scan_python(path, text)
    if ext == ".lua":
        return _scan_lua(path, text)
    a = _scan(path, text, False)
    b = _scan(path, text, True)
    if a[:2] != b[:2] or a[2] != b[2]:
        raise LexError(
            f"{path}: a `/` after `)`, `]` or `}}` reads as EITHER a regex literal or division, "
            "and the two readings disagree about which lines are comments. Refusing to judge "
            "the file — rewrite the line (assign the regex to a name, or parenthesise the "
            "division) so it is unambiguous."
        )
    return a


def count_lines(path, text):
    """(code, comment) for one file. EVERY comment counts, wherever it sits.

    A bare mnemonic beside `regs.and(regs.a)` says nothing the code does not, so a block on a
    file made of them is followable: delete the comment.
    """
    code, comment, _ = _both_ways(path, text)
    return code, comment


def comment_spans(path, text):
    """[(lineno, comment_text)] for every comment, leading OR trailing."""
    return _both_ways(path, text)[2]


def density_violations(paths, read):
    """[(path, code, comment, cap)] for every file over the cap."""
    out = []
    for p in paths:
        code, comment = count_lines(p, read(p))
        cap = code // DENSITY_DIVISOR + DENSITY_FLOOR
        if comment > cap:
            out.append((p, code, comment, cap))
    return out


def report_density(hits, stream):
    for path, code, comment, cap in hits:
        print(f"  {path}: {comment} comment lines, {code} code — cap is {cap}", file=stream)
        # A generated file is governed like any other, but editing it is wasted work: the next
        # regeneration discards it. Say where the prose actually lives, or the blanket advice
        # above sends the reader to the wrong file.
        if re.search(r"\.generated\.[A-Za-z0-9]+$", os.path.basename(path)):
            print("      ^ generated — fix the generator's template, not this file", file=stream)


# ── floor: a cleaned (idiomaticComplete) game must carry ENOUGH comment ───────────────────────
# The density CAP steps aside for idiomaticComplete games, so nothing then REQUIRES the cleanup phase's
# verbose comments -- invaders shipped DONE with descriptive names but a ~0.27 comment ratio (vs ~1.9 the
# other cleaned games carry). The FLOOR closes that gap: each idiomatic file must carry at least
# code // DENSITY_DIVISOR + FLOOR_MIN comment lines. Rationale + calibration: docs/comment-gate.md.
FLOOR_MIN = 3  # >=3 comment lines always required (a header) regardless of code size


def comment_debt(game):
    """Idiomatic paths allowlisted off the floor, from games/<game>/comment-debt.txt ('#'/blank ignored)."""
    debt = set()
    try:
        text = blob(":0", f"games/{game}/comment-debt.txt")
    except GitError:
        return debt  # no debt file -> no exemptions
    for line in text.splitlines():
        line = line.split("#", 1)[0].strip()
        if line:
            debt.add(line)
    return debt


def floor_files(game):
    """Idiomatic .js files the floor governs, as STAGED (the index): games/<game>/idiomatic/**.js minus
    names.js and test/. The floor reads the file list, the files and idiomaticComplete all from the index,
    so the three always describe the same tree (an unstaged edit can neither pass nor fail it)."""
    base = f"games/{game}/idiomatic/"
    r = subprocess.run(["git", "ls-files", "--cached", "--", base], capture_output=True, text=True)
    if r.returncode != 0:
        raise GitError(r.stderr.strip() or f"cannot list {base}")
    out = []
    for path in r.stdout.splitlines():
        rest = path[len(base):]
        if rest.startswith("test/") or "/test/" in rest:
            continue
        if path.endswith(".js") and os.path.basename(path) != EXEMPT_LEAF:
            out.append(path)
    return out


def floor_violations(files, read, debt=frozenset()):
    """[(path, code, comment, floor)] for each file whose comment count is below the floor, minus debt."""
    out = []
    for path in sorted(files):
        if path in debt:
            continue
        code, comment = count_lines(path, read(path))
        floor = code // DENSITY_DIVISOR + FLOOR_MIN
        if comment < floor:
            out.append((path, code, comment, floor))
    return out


# ── extracting comments ───────────────────────────────────────────────────────────────────────

_MARKER = re.compile(r"^\s*(?:/\*+|\*/|\*)\s?")


def blocks(spans):
    """Join runs of consecutive-line comments into (first_line, joined_text, member_spans) -- a claim
    wraps across lines in a header, and a per-line scan splits the sentence and matches neither half.
    """
    out, run, prev = [], [], None
    for span in spans:
        lineno = span[0]
        if prev is not None and lineno == prev + 1:
            run.append(span)
        else:
            if run:
                out.append((run[0][0], " ".join(s[1] for s in run), run))
            run = [span]
        prev = lineno
    if run:
        out.append((run[0][0], " ".join(s[1] for s in run), run))
    return out


def _self_names(path):
    """The names that ARE this file, lowercased. A file naming itself is not an outside
    reference, and an unnamed routine is REQUIRED to be called loc_<addr>."""
    leaf = os.path.basename(path)
    stem = leaf[:-3] if leaf.endswith(".js") else leaf
    return {stem.lower(), leaf.lower()}


# The self-name exemption applies ONLY to the two rules that match a NAME. Applied to every rule it
# becomes a stem collision: `rom.js` would suppress "the ROM", `mame.js` would suppress "MAME", and
# `oracle.js` would suppress "the frozen oracle" — none of which is the file naming itself.
SELF_EXEMPT_LABELS = {"cites another routine", "cites another file"}


def violations(path, text):
    """[(path, lineno, label, matched_text)] — one per comment block per rule broken. Prints no
    tree-wide total (a printed count gets quoted into prose where nothing invalidates it). The line
    is the one the match is ON, not the block's first.
    """
    mine = _self_names(path)
    hits = []
    for start, block, spans in blocks(comment_spans(path, text)):
        for label, pattern in FORBIDDEN:
            skip = mine if label in SELF_EXEMPT_LABELS else frozenset()

            def carries(body, _p=pattern, _skip=skip):
                return next(
                    (m for m in _p.finditer(body) if m.group(0).strip().lower() not in _skip), None
                )

            found = carries(block)
            if not found:
                continue
            # Prefer the member line that carries the match; fall back to the block start for a
            # claim that only exists once the wrapped lines are joined.
            lineno = next((ln for ln, body in spans if carries(body)), start)
            hits.append((path, lineno, label, found.group(0).strip()))
    return hits


# ── subcommands ───────────────────────────────────────────────────────────────────────────────


def staged_names():
    """Every staged path. `-z` matters: without it `core.quotePath` returns a quoted name that
    every scope test drops SILENTLY, which is fail-OPEN."""
    raw = git(["diff", "--cached", "--name-only", "-z", "--diff-filter=ACMR"])
    return [p for p in raw.split("\0") if p]


def cmd_check(_args):
    try:
        names = staged_names()
    except GitError as e:
        print(f"comment_gate: BLOCKED — git failed: {e}", file=sys.stderr)
        return 1

    # BOTH rules run every time, and both report. Returning on the first failure meant a
    # density block hid every reference violation in the same commit, so a reviewer told to
    # "verify comment_gate check exits 0" could not tell which rule the exit code was about.
    failed = False

    try:
        dense = density_violations(
            [p for p in names if density_scope(p)], lambda p: blob(":0", p)
        )
    except LexError as e:
        print(f"comment_gate: BLOCKED — cannot lex: {e}", file=sys.stderr)
        return 1
    if dense:
        failed = True
        print(
            "comment_gate: BLOCKED — comments may not exceed code lines // "
            f"{DENSITY_DIVISOR} + {DENSITY_FLOOR}.\n"
            "  Cut the prose; do not raise the cap.\n",
            file=sys.stderr,
        )
        report_density(dense, sys.stderr)

    hits = []
    for p in [p for p in names if in_scope(p)]:
        hits += violations(p, blob(":0", p))
    if hits:
        failed = True
        print(
            "comment_gate: BLOCKED — these comments name something outside their own file.\n"
            "  An idiomatic comment describes THIS file.\n"
            "  (docs/idiomatic-generation.md, \"Output conventions\")\n",
            file=sys.stderr,
        )
        for path, lineno, label, matched in hits:
            print(f"  {path}:{lineno}: {label} — {matched!r}", file=sys.stderr)

    if failed:
        return 1
    print("comment_gate: OK")
    return 0


def cmd_scan(args):
    root = repo_root()
    roots = args.paths or ["games"]
    files, empty = [], []
    for r in roots:
        before = len(files)
        for dirpath, _dirnames, filenames in os.walk(os.path.join(root, r)):
            for fn in filenames:
                full = os.path.join(dirpath, fn)
                rel = os.path.relpath(full, root)
                if in_scope(rel):
                    files.append((rel, full))
        if len(files) == before:
            empty.append(r)
    # A root matching NOTHING is an error, not a pass: a green scan licenses skipping the
    # tree-wide sweep, so a mistyped name must not buy that licence.
    if empty:
        # PER ROOT, not "every root was empty". `scan games/dkong games/timepilot` would otherwise
        # report on dkong and quietly license timepilot, which is the same vacuous green one root
        # further out.
        print(
            f"comment_gate: ERROR — no in-scope file under: {', '.join(empty)}.\n"
            "  Those were not inspected, so this run is not a pass for them. Check the path, or\n"
            "  omit a game whose idiomatic layer does not exist yet.",
            file=sys.stderr,
        )
        return 2

    # One line per violation, grep-style, NO totals — see violations().
    found = False
    for rel, full in sorted(files):
        try:
            with open(full, encoding="utf-8") as fh:
                text = fh.read()
        except UnicodeDecodeError as e:
            # Aborting mid-walk would print a PARTIAL list under a non-zero exit, which reads as
            # "here is everything left". Name the file and keep going.
            print(f"{rel}: ERROR — not valid UTF-8 ({e.reason}); not inspected", file=sys.stderr)
            found = True
            continue
        for path, lineno, label, matched in violations(rel, text):
            print(f"{path}:{lineno}: {label} — {matched!r}")
            found = True
    return 1 if found else 0


GOOD = [
    "Advance the sprite one animation step, wrapping at the end of the cycle.",
    "Returns false when the walk is blocked, so the caller can skip its move.",
    "The three lead records are seeded here; the rest stay inactive until a spawn.",
    "Mask to the low nibble — the high bits carry the colour, not the frame.",
    'const s = "https://example.invalid/not-a-comment";',
    # Ordinary English that a careless pattern flags. Each is prose about THIS file and must pass.
    "// the low nibble is stashed for a later pass over the row",
    "// the palette bank is kept neutral until the board builds",
    "// the two lamp pins are unwired at reset",
    "// the core/shell boundary is at the third byte",
    "// the value comes from the read, not from a table",
]
BAD = [
    ("cites an address", "// the table at 0x39c3 holds waypoint pairs"),
    ("cites the ROM", "// faithful to the ROM at this point"),
    ("cites MAME", "// measured under MAME across 1500 frames"),
    ("cites the frozen oracle", "// memory-equivalent to the frozen oracle"),
    ("cites another file", "// see equivalence-3009.test.js for the gate"),
    ("cites another directory", "// its callee still lives in translated/"),
    ("carries a to-do", "// TODO: confirm this against a longer run"),
    ("carries a to-do", "// Name kept neutral: promote once corroborated."),
    ("cites the port's state", "// the only caller sits in the still-untranslated object chain"),
    # The wrap case — the whole reason blocks are joined before matching. Neither line matches
    # alone; the sentence does.
    ("cites the port's state", "/**\n * the only caller sits in the\n * still-untranslated chain\n */"),
    # The trailing-comment case — the hole names_consistency.py documents and this gate does not
    # inherit.
    ("cites an address", "const v = mem8[FRAME];  // 0x601a is the frame counter"),
    # A sibling routine by address-name is both an address and a module — the commonest form of
    # cross-file citation here, and the easiest form to leave out of a pattern set.
    ("cites another routine", "// reads through loc_31f6 before returning"),
    ("cites another routine", "// abort the rest of LOC_197A for this frame"),
    ("cites the ROM", "// straight out of the rom table"),
    ("cites the ROM", "// the ROMs disagree about this byte"),
    ("cites the port's state", "// UNWIRED: no captured dispatches"),
    ("cites the port's state", "// consumed by the still-translated caller"),
]


# The apostrophe fixture protects LINE ATTRIBUTION, not matching: an apostrophe must not open a
# string. Assert the lines, not just the verdict.
APOSTROPHE_SRC = """\
// The ring's four values step 0/1/4/2.
const RING = 1;

// A clean second comment.
const OTHER = 2;

// the table at 0x39c3 holds waypoint pairs
"""


SCOPE_CASES = [
    ("games/dkong/idiomatic/walkMarioLeft.js", True),
    ("games/dkong/idiomatic/loc_2a2f.js", True),
    ("games/dkong/idiomatic/sub/deep.js", True),
    ("games/dkong/idiomatic/names.js", False),
    ("games/dkong/idiomatic/sub/names.js", True),
    ("games/dkong/idiomatic/test/equivalence-3009.test.js", False),
    ("games/dkong/translated/loc_23de.js", False),
    ("games/dkong/idiomatic/notes.md", False),
    ("tools/comment_gate.py", False),
]

# A file naming ITSELF is not a cross-file reference.
SELF_NAME_CASES = [
    # The exemption is for NAMES only. A file called rom.js does not get to say "the ROM"; that is
    # a stem collision, not a file naming itself.
    ("games/dkong/idiomatic/rom.js", "// Faithful to the ROM at this point.", ["cites the ROM"]),
    ("games/dkong/idiomatic/mame.js", "// Measured under MAME across many frames.", ["cites MAME"]),
    ("games/dkong/idiomatic/oracle.js", "// Memory-equivalent to the frozen oracle.",
     ["cites the frozen oracle", "restores a repealed header block"]),
    ("games/dkong/idiomatic/loc_9f9f.js", "// loc_9f9f — one-line role.", []),
    ("games/dkong/idiomatic/loc_9f9f.js", "// see loc_9f9f.js for the tail", []),
    # …but a DIFFERENT routine is still a reference, in the same header.
    ("games/dkong/idiomatic/loc_9f9f.js", "// loc_9f9f hands off to loc_2a2f", ["cites another routine"]),
    ("games/dkong/idiomatic/walkMarioLeft.js", "// loc_9f9f is the tail", ["cites another routine"]),
]


# Density fixtures: (path, source, code, comment). Each language's line AND block form, plus the
# boilerplate that must count as neither, plus a case that is over the cap.
DENSITY_CASES = [
    ("a.js", "// one\nlet a = 1;\nlet b = 2;\n", 2, 1),
    ("a.js", "/* one\n * two\n */\nlet a = 1;\n", 1, 3),
    ("a.js", "let a = 1; // a trailing claim is prose too\n", 1, 1),
    ("a.js", "export const A = 1; /**\n * header\n */\n", 1, 3),
    ("a.js", "const b = `\n// not a comment\n`;\n", 3, 0),
    ("a.js", 'const s = "// nor this";\n', 1, 0),
    ("a.js", "const r = /\\/\\//;\nlet a = 1;\n", 2, 0),
    ("a.js", "const q = a / b; // real comment\n", 1, 1),
    ("a.js", "let r = a++ / 2; // still a real comment\n", 1, 1),
    ("a.js", "\n\nlet a = 1;\n", 1, 0),
    ("a.js", "// SPDX-License-Identifier: X\nlet a = 1;\n", 1, 0),
    ("a.js", "// SPDX-License-Identifier: X\n// SPDX-License-Identifier: X and prose\nlet a=1;\n", 1, 1),
    ("a.js", "#!/usr/bin/env node\n// one\nlet a = 1;\n", 1, 1),
    ("a.js", "/* unterminated at EOF\n * two\n", 0, 2),
    ("a.mjs", "// one\nlet a = 1;\nlet b = 2;\n", 2, 1),
    # regex-vs-division. Each of these was a live fail-OPEN before the scanner learned the rule:
    # the regex body's quote opened a phantom string, the comment vanished, the code count rose.
    ("a.js", "function f(s) {\n  return /['\"]/.test(s);\n}\n// prose\n", 3, 1),
    ("a.js", 'const n = "10" / 2; // halve it\n', 1, 1),
    ("a.js", "const t = typeof /x/; // a claim\n", 1, 1),
    ("a.js", "const n = arr[0] / 2; // halve it\n", 1, 1),
    ("a.js", "const n = (a+b) / c; // halve it\n", 1, 1),
    ("a.js", "if(x){} /[a]/.test(y); // a claim\n", 1, 1),
    # `of` is a legal identifier, so it is deliberately NOT a value-keyword.
    ("a.js", "let of = 4;\nlet x = of / 2; // halve it\n", 2, 1),
    # translated/ is counted like everywhere else -- a trailing mnemonic is a comment. These
    # two pin that: neither may quietly stop counting the `// ret`.
    ("games/g/translated/loc_0ce8.js",
     "// loc_0ce8  (ROM 0x0CE8)\nexport function loc_0ce8(m) {\n  m.ret(); // ret\n}\n", 3, 2),
    ("games/g/translated/loc_x.js",
     "// loc_x\n// an explanatory header\n// second line of it\n"
     "export function f(m) {\n  m.ret(); // ret\n}\n", 3, 4),
    ("games/g/idiomatic/f.js", "export function f(m) {\n  m.ret(); // ret\n}\n", 3, 1),
    # Lua. The long bracket is what a naive scanner gets wrong in BOTH directions: a [[...]]
    # string holding `--` is not a comment, and --[==[...]==] is not one line.
    ("a.lua", "-- a claim\nlocal a = 1\n", 1, 1),
    ("a.lua", "--[[ a claim\n  spanning lines ]]\nlocal a = 1\n", 1, 2),
    ("a.lua", "--[==[ a claim ]==]\nlocal a = 1\n", 1, 1),
    ("a.lua", "local s = [[\n-- not a comment\n]]\n", 3, 0),
    ("a.lua", 'local s = "-- not a comment"\nlocal a = 1\n', 2, 0),
    ("a.lua", "local a = 1 -- a claim\n", 1, 1),
    ("a.lua", "-- SPDX-License-Identifier: X\nlocal a = 1\n", 1, 0),
    ("a.lua", "#!/usr/bin/env lua\n-- a claim\nlocal a = 1\n", 1, 1),
    # Python. The docstring-as-prose branch is the whole reason this gate can measure its own
    # prose, and it was unfixtured -- stubbing it out left the selftest green while a file of
    # 30 docstring lines over 2 of code read as 34 code / 0 comment.
    ("a.py", '"""doc line one\ndoc line two\n"""\nx = 1\n', 1, 3),
    ("a.py", "# a claim\nx = 1\n", 1, 1),
    ("a.py", "x = f(\"\"\"a value, not a docstring\"\"\")\n", 1, 0),
    ("a.py", "# SPDX-License-Identifier: X\nx = 1\n", 1, 0),
    # Blank lines are neither, INCLUDING inside a block comment or a docstring. JS charged them
    # and Python did not, so the two languages disagreed and the JS side contradicted the rule
    # this file states.
    ("a.js", "/* a\n\n b */\nlet a = 1;\n", 1, 2),
    ("a.py", '"""a\n\nb"""\nx = 1\n', 1, 2),
]

# Files no scanner can judge. Each must RAISE, not return a number -- these are the cases that
# used to pass silently, and whether they did was decided by the parity of apostrophes in the
# prose being measured.
LEX_CASES = [
    ("a.js", "if (s) /[\']/.test(s); // don\'t trust this\n", "balanced apostrophe closes the phantom string"),
    ("a.js", 'if (s) /["]/.test(s); // a claim\n', "unbalanced quote runs off the line"),
    ("a.js", 'const s = "never closed;\nlet a = 1;\n', "plainly unterminated string"),
]

DENSITY_SCOPE_CASES = [
    ("boards/timeplt/video.js", True),
    ("core/cpu/z80.js", True),
    ("web/player.mjs", True),
    ("games/dkong/tools/x.mjs", True),
    # Python IS governed, via the stdlib tokenizer -- including this file.
    ("tools/comment_gate.py", True),
    ("games/dkong/tools/lua/x.lua", True),
    # NOT governed: shell has no lexer here and the hand-written one was measured wrong.
    ("games/dkong/tools/x.sh", False),
    ("docs/porting.md", False),
    ("games/dkong/translated/loc_0000.js", True),
    ("games/dkong/translated/_registry.generated.js", True),
    # The registry is exempt by POSITION, so a nested or differently-placed names.js is not.
    # The game is a wildcard -- `nosuchgame` has never existed and must still be exempted, or
    # the rule has quietly become a list of the games that happen to exist today.
    ("games/dkong/idiomatic/names.js", False),
    ("games/nosuchgame/idiomatic/names.js", False),
    ("games/dkong/idiomatic/sub/names.js", True),
    ("games/dkong/translated/names.js", True),
    ("web/node_modules/x/y.js", False),
    ("tools/translated/x.js", True),
    ("games/dkong/idiomatic/translated/x.js", True),
    ("boards/x/handwritten.generated.notjs.js", True),
    # A generated file is governed like any other: the block is followable by fixing the
    # generator's template. Measured, every generated file in the tree passes anyway.
    ("games/thepit/translated/_registry.generated.js", True),
]

def cmd_selftest(_args):
    failures = []
    for path, src, want_code, want_com in DENSITY_CASES:
        # A case that RAISES is a failure of this case, not of the run -- letting LexError
        # escape here reports the whole selftest as "cannot lex" and names no fixture.
        try:
            got = count_lines(path, src)
        except LexError as e:
            failures.append(f"DENSITY {path} {src!r}: raised LexError ({e})")
            continue
        if got != (want_code, want_com):
            failures.append(f"DENSITY {path} {src!r}: got {got}, want {(want_code, want_com)}")
    for path, want in DENSITY_SCOPE_CASES:
        if density_scope(path) != want:
            failures.append(f"DENSITY-SCOPE {path}: got {not want}, want {want}")
    # Teeth: a file over the cap must be reported, one at the cap must not.
    _over = "".join(f"// c{i}\n" for i in range(DENSITY_FLOOR + 2))  # 2+F comments clear the 1+F cap for D code
    ratio = density_violations(
        ["x.js"], lambda _p: _over + "".join(f"let v{i}={i};\n" for i in range(DENSITY_DIVISOR))
    )
    if not ratio:
        failures.append("DENSITY: comments over the code // DENSITY_DIVISOR + DENSITY_FLOOR cap must be reported")
    for path, src, why in LEX_CASES:
        try:
            got = count_lines(path, src)
            failures.append(f"LEX {path} ({why}): returned {got}, must raise LexError")
        except LexError:
            pass
        try:
            comment_spans(path, src)
            failures.append(f"LEX-SPANS {path} ({why}): returned, must raise LexError")
        except LexError:
            pass
    # Fixtures DERIVE from DENSITY_DIVISOR and DENSITY_FLOOR rather than hardcoding them: encoding a
    # constant in the literals turns the selftest RED whenever the constant is tuned and looks like a
    # defect in the tuning. A test that breaks when you adjust the thing it tests is testing the wrong
    # thing. At divisor D and floor F: D code lines give cap 1+F, so 1+F comments is AT and 2+F is OVER.
    _code = "".join(f"let v{i} = {i};\n" for i in range(DENSITY_DIVISOR))
    _com = lambda n: "".join(f"// c{i}\n" for i in range(n))
    over = density_violations(["x.js"], lambda _p: _com(DENSITY_FLOOR + 2) + _code)
    at = density_violations(["x.js"], lambda _p: _com(DENSITY_FLOOR + 1) + _code)
    if not over:
        failures.append("DENSITY: a file over the cap was not reported")
    if at:
        failures.append("DENSITY: a file at the cap was reported")
    for path, src, want in SELF_NAME_CASES:
        got = sorted({h[2] for h in violations(path, src)})
        if got != sorted(want):
            failures.append(f"SELF-NAME {path} {src!r}: got {got}, want {sorted(want)}")
    for src in GOOD:
        hits = violations("games/g/idiomatic/x.js", src)
        if hits:
            failures.append(f"FALSE POSITIVE on {src!r}: {hits}")

    spans = comment_spans("a.js", APOSTROPHE_SRC)
    if [ln for ln, _ in spans] != [1, 4, 7]:
        failures.append(f"APOSTROPHE line attribution: got {[ln for ln, _ in spans]}, want [1, 4, 7]")
    apo = violations("games/g/idiomatic/x.js", APOSTROPHE_SRC)
    if [(h[1], h[2]) for h in apo] != [(7, "cites an address")]:
        failures.append(f"APOSTROPHE violations: got {[(h[1], h[2]) for h in apo]}, want [(7, 'cites an address')]")

    # A real file opens with an SPDX `//` and a JSDoc directly under it, so the whole header is
    # ONE block. Report the line the match is on, or every header violation in the codebase
    # points at line 1.
    header = (
        "// SPDX-License-Identifier: GPL-3.0-only\n"
        "/**\n"
        " * doSomething — one line of role.\n"
        " *\n"
        " * Runs the thing, then hands back the result.\n"
        " * memory-equivalent to the frozen oracle.\n"
        " */\n"
    )
    hv = sorted((h[1], h[2]) for h in violations("games/g/idiomatic/x.js", header))
    want = [(6, "cites the frozen oracle"), (6, "restores a repealed header block")]
    if hv != want:
        failures.append(f"HEADER attribution: got {hv}, want {want}")
    for expect, src in BAD:
        hits = violations("games/g/idiomatic/x.js", src)
        if not hits:
            failures.append(f"MISSED {expect!r} in {src!r}")
        elif not any(label == expect for _p, _l, label, _m in hits):
            got = sorted({label for _p, _l, label, _m in hits})
            failures.append(f"WRONG LABEL for {src!r}: expected {expect!r}, got {got}")
    for path, want in SCOPE_CASES:
        if in_scope(path) != want:
            failures.append(f"SCOPE wrong for {path}: in_scope={in_scope(path)}, want={want}")
    # CLEANUP exemption: a flagged (idiomaticComplete) game's idiomatic/** steps aside from both rules.
    _complete_cache.update({"donecx": True, "wipcx": False})  # inject the manifest read (no git in the test)
    for path, complete in [
        ("games/donecx/idiomatic/foo.js", True),
        ("games/donecx/idiomatic/sub/bar.js", True),
        ("games/wipcx/idiomatic/foo.js", False),
    ]:
        governed = not complete
        if density_scope(path) != governed:
            failures.append(f"CLEANUP density_scope {path}: got {density_scope(path)}, want {governed}")
        if in_scope(path) != governed:
            failures.append(f"CLEANUP in_scope {path}: got {in_scope(path)}, want {governed}")
    _tp = "games/donecx/idiomatic/test/bar.test.js"
    if not density_scope(_tp):
        failures.append(f"CLEANUP test/ must stay density-governed: {_tp}")
    if in_scope(_tp):
        failures.append(f"CLEANUP test/ must not be reference-governed: {_tp}")
    if _COMPLETE_RE.search("  // idiomaticComplete: true"):
        failures.append("CLEANUP _COMPLETE_RE must not match a commented-out flag")
    for _k in ("donecx", "wipcx"):
        _complete_cache.pop(_k, None)
    # FLOOR: a cleaned file must carry >= code // DENSITY_DIVISOR + FLOOR_MIN comments. Fixtures DERIVE from
    # the constants (tuning them must not read as a defect). DENSITY_DIVISOR code lines -> floor 1 + FLOOR_MIN.
    _fcode = "".join(f"let v{i} = {i};\n" for i in range(DENSITY_DIVISOR))
    _fcom = lambda n: "".join(f"// c{i}\n" for i in range(n))
    _floor = 1 + FLOOR_MIN
    if not floor_violations(["x.js"], lambda _p: _fcom(_floor - 1) + _fcode):
        failures.append("FLOOR: a file below the floor must be reported")
    if floor_violations(["x.js"], lambda _p: _fcom(_floor) + _fcode):
        failures.append("FLOOR: a file at the floor must not be reported")
    if floor_violations(["x.js"], lambda _p: _fcom(_floor - 1) + _fcode, debt={"x.js"}):
        failures.append("FLOOR: a debt-allowlisted file must be exempt")
    if failures:
        print("comment_gate selftest: FAIL", file=sys.stderr)
        for f in failures:
            print(f"  {f}", file=sys.stderr)
        return 1
    print(
        f"comment_gate selftest: PASS ({len(GOOD)} good, {len(BAD)} bad, "
        f"{len(SCOPE_CASES)} scope cases, 3 line-attribution assertions)"
    )
    return 0


def cmd_density(args):
    """Density rule over the working tree."""
    roots = args.paths or list(_ROOTS)
    paths, empty = [], []
    for r in roots:
        found = []
        if os.path.isfile(r):
            found = [r] if density_scope(r) else []
        else:
            for dirpath, dirs, files in os.walk(r):
                dirs[:] = [d for d in dirs if d != "node_modules"]
                found += [
                    q for q in (os.path.join(dirpath, f) for f in files) if density_scope(q)
                ]
        if found:
            paths += found
        else:
            empty.append(r)
    # A root matching NOTHING is an error, not a pass -- checked PER ROOT so one good root
    # cannot cover for a typo'd one.
    if empty:
        print(
            f"comment_gate: ERROR — no source file under: {', '.join(empty)}", file=sys.stderr
        )
        return 2
    paths = sorted(paths)
    hits = density_violations(paths, lambda p: open(p, encoding="utf-8").read())
    report_density(hits, sys.stdout)
    return 1 if hits else 0


def cmd_floor(args):
    """Comment FLOOR for a cleaned game: each idiomatic file must carry enough comment. Reads the INDEX
    (file list, contents, idiomaticComplete and comment-debt.txt alike)."""
    game = args.game
    if not _game_idiomatic_complete(game):
        print(f"comment_gate floor [{game}]: N/A (not idiomaticComplete — the floor is a cleanup-phase bar)")
        return 0
    try:
        hits = floor_violations(floor_files(game), lambda p: blob(":0", p), comment_debt(game))
    except LexError as e:
        print(f"comment_gate floor: BLOCKED — cannot lex: {e}", file=sys.stderr)
        return 1
    if hits:
        print(
            f"comment_gate floor [{game}]: BLOCK — idiomatic files below the comment floor "
            f"(code // {DENSITY_DIVISOR} + {FLOOR_MIN}); the cleanup COMMENT obligation is incomplete:",
            file=sys.stderr,
        )
        for path, code, comment, floor in hits:
            print(f"  {path}: {comment} comment lines, {code} code — floor is {floor}", file=sys.stderr)
        print(
            "  Add verbose explanatory comments, or allowlist a genuinely-trivial file (with a reason) "
            f"in games/{game}/comment-debt.txt.",
            file=sys.stderr,
        )
        return 1
    print(f"comment_gate floor [{game}]: OK (every idiomatic file carries >= code // {DENSITY_DIVISOR} + {FLOOR_MIN} comments)")
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("check").set_defaults(fn=cmd_check)
    s = sub.add_parser("scan")
    s.add_argument("paths", nargs="*")
    s.set_defaults(fn=cmd_scan)
    d = sub.add_parser("density")
    d.add_argument("paths", nargs="*")
    d.set_defaults(fn=cmd_density)
    fl = sub.add_parser("floor")
    fl.add_argument("--game", required=True)
    fl.set_defaults(fn=cmd_floor)
    sub.add_parser("selftest").set_defaults(fn=cmd_selftest)
    args = ap.parse_args()
    # EVERY subcommand fails closed, not just `check`. `scan` is what docs/understanding.md
    # prescribes as a game's migration licence, and a Python traceback there is neither a green
    # scan nor a red one — it is an unanswered question that reads like a broken tool.
    try:
        return args.fn(args)
    except GitError as e:
        print(f"comment_gate: BLOCKED — git failed: {e}", file=sys.stderr)
        return 1
    except LexError as e:
        print(f"comment_gate: BLOCKED — cannot lex: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
