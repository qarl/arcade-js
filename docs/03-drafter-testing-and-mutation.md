# 3. Drafter testing & mutation

Translating a routine and *asserting* it's right are two different jobs. The process separates
them: a **drafter** translates a routine and ships it with the evidence that it works, and a
different reviewer integrates it. Author ≠ checker.

## What a drafter delivers per routine

For each ROM routine, the deliverable is not just the JavaScript. It is:

- The **byte/skeleton**: the exact ROM bytes and the instruction-level structure they decode to,
  so the translation can be checked against the disassembly rather than taken on faith.
- The **open questions and structure analysis**: the non-obvious decisions (is this jump a return?
  is this table 4 or 5 bytes per record? does this flag stay live?), stated explicitly, because
  those are where translations go wrong.
- A **drafted test**: a unit test that exercises the routine against ground truth — T-state charges,
  dispatch-table targets, fall-through, flag polarity — each assertion tied to a specific fact.
- A **mutation** (below).

## Mutation testing — proving the test has teeth

A test that passes tells you nothing unless you know it *can fail*. So every drafted test ships with
a **mutation**: a small, deliberate corruption of the routine (an anchor/replace patch — see
`tools/` and the mutation format) that the test is supposed to catch.

`tools/mutation-runner.py` runs the contract mechanically, per patch:

1. Baseline: the test **passes** on the correct code.
2. Apply the mutation. The test must now **fail** — verdict `CAUGHT`.
3. Revert. The test **passes** again.

A mutation the test fails to catch (`NOT_CAUGHT`) means the test is asleep — it asserts something,
but not the thing the mutation broke — and the drafter is pinged to strengthen it. The runner parses
the *executed* test names (not summary counts) so that "0 tests matched" can never masquerade as a
pass. This turns "I wrote a test" into "I proved the test detects the failure it claims to."
