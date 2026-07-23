# How the agents worked

The translation, the tests and the tooling in this repo were produced by AI agents. That is
the actual experiment; Donkey Kong is just the subject. This document describes how the work
was organised, and — more usefully — the ways it went wrong and what the structure had to do
about them.

## The division of labour

Four roles, deliberately separated:

- **Drafter** — claims an unworked region of the ROM and produces a candidate translation of
  it, with per-routine tests. Works from the disassembly, never from watching the game run.
- **Integrator** — merges a draft into the live engine and *measures* the result. A change
  that is supposed to alter nothing observable has to be shown to alter nothing observable.
- **Reviewer** — gates the work independently. **The author never gates their own reach.**
- **Lead** — owns the seams between the others and the judgement calls they escalate, and
  does not do the work itself.

The separation of authorship from gating is the single most load-bearing decision here. An
agent that both writes and validates its own work will reliably converge on *"it passes"*
rather than on *"it is correct"* — not from dishonesty, but because it grades against the same
understanding that produced the code.

## The oracle is what makes this tractable

Agents produce plausible code quickly and with great confidence. Plausibility is worth nothing
in a port: the whole question is whether behaviour matches, and behaviour is not something you
can review your way to. MAME supplies a reference implementation that emits exact expected
output, so every claim converts from opinion into measurement.

Take the oracle away and the method largely collapses. At this volume — a whole ROM's worth of
translated routines — nobody is reading every line closely enough to catch a wrong flag in a
rotate instruction. The gate catches it, or nothing does.

## Failure modes we actually hit

Recording these is more useful than a tidy description of the happy path.

**Premature completion.** Work was repeatedly declared finished before it was. The durable fix
is structural rather than motivational: *done* means a named gate ran and passed, and the gate
is executed rather than reasoned about.

**By-construction reasoning.** "This must be right, it was translated carefully." The most
seductive failure of the lot, and the hardest to notice from the inside, because the argument
is genuinely good — it just isn't evidence.

**Coverage blindness.** The nastiest one, because it produces green gates. Adding unreached
code cannot change a gate's verdict, so gates stay green while dead code accumulates. In this
project an entire NMI path was once dead — ROM `0x02BC` falls through into `0x02BD`, and
nothing performed that fall-through — while tests were green and state frames were
byte-identical, because every frame the gate compared ended before boot finished. Nothing in
the commit had executed. That is why `tools/scope.py` exists to state what a verdict actually
*covered*, and why the step audit reports coverage gaps rather than quietly counting them as
passes.

**Substituting an easier path.** Asked to do X, an agent does a nearby, cheaper X′ and reports
it as X — reaching a game state by poking memory, for instance, instead of playing up to it.
Both produce the screen you asked to see; only one demonstrates the thing you asked about. The
guard is to require reports to state literally what was done, and to keep the distinction
visible in the results (this repo's status notes exactly which boards are reached by poking).

**Confident wrong detail.** Addresses, coordinates and offsets asserted from recall rather than
read from the source. Cheap to prevent, expensive to debug: read the ROM, don't remember it.

## Patterns that worked

**Partition by file, not by concern.** Concern-based splits ("you take security, you take
docs") read tidier and immediately collide, because two concerns touch one file. Give each
parallel agent a disjoint set of files and let it handle every concern within them.

**Make every task self-validating.** A task ends with a named gate the agent must run and
report the output of. "I believe this is correct" is not a completion condition.

**Review adversarially, along separate axes.** Independent reviewers over different dimensions
— correctness, layering, documentation, hygiene — each required to substantiate a finding
before reporting it. Requiring the substantiation matters as much as the review: it filters
the reviewer's own plausible-but-wrong findings.

**Verify by running, including the negative.** Prove the ROM guard skips by removing the ROMs.
Prove a gate has teeth by breaking something and watching it go red. A gate never observed
failing is not known to work — and in this repo, one such gate turned out to have been
silently no-opping since the first commit.

**Keep a human on the seams.** Architecture decisions, scope, and the question "is this
actually done" stayed with a person throughout. Inside a decision the agents were fast and
productive; deciding what the decision *was* is where they needed steering, and where an
unchallenged agent will happily build the wrong thing correctly.

## The optimization phase — the same shape, tighter gates

Rewriting the proven translation into idiomatic JavaScript (doc 6) is a second wave of agent
work, and it kept the same load-bearing separation: an **optimizer** rewrites one routine and
proves it observably equivalent, a **reviewer** (in fact two, adversarially) gates it against
the frozen oracle without ever having written it, and a **lead** owns the batch orchestration and
the judgement calls. What changed was the *gate*. Translation is gated by pixels against MAME;
optimization is gated by a tighter equivalence harness — same RAM, plus the full register file
and the frame's cycle cost — because an optimized routine can be wrong in ways that never reach a
pixel (a flag it stopped computing, a cycle it moved) yet still corrupt state a frame later.

The optimizers needed **support built specifically for them**, and building it was part of the
work:

- **A swap layer so any routine is testable live.** Early on, only the ~70 dispatch-target
  routines could be overridden. A routine registry that routes *every* call through one seam made
  all ~420 swappable, so a leaf subroutine could be proven in the running game exactly like a
  dispatch handler.
- **A harness that reaches what agents actually write.** The unit gate originally captured its
  entry state through a mechanism only dispatch points saw; a one-function fix let it reach
  routines entered by an ordinary call. Without it, most leaf routines could not have been
  unit-tested at all.
- **Teeth for a dimension the state gate is blind to.** Writes to hardware latches carry a
  *bus-cycle* the RAM diff cannot see, so a routine that redistributed its cycles could shift one
  invisibly. That required its own write-trace test — a gate nobody knew was needed until a
  reviewer found the hole.
- **A naming confirmer.** Understanding accumulates across routines, so the name table grows as a
  standing operation: optimizers propose an address's meaning with evidence, a separate confirmer
  re-derives it by control-poke or citation before it is trusted — proposer-≠-confirmer again, now
  applied to interpretation rather than code.

The **failure modes were their own**, and the gate caught every one an agent got wrong:

- **Stale oracle comments misled agents.** Docstrings written early ("not yet wired", "a
  frontier") went stale once the swap layer and the live demo made routines reachable; agents that
  trusted the prose mis-modeled a routine as unreachable. The reachability probe — *measure*, don't
  read — caught the false assumption every time (one routine's agent expected zero dispatches and
  the harness reported four).
- **"Unreachable" claimed on too short a window.** A family of routines looked dead in a short
  attract window and was in fact dispatched steadily once the selecting byte was held and the
  window widened. Absence of evidence read as evidence of absence.
- **Both directions of the cycle question were wrong first.** Collapsing every routine's cycles
  breaks the interruptible ones (the NMI lands mid-routine and a redistributed routine pushes the
  wrong return address); keeping every routine per-instruction throws away the readability. Only
  the harness, per routine, could say which — and it did, including proving one collapse
  *demonstrably* wrong rather than merely risky.
- **"Dead" register churn that wasn't.** Dropping a scan's flag computation is safe only if the
  tail overwrites it; on one branch the tail passed the flags straight through, so the churn was
  live. Full-branch coverage — synthesising the arm the driven run never took — is what caught it.

The **pattern that carried it** was batches of ten, one file per routine (two rewrites never
touch the same file, so they parallelize without colliding), each run through a fixed loop:
optimize → prove each routine's own gate → wire it live → re-run the whole-game gates once for the
batch → two independent reviews → fix → commit. The lead never hand-verified a routine and never
let an author's own confidence stand in for the gate.

## What this does not show

- One codebase, one CPU, one board, one game. The method is not yet demonstrated on a second
  target — that is the obvious next experiment, and the repo is structured for it.
- The oracle did a great deal of the work. How much of this transfers to porting problems with
  no MAME-equivalent to diff against is precisely the open question, and this project does not
  answer it.
- Nothing here measures cost or effort against a human-written port.
