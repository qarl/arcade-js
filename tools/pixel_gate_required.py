#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""Refuse a commit that changes what a game renders unless that game's pixel gate PASSED.

WHY. The per-routine and assembled gates compare RAM and a declared live-out; neither looks at a
pixel, so a layer can be green everywhere and wrong on the glass. That is not hypothetical -- Time
Pilot ran a full day of batches with the pixel gate wired into nothing, and a person noticed twice,
not a gate. Documentation was the first fix and it is the wrong shape: a doc fires when someone
chooses to look, which is exactly the moment a person who forgot is not having. Forgetting is a
WRITE-TIME failure, so the remedy is a write-time interlock.

★★ WHICH LAYER THE SUITES RENDER, first because getting it backwards misleads most. `render.js`
follows its own `--idiomatic` FLAG and the game's `pixel_suite.py` decides whether to pass it --
`manifest.runtime` alone does NOT control it. All three games declare "idiomatic", yet only
timeplt's suite passes the flag and thepit's renderer has no override path, so thepit still renders
the ORACLE. `suite_renders_idiomatic()` requires all three terms; keying on the manifest alone once
silenced the caveat for every game. Where the oracle is rendered the idiomatic layer is dormant and
a regression in it is uncovered -- MEASURED: poisoning every timeplt idiomatic module with a
throwing import left the frames byte-identical, with a positive control confirming the poison fires
when a module genuinely loads.
⚠ Two limits survive the wiring, stated where they are measured in `pixel_suite.py`: the frames
before the first vblank yield are not compared, and the upper rows carry a residual worth about
half the tolerance. A PASS is real coverage of the shipped layer, not parity.

★ THE FAILURE MODE THIS MUST NOT REPRODUCE. `pixel_suite.py` exits 0 when it CANNOT run -- no MAME,
no romset -- which is right for the suite and fatal for a gate reading its exit code. So this gate
never trusts the code alone: it requires the literal PASS line and treats SKIP, INCOMPLETE, FAIL, a
crash or a timeout as refusal. An absence of failure is not a pass.

★ WHAT THIS DELIBERATELY DOES NOT OWN, each with its own reason, because one reason covering a list
is how a wrong exclusion hides inside a right one. `core/` -- shared by every game, so firing would
demand suites a machine holding one romset cannot run. `tools/pixel_gate.py` -- holds
ROUGH_TOLERANCE, which changes every game's verdict; the sharpest hole left here, left open
knowingly. `boards/<board>/` and `games/<g>/manifest.js` are NOT excluded: each is single-game and
costs one suite run, and the board is resolved through each manifest's `board:` field.
"""
import argparse
import concurrent.futures
import contextlib
import glob
import hashlib
import io
import json
import os
import re
import subprocess
import sys
import tempfile
import time

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RENDER_AFFECTING = re.compile(
    r"^games/([^/]+)/(?:idiomatic/|translated/|routines\.js$|machine\.js$|manifest\.js$"
    r"|tools/render\.js$|tools/render-lib\.js$|tools/pixel_suite\.py$"
    r"|tools/distant_suite\.py$|tapes/[^/]+\.poke\.json$)"
)

BOARD_PATH = re.compile(r"^boards/([^/]+)/")

IDIOMATIC_ONLY = re.compile(r"^games/([^/]+)/idiomatic/")
TRANSLATED_ONLY = re.compile(r"^games/([^/]+)/translated/")

MANIFEST_RUNTIME = re.compile(r'^\s*runtime:\s*"([^"]+)"', re.M)
MANIFEST_BOARD = re.compile(r'^\s*board:\s*"([^"]+)"', re.M)

PIXEL_SUITE_PASS = re.compile(r"^pixel_suite: PASS", re.M)


def DISTANT_PASS(name):
    """The verdict line of ONE distant tape, anchored at both ends and keyed to the tape's name.
    distant_suite.py's header reads `distant_suite: tape <name> -- ...`, so no tape name can make
    the header satisfy this; and another tape's PASS cannot stand in for this one."""
    return re.compile(r"^distant_suite: PASS -- " + re.escape(name) + r"$", re.M)


def distant_entries(game, repo=None):
    """One SUITES entry per distant-state tape of `game`: every games/<g>/tapes/*.poke.json, GLOBBED
    at import, when the game has tools/distant_suite.py -- so a new tape is gated the moment it
    lands, with nothing to remember. Every tape passes the same --work BASE; the suite partitions
    it per tape name and per layer (distant_suite.work_dir), so no two runs share a dir. The pattern keys on the
    schedule's own `name` (what the suite prints); an unreadable schedule keys on its file stem and
    the suite's own load error refuses it."""
    repo = repo or REPO
    suite = f"games/{game}/tools/distant_suite.py"
    if not os.path.isfile(os.path.join(repo, suite)):
        return []
    out = []
    for path in sorted(glob.glob(os.path.join(repo, "games", game, "tapes", "*.poke.json"))):
        rel = os.path.relpath(path, repo)
        stem = os.path.basename(path)[: -len(".poke.json")]
        try:
            with open(path, encoding="utf-8") as fh:
                name = json.load(fh).get("name", stem)
        except (OSError, ValueError):
            name = stem
        argv = ["python3", suite, "--schedule", rel,
                "--work", f"games/{game}/out/distantwork"]
        out.append((argv, DISTANT_PASS(name)))
    return out


SUITES = {
    # + one entry per distant-state tape (distant_entries, globbed below). Both layers: every tape
    # PASSes on --layer oracle and --layer idiomatic (measured when the wiring landed).
    "timeplt": [(["python3", "games/timeplt/tools/pixel_suite.py"], PIXEL_SUITE_PASS)],
    "thepit": [(["python3", "games/thepit/tools/pixel_suite.py"], PIXEL_SUITE_PASS)],
    "frogger": [(["python3", "games/frogger/tools/pixel_suite.py"], PIXEL_SUITE_PASS)],
    "pooyan": [(["python3", "games/pooyan/tools/pixel_suite.py"], PIXEL_SUITE_PASS)],
    "invaders": [(["python3", "games/invaders/tools/pixel_suite.py"], PIXEL_SUITE_PASS)],
    "galaxian": [(["python3", "games/galaxian/tools/pixel_suite.py"], PIXEL_SUITE_PASS)],
    "centiped": [(["python3", "games/centiped/tools/pixel_suite.py"], PIXEL_SUITE_PASS)],
    "tempest": [(["python3", "games/tempest/tools/pixel_suite.py"], PIXEL_SUITE_PASS)],
    "dkong": [(["python3", "games/dkong/tools/pixel_suite.py"], PIXEL_SUITE_PASS)],
}

for _game in SUITES:
    SUITES[_game] = SUITES[_game] + distant_entries(_game)

#: game -> a human hint printed when the game is absent from SUITES. Empty: every game now
#: declares a pixel_suite.py. (move_suite.py/prize_suite.py remain dkong's separate unit gates.)
MANUAL = {}

#: game -> the written reason this game's pixel gate is not required.
#: ★ AN ENTRY EXEMPTS THE GAME UNTIL REMOVED, waiving every later commit silently. Kept NEAR-EMPTY
#: by design: legitimate ONLY when the gate cannot run and the reason is one a reviewer can check --
#: the canonical case is a NEW game mid-translation that cannot render a frame yet (see docs/runbook.md).
EXEMPT = {
    # (empty) -- Tempest's waiver came off once its idiomatic layer rendered frames vs MAME; its real suite is
    # games/tempest/tools/pixel_suite.py (drift-tolerant reconverge + a null-mutant), declared in SUITES above.
}


def staged_paths():
    """Every staged path, INCLUDING deletions and both ends of a rename.

    `--name-only` reports only a rename's destination, so a module moved OUT of a watched
    directory would look like an unrelated add. `--name-status -z` gives the source too, and
    deletions are included rather than filtered out: removing a module changes what renders.
    """
    out = subprocess.run(["git", "diff", "--cached", "--name-status", "-z"],
                         cwd=REPO, capture_output=True, text=True, check=True).stdout
    fields = [f for f in out.split("\0") if f]
    paths, i = [], 0
    while i < len(fields):
        status = fields[i]
        n = 2 if status[:1] in ("R", "C") else 1
        paths.extend(fields[i + 1:i + 1 + n])
        i += 1 + n
    return paths


def board_to_games():
    """board id -> [game ids], read from each manifest's `board:` field.

    Read rather than assumed: the board is the MAME driver name and need not match the game
    directory. A board that no manifest claims maps to nothing, which is correct -- an unclaimed
    board cannot change any game's pixels.
    """
    out = {}
    games_dir = os.path.join(REPO, "games")
    if not os.path.isdir(games_dir):
        return out
    for game in sorted(os.listdir(games_dir)):
        mf = os.path.join(games_dir, game, "manifest.js")
        if not os.path.isfile(mf):
            continue
        with open(mf, encoding="utf-8") as fh:
            m = MANIFEST_BOARD.search(fh.read())
        if m:
            out.setdefault(m.group(1), []).append(game)
    return out


def affected_games(paths):
    """Games whose render-affecting files are in the staged set, in stable order."""
    seen, boards = [], None
    for p in paths:
        m = RENDER_AFFECTING.match(p)
        if m:
            if m.group(1) not in seen:
                seen.append(m.group(1))
            continue
        b = BOARD_PATH.match(p)
        if b:
            if boards is None:
                boards = board_to_games()
            for game in boards.get(b.group(1), []):
                if game not in seen:
                    seen.append(game)
    return seen


def layers_for_game(game, paths):
    """Which layer(s) the pixel gate must render for this game, from WHICH FILES changed -- so the
    gate tests the layer you touched, not whatever `manifest.runtime` names. `idiomatic/` -> render
    "idiomatic"; `translated/` -> render "oracle"; every other RENDER_AFFECTING path (machine.js,
    manifest.js, render.js, routines.js, pixel_suite.py) and any board path is SHARED by both
    layers, so it asks for both. Order idiomatic-before-oracle, stable. Non-empty whenever `game`
    is in affected_games(paths)."""
    want_idio = want_oracle = False
    boards = None
    for p in paths:
        m = RENDER_AFFECTING.match(p)
        if m and m.group(1) == game:
            if IDIOMATIC_ONLY.match(p):
                want_idio = True
            elif TRANSLATED_ONLY.match(p):
                want_oracle = True
            else:
                want_idio = want_oracle = True   # shared infra renders under both layers
            continue
        b = BOARD_PATH.match(p)
        if b:
            if boards is None:
                boards = board_to_games()
            if game in boards.get(b.group(1), []):
                want_idio = want_oracle = True   # the board is shared by both layers
    layers = []
    if want_idio:
        layers.append("idiomatic")
    if want_oracle:
        layers.append("oracle")
    return layers


def game_runtime(game):
    """A game's declared `runtime`, or None if it cannot be read."""
    mf = os.path.join(REPO, "games", game, "manifest.js")
    try:
        with open(mf, encoding="utf-8") as fh:
            m = MANIFEST_RUNTIME.search(fh.read())
    except OSError:
        return None
    return m.group(1) if m else None


# A relative ES import (static or dynamic) of a .js/.mjs module.
LOCAL_IMPORT = re.compile(r"""(?:\bfrom|\bimport)\s*\(?\s*["'](\.{1,2}/[^"']+\.m?js)["']""")
# A USE of the override resolver -- a call, not its definition in machine.js.
OVERRIDE_USE = re.compile(r"(?<!function )\bresolveAllIdiomatic\s*\(")


def renderer_has_override_path(game):
    """Does the renderer -- `render.js` plus the modules of its own `tools/` dir it imports,
    transitively -- CALL `resolveAllIdiomatic`?

    ⚠ render.js alone was the old test, and it went FALSE the day timeplt's machine setup moved
    into `tools/render-lib.js` (shared with a standing test): the caveat then told every timeplt
    PASS it "renders the ORACLE" while the suite ran the idiomatic layer. Only modules inside the
    game's `tools/` dir are followed: `machine.js` DEFINES the resolver, so following imports out of
    `tools/` would find it for a game whose renderer never calls it.
    """
    tools_dir = os.path.realpath(os.path.join(REPO, "games", game, "tools"))
    entry = os.path.join(tools_dir, "render.js")
    todo, seen = [entry], set()
    while todo:
        f = os.path.realpath(todo.pop())
        if f in seen:
            continue
        seen.add(f)
        try:
            with open(f, encoding="utf-8") as fh:
                src = fh.read()
        except OSError:
            if f == entry:
                return False
            continue
        if OVERRIDE_USE.search(src):
            return True
        for rel in LOCAL_IMPORT.findall(src):
            dep = os.path.realpath(os.path.join(os.path.dirname(f), rel))
            if os.path.dirname(dep) == tools_dir:
                todo.append(dep)
    return False


def suite_renders_idiomatic(game):
    """Does THIS game's suite actually render the idiomatic layer?

    THREE INDEPENDENT TERMS, ALL REQUIRED: the suite must pass `--idiomatic`, the renderer must have
    an override path, and the manifest must say "idiomatic" (the suite reads `runtime()` and appends
    the flag only then). ⚠ Keying on the manifest ALONE silenced the caveat for every game; dropping
    it silenced a translated game whose suite merely COULD render idiomatic. Each term is
    mutation-tested in `_selftest_predicate_terms`, which the corpus cannot do.
    """
    suite = os.path.join(REPO, "games", game, "tools", "pixel_suite.py")
    try:
        with open(suite, encoding="utf-8") as fh:
            passes_flag = "--idiomatic" in fh.read()
    except OSError:
        return False
    has_path = renderer_has_override_path(game)
    # ★ A CONJUNCTION, all three terms INDEPENDENT: a suite can pass the flag whether or not its
    # renderer honours it, and appends it only when `runtime()` reads "idiomatic". Dropping the
    # manifest term would silence the caveat for a translated game rendering the ORACLE.
    return passes_flag and has_path and game_runtime(game) == "idiomatic"


def run_suite(argv, pattern, timeout=900):
    """(ok, output). ok ONLY when the process exits 0 AND prints its literal pass line.

    Both halves are load-bearing, but not for the reason it is tempting to give: the anchored
    pattern already rejects the suite's indented per-window lines, so the pattern alone would not
    be fooled by "one window passed." The exit code earns its place against a suite that prints
    PASS and then dies -- a crash or a non-zero exit after the verdict line.
    """
    try:
        r = subprocess.run(argv, cwd=REPO, capture_output=True, text=True, timeout=timeout)
    except FileNotFoundError as e:
        return False, f"could not execute {' '.join(argv)}: {e}"
    except subprocess.TimeoutExpired:
        return False, f"{' '.join(argv)} exceeded {timeout}s and was killed"
    out = (r.stdout or "") + (r.stderr or "")
    if r.returncode != 0:
        return False, out + f"\n[exit {r.returncode}]"
    return bool(pattern.search(out)), out


def dormancy_caveat(game, paths):
    """The warning to hang on a PASS that cannot mean what it looks like, or "".

    A PASS driven ONLY by `idiomatic/` paths, for a game whose SUITE RENDERS THE ORACLE, never
    executed a line of what was staged. Printing it bare invites the reading it prevents, so the
    caveat travels with the verdict rather than living in a document someone must consult.
    ⚠ "Renders the oracle" is NOT "runtime is not idiomatic" -- see `suite_renders_idiomatic()`.
    """
    matched, boards = [], None
    for p in paths:
        m = RENDER_AFFECTING.match(p)
        if m:
            if m.group(1) == game:
                matched.append(p)
            continue
        b = BOARD_PATH.match(p)
        if b:
            if boards is None:
                boards = board_to_games()
            if game in boards.get(b.group(1), []):
                matched.append(p)
    if not matched or not all(IDIOMATIC_ONLY.match(p) for p in matched):
        return ""
    if suite_renders_idiomatic(game):
        return ""
    return ("\n  ★ but the staged paths are idiomatic/ ONLY, and this game's suite renders the "
            "ORACLE -- it executed none of them.\n"
            "    This PASS does NOT cover the staged change. See docs/pixel-gate.md.")


# ── romset-absent waiver + the re-run-owed ledger ─────────────────────────────────────────────
# A machine without a game's romset cannot run that game's suite, and a commit touching every suite
# (a shared-tool change) is then refused for a reason no code change can fix. The waiver lets that ONE
# case through, loudly and accountably: single-use (bound to the staged diff like batch_size_gate's),
# for the NAMED game only, honoured only when that game's suite printed a romset-missing SKIP and
# nothing else went wrong, and only with the game's line staged in the ledger -- which every run of
# this gate then prints until a PASS for that game lets someone delete it. See docs/runbook.md §2.
WAIVER_DIR = ".pixelgate-waivers"
LEDGER = "tools/pixel-rerun-owed.txt"
ROMSET_SKIP = re.compile(r"^(?:pixel|distant)_suite: SKIP -- (?:romset \S+ not found under "
                         r"|no verified \S+ romset at |MAME cannot verify \S+ under --rompath )")
NOT_A_SKIP = re.compile(r"^(?:Traceback|\S*(?:Error|Exception)\b)|^(?:pixel|distant)_suite: (?:PASS|FAIL|INCOMPLETE)"
                        r"|exceeded \d+s and was killed|^could not execute", re.M)


def romset_skip(out):
    """True only for a run whose LAST line is a romset-missing SKIP, exiting 0 or 1, with no verdict,
    traceback, timeout or launch failure anywhere in it."""
    lines = [ln.strip() for ln in out.strip().splitlines() if ln.strip()]
    if lines and re.fullmatch(r"\[exit -?\d+\]", lines[-1]):
        if lines[-1] != "[exit 1]":
            return False
        lines = lines[:-1]
    return bool(lines) and bool(ROMSET_SKIP.match(lines[-1])) and not NOT_A_SKIP.search(out)


def _git(*args, check=True):
    r = subprocess.run(["git", *args], cwd=REPO, capture_output=True, text=True)
    if check and r.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} failed: {r.stderr.strip()}")
    return r


def staged_diff_id():
    """sha256 of the staged diff, flags pinned as batch_size_gate's: edit one byte and it changes."""
    diff = _git("diff", "--cached", "--no-color", "--no-ext-diff", "-U0", "--full-index").stdout
    return hashlib.sha256(diff.encode()).hexdigest()


def ledger_games(rev):
    """{game: line} in the ledger at `rev` ('' = the index, 'HEAD' = the last commit, None = the
    working tree). A missing file is an empty ledger; '#' lines are commentary."""
    if rev is None:
        try:
            with open(os.path.join(REPO, LEDGER), encoding="utf-8") as fh:
                text = fh.read()
        except FileNotFoundError:
            text = ""
    else:
        r = _git("show", f"{rev}:{LEDGER}", check=False)
        text = r.stdout if r.returncode == 0 else ""
    out = {}
    for ln in text.splitlines():
        if ln.strip() and not ln.lstrip().startswith("#"):
            out.setdefault(ln.split("\t")[0].strip(), ln.strip())
    return out


def loud(lines):
    bar = "!" * 100
    return "\n".join([bar, *(f"!!  {ln}" for ln in lines), bar])


def ledger_banner():
    """The owed re-runs, loud, or '' when the ledger is empty. Printed on every check and run."""
    owed = ledger_games(None)
    if not owed:
        return ""
    return loud(["pixel_gate_required: PIXEL RE-RUN OWED -- these games were committed WITHOUT their pixel gate:",
                 *(f"  {ln}" for ln in owed.values()),
                 "Run `python3 tools/pixel_gate_required.py run <game>` once the romset is back; on PASS delete",
                 f"the game's line from {LEDGER} and stage it (that commit re-runs the game's suite)."])


def waiver_games():
    """{game: reason} from the waiver bound to the CURRENT staged diff; {} when none matches."""
    path = os.path.join(REPO, WAIVER_DIR, staged_diff_id() + ".json")
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, ValueError):
        return {}
    games = data.get("games")
    return games if isinstance(games, dict) and data.get("diff_id") == os.path.basename(path)[:-5] else {}


def cmd_skip_romset(game, reason):
    """Record a single-use romset-absent waiver for `game`: append (and stage) its ledger line, then
    bind the waiver to the resulting staged diff. Any later staging change makes it stale."""
    if game not in SUITES:
        print(f"pixel_gate_required: {game} has no declared suite; nothing to waive.", file=sys.stderr)
        return 2
    if not reason.strip():
        print("pixel_gate_required: skip-romset needs a --reason.", file=sys.stderr)
        return 2
    carried = waiver_games()
    old = os.path.join(REPO, WAIVER_DIR, staged_diff_id() + ".json")
    if game not in ledger_games(""):
        path = os.path.join(REPO, LEDGER)
        prior = ""
        if os.path.exists(path):
            with open(path, encoding="utf-8") as fh:
                prior = fh.read()
        clean = " ".join(reason.split())
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(prior + ("" if not prior or prior.endswith("\n") else "\n")
                     + f"{game}\t{time.strftime('%Y-%m-%d')}\t{clean}\n")
        _git("add", "--", LEDGER)
    did = staged_diff_id()
    os.makedirs(os.path.join(REPO, WAIVER_DIR), exist_ok=True)
    with open(os.path.join(REPO, WAIVER_DIR, did + ".json"), "w", encoding="utf-8") as fh:
        json.dump({"diff_id": did, "games": dict(carried, **{game: reason}),
                   "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}, fh, indent=2)
    if os.path.exists(old) and os.path.basename(old) != did + ".json":
        os.remove(old)
    print(f"pixel_gate_required: romset waiver {did[:12]} for {game} -- {reason}\n"
          f"  {LEDGER} carries {game} (staged). Honoured ONLY if {game}'s suite reports a missing romset,\n"
          "  and only for THIS staged diff: restage anything and it no longer matches.")
    return 0


def cmd_check(_args=None):
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(line_buffering=True)  # keep verdict lines in order when piped
    banner = ledger_banner()
    if banner:
        print(banner, file=sys.stderr)
    paths = staged_paths()
    games = affected_games(paths)
    # A ledger line may leave only with a PASS: removing one runs that game's suite, never waivable.
    cleared = [g for g in ledger_games("HEAD") if g not in ledger_games("")]
    for g in cleared:
        if g not in games:
            games.append(g)
            paths = paths + [f"games/{g}/manifest.js"]
    if not games:
        return 0

    waivers = waiver_games()
    staged_ledger = ledger_games("")
    failed, waived = [], []
    for game in games:
        if game in EXEMPT:
            print(f"pixel_gate_required: {game} EXEMPT -- {EXEMPT[game]}")
            continue
        if game not in SUITES:
            manual = MANUAL.get(game)
            print(f"pixel_gate_required: {game} CANNOT BE EVALUATED", file=sys.stderr)
            print(f"  {manual}" if manual else
                  f"  No pixel suite is declared for {game} in tools/pixel_gate_required.py.",
                  file=sys.stderr)
            failed.append(game)
            continue
        layers = layers_for_game(game, paths)
        jobs = [(argv + ["--layer", layer], pattern, layer)
                for argv, pattern in SUITES[game] for layer in layers]
        for full, _p, layer in jobs:
            print(f"pixel_gate_required: {game} [{layer}] -- running {' '.join(full)}")
        # A distant tape's run owns its work dir (per tape, per layer), so those go concurrently.
        # Every OTHER suite runs serially, in one worker: pixel_suite.py's two layers share one
        # work dir, and running them at once corrupts both (measured: a spurious oracle FAIL).
        results = [None] * len(jobs)
        serial = [i for i, j in enumerate(jobs) if "--schedule" not in j[0]]
        parallel = [i for i, j in enumerate(jobs) if "--schedule" in j[0]]

        def run_serial():
            for i in serial:
                results[i] = run_suite(jobs[i][0], jobs[i][1])

        def run_one(i):
            results[i] = run_suite(jobs[i][0], jobs[i][1])

        workers = max(1, min(len(parallel) + 1, os.cpu_count() or 1, 8))
        with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
            futs = [pool.submit(run_serial)] + [pool.submit(run_one, i) for i in parallel]
            for f in futs:
                f.result()
        bad = [out for ok, out in results if not ok]
        waivable = (bool(bad) and all(romset_skip(o) for o in bad) and game in waivers
                    and game in staged_ledger and game not in cleared)
        for (full, _p, layer), (ok, out) in zip(jobs, results):
            tail = "\n".join(out.strip().splitlines()[-12:])
            what = f"{game} [{layer}] {' '.join(full[1:4])}"
            if ok:
                print(f"  {what}: PASS{dormancy_caveat(game, paths)}\n{tail}")
            elif waivable:
                print(f"  {what}: SKIPPED (romset missing) -- NOT validated\n{tail}", file=sys.stderr)
            else:
                print(f"  {what}: REFUSED -- the suite did not print its PASS "
                      f"line.\n{tail}", file=sys.stderr)
                if game not in failed:
                    failed.append(game)
        if waivable:
            waived.append(game)
            print(loud([f"pixel_gate_required: {game} SKIPPED -- romset missing -- NOT validated",
                        f"waiver {staged_diff_id()[:12]}: {waivers[game]}",
                        f"RE-RUN OWED -- recorded in {LEDGER}; this commit carries NO pixel evidence for {game}."]),
                  file=sys.stderr)
        elif not bad and game in staged_ledger:
            print(loud([f"pixel_gate_required: {game} PASSED and is still in {LEDGER}.",
                        "Delete its line and stage the file: the re-run it owed is done."]), file=sys.stderr)

    if failed:
        print(
            "\npixel_gate_required: REFUSING THE COMMIT.\n"
            f"  Staged render-affecting changes for: {', '.join(failed)}\n"
            "  The per-routine and assembled-swap gates never look at a pixel, so a green suite\n"
            "  says nothing about the glass. SKIP (no MAME, no romset) and INCOMPLETE are NOT\n"
            "  passes -- they mean nothing was checked.\n"
            "  Either make the suite runnable and green, or add a checkable reason to EXEMPT in\n"
            "  tools/pixel_gate_required.py so the waiver lands in the diff and gets reviewed.\n"
            "  A MISSING ROMSET alone: `python3 tools/pixel_gate_required.py skip-romset --game <g> "
            "--reason \"...\"`\n"
            "  (single-use, this staged diff only; records the owed re-run in " + LEDGER + ").",
            file=sys.stderr)
        return 1
    if waived:
        print(f"\npixel_gate_required: ALLOWED WITH A ROMSET WAIVER -- {', '.join(waived)} NOT VALIDATED "
              f"(re-run owed, {LEDGER}).", file=sys.stderr)
    return 0


def _fixture(tmpdir, name, text, rc):
    """A stand-in suite that prints `text` and exits `rc`, so the selftest drives the REAL
    subprocess path in run_suite instead of re-implementing its predicate."""
    path = os.path.join(tmpdir, name)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("import sys\nsys.stdout.write(%r)\nsys.exit(%d)\n" % (text, rc))
    return ["python3", path]


def _selftest_staged_paths():
    """Drive the REAL `staged_paths` against a REAL git index. Returns the failure count.

    The cmd_check arms monkeypatch `staged_paths`, so they never execute the git invocation and
    cannot notice it losing deletions or a rename's source path -- asserting against itself, one
    level down from the predicate. Only a real index exercises the flags: narrowing them back to
    `--name-only --diff-filter=ACMR` is invisible to every other arm here.
    """
    global REPO
    bad, saved = 0, REPO
    with tempfile.TemporaryDirectory() as repo:
        def git(*a):
            subprocess.run(["git", *a], cwd=repo, check=True,
                           capture_output=True, text=True)
        try:
            git("init", "-q")
            git("config", "user.email", "selftest@example.invalid")
            git("config", "user.name", "selftest")
            os.makedirs(os.path.join(repo, "games", "tp", "idiomatic"))
            os.makedirs(os.path.join(repo, "archive"))
            for n in ("gone.js", "moved.js"):
                with open(os.path.join(repo, "games", "tp", "idiomatic", n), "w") as fh:
                    fh.write("// %s\n" % ("x" * 200))
            git("add", "-A")
            git("commit", "-qm", "base")
            git("rm", "-q", "games/tp/idiomatic/gone.js")
            git("mv", "games/tp/idiomatic/moved.js", "archive/moved.js")

            REPO = repo
            paths = staged_paths()
            for label, want in [("deleted module", "games/tp/idiomatic/gone.js"),
                                ("rename SOURCE", "games/tp/idiomatic/moved.js")]:
                ok = want in paths
                bad += not ok
                print(f"  [{'ok ' if ok else 'BAD'}] real git: {label} in staged_paths -> {ok}")
            fires = affected_games(paths) == ["tp"]
            bad += not fires
            print(f"  [{'ok ' if fires else 'BAD'}] real git: a module LEAVING the layer fires "
                  f"the gate -> {fires}")
        finally:
            REPO = saved
    return bad


def _selftest_distant_glob():
    """distant_entries must pick up EVERY tape on disk (a new tape is gated with no edit here), key
    each pattern to the schedule's own name, and add nothing for a game without a distant_suite.py.
    Work-dir uniqueness is the SUITE's partition, not a per-tape --work: every entry passes the same
    base, every tape's name is distinct, and distant_suite.work_dir puts name AND layer in the path."""
    bad = 0
    with tempfile.TemporaryDirectory() as root:
        tapes = os.path.join(root, "games", "g", "tapes")
        os.makedirs(tapes)
        os.makedirs(os.path.join(root, "games", "g", "tools"))
        for stem in ("alpha", "beta"):
            with open(os.path.join(tapes, f"{stem}.poke.json"), "w", encoding="utf-8") as fh:
                json.dump({"name": stem}, fh)
        with open(os.path.join(tapes, "notes.json"), "w", encoding="utf-8") as fh:
            fh.write("{}")
        none_yet = distant_entries("g", root) == []
        bad += not none_yet
        print(f"  [{'ok ' if none_yet else 'BAD'}] distant glob: no distant_suite.py -> no entries")
        open(os.path.join(root, "games", "g", "tools", "distant_suite.py"), "w").close()
        ents = distant_entries("g", root)
        scheds = [a[a.index("--schedule") + 1] for a, _ in ents]
        works = [a[a.index("--work") + 1] for a, _ in ents]
        ok = (scheds == ["games/g/tapes/alpha.poke.json", "games/g/tapes/beta.poke.json"]
              and works == ["games/g/out/distantwork"] * 2
              and ents[1][1].search("distant_suite: PASS -- beta\n")
              and not ents[1][1].search("distant_suite: PASS -- alpha\n"))
        bad += not ok
        print(f"  [{'ok ' if ok else 'BAD'}] distant glob: every *.poke.json, shared --work base, own name -> {scheds}")
    real = [a[a.index("--schedule") + 1] for a, _ in SUITES.get("timeplt", []) if "--schedule" in a]
    disk = sorted(os.path.relpath(p, REPO) for p in
                  glob.glob(os.path.join(REPO, "games", "timeplt", "tapes", "*.poke.json")))
    ok = real == disk and len(disk) > 0
    bad += not ok
    print(f"  [{'ok ' if ok else 'BAD'}] SUITES[timeplt] distant entries == tapes on disk -> {ok}")
    # Work-dir uniqueness: the real tapes' names are distinct, and the suite's own partition puts
    # name AND layer in the path, so (tape, layer) -> dir is injective under the shared base.
    names = []
    for t in disk:
        with open(os.path.join(REPO, t), encoding="utf-8") as fh:
            names.append(json.load(fh).get("name"))
    sys.path.insert(0, os.path.join(REPO, "games", "timeplt", "tools"))
    try:
        import distant_suite
        base = "games/timeplt/out/distantwork"
        dirs = {distant_suite.work_dir(base, n, layer)
                for n in names for layer in ("idiomatic", "oracle")}
        part = (len(dirs) == 2 * len(names)
                and all(d.startswith(base + os.sep) for d in dirs)
                and distant_suite.work_dir(base, "n", "l") == os.path.join(base, "n", "l"))
    except Exception as e:  # noqa: BLE001 -- a broken import is itself a BAD
        print(f"  distant_suite import failed: {e}")
        part = False
    finally:
        sys.path.pop(0)
    ok = len(set(names)) == len(names) and part
    bad += not ok
    print(f"  [{'ok ' if ok else 'BAD'}] distant work dirs: tape names distinct + suite partitions "
          f"by name and layer -> {ok}")
    return bad


def _selftest_distant_budget():
    """A tape's `distant_budget_px` may only TIGHTEN. Drive the REAL distant_suite.py (its
    schedule load runs before any MAME work, via --print-render-argv) on a real tape with the key
    rewritten: a value at the default band budget and a tight one must be accepted (controls
    first -- else the refusals prove only that every schedule is refused); above the default,
    negative, fractional or boolean must exit non-zero."""
    bad = 0
    real = os.path.join(REPO, "games", "timeplt", "tools", "distant_suite.py")
    src = os.path.join(REPO, "games", "timeplt", "tapes", "era-advance.poke.json")
    if not (os.path.isfile(real) and os.path.isfile(src)):
        print("  [BAD] distant budget: games/timeplt distant_suite.py or era-advance tape missing")
        return 1
    sys.path.insert(0, os.path.join(REPO, "games", "timeplt", "tools"))
    try:
        import pixel_suite
        default = pixel_suite.BAND_MAX_PX
    finally:
        sys.path.pop(0)
    with open(src, encoding="utf-8") as fh:
        base = json.load(fh)
    with tempfile.TemporaryDirectory() as tmp:
        for label, val, want_ok in [
            ("tight budget (control -- must be ACCEPTED)", 16, True),
            ("budget == default band budget (control -- ACCEPTED)", default, True),
            ("budget ABOVE the default -- loosens, REFUSE", default + 1, False),
            ("budget far above the default -- REFUSE", 5000, False),
            ("negative budget -- REFUSE", -1, False),
            ("fractional budget -- REFUSE", 16.5, False),
            ("boolean budget -- REFUSE", True, False),
        ]:
            path = os.path.join(tmp, "t.poke.json")
            with open(path, "w", encoding="utf-8") as fh:
                json.dump(dict(base, distant_budget_px=val), fh)
            r = subprocess.run(["python3", real, "--schedule", path, "--layer", "idiomatic",
                                "--print-render-argv"], cwd=REPO, capture_output=True, text=True)
            ok = (r.returncode == 0) == want_ok
            bad += not ok
            print(f"  [{'ok ' if ok else 'BAD'}] distant budget: {label}: rc={r.returncode}")
    return bad


def _fixture_game(root, game, *, flag, path, runtime):
    """A minimal game with the three predicate terms set INDEPENDENTLY: no shipped game has
    exactly one term false, so the corpus cannot supply these."""
    gdir = os.path.join(root, "games", game)
    tdir = os.path.join(gdir, "tools")
    os.makedirs(tdir, exist_ok=True)
    with open(os.path.join(gdir, "manifest.js"), "w", encoding="utf-8") as fh:
        fh.write(f'export default {{\n  board: "{game}board",\n  runtime: "{runtime}",\n}};\n')
    with open(os.path.join(tdir, "pixel_suite.py"), "w", encoding="utf-8") as fh:
        fh.write('cmd += ["--idiomatic"]\n' if flag else "# renders the oracle\n")
    # `path`: True = render.js calls the resolver; "lib" = a tools/ module render.js imports calls
    # it; "machine" = only ../machine.js (outside tools/) mentions it, defining it; False = none.
    render = {
        True: "await resolveAllIdiomatic();\n",
        "lib": 'import { build } from "./render-lib.js";\nawait build();\n',
        "machine": 'import { Machine } from "../machine.js";\nbuildRoutines();\n',
        False: "buildRoutines();\n",
    }[path]
    with open(os.path.join(tdir, "render.js"), "w", encoding="utf-8") as fh:
        fh.write(render)
    if path == "lib":
        with open(os.path.join(tdir, "render-lib.js"), "w", encoding="utf-8") as fh:
            fh.write("export async function build() { return layer.resolveAllIdiomatic(); }\n")
    if path == "machine":
        with open(os.path.join(gdir, "machine.js"), "w", encoding="utf-8") as fh:
            fh.write("export async function resolveAllIdiomatic(base) { return new Map(); }\n")


def _selftest_predicate_terms():
    """Every conjunct of `suite_renders_idiomatic` must be INDEPENDENTLY load-bearing.

    ⛔ Arms keyed to the real games were BLIND to it -- deleting any term left zero failures,
    since timeplt is (True,True,idiomatic) and thepit (False,False,idiomatic) -- and went red when
    thepit was made compliant, a gate refusing the fix.
    """
    global REPO
    bad, saved = 0, REPO
    cases = [
        ("all three terms true", True, True, "idiomatic", True),
        ("suite never passes the flag", False, True, "idiomatic", False),
        ("renderer has no override path", True, False, "idiomatic", False),
        ("override path in a tools/ module render.js imports", True, "lib", "idiomatic", True),
        ("only the imported machine.js defines the resolver", True, "machine", "idiomatic", False),
        ("manifest declares translated", True, True, "translated", False),
    ]
    with tempfile.TemporaryDirectory() as root:
        try:
            REPO = root
            for i, (label, flag, path, runtime, want) in enumerate(cases):
                game = f"fixture{i}"
                _fixture_game(root, game, flag=flag, path=path, runtime=runtime)
                got = suite_renders_idiomatic(game)
                ok = got == want
                bad += not ok
                print(f"  [{'ok ' if ok else 'BAD'}] terms: {label} -> {got} (expected {want})")
                fired = bool(dormancy_caveat(game, [f"games/{game}/idiomatic/x.js"]))
                ok = fired == (not want)
                bad += not ok
                print(f"  [{'ok ' if ok else 'BAD'}] terms: {label} -> caveat {fired}")
        finally:
            REPO = saved
    return bad


def _selftest_manifest_reads():
    """Manifest fields must come from a DECLARATION, never from a `//` comment.

    The real corpus cannot supply the discriminating case: two shipped manifests carry
    `// Live runtime: "idiomatic" ...` above their real field, and both happen to AGREE with it,
    so an unanchored read returns the right answer on every game today. Construct the manifest
    where they disagree. The unsafe direction is the one that matters -- a comment reading
    "idiomatic" above a translated declaration suppresses the dormancy caveat, deleting the
    warning exactly where it is needed.
    """
    global REPO
    bad, saved = 0, REPO
    with tempfile.TemporaryDirectory() as root:
        gdir = os.path.join(root, "games", "trap")
        os.makedirs(gdir)
        with open(os.path.join(gdir, "manifest.js"), "w", encoding="utf-8") as fh:
            fh.write('// Live runtime: "idiomatic" runs the whole game on the readable layer.\n'
                     '// board: "decoy"\n'
                     'export const manifest = {\n'
                     '  board: "trapboard",\n'
                     '  runtime: "translated",\n'
                     '};\n')
        try:
            REPO = root
            for label, got, want in [
                ("runtime read past a contradicting comment", game_runtime("trap"), "translated"),
                ("board read past a contradicting comment",
                 sorted(board_to_games().keys()), ["trapboard"]),
            ]:
                ok = got == want
                bad += not ok
                print(f"  [{'ok ' if ok else 'BAD'}] manifest: {label} -> {got!r} "
                      f"(expected {want!r})")
            # ⚠ Once green for the WRONG reason -- no `tools/`, so the predicate returned False on
            # OSError whatever the manifest said. Now only the runtime read can fire the caveat.
            _fixture_game(root, "trap", flag=True, path=True, runtime="translated")
            with open(os.path.join(gdir, "manifest.js"), "w", encoding="utf-8") as fh:
                fh.write('// Live runtime: "idiomatic" runs the whole game on the readable layer.\n'
                         '// board: "decoy"\n'
                         'export const manifest = {\n'
                         '  board: "trapboard",\n'
                         '  runtime: "translated",\n'
                         '};\n')
            fired = bool(dormancy_caveat("trap", ["games/trap/idiomatic/x.js"]))
            bad += not fired
            print(f"  [{'ok ' if fired else 'BAD'}] manifest: caveat NOT suppressed by the "
                  f"comment -> {fired}")
        finally:
            REPO = saved
    return bad


def _selftest_romset_waiver():
    """The romset waiver, end to end against a REAL throwaway git repo (diff binding, staged ledger),
    driving the real cmd_check / cmd_skip_romset with stand-in suites. Fail-closed arms: the waiver
    must NOT rescue FAIL, INCOMPLETE, a crash, a timeout, a no-mame SKIP, another game, a stale diff
    or a missing ledger line; the control (romset SKIP + waiver + ledger) must pass, banner and all."""
    global REPO
    bad, saved, real_suites = 0, REPO, SUITES

    def expect(label, got, want):
        nonlocal bad
        bad += got != want
        print(f"  [{'ok ' if got == want else 'BAD'}] romset waiver: {label} -> {got} (expected {want})")

    skip_line = "pixel_suite: SKIP -- no verified gset romset at /nowhere\n"
    for label, out, want in [
        ("romset SKIP, exit 0 (control)", skip_line, True),
        ("romset SKIP, exit 1 (control)", skip_line + "\n[exit 1]", True),
        ("romset SKIP, exit 2", skip_line + "\n[exit 2]", False),
        ("no-mame SKIP", "pixel_suite: SKIP -- no `mame` on PATH\n", False),
        ("romset SKIP then a traceback", skip_line + "Traceback (most recent call last):\nKeyError: 1\n[exit 1]", False),
        ("FAIL after a romset line", skip_line + "pixel_suite: FAIL\n[exit 1]", False),
        ("FAIL, then a romset SKIP as the last line", "pixel_suite: FAIL -- x\n" + skip_line + "[exit 1]", False),
        ("traceback, then a romset SKIP as the last line", "Traceback (most recent call last):\nKeyError: 1\n" + skip_line + "[exit 1]", False),
        ("INCOMPLETE", "pixel_suite: INCOMPLETE -- 3 of 1801\n[exit 1]", False),
        ("timeout", "python3 s.py exceeded 900s and was killed", False),
        ("launch failure", "could not execute python3 s.py: [Errno 2]", False),
    ]:
        expect(f"romset_skip({label})", romset_skip(out), want)

    def check():
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
            rc = cmd_check()
        return rc, buf.getvalue()

    with tempfile.TemporaryDirectory() as repo:
        def git(*a):
            subprocess.run(["git", *a], cwd=repo, check=True, capture_output=True, text=True)

        def stage(rel, text):
            os.makedirs(os.path.dirname(os.path.join(repo, rel)), exist_ok=True)
            with open(os.path.join(repo, rel), "w", encoding="utf-8") as fh:
                fh.write(text)
            git("add", "--", rel)

        def suite(name, text, rc):
            globals()["SUITES"] = {"g": [(_fixture(repo, name, text, rc), PIXEL_SUITE_PASS)],
                                   "h": [(_fixture(repo, name + "_h", "pixel_suite: PASS\n", 0), PIXEL_SUITE_PASS)]}

        try:
            REPO = repo
            git("init", "-q")
            git("config", "user.email", "selftest@example.invalid")
            git("config", "user.name", "selftest")
            stage(LEDGER, "# game<TAB>date<TAB>reason\n")
            stage("games/g/tools/pixel_suite.py", "# v1\n")
            git("commit", "-qm", "base")
            stage("games/g/tools/pixel_suite.py", "# v2\n")

            suite("skip.py", skip_line, 1)
            rc, _ = check()
            expect("romset SKIP, NO waiver -> refused", rc, 1)
            with contextlib.redirect_stdout(io.StringIO()):
                cmd_skip_romset("g", "selftest: no gset romset")
            rc, out = check()
            expect("romset SKIP + waiver + staged ledger line -> allowed", rc, 0)
            expect("  ...prints the SKIPPED/NOT validated/RE-RUN OWED banner",
                   all(k in out for k in ("g SKIPPED -- romset missing -- NOT validated", "RE-RUN OWED")), True)
            expect("  ...and never a PASS line for g", bool(re.search(r"^\s*g \[.*\]: PASS", out, re.M)), False)
            expect("  ...and the ledger line is staged", "g" in ledger_games(""), True)
            expect("  ...and the ledger banner prints on this run", "PIXEL RE-RUN OWED" in out, True)
            for label, text, rc_ in [("FAIL", "pixel_suite: FAIL\n", 1),
                                     ("INCOMPLETE", "pixel_suite: INCOMPLETE -- 3 of 9\n", 1),
                                     ("crash after the romset line", skip_line + "Traceback (x)\nKeyError\n", 1),
                                     ("no-mame SKIP", "pixel_suite: SKIP -- no `mame` on PATH\n", 0)]:
                suite(f"w_{label[:4]}.py", text, rc_)
                expect(f"waiver present, suite {label} -> refused", check()[0], 1)

            suite("skip2.py", skip_line, 1)
            did = staged_diff_id()
            with open(os.path.join(repo, WAIVER_DIR, did + ".json"), "w", encoding="utf-8") as fh:
                json.dump({"diff_id": did, "games": {"h": "wrong game"}}, fh)
            expect("waiver names ANOTHER game -> refused", check()[0], 1)
            with open(os.path.join(repo, WAIVER_DIR, did + ".json"), "w", encoding="utf-8") as fh:
                json.dump({"diff_id": did, "games": {"g": "right game"}}, fh)
            expect("waiver re-bound to g (control) -> allowed", check()[0], 0)
            stage("games/g/tools/pixel_suite.py", "# v3\n")
            expect("staged diff changed after the waiver (stale) -> refused", check()[0], 1)

            git("rm", "-q", "--cached", "--", LEDGER)
            stage(LEDGER, "# game<TAB>date<TAB>reason\n")
            did = staged_diff_id()
            with open(os.path.join(repo, WAIVER_DIR, did + ".json"), "w", encoding="utf-8") as fh:
                json.dump({"diff_id": did, "games": {"g": "no ledger line"}}, fh)
            expect("waiver for this diff but NO ledger line -> refused", check()[0], 1)

            git("reset", "-q", "--hard")
            stage(LEDGER, "# game<TAB>date<TAB>reason\ng\t2026-01-01\towed\n")
            git("commit", "-qm", "owe g")
            stage("docs/x.md", "unrelated\n")
            rc, out = check()
            expect("ledger non-empty, nothing render-affecting staged -> allowed", rc, 0)
            expect("  ...and the RE-RUN OWED banner still prints", "PIXEL RE-RUN OWED" in out and "g\t2026" in out, True)

            stage(LEDGER, "# game<TAB>date<TAB>reason\n")
            suite("skip3.py", skip_line, 1)
            did = staged_diff_id()
            with open(os.path.join(repo, WAIVER_DIR, did + ".json"), "w", encoding="utf-8") as fh:
                json.dump({"diff_id": did, "games": {"g": "try to waive the clearing"}}, fh)
            expect("deleting a ledger line runs g's suite; a SKIP, even with a waiver -> refused", check()[0], 1)
            suite("pass.py", "pixel_suite: PASS\n", 0)
            expect("deleting a ledger line with g PASSing -> allowed", check()[0], 0)

            git("reset", "-q", "--hard")
            stage("games/g/tools/pixel_suite.py", "# v4\n")
            rc, out = check()
            expect("g PASSes while still owed -> allowed, told to delete its line",
                   (rc, "Delete its line" in out), (0, True))

            git("reset", "-q", "--hard")
            stage(LEDGER, "# game<TAB>date<TAB>reason\n")
            git("commit", "-qm", "clear")
            rc, out = check()
            expect("empty ledger (control) -> no RE-RUN OWED banner", "RE-RUN OWED" in out, False)
        finally:
            REPO = saved
            globals()["SUITES"] = real_suites
    return bad


def cmd_selftest(_args=None):
    """Prove this gate can REFUSE -- by driving run_suite and cmd_check, not a copy of them.

    A selftest that recomputes the predicate inline instead of calling it asserts against itself:
    it stays green even with the pattern check deleted from `run_suite` outright, which is the one
    defect this whole tool exists to avoid. Drive the real functions. Controls run first; if the
    PASS case is not ACCEPTED, the refusals below prove only that the predicate rejects everything.
    """
    bad = 0
    with tempfile.TemporaryDirectory() as tmp:
        cases = [
            ("PASS (control -- must be ACCEPTED)", "  boot -> PASS\npixel_suite: PASS\n", 0, True),
            ("SKIP, no mame -- exit 0, THE FAILURE MODE", "pixel_suite: SKIP -- no `mame` on PATH\n", 0, False),
            ("SKIP, no romset -- exit 0", "pixel_suite: SKIP -- romset timeplt not found\n", 0, False),
            ("INCOMPLETE -- short render", "pixel_suite: INCOMPLETE -- 3 of 1801\n", 1, False),
            ("FAIL -- real divergence", "pixel_suite: FAIL\n", 1, False),
            ("silence -- suite printed nothing", "", 0, False),
            ("indented window PASS, NO verdict line", "  boot+attract -> PASS\n", 0, False),
            ("PASS line then non-zero exit (a crash after the verdict)", "pixel_suite: PASS\n", 3, False),
        ]
        for i, (label, text, rc, want) in enumerate(cases):
            argv = _fixture(tmp, f"s{i}.py", text, rc)
            got, _ = run_suite(argv, PIXEL_SUITE_PASS)
            mark = "ok " if got == want else "BAD"
            bad += got != want
            print(f"  [{mark}] {label}: accepted={got} expected={want}")

        got, _ = run_suite(["python3", os.path.join(tmp, "does-not-exist.py")], PIXEL_SUITE_PASS)
        mark = "ok " if got is False else "BAD"
        bad += got is not False
        print(f"  [{mark}] missing suite file: accepted={got} expected=False")

        hang = os.path.join(tmp, "hang.py")
        with open(hang, "w", encoding="utf-8") as fh:
            fh.write("import time\nprint('pixel_suite: PASS')\ntime.sleep(30)\n")
        got, _ = run_suite(["python3", hang], PIXEL_SUITE_PASS, timeout=1)
        mark = "ok " if got is False else "BAD"
        bad += got is not False
        print(f"  [{mark}] suite HANGS past its timeout: accepted={got} expected=False")

        # The distant tapes' verdict: anchored, keyed to the tape's name, header-proof.
        dp = DISTANT_PASS("era-advance")
        for label, text, rc, want in [
            ("distant PASS (control -- must be ACCEPTED)",
             "distant_suite: tape era-advance -- desc\n  band -> PASS\ndistant_suite: PASS -- era-advance\n", 0, True),
            ("distant SKIP, exit 0 -- no mame", "distant_suite: SKIP -- no `mame` on PATH\n", 0, False),
            ("distant header only, exit 0", "distant_suite: tape era-advance -- desc\n", 0, False),
            ("distant PASS then exit 1", "distant_suite: PASS -- era-advance\n", 1, False),
            ("distant argparse error, exit 2",
             "usage: distant_suite.py [-h] --schedule SCHEDULE\ndistant_suite.py: error: unrecognized arguments: --bogus\n", 2, False),
            ("ANOTHER tape's PASS line", "distant_suite: PASS -- era-one\n", 0, False),
            ("PASS with a trailing suffix", "distant_suite: PASS -- era-advance-twin\n", 0, False),
        ]:
            argv = _fixture(tmp, f"d{abs(hash(label))}.py", text, rc)
            got, _ = run_suite(argv, dp)
            mark = "ok " if got == want else "BAD"
            bad += got != want
            print(f"  [{mark}] {label}: accepted={got} expected={want}")
        # The REAL suite's argparse error (exit 2), not a stand-in, when the suite is present.
        real = "games/timeplt/tools/distant_suite.py"
        if os.path.isfile(os.path.join(globals()["REPO"], real)):
            got, _ = run_suite(["python3", real, "--bogus"], dp)
            bad += got is not False
            print(f"  [{'ok ' if got is False else 'BAD'}] REAL distant_suite argparse error: "
                  f"accepted={got} expected=False")
        # A tape NAMED "PASS": its header must not read as its verdict.
        argv = _fixture(tmp, "dpass.py", "distant_suite: tape PASS -- PASS\n", 0)
        got, _ = run_suite(argv, DISTANT_PASS("PASS"))
        bad += got is not False
        print(f"  [{'ok ' if got is False else 'BAD'}] tape named PASS, header only: accepted={got} expected=False")

        real_staged, real_suites = globals()["staged_paths"], SUITES
        try:
            for label, paths, suites, want_rc in [
                ("cmd_check: no render-affecting paths -> allow",
                 ["docs/pixel-gate.md"], {}, 0),
                ("cmd_check: idiomatic staged, suite passes -> allow",
                 ["games/timeplt/idiomatic/loc_1.js"],
                 {"timeplt": [(_fixture(tmp, "ok.py", "pixel_suite: PASS\n", 0), PIXEL_SUITE_PASS)]}, 0),
                ("cmd_check: translated staged -> runs the oracle layer, passes -> allow",
                 ["games/timeplt/translated/loc_1.js"],
                 {"timeplt": [(_fixture(tmp, "oracle_ok.py", "pixel_suite: PASS\n", 0), PIXEL_SUITE_PASS)]}, 0),
                ("cmd_check: both layers staged -> runs both, both pass -> allow",
                 ["games/timeplt/idiomatic/a.js", "games/timeplt/translated/b.js"],
                 {"timeplt": [(_fixture(tmp, "both_ok.py", "pixel_suite: PASS\n", 0), PIXEL_SUITE_PASS)]}, 0),
                ("cmd_check: idiomatic staged, suite SKIPs -> REFUSE",
                 ["games/timeplt/idiomatic/loc_1.js"],
                 {"timeplt": [(_fixture(tmp, "skip.py", "pixel_suite: SKIP\n", 0), PIXEL_SUITE_PASS)]}, 1),
                ("cmd_check: pixel PASS + distant SKIP -> REFUSE",
                 ["games/timeplt/tapes/era-advance.poke.json"],
                 {"timeplt": [(_fixture(tmp, "px_ok.py", "pixel_suite: PASS\n", 0), PIXEL_SUITE_PASS),
                              (_fixture(tmp, "dist_skip.py", "distant_suite: SKIP -- no `mame` on PATH\n", 0),
                               DISTANT_PASS("era-advance"))]}, 1),
                ("cmd_check: pixel PASS + distant PASS -> allow",
                 ["games/timeplt/tools/distant_suite.py"],
                 {"timeplt": [(_fixture(tmp, "px_ok2.py", "pixel_suite: PASS\n", 0), PIXEL_SUITE_PASS),
                              (_fixture(tmp, "dist_ok.py", "distant_suite: PASS -- era-advance\n", 0),
                               DISTANT_PASS("era-advance"))]}, 0),
                ("cmd_check: undeclared game staged -> REFUSE",
                 ["games/dkong/idiomatic/marioWalk.js"], {}, 1),
                ("cmd_check: a BOARD path reaches its game -> REFUSE (undeclared here)",
                 ["boards/dkong/video.js"], {}, 1),
                ("cmd_check: an unclaimed board reaches nothing -> allow",
                 ["boards/nosuchboard/video.js"], {}, 0),
            ]:
                globals()["staged_paths"] = lambda p=paths: p
                globals()["SUITES"] = suites
                rc = cmd_check()
                mark = "ok " if rc == want_rc else "BAD"
                bad += rc != want_rc
                print(f"  [{mark}] {label}: rc={rc} expected={want_rc}")
        finally:
            globals()["staged_paths"], globals()["SUITES"] = real_staged, real_suites

    bad += _selftest_staged_paths()
    bad += _selftest_romset_waiver()
    bad += _selftest_distant_glob()
    bad += _selftest_distant_budget()
    bad += _selftest_manifest_reads()
    bad += _selftest_predicate_terms()

    # A path matcher that never fires looks exactly like a clean repo. ★ The `*ness.js` /
    # `*-notes.md` entries are not padding: no real path starts with "idiomatic" without being the
    # directory, so a regex that lost its trailing slash is invisible against real data.
    for path, want_game in [
        ("games/timeplt/idiomatic/loc_1234.js", "timeplt"),
        ("games/timeplt/idiomatic/names.js", "timeplt"),
        ("games/timeplt/translated/loc_1234.js", "timeplt"),
        ("games/timeplt/routines.js", "timeplt"),
        ("games/timeplt/machine.js", "timeplt"),
        ("games/timeplt/tools/render.js", "timeplt"),
        ("games/timeplt/tools/pixel_suite.py", "timeplt"),
        ("games/timeplt/tools/distant_suite.py", "timeplt"),
        ("games/timeplt/tools/render-lib.js", "timeplt"),
        ("games/timeplt/tapes/era-advance.poke.json", "timeplt"),
        ("games/timeplt/tapes/era-advance.poke.json.bak", None),
        ("games/timeplt/tapes/sub/x.poke.json", None),
        ("games/dkong/idiomatic/marioWalk.js", "dkong"),
        ("games/timeplt/manifest.js", "timeplt"),
        ("boards/timeplt/video.js", "timeplt"),
        ("boards/nosuchboard/video.js", None),
        ("games/timeplt/idiomaticness.js", None),
        ("games/timeplt/translated-notes.md", None),
        ("games/timeplt/routines.js.bak", None),
        ("games/timeplt/audio/samples/x.wav", None),
        ("docs/pixel-gate.md", None),
        ("tools/review_gate.py", None),
        ("core/machine.js", None),
    ]:
        got = affected_games([path])
        got_game = got[0] if got else None
        mark = "ok " if got_game == want_game else "BAD"
        bad += got_game != want_game
        print(f"  [{mark}] {path} -> {got_game} (expected {want_game})")

    # layers_for_game: the layer(s) to render come from WHICH files changed, not the manifest.
    for lpaths, want in [
        (["games/timeplt/idiomatic/loc_1.js"], ["idiomatic"]),
        (["games/timeplt/translated/loc_1.js"], ["oracle"]),
        (["games/timeplt/idiomatic/a.js", "games/timeplt/translated/b.js"], ["idiomatic", "oracle"]),
        (["games/timeplt/machine.js"], ["idiomatic", "oracle"]),      # shared infra -> both
        (["games/timeplt/manifest.js"], ["idiomatic", "oracle"]),
        (["games/timeplt/tools/render.js"], ["idiomatic", "oracle"]),
        (["games/timeplt/tools/pixel_suite.py"], ["idiomatic", "oracle"]),
        (["games/timeplt/routines.js"], ["idiomatic", "oracle"]),
        (["games/timeplt/tools/distant_suite.py"], ["idiomatic", "oracle"]),
        (["games/timeplt/tapes/era-one.poke.json"], ["idiomatic", "oracle"]),
        (["games/timeplt/idiomatic/a.js", "games/dkong/idiomatic/b.js"], ["idiomatic"]),  # this game only
    ]:
        got = layers_for_game("timeplt", lpaths)
        mark = "ok " if got == want else "BAD"
        bad += got != want
        print(f"  [{mark}] layers_for_game(timeplt, {lpaths}) -> {got} (expected {want})")

    # ⛔ SYNTHETIC games: corpus-keyed arms were blind to the predicate and went red when a real
    # game became compliant. See _selftest_predicate_terms.
    global REPO
    saved = REPO
    with tempfile.TemporaryDirectory() as root:
        try:
            REPO = root
            _fixture_game(root, "oracled", flag=False, path=False, runtime="idiomatic")
            _fixture_game(root, "idio", flag=True, path=True, runtime="idiomatic")
            for label, game, paths, want in [
                ("idiomatic-only, suite renders the ORACLE -> CAVEAT",
                 "oracled", ["games/oracled/idiomatic/loc_1.js"], True),
                ("idiomatic AND translated staged -> no caveat",
                 "oracled", ["games/oracled/idiomatic/loc_1.js",
                             "games/oracled/translated/loc_1.js"], False),
                ("idiomatic-only, suite renders IDIOMATIC -> no caveat",
                 "idio", ["games/idio/idiomatic/x.js"], False),
                ("idiomatic AND its own board path -> no caveat",
                 "oracled", ["games/oracled/idiomatic/x.js", "boards/oracledboard/video.js"], False),
                ("a board path for ANOTHER game does not clear the caveat",
                 "oracled", ["games/oracled/idiomatic/x.js", "boards/idioboard/video.js"], True),
            ]:
                got = bool(dormancy_caveat(game, paths))
                mark = "ok " if got == want else "BAD"
                bad += got != want
                print(f"  [{mark}] caveat: {label} -> {got}")
        finally:
            REPO = saved

    print("pixel_gate_required selftest: " + ("OK" if not bad else f"{bad} FAILING CASE(S)"))
    return 1 if bad else 0


def cmd_run(game):
    """Run one game's declared pixel suite(s) on demand, outside any staged-diff context."""
    banner = ledger_banner()
    if banner:
        print(banner, file=sys.stderr)
    if game not in SUITES:
        manual = MANUAL.get(game)
        print(f"pixel_gate_required: no pixel suite is declared for {game}.", file=sys.stderr)
        if manual:
            print(f"  {manual}", file=sys.stderr)
        return 2
    rc = 0
    for argv, pattern in SUITES[game]:
        ok, out = run_suite(argv, pattern)
        print(out.rstrip())
        if not ok:
            print(f"pixel_gate_required: {game} did NOT pass -- "
                  "SKIP and INCOMPLETE are not passes.", file=sys.stderr)
            rc = 1
    return rc


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "check"
    if cmd == "check":
        return cmd_check()
    if cmd == "selftest":
        return cmd_selftest()
    if cmd == "run":
        if len(sys.argv) < 3:
            print(f"usage: {sys.argv[0]} run <game>", file=sys.stderr)
            return 2
        return cmd_run(sys.argv[2])
    if cmd == "skip-romset":
        ap = argparse.ArgumentParser(prog=f"{sys.argv[0]} skip-romset")
        ap.add_argument("--game", required=True)
        ap.add_argument("--reason", required=True)
        a = ap.parse_args(sys.argv[2:])
        return cmd_skip_romset(a.game, a.reason)
    print(f"usage: {sys.argv[0]} [check|selftest|run <game>|skip-romset --game G --reason R]",
          file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
