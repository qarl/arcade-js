#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""Understanding-completeness gate — make the MECHANISMS-with-renames rule MECHANICAL.

The recipe rule (docs/idiomatic-generation.md and docs/understanding.md): an understanding pass
rewrites the game's mechanisms.md in the SAME landable unit as the renames, and the
map must reference only names that exist in the code. Prose can't enforce that — an
agent (or a lead) under a "correctness gates are green -> commit" reflex ships the
renames and leaves the map stale. Every gate we DO follow has teeth; this gives the
recipe teeth too. The pre-commit hook refuses a commit that breaks it.

Two checks, per game with staged changes, computed on the STAGED (index) content so
they bind to exactly what will be committed:

  A. same-landable-unit — if the commit renames idiomatic routine files OR changes the
     names.js export set for game G, then games/G/mechanisms.md must ALSO be staged. A
     understanding pass that renames without touching the map is half-done.

  B. no-retired-names — games/G/mechanisms.md must contain NONE of the names this commit
     retired: idiomatic routine files removed, or names.js exports removed, between HEAD
     and the index. A retired name still in the map is a dangling reference the renames
     left behind (this is what caught the stale CLIMB_GATE / ANIM_RAND).

  C. map-references-the-registry — for an enrolled game (MAP_GAMES), every routine-shaped name the
     map cites (camelCase or loc_<addr>, tagged or not) exists as a names.js export, a ROUTINES name or
     an idiomatic routine file; every `NAME [tag]` citation names a names.js cell or ROUTINES entry and
     carries that entry's own tag; every [code]/[guess] in the map is attached to such a citation, and
     its address is accounted for in games/G/grounding-debt.txt (runbook §5: stage-B grounding is
     complete only when every [code] is lifted or accounted for). Binds to the index, like A and B.

FAIL CLOSED: any git error blocks the commit rather than being read as "nothing to check".
'git commit --no-verify' bypasses it — that is the exact rule it enforces; do not.
Subcommands: check (the hook), map --game <g> (check C on the working tree, for done_gate), selftest.
"""
import contextlib
import io
import os
import re
import shutil
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import names_consistency  # noqa: E402  (registry_tags / tag_citations: one reading of names.js tags)


class GitError(RuntimeError):
    """A git invocation failed — callers turn this into a BLOCK (fail closed)."""


def repo_root():
    r = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True)
    if r.returncode != 0 or not r.stdout.strip():
        raise GitError(r.stderr.strip() or "not inside a git work tree")
    return r.stdout.strip()


def git(args, allow_fail=False):
    r = subprocess.run(["git", *args], capture_output=True, text=True, cwd=REPO)
    if r.returncode != 0 and not allow_fail:
        raise GitError(f"`git {' '.join(args)}` failed (exit {r.returncode}): {r.stderr.strip()}")
    return r.stdout


REPO = None
try:
    REPO = repo_root()
except GitError:
    pass


ROUTINE_RE = re.compile(r"^games/([^/]+)/idiomatic/([^/]+)\.js$")
EXPORT_RE = re.compile(r"export\s+const\s+([A-Za-z_][A-Za-z0-9_]*)\s*=")


def is_routine(path):
    """games/<G>/idiomatic/<name>.js — a top-level routine file (not names.js, not test/)."""
    m = ROUTINE_RE.match(path)
    if not m:
        return None
    name = m.group(2)
    if name == "names" or "/" in path[len(f"games/{m.group(1)}/idiomatic/"):]:
        return None
    return m.group(1), name  # (game, routine-name)


def staged_name_status():
    """[(status, oldpath, newpath)] for the staged diff, rename-detected."""
    out = git(["diff", "--cached", "-M", "--name-status", "--no-color"])
    rows = []
    for line in out.splitlines():
        parts = line.split("\t")
        if not parts or not parts[0]:
            continue
        status = parts[0]
        if status.startswith("R") and len(parts) == 3:
            rows.append((status, parts[1], parts[2]))
        elif len(parts) >= 2:
            rows.append((status, parts[1], parts[1]))
    return rows


def blob(ref, path):
    """Contents of <path> at a ref ('HEAD', or ':' for the index stage-0); '' if absent.

    Index syntax is a SINGLE leading colon (`git show :path`) — building `f"{ref}:{path}"`
    with ref=':' yields `::path`, an invalid rev that returns empty and makes every HEAD
    name look retired. Handle the index case explicitly.
    """
    spec = f":{path}" if ref == ":" else f"{ref}:{path}"
    return git(["show", spec], allow_fail=True)


def exports_of(text):
    return set(EXPORT_RE.findall(text))


def routine_names(ref, game):
    """Set of routine names present in games/<game>/idiomatic/ at a ref (HEAD or index)."""
    if ref == ":":
        out = git(["ls-files", "--", f"games/{game}/idiomatic/"])
    else:
        out = git(["ls-tree", "-r", "--name-only", ref, "--", f"games/{game}/idiomatic/"])
    names = set()
    for p in out.splitlines():
        r = is_routine(p)
        if r and r[0] == game:
            names.add(r[1])
    return names


def games_touched(rows):
    gs = set()
    for _s, old, new in rows:
        for p in (old, new):
            m = re.match(r"^games/([^/]+)/", p)
            if m:
                gs.add(m.group(1))
    return gs


# CHECK C is opted in game by game: the legacy maps cite helpers and loc_ labels that are not registry
# names, and carry [code] the registry no longer does.
MAP_GAMES = {"timeplt"}
ROUTINE_TOKEN = re.compile(r"(?<![A-Za-z0-9_.$/])([a-z][a-z0-9]*[A-Z][A-Za-z0-9_]*|loc_[0-9a-fA-F]{4})(?![A-Za-z0-9_])")
UNGROUNDED_TAG = re.compile(r"(?<!`)\[(?:code|guess)\](?!`)")
# (R40 U1) The map's body states what the machine does; whether a reading was watched under MAME is the
# TAG's job, and an unwatched reading belongs in §9's open questions. So, between the first `## ` heading
# and `## §9` (the legend above and §9 itself are exempt), prose admitting a claim was never observed blocks.
UNOBSERVED = re.compile(r"not (?:been |yet )?(?:observed|watched|checked|measured|confirmed)|code[- ]reading only|"
                        r"code-level (?:reading|inference)|has not been (?:seen|observed|watched)|under MAME", re.I)


def debt_addrs(text):
    """Addresses listed in a grounding-debt.txt (`0xADDR  reason`, # comments)."""
    out = set()
    for ln in text.splitlines():
        ln = ln.split("#", 1)[0].strip()
        if ln:
            try:
                out.add(int(ln.split()[0], 16))
            except ValueError:
                pass
    return out


def map_problems(map_text, names_text, routine_files, debt_text):
    """CHECK C core: [(line, message)] for the map against the registry. Pure: every input is text or a set."""
    reg = names_consistency.registry_tags(names_text)
    known = set(reg) | exports_of(names_text) | set(routine_files)
    debt = debt_addrs(debt_text)
    problems = []
    zone = "legend"   # legend -> body (first `## `) -> open (`## §9`); only the body is held to UNOBSERVED
    for i, line in enumerate(map_text.splitlines(), 1):
        if line.startswith("## "):
            zone = "open" if line.startswith("## §9") else ("body" if zone == "legend" else zone)
        u = UNOBSERVED.search(line) if zone == "body" else None
        if u:
            problems.append((i, f"“{u.group(0)}”: the body states what the code does; a reading no run has "
                                "observed is a §9 open question, and grounding is the tag's job"))
        attached, reported = set(), set()
        for at, name, tag in names_consistency.tag_citations(line):
            attached.add(at)
            if name not in reg:
                reported.add(name)
                problems.append((i, f"`{name} [{tag}]`: no names.js cell or ROUTINES entry by that name"))
                continue
            addr, have = reg[name]
            if have != tag:
                problems.append((i, f"`{name} [{tag}]` but names.js gives it " + (f"[{have}]" if have else "no tag")))
            if tag in ("code", "guess") and addr not in debt:
                where = f"0x{addr:04x}" if addr is not None else "its address"
                problems.append((i, f"`{name} [{tag}]`: {where} is not accounted for in grounding-debt.txt"))
        for m in UNGROUNDED_TAG.finditer(line):
            if m.start() not in attached:
                problems.append((i, f"{m.group(0)} is not attached to a names.js name: "
                                    f"“…{line[max(0, m.start() - 60):m.end()].strip()}”"))
        for m in ROUTINE_TOKEN.finditer(line):
            if m.group(1) not in known and m.group(1) not in reported:
                problems.append((i, f"`{m.group(1)}` is not a names.js export, ROUTINES name or routine file"))
    return problems


def _map_failure(game, mech, problems):
    return (f"[{game}] {mech} does not match the registry (CHECK C):\n"
            + "\n".join(f"    {mech}:{ln}  {msg}" for ln, msg in problems))


def map_report(game):
    """CHECK C over the WORKING TREE for one game (done_gate's call). A game outside MAP_GAMES is info, rc 0."""
    if game not in MAP_GAMES:
        print(f"understanding_gate map [{game}]: not enrolled in MAP_GAMES (info only)")
        return 0
    base = os.path.join(REPO, "games", game)

    def read(rel, required):
        try:
            return open(os.path.join(base, rel), encoding="utf-8").read()
        except OSError as e:
            if required:
                raise GitError(f"cannot read games/{game}/{rel}: {e}")
            return ""

    files = {f[:-3] for f in os.listdir(os.path.join(base, "idiomatic")) if f.endswith(".js") and f != "names.js"}
    problems = map_problems(read("mechanisms.md", True), read("idiomatic/names.js", True), files,
                            read("grounding-debt.txt", False))
    if problems:
        print(f"understanding_gate map [{game}]: FAIL\n" + _map_failure(game, f"games/{game}/mechanisms.md", problems))
        return 1
    print(f"understanding_gate map [{game}]: PASS")
    return 0


def check():
    rows = staged_name_status()
    if not rows:
        return 0  # nothing staged with content — not our business (review_gate handles empties)
    staged_paths = {new for _s, _o, new in rows} | {old for _s, old, _n in rows}
    failures = []

    for game in sorted(games_touched(rows)):
        mech = f"games/{game}/mechanisms.md"
        mech_head = blob("HEAD", mech)
        mech_index = blob(":", mech)
        mech_exists = bool(mech_head or mech_index)
        mech_staged = mech in staged_paths

        # --- what did this commit rename/retire for this game? ---
        renamed_routines = any(
            s.startswith("R") and (is_routine(o) or is_routine(n)) and game in (
                (is_routine(o) or ("",))[0], (is_routine(n) or ("",))[0])
            for s, o, n in rows
        )
        head_exports = exports_of(blob("HEAD", f"games/{game}/idiomatic/names.js"))
        index_exports = exports_of(blob(":", f"games/{game}/idiomatic/names.js"))
        exports_changed = head_exports != index_exports

        retired_routines = routine_names("HEAD", game) - routine_names(":", game)
        retired_exports = head_exports - index_exports
        # a name still carried by a staged routine file is live, not retired
        retired = (retired_routines | retired_exports) - routine_names(":", game)

        understanding_change = renamed_routines or exports_changed

        # CHECK A — same landable unit
        if understanding_change and mech_exists and not mech_staged:
            failures.append(
                f"[{game}] this commit renames routines / changes names.js exports but does NOT "
                f"stage {mech}. An understanding pass rewrites the map in the same commit."
            )

        # CHECK B — no retired names left in the (staged) map
        map_text = mech_index if mech_staged else mech_head
        if map_text and retired:
            hits = []
            for name in sorted(retired):
                for i, line in enumerate(map_text.splitlines(), 1):
                    if re.search(rf"(?<![A-Za-z0-9_]){re.escape(name)}(?![A-Za-z0-9_])", line):
                        hits.append(f"    {mech}:{i}  references retired name `{name}`")
                        break
            if hits:
                failures.append(
                    f"[{game}] {mech} still references names this commit retired:\n" + "\n".join(hits)
                )

        # CHECK C — the map cites only registry names, with the registry's tags
        if game in MAP_GAMES:
            names_text = blob(":", f"games/{game}/idiomatic/names.js")
            if not mech_index or not names_text:
                failures.append(f"[{game}] enrolled in MAP_GAMES but {mech} or names.js is absent from the index")
            else:
                problems = map_problems(mech_index, names_text, routine_names(":", game),
                                        blob(":", f"games/{game}/grounding-debt.txt"))
                if problems:
                    failures.append(_map_failure(game, mech, problems))

    if failures:
        sys.stderr.write(
            "\nCOMMIT BLOCKED — understanding-completeness gate (tools/understanding_gate.py):\n"
            "  the game map (mechanisms.md) is out of sync with the code and names.js.\n\n"
            + "\n".join("  " + f for f in failures)
            + "\n\n  Bring the game's mechanisms.md in line with the current code and names.js, in THIS "
            "commit (do not --no-verify).\n\n"
        )
        return 1
    return 0


SELFTEST_NAMES = (
    "/** Coins accepted. [seen] */\n"
    "export const COIN_COUNT = 0xa982;\n"
    "/** Tamper witness. [code] */\n"
    "export const TAMPER_WITNESS = 0xad39;\n"
    "export const ROUTINES = {\n"
    '  0x4984: { name: "pulseCoinCounter", cert: "seen" },\n'
    '  0x0167: { name: "loc_0167", cert: "code" },\n'
    '  0x0200: { name: "flyAtSlowestSpeed", cert: "seen" },\n'
    "};\n"
)
SELFTEST_MAP = (
    "- **`[code]`** — read from the routines.\n"
    "`pulseCoinCounter` (0x4984) [seen] steps COIN_COUNT 0xA982 [seen]; flyAtSlowestSpeed [seen] flies.\n"
    "The trap loc_0167 [code] checks TAMPER_WITNESS 0xAD39 [code].\n"
)
SELFTEST_DEBT = "0x0167  [anti-tamper] trap\n0xad39  [anti-tamper] witness\n"
SELFTEST_ROUTINES = ("pulseCoinCounter", "loc_0167", "flyAtSlowestSpeed")


def _selftest_map(failures):
    """CHECK C fixtures: the faithful map passes; each mutant row is caught."""
    files = set(SELFTEST_ROUTINES)
    got = map_problems(SELFTEST_MAP, SELFTEST_NAMES, files, SELFTEST_DEBT)
    if got:
        failures.append(f"CHECK C faithful map: want no problems, got {got}")
    mutants = [
        ("invented routine, tagged", "The era-2 craft are flown by serviceEra2EnemyCraftSlots [seen].\n", SELFTEST_DEBT),
        ("dangling loc_ tagged [code]", "The tamper trap is loc_4f00 [code].\n", SELFTEST_DEBT),
        ("invented routine, untagged", "Then `serviceEra2Craft` runs.\n", SELFTEST_DEBT),
        ("map [code] on a [seen] routine", "pulseCoinCounter [code] steps it.\n", SELFTEST_DEBT),
        ("map [seen] on a [code] cell", "TAMPER_WITNESS 0xAD39 [seen] holds 0x68.\n", SELFTEST_DEBT),
        ("[code] routine off the debt list", "", "0xad39  witness\n"),
        ("promotion arrow on a [code] routine", "loc_0167 [code] -> [seen] runs.\n", SELFTEST_DEBT),
        ("unattached [guess]", "The bonus may repeat [guess].\n", SELFTEST_DEBT),
    ]
    for label, extra, debt in mutants:
        if not map_problems(SELFTEST_MAP + extra, SELFTEST_NAMES, files, debt):
            failures.append(f"CHECK C mutant not caught: {label}")
    # U1: an unobserved-admission in the body blocks; the same line in the legend or in §9 passes
    body = "## §2 The frame\nThe frame steps.\n## §9 What is still open\nA question.\n"
    for label, text, want in (
            ("U1 faithful zoned map", body, False),
            ("U1 body admission", body.replace("The frame steps.", "The frame steps. This has not been observed."), True),
            ("U1 body 'code reading only'", body.replace("The frame steps.", "The frame steps (code reading only)."), True),
            ("U1 §9 admission exempt", body.replace("A question.", "A question. This has not been observed."), False),
            ("U1 legend admission exempt", "- **`[code]`** -- not observed under MAME.\n" + body, False)):
        got = bool(map_problems(SELFTEST_MAP + text, SELFTEST_NAMES, files, SELFTEST_DEBT))
        if got != want:
            failures.append(f"CHECK C {label}: problems={got}, expected {want}")


def _selftest_repo(failures):
    """CHECKs A, B and C through check() against a throwaway repo: the hook's own path."""
    global REPO
    saved, tmp = REPO, tempfile.mkdtemp(prefix="understanding-gate-selftest-")

    def sh(*args):
        subprocess.run(["git", "-C", tmp, *args], check=True, capture_output=True)

    def write(rel, text):
        os.makedirs(os.path.dirname(os.path.join(tmp, rel)), exist_ok=True)
        with open(os.path.join(tmp, rel), "w") as fh:
            fh.write(text)

    def case(label, want):
        try:
            with contextlib.redirect_stderr(io.StringIO()):
                got = check()
        except Exception as e:  # a crash is a failure, not a pass
            failures.append(f"{label}: raised {type(e).__name__}: {e}")
            return
        if got != want:
            failures.append(f"{label}: exit {got}, expected {want}")

    def stage(label, want, edits):
        for rel, text in edits:
            write(rel, text)
        sh("add", "-A")
        case(label, want)

    def reset():
        sh("reset", "-q", "--hard", "HEAD")
        sh("clean", "-qfd")

    try:
        sh("init", "-q")
        sh("config", "user.email", "t@t")
        sh("config", "user.name", "t")
        for g in ("sg", "timeplt"):
            write(f"games/{g}/idiomatic/names.js", SELFTEST_NAMES)
            write(f"games/{g}/mechanisms.md", SELFTEST_MAP)
            write(f"games/{g}/grounding-debt.txt", SELFTEST_DEBT)
            for r in SELFTEST_ROUTINES:
                write(f"games/{g}/idiomatic/{r}.js", f"export function {r}() {{}}\n")
        sh("add", "-A")
        sh("commit", "-qm", "base")
        REPO = tmp

        stage("control: body edit, no rename", 0,
              [("games/sg/idiomatic/pulseCoinCounter.js", "export function pulseCoinCounter() { return 1; }\n")])
        reset()

        stage("CHECK A: a new names.js export without the map", 1,
              [("games/sg/idiomatic/names.js", SELFTEST_NAMES + "/** [seen] */\nexport const NEW_CELL = 0xa983;\n")])
        reset()

        sh("mv", "games/sg/idiomatic/flyAtSlowestSpeed.js", "games/sg/idiomatic/flyAtSlowSpeed.js")
        case("CHECK A+B: routine rename without the map", 1)
        stage("CHECK A: rename with the map threaded", 0,
              [("games/sg/mechanisms.md", SELFTEST_MAP.replace("flyAtSlowestSpeed", "flyAtSlowSpeed"))])
        reset()

        stage("CHECK B: map still cites a retired export", 1,
              [("games/sg/idiomatic/names.js", SELFTEST_NAMES.replace("COIN_COUNT", "COINS_TAKEN")),
               ("games/sg/mechanisms.md", SELFTEST_MAP + "Nothing else.\n")])
        stage("CHECK B: retired export threaded out", 0,
              [("games/sg/mechanisms.md", SELFTEST_MAP.replace("COIN_COUNT", "COINS_TAKEN"))])
        reset()

        stage("CHECK C: a game outside MAP_GAMES is not checked", 0,
              [("games/sg/mechanisms.md", SELFTEST_MAP + "The trap is loc_4f00 [code].\n")])
        reset()
        stage("CHECK C: enrolled map cites an invented [code] name", 1,
              [("games/timeplt/mechanisms.md", SELFTEST_MAP + "The trap is loc_4f00 [code].\n")])
        reset()
        stage("CHECK C: debt entry dropped under a map [code]", 1,
              [("games/timeplt/grounding-debt.txt", "0xad39  witness\n")])
        reset()
        stage("CHECK C: enrolled faithful map edit", 0,
              [("games/timeplt/mechanisms.md", SELFTEST_MAP + "COIN_COUNT [seen] wraps at a byte.\n")])
    finally:
        REPO = saved
        shutil.rmtree(tmp, ignore_errors=True)


def selftest():
    failures = []
    _selftest_map(failures)
    _selftest_repo(failures)
    if failures:
        sys.stderr.write("understanding_gate selftest: FAIL\n" + "".join(f"  {f}\n" for f in failures))
        return 1
    print("understanding_gate selftest: PASS (CHECK A, B and C mutants caught; each passing control passes)")
    return 0


def main():
    if len(sys.argv) >= 2 and sys.argv[1] == "selftest":
        return selftest()
    if REPO is None:
        sys.stderr.write("COMMIT BLOCKED — understanding gate: not inside a git work tree (failing closed).\n")
        return 1
    if len(sys.argv) < 2 or sys.argv[1] not in ("check", "map") or (
            sys.argv[1] == "map" and (len(sys.argv) != 4 or sys.argv[2] != "--game")):
        sys.stderr.write("usage: understanding_gate.py {check|map --game <game>|selftest}\n")
        return 2
    try:
        return map_report(sys.argv[3]) if sys.argv[1] == "map" else check()
    except GitError as e:
        sys.stderr.write(f"COMMIT BLOCKED — understanding gate git error (failing closed): {e}\n")
        return 1


if __name__ == "__main__":
    sys.exit(main())
