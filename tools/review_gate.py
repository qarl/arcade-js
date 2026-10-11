#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""Review gate — make an independent review a MECHANICAL PREREQUISITE for every commit.

The top-level rule: no commit lands until a SEPARATE reviewer has read exactly those
staged changes and recorded a PASS. Memory and docs cannot enforce that — an agent that
forgets ships unreviewed code. A git hook can: it refuses the commit.

How it works
------------
* ``diff_id`` = sha256 of the staged diff (``git diff --cached``, stable flags incl.
  ``--full-index`` so the id does not drift with ``core.abbrev``). It changes the instant
  the staged content changes, so a review is bound to the EXACT bytes that will be
  committed. Review v1 then edit to v2 and the token no longer matches — you are forced to
  re-review the change.
* A reviewer records ``.reviews/<diff_id>.json`` after reading the staged diff. The file holds
  ``{"diff_id": ..., "verdicts": [...]}`` — an APPEND-ONLY list, oldest first.
* The ``pre-commit`` hook runs ``check``: the LATEST verdict must be PASS, else exit 1.

Why the history is kept
-----------------------
``record`` used to overwrite, so a PASS recorded over an earlier FAIL erased it. That made an
honest re-adjudication (a reviewer shown new evidence, overturning itself on its own
reasoning) BYTE-IDENTICAL to a quiet erasure. It also left the "a confirmer's written
objection stops a promotion" rule with no artifact — nothing could show whether a unit had
ever been blocked. Appending costs nothing and keeps that answerable.

Files written by the older single-verdict version are still read correctly: a token holding a
bare ``{"verdict": ...}`` is treated as a one-element history. Nothing needed migrating, and
nothing was rewritten.

So the only path to a commit is: stage -> review (writes the token) -> commit.

FAIL CLOSED: any git error (not-a-repo, a failing ``git diff``) blocks the commit rather
than being mistaken for an empty diff. A gate that errors open is worthless.

Honest limits (stated, not hidden)
----------------------------------
``git commit --no-verify`` bypasses any local hook, and a misbehaving agent could forge a
token. History-rewrite paths (rebase -x / cherry-pick / revert / auto-merge) do not fire
pre-commit at all. This gate stops FORGETTING — the actual failure mode here — not a
determined bypass; hard enforcement needs a server-side check on push. reviewer != author
is recorded but not cryptographically enforced.

Subcommands
-----------
  id                     print the current staged diff_id
  check                  exit 0 iff a PASS token exists for the staged diff (the hook calls this)
  record --verdict PASS --reviewer WHO [--summary S]   write the token for the staged diff
  install                wire the repo to use hooks/ (git config core.hooksPath hooks)
  selftest               prove the append-only property against a throwaway repo
"""
import argparse
import contextlib
import hashlib
import io
import json
import os
import shutil
import re
import subprocess
import sys
import tempfile
import time
import types


class GitError(RuntimeError):
    """A git invocation failed — callers turn this into a BLOCK (fail closed)."""


def repo_root():
    """Absolute repo root, or raise GitError (so the gate fails closed outside a work tree)."""
    r = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True
    )
    if r.returncode != 0 or not r.stdout.strip():
        raise GitError(r.stderr.strip() or "not inside a git work tree")
    return r.stdout.strip()


def git(args):
    """Run git at REPO; raise GitError on any non-zero exit so callers fail CLOSED.

    The previous version discarded the return code and returned only stdout, so a failing
    `git diff --cached` came back as "" and read as "nothing to review -> allow" — a
    fail-OPEN. Raising here is what makes an errored diff block the commit.
    """
    r = subprocess.run(["git", *args], capture_output=True, text=True, cwd=REPO)
    if r.returncode != 0:
        raise GitError(f"`git {' '.join(args)}` failed (exit {r.returncode}): {r.stderr.strip()}")
    return r.stdout


def staged_diff():
    """The staged diff, flags pinned so the hash is reproducible between record and check.

    --no-color / --no-ext-diff strip environment-dependent formatting; -U0 drops context so
    unrelated nearby edits don't perturb the id; --full-index pins the index blob SHAs to
    full length so the id doesn't drift as the repo's object count grows (core.abbrev).
    """
    return git(["diff", "--cached", "--no-color", "--no-ext-diff", "-U0", "--full-index"])


def diff_id(diff):
    return hashlib.sha256(diff.encode()).hexdigest()


def token_path(did):
    return os.path.join(REVIEWS, did + ".json")


class TokenError(RuntimeError):
    """A token file exists but cannot be understood — callers turn this into a BLOCK."""


def load_history(path):
    """Every verdict recorded for this diff, oldest first.

    Accepts both shapes so no stored token ever had to be rewritten:
      * current  {"diff_id": ..., "verdicts": [ {...}, ... ]}
      * original {"diff_id": ..., "verdict": "PASS", ...}   -> a one-element history

    Raises TokenError on anything else. An unreadable or unrecognised token must BLOCK, never
    be mistaken for an absent one — "no verdict" and "a verdict I cannot parse" are different
    facts and only one of them is safe to treat as "not yet reviewed".
    """
    try:
        data = json.load(open(path))
    except (OSError, json.JSONDecodeError) as e:
        raise TokenError(f"{path} is unreadable ({e})")
    if isinstance(data, dict) and isinstance(data.get("verdicts"), list):
        if not data["verdicts"]:
            raise TokenError(f"{path} holds an empty verdict history")
        if not all(isinstance(v, dict) for v in data["verdicts"]):
            # Without this the caller's .get() raises AttributeError. It would still block —
            # main() has no bare-except — but as a traceback rather than a diagnosis, and a
            # gate that loses its reason at the moment of failing is half a gate.
            raise TokenError(f"{path} has a verdict entry that is not an object")
        return data["verdicts"]
    if isinstance(data, dict) and "verdict" in data:
        return [data]  # written by the pre-append-only version
    raise TokenError(f"{path} is not a recognised review token")


def cmd_id(_args):
    print(diff_id(staged_diff()))
    return 0


def cmd_check(_args):
    diff = staged_diff()  # GitError -> caught in main() -> BLOCK (fail closed)
    if not diff.strip():
        # Genuinely nothing staged with content to review (e.g. --allow-empty or a pure
        # merge/reword). No code to review, so do not block. (A git ERROR does not reach
        # here — staged_diff() raises, and main() blocks.)
        return 0
    did = diff_id(diff)
    path = token_path(did)
    if not os.path.exists(path):
        sys.stderr.write(
            "\nCOMMIT BLOCKED — these staged changes have not been reviewed.\n"
            f"  staged diff {did[:12]} has no review token.\n"
            "  An INDEPENDENT reviewer (not the author) must read the staged diff and record a PASS:\n"
            "    python3 tools/review_gate.py record --verdict PASS --reviewer <who> --summary <one line>\n"
            f"  Recording the review is what writes .reviews/{did[:12]}...json. Then commit.\n"
            "  Do NOT --no-verify around this — that is the exact rule it enforces.\n\n"
        )
        return 1
    try:
        history = load_history(path)
    except TokenError as e:
        sys.stderr.write(f"\nCOMMIT BLOCKED — {e}.\n\n")
        return 1
    latest = history[-1]
    if latest.get("verdict") != "PASS":
        sys.stderr.write(
            f"\nCOMMIT BLOCKED — the latest review verdict is {latest.get('verdict')!r}, "
            f"not PASS ({path}).\n\n"
        )
        return 1
    if len(history) > 1:
        # Say it out loud. A unit that was blocked and then cleared is a different history
        # from one that passed first time, and the difference should not be silent.
        earlier = ", ".join(f"{v.get('verdict')} by {v.get('reviewer')}" for v in history[:-1])
        print(f"review: PASS by {latest.get('reviewer')} — after {earlier}")
    return 0


_DONE_RE = re.compile(r"^games/[^/]+/DONE\.md$")
_AUDITOR_RE = re.compile(r"(?im)^\s*[-*]?\s*\**\s*Auditor\b[^:]*:\**:?\**\s*(.+)$")


def staged_done_auditors(files):
    """{DONE.md path: set of auditor identities} for every staged games/<g>/DONE.md. An identity is each
    backticked token on an Auditor line, plus the line's whole value, lower-cased (both are compared)."""
    out = {}
    for f in files:
        if not _DONE_RE.match(f):
            continue
        try:
            text = git(["show", f":0:{f}"])
        except GitError:
            continue  # a staged deletion has no Auditor to collide with
        ids = set()
        for m in _AUDITOR_RE.finditer(text):
            value = m.group(1).strip()
            ids.update(t.strip().lower() for t in re.findall(r"`([^`]+)`", value))
            ids.add(value.strip("*` ").lower())
        out[f] = {i for i in ids if i}
    return out


def cmd_record(args):
    diff = staged_diff()
    if not diff.strip():
        sys.stderr.write("nothing staged to review.\n")
        return 1
    did = diff_id(diff)
    os.makedirs(REVIEWS, exist_ok=True)
    files = git(["diff", "--cached", "--name-only"]).split()
    path = token_path(did)

    # The auditor who proposed a DONE.md cannot also be the reviewer who passes it: the review is the
    # independent read of the auditor's claim.
    who = args.reviewer.strip().lower()
    for done, auditors in staged_done_auditors(files).items():
        if who in auditors:
            sys.stderr.write(f"refusing to record: reviewer {args.reviewer!r} is the Auditor of the staged {done}; "
                             "a DONE.md needs a reviewer other than its auditor.\n")
            return 1

    # Read what is already on file BEFORE writing. An unparseable token blocks rather than
    # being silently replaced — overwriting a token we could not read would destroy exactly
    # the history this change exists to keep.
    history = []
    if os.path.exists(path):
        try:
            history = load_history(path)
        except TokenError as e:
            sys.stderr.write(f"refusing to record: {e}\n")
            return 1

    history.append({
        "diff_id": did,
        "verdict": args.verdict,
        "reviewer": args.reviewer,
        "summary": args.summary or "",
        "files": files,
        "recorded_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    })
    json.dump({"diff_id": did, "verdicts": history}, open(path, "w"), indent=2)

    print(f"recorded {args.verdict} for diff {did[:12]} ({len(files)} file(s)) by {args.reviewer}")
    if len(history) > 1:
        prior = history[-2]
        print(
            f"  this diff now has {len(history)} verdicts on file; the previous was "
            f"{prior.get('verdict')} by {prior.get('reviewer')} — both are kept."
        )
    return 0


def _selftest_case(tmp, label, fn, want, failures):
    """Run one case with the gate's chatter suppressed; record a mismatch rather than raising."""
    buf_out, buf_err = io.StringIO(), io.StringIO()
    try:
        with contextlib.redirect_stdout(buf_out), contextlib.redirect_stderr(buf_err):
            got = fn()
    except Exception as e:  # a crash is a failure, not a stack trace at the caller
        failures.append(f"{label}: raised {type(e).__name__}: {e}")
        return
    if got != want:
        failures.append(f"{label}: exit {got}, expected {want}")


def cmd_selftest(_args):
    """Prove the append-only property against a throwaway repo, not against .reviews.

    Every case here was first run by hand; this exists so the proof is repeatable. In
    particular the CONTROLS matter: a store that always says PASS would satisfy the
    history checks and be useless, so the no-token and latest-is-FAIL cases must block.
    """
    global REPO, REVIEWS
    saved = (REPO, REVIEWS)
    tmp = tempfile.mkdtemp(prefix="review-gate-selftest-")
    failures = []
    rec = lambda v, who: types.SimpleNamespace(verdict=v, reviewer=who, summary="selftest")
    try:
        for cmd in (["init", "-q", tmp], ["-C", tmp, "config", "user.email", "t@t"],
                    ["-C", tmp, "config", "user.name", "t"]):
            subprocess.run(["git", *cmd], check=True, capture_output=True)
        open(os.path.join(tmp, "f.txt"), "w").write("one\n")
        subprocess.run(["git", "-C", tmp, "add", "f.txt"], check=True, capture_output=True)
        subprocess.run(["git", "-C", tmp, "commit", "-qm", "i"], check=True, capture_output=True)
        open(os.path.join(tmp, "f.txt"), "a").write("two\n")
        subprocess.run(["git", "-C", tmp, "add", "f.txt"], check=True, capture_output=True)

        REPO, REVIEWS = tmp, os.path.join(tmp, ".reviews")
        did = diff_id(staged_diff())
        path = token_path(did)

        _selftest_case(tmp, "no token blocks", lambda: cmd_check(None), 1, failures)
        _selftest_case(tmp, "record FAIL", lambda: cmd_record(rec("FAIL", "a")), 0, failures)
        _selftest_case(tmp, "latest FAIL blocks", lambda: cmd_check(None), 1, failures)
        _selftest_case(tmp, "re-record PASS", lambda: cmd_record(rec("PASS", "a")), 0, failures)
        _selftest_case(tmp, "latest PASS allows", lambda: cmd_check(None), 0, failures)

        got = [v["verdict"] for v in load_history(path)]
        if got != ["FAIL", "PASS"]:
            failures.append(f"history lost: stored {got}, expected ['FAIL', 'PASS']")

        # A token written by the pre-append-only version must still be honoured, and
        # appending to it must not discard it.
        #
        # ★ BOTH legacy verdicts are exercised, and the FAIL case is the load-bearing one.
        # An earlier version of this selftest wrote only a legacy PASS and asserted "allows".
        # That branch then had no negative control: a mutant laundering every legacy token to
        # PASS made a legacy FAIL exit 0 — a fail-open — while this selftest stayed green.
        # A large share of the real store is FAIL, and those records are the only artifact
        # that a unit was ever blocked, so the branch that reads them must be shown able to
        # say NO, not merely able to say yes.
        json.dump({"diff_id": did, "verdict": "FAIL", "reviewer": "legacy", "files": []},
                  open(path, "w"), indent=2)
        _selftest_case(tmp, "legacy FAIL blocks", lambda: cmd_check(None), 1, failures)

        json.dump({"diff_id": did, "verdict": "PASS", "reviewer": "legacy", "files": []},
                  open(path, "w"), indent=2)
        _selftest_case(tmp, "legacy token honoured", lambda: cmd_check(None), 0, failures)
        _selftest_case(tmp, "append onto legacy", lambda: cmd_record(rec("FAIL", "b")), 0, failures)
        got = [v["verdict"] for v in load_history(path)]
        if got != ["PASS", "FAIL"]:
            failures.append(f"legacy verdict lost: stored {got}, expected ['PASS', 'FAIL']")
        _selftest_case(tmp, "latest FAIL blocks again", lambda: cmd_check(None), 1, failures)

        # A staged DONE.md: its Auditor may not record the review; anyone else may (control).
        os.makedirs(os.path.join(tmp, "games", "g"), exist_ok=True)
        open(os.path.join(tmp, "games", "g", "DONE.md"), "w").write(
            "# g DONE\n- **Auditor:** `aud-1` \u2014 a fresh adversarial agent.\n")
        subprocess.run(["git", "-C", tmp, "add", "games/g/DONE.md"], check=True, capture_output=True)
        _selftest_case(tmp, "DONE.md auditor as reviewer refused", lambda: cmd_record(rec("PASS", "aud-1")), 1, failures)
        _selftest_case(tmp, "DONE.md other reviewer recorded", lambda: cmd_record(rec("PASS", "rev-2")), 0, failures)
        subprocess.run(["git", "-C", tmp, "rm", "-q", "--cached", "games/g/DONE.md"], check=True, capture_output=True)
        path = token_path(diff_id(staged_diff()))

        # An unreadable token is not an absent one.
        open(path, "w").write("not json")
        _selftest_case(tmp, "corrupt token blocks", lambda: cmd_check(None), 1, failures)
        _selftest_case(tmp, "refuse to clobber corrupt", lambda: cmd_record(rec("PASS", "c")), 1, failures)
    finally:
        REPO, REVIEWS = saved
        shutil.rmtree(tmp, ignore_errors=True)

    if failures:
        for f in failures:
            print(f"  {f}", file=sys.stderr)
        print("review_gate selftest: FAIL", file=sys.stderr)
        return 1
    print("review_gate selftest: OK (append-only history, legacy tokens, fail-closed)")
    return 0


def cmd_install(_args):
    git(["config", "core.hooksPath", "hooks"])
    print("installed: core.hooksPath = hooks (pre-commit review gate active)")
    return 0


# REPO is resolved once at import; if we are not in a work tree it stays None and every
# subcommand fails closed via the guard in main().
try:
    REPO = repo_root()
except GitError:
    REPO = None
REVIEWS = os.path.join(REPO, ".reviews") if REPO else None


def main():
    p = argparse.ArgumentParser(description="Review gate — block commits lacking an independent review")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("id")
    sub.add_parser("check")
    sub.add_parser("install")
    sub.add_parser("selftest")
    r = sub.add_parser("record")
    r.add_argument("--verdict", required=True, choices=["PASS", "FAIL"])
    r.add_argument("--reviewer", required=True, help="who reviewed (agent id / name) — must not be the author")
    r.add_argument("--summary", help="one-line review summary")
    args = p.parse_args()
    if REPO is None:
        sys.stderr.write("COMMIT BLOCKED — review gate: not inside a git work tree (failing closed).\n")
        return 1
    try:
        return {"id": cmd_id, "check": cmd_check, "record": cmd_record,
                "install": cmd_install, "selftest": cmd_selftest}[args.cmd](args)
    except GitError as e:
        sys.stderr.write(f"COMMIT BLOCKED — review gate git error (failing closed): {e}\n")
        return 1


if __name__ == "__main__":
    sys.exit(main())
