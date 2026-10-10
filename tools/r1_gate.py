#!/usr/bin/env python3
"""R1 gate — no two DECOMPILE commits without an UNDERSTANDING commit between them.

R1 [D] of the reviewer rules. This is the HARD ENFORCER. On 2026-08-09 the rule —
which lived only as a prose clause ("...one understanding pass between...") — was
drifted past three times: batches 1-3 ran decompile-only, two of them committed and
pushed before Karl caught it. A rule that only asks does not stick under autonomy;
a gate that exits 1 does. This converts R1 from a standing invariant (which drifts)
into an immediate signal at the moment of commit (which holds).

Called from hooks/commit-msg with the commit-message file. Exit 0 = allowed,
1 = R1 violation (commit blocked). Fails CLOSED: if history can't be read, it blocks.

    r1_gate.py <commit-msg-file>       # hook usage
    r1_gate.py --subject "<subject>"   # check one subject against real history
    r1_gate.py --selftest              # prove it discriminates (block AND allow)
"""
import re
import subprocess
import sys

DECOMPILE = re.compile(r"decompile|idiomatic batch|leaf routines", re.I)
UNDERSTANDING = re.compile(r"understanding|grounding", re.I)


def classify(subject):
    """A commit's role for R1. UNDERSTANDING wins if both match (an understanding
    commit satisfies R1 even if it also touches routines). Anything else is
    TRANSPARENT — it neither satisfies nor triggers R1."""
    if UNDERSTANDING.search(subject):
        return "understanding"
    if DECOMPILE.search(subject):
        return "decompile"
    return None


def verdict(subject, log_subjects):
    """log_subjects: prior commit subjects, HEAD-first (this commit not included).
    Returns 'allow' or 'block'."""
    if classify(subject) != "decompile":
        return "allow"  # only a decompile commit can violate R1
    for subj in log_subjects:  # newest first
        kind = classify(subj)
        if kind == "understanding":
            return "allow"   # understanding since the last decompile
        if kind == "decompile":
            return "block"   # last landmark was decompile, none understood since
    return "allow"  # first decompile ever


def _git_log_subjects():
    r = subprocess.run(["git", "log", "--format=%h %s", "-200"],
                       capture_output=True, text=True)
    if r.returncode != 0:
        # An empty repo (no commits yet) is NOT an error — it is the first-commit
        # case, which has no prior decompile and must be allowed. Only a genuine
        # git failure (HEAD exists but log broke) is an error worth failing closed on.
        head = subprocess.run(["git", "rev-parse", "--verify", "HEAD"],
                              capture_output=True, text=True)
        if head.returncode != 0:
            return []  # no commits -> no landmark -> verdict() allows
        raise RuntimeError(r.stderr.strip() or "git log failed")
    return [line.partition(" ")[2] for line in r.stdout.splitlines()]


def selftest():
    D = "timeplt: idiomatic batch-9 — leaf routines"
    U = "timeplt: an understanding pass on cluster 8"
    I = "hooks: tidy the pre-push arm"
    cases = [
        (D, [D, I],    "block"),  # decompile after decompile (infra between doesn't count)
        (D, [I, D, I], "block"),  # only infra between two decompiles -> still block
        (D, [U, D],    "allow"),  # understanding since last decompile
        (D, [I, U, D], "allow"),  # understanding present before the last decompile
        (D, [],        "allow"),  # first decompile ever
        (U, [D],       "allow"),  # understanding commit is always allowed
        (I, [D],       "allow"),  # infra commit is always allowed
    ]
    ok = True
    for subj, log, exp in cases:
        got = verdict(subj, log)
        tag = "OK" if got == exp else "FAIL"
        if got != exp:
            ok = False
        print(f"[{tag}] verdict(decompile={classify(subj)=='decompile'}, {len(log)} prior) "
              f"= {got}  expected {exp}")
    print("selftest:", "PASS" if ok else "FAIL")
    sys.exit(0 if ok else 1)


def main():
    args = sys.argv[1:]
    if args and args[0] == "--selftest":
        selftest()
        return
    if args and args[0] == "--subject":
        subject = args[1]
    elif args:
        subject = open(args[0]).readline().strip()
    else:
        print("r1_gate: no commit message given", file=sys.stderr)
        sys.exit(1)

    if classify(subject) != "decompile":
        sys.exit(0)  # R1 only governs decompile commits

    try:
        log_subjects = _git_log_subjects()
    except Exception as e:  # cannot read history -> fail closed
        print(f"R1 gate: could not read git history ({e}) — blocking to be safe.", file=sys.stderr)
        sys.exit(1)

    if verdict(subject, log_subjects) == "block":
        prev = next((s for s in log_subjects if classify(s) == "decompile"), "?")
        print("R1 VIOLATION — commit blocked.", file=sys.stderr)
        print("  R1 [D]: No two DECOMPILE COMMITS without an UNDERSTANDING COMMIT between them.", file=sys.stderr)
        print(f"  The previous landmark commit is a decompile ({prev[:60]}), with no", file=sys.stderr)
        print("  understanding-pass commit since. Land an understanding pass first.", file=sys.stderr)
        sys.exit(1)
    sys.exit(0)


if __name__ == "__main__":
    main()
