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

## What this does not show

- One codebase, one CPU, one board, one game. The method is not yet demonstrated on a second
  target — that is the obvious next experiment, and the repo is structured for it.
- The oracle did a great deal of the work. How much of this transfers to porting problems with
  no MAME-equivalent to diff against is precisely the open question, and this project does not
  answer it.
- Nothing here measures cost or effort against a human-written port.
