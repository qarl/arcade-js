# How the agents worked

The translation, the tests, and the tooling in this repo are produced by AI agents. That is
the actual experiment; Donkey Kong is just the subject. This document describes how the work
is organised, and — more usefully — the ways it goes wrong and what the structure does about
them.

## The division of labour

Four roles, deliberately separated:

- **Drafter** — claims an unworked region of the ROM and produces a candidate translation of
  it, with per-routine tests. Works from the disassembly, never from watching the game run.
- **Integrator** — merges a draft into the live engine and *measures* the result. A change
  that is supposed to alter nothing observable has to be shown to alter nothing observable.
- **Reviewer** — gates the work independently. **The author never gates their own reach.**
  Beyond correctness, the reviewer checks the process-rules checklist in
  [`reviewer-rules.md`](reviewer-rules.md) (cadence, grounding-is-part-of-understanding,
  proposer≠confirmer, single-source, staging hygiene) — the rules that drift when only the lead
  watches them. Enforcement lives in those rules, not in bespoke gate scripts.
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

## Failure modes to design against

Recording these is more useful than a tidy description of the happy path.

**Premature completion.** Work is repeatedly declared finished before it is. The durable fix
is structural rather than motivational: *done* means a named gate ran and passed, and the gate
is executed rather than reasoned about.

**By-construction reasoning.** "This must be right, it was translated carefully." The most
seductive failure of the lot, and the hardest to notice from the inside, because the argument
is genuinely good — it just isn't evidence.

**Coverage blindness.** The nastiest one, because it produces green gates. Adding unreached
code cannot change a gate's verdict, so gates stay green while dead code accumulates. An entire
NMI path can sit dead — ROM `0x02BC` falls through into `0x02BD`, and nothing performs that
fall-through — while tests are green and state frames are byte-identical, because every frame
the gate compares ends before boot finishes and nothing in the commit has executed. That is
why `tools/scope.py` exists to state what a verdict actually *covered*. An exemption that
reclassifies a miss as benign is where the next bug will live.

**Substituting an easier path.** Asked to do X, an agent does a nearby, cheaper X′ and reports
it as X — reaching a game state by poking memory, for instance, instead of playing up to it.
Both produce the screen you asked to see; only one demonstrates the thing you asked about. The
guard is to require reports to state literally what was done, and to keep the distinction
visible in the results (the status notes record exactly which boards are reached by poking).

**Confident wrong detail.** Addresses, coordinates, and offsets asserted from recall rather
than read from the source. Cheap to prevent, expensive to debug: read the ROM, don't remember
it.

## Patterns that work

**Partition by file, not by concern.** Concern-based splits ("you take security, you take
docs") read tidier and immediately collide, because two concerns touch one file. Give each
parallel agent a disjoint set of files and let it handle every concern within them.

**Make every task self-validating.** A task ends with a named gate the agent must run and
report the output of. "I believe this is correct" is not a completion condition.

**Review adversarially, along separate axes.** Independent reviewers over different dimensions
— correctness, layering, documentation, hygiene — each required to substantiate a finding
before reporting it. Requiring the substantiation matters as much as the review: it filters the
reviewer's own plausible-but-wrong findings.

**Verify by running, including the negative.** Prove the ROM guard skips by removing the ROMs.
Prove a gate has teeth by breaking something and watching it go red. A gate never observed
failing is not known to work — and one such gate turned out to have been silently no-opping
since the first commit.

**Keep a human on the seams.** Architecture decisions, scope, and the question "is this actually
done" stay with a person throughout. Inside a decision the agents are fast and productive;
deciding what the decision *is* is where they need steering, and where an unchallenged agent will
happily build the wrong thing correctly.

## The idiomatic rewrite is a second wave, same discipline

Rewriting the faithful translation into idiomatic JavaScript (see
[idiomatic generation](idiomatic-generation.md)) is a second wave of agent work, and it
keeps the same load-bearing separation: an agent rewrites one routine and proves it observably
equivalent, a separate reviewer (in fact two, adversarially) gates it against the frozen oracle
without ever having written it, and the lead owns the batch orchestration and the judgement
calls. What differs is the gate — memory-equivalence against the oracle rather than pixels
against MAME — and the support it needs:

- **A swap seam so any routine is testable in isolation.** Every call routes through one seam,
  so any routine — a leaf subroutine as much as a dispatch target — can be captured and proven
  against the oracle, not only the dispatch handlers.
- **Reachability measured, not assumed.** Whether a routine is reached, and on which arms, is
  determined by instrumenting a run and counting dispatches — never by trusting a docstring. A
  short observation window reads absence of dispatches as "unreachable"; widening it, and holding
  the selecting state, is what separates genuinely dead code from code the window never reached.
- **A naming confirmer.** Understanding accumulates across routines, so the name table grows as
  a standing operation: one agent proposes an address's meaning with evidence, a separate
  confirmer re-derives it by control-poke or citation before it is trusted —
  proposer-≠-confirmer applied to interpretation rather than code.

The pattern that carries it is large batches fanned out aggressively — roughly forty to fifty
routines at a time, one file per routine (two rewrites never touch the
same file, so they parallelize without colliding), each run through a fixed loop: rewrite → prove
it memory-equivalent to the oracle (almost always in a gate of its own) → review independently → fix → commit. The lead never
hand-verifies a routine and never lets an author's own confidence stand in for the gate.

## What this does not show

- Five games on five boards now (`dkong` = Donkey Kong, `thepit` = The Pit, `timeplt` = Time
  Pilot, `frogger`, `pooyan`), but still one CPU family (Z80) and one era of arcade hardware. How far the method carries to a very different CPU,
  or to a non-arcade target, is still open.
- The oracle does a great deal of the work. How much of this transfers to porting problems with
  no MAME-equivalent to diff against is precisely the open question, and this project does not
  answer it.
- Nothing here measures cost or effort against a human-written port.
