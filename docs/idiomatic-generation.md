# Idiomatic generation — from the frozen lift to understood code

This turns the [translated](translation.md) lift into idiomatic JavaScript that a person can read,
held **memory-equivalent** to the oracle. It is one sentence:

> Register fidelity and cycle fidelity are **conservative proxies**. The only thing that has to be
> right is the memory the display reads. Reproduce *that* — plus the registers/flags a caller
> actually consumes — and the code is free to be ordinary JavaScript.

Everything here is the consequence of taking that seriously. Two activities interleave and neither
works alone: **decompilation** recovers correct structure, **grounding** recovers what it means.
Code has a hard ceiling — it cannot tell you which sprite is an enemy, what a cell means in play,
or what the game *is*. Those answers live in behaviour. So grounding is not a phase at the end; it
is the second face of the oracle, and it runs from day zero.

---

# Part I — The loop, concretely

## Day zero, before any routine is rewritten

1. **Stand up the MAME observation rig** — verified romset, per-frame RAM dump, poke/input harness.
   Build it *before* naming. If the rig is late-phase setup, grounding slides to the end and stops
   gating the picks it should, and a session gets lost to a false "I can't ground yet."
2. **Write `gameplay.md`** — the outside-in view from public sources only, deliberately blind to the
   ROM, so it can later adjudicate mechanics the code cannot settle.
3. **Behavioural grounding** — play the game and take notes. Objective, cast, win/lose, controls.
   Zero reverse-engineering required. Front-load it, or names get chosen at partial understanding
   and need a costly re-derivation later.
4. **Close the call graph** under the whole control-flow graph — not just `call` targets. A shared
   tail reached only by `jr`, or a computed-dispatch target, is otherwise silently omitted. Report
   "≥N, still closing," never "N of total," until a pass adds nothing new.
5. **Reachability sweep** — see *Triage the backlog first*, below. One MAME run; it re-plans
   everything.
6. **RAM naming pass** — front-loaded, because named memory is the single biggest legibility lever.
7. ★★ **TURN THE PIXEL GATE ON.** Before the first idiomatic module is written, the pixel gate must
   be running against pinned MAME and green, and it must stay running for the life of the idiomatic
   layer. **The pixel gate is a precondition for idiomatic work, not a capstone you reach later.**
   For a NEW game this is real work, not a switch: declare the game's suite in
   `tools/pixel_gate_required.py`, which is what makes `hooks/pre-commit` refuse an idiomatic
   commit whose pixels were never compared. Until you do, the gate refuses that game rather than
   passing it — an undeclared game is unevaluable, not clean.
   ★ **But know what it can and cannot see.** The idiomatic layer runs from the skeleton (on the generator engine),
   but a suite that renders the ORACLE cannot observe an idiomatic *render* regression — it sees one
   only once the game's idiomatic render path exists and the suite selects it (the `render.js
   --idiomatic` CLI switch for the gate; `manifest.runtime` `"idiomatic"` for the shipped worker).
   Getting the gate running from day zero is still right — it holds the oracle and the board layer to
   MAME while the idiomatic layer is being built, and it bites the idiomatic render the moment that
   path is wired. See [the pixel gate](pixel-gate.md).

## ★★ Why the pixel gate has to be on BEFORE the idiomatic layer, not after

Per-routine memory-equivalence and the assembled swap are the two gates the idiomatic loop runs all
day, and **neither one looks at a pixel.** They compare RAM outside the stack window and a declared
live-out. That is a fast, precise proxy — and it is a proxy.

What it cannot see is everything the machine expresses through *timing and the beam* rather than
through work RAM. No idiomatic module spends T-states, by design, so every rewrite is cheaper than
its frozen twin. Under the cycle-free engine the swap gate runs, that is harmless. Under the
cycle-driven engine a player actually runs, it moves the foreground phase, which moves where the
NMI interrupts the idle spin, which moves what the beam has drawn when it fires. **None of that
touches a byte the memory gates compare.** The DMA sub-frame raster position has no owner among
them at all — it is pixel-only.

So an idiomatic layer built with the pixel gate off can be *green on every gate it runs* and still
be wrong on the glass, and nothing will say so until someone finally runs it — by which point the
regression is buried under however many routines landed after it. **A proxy is only safe while the
thing it proxies for is being checked.**

The cost of turning it on late is not the run; it is the bisect. Many green routines and one pixel
diff is a search problem. One routine and one pixel diff is a bug report.

**`make verify` is not the pixel gate despite the name** — it is a disassembly decoder check, and it
defaults to `GAME=dkong`, so on any other game it does not even read your ROM.

## The batch loop: forty routines a batch, leaves-first, one commit

The unit of work is a **batch of at least forty routines, taken leaves-first and landed as a single
commit**. Forty is the floor — the same floor the translation pass and `batch_size_gate` share
(runbook §4) — so fan the batch aggressively across ~15 agents at three or four routines each
rather than retreating to tiny leaf batches. Each agent still holds its handful in view and the
per-commit reviewer re-derives every claim in the batch, so shared context across sibling routines
pays for itself without shrinking the batch below the floor.

**Leaves first is not a preference.** A caller decompiled while its callee is still a raw ROM
routine has to marshal the callee's register ABI by hand — an assembly leak that the equivalence
gate cannot see, because both call paths are memory-equivalent. Decompile the callee first into a
real signature and the marshalling dissolves into a named call.

**Batches alternate: DECOMPILE, then UNDERSTANDING.** Decompilation recovers correct,
memory-equivalent routines (leaves first, cycles and dead registers/flags dropped, gated against the
`loc_XXXX` lift with pinned PRNG and teeth). An **understanding pass** then makes the accumulated
routines *read* like the game. Keep the two separate — decompile is about correctness, understanding
is about meaning — and run understanding *after* and *across the whole set*, so it sees the layer
as a whole rather than one batch at a time. This separation
is not stylistic: `reviewer-rules.md` classifies every commit as one or the other, and R1 forbids two
DECOMPILE commits in a row with no UNDERSTANDING between them.

### ★ The proposals file belongs to the DECOMPILE batch, not to the promotion

R4 wants a name to appear in a proposals file and to be judged in a *separate* confirmer file, by a
different agent. That only works if the proposals are written when the routines are lifted. Backfill
them at promotion time and the ordering collapses: the confirmer has nothing to judge but the
registry `role` lines, and any routine those lines left unnamed gets its name invented by the
confirmer — who is then judging its own proposal, which is the one thing R4 exists to prevent.

So each DECOMPILE batch writes its proposals as it goes, and the promotion pass adds only the
confirmer's file beside it. If a batch reaches promotion with no proposals file, the honest repair
is to say so in the file you write, mark which names originated with the confirmer, and get a
DIFFERENT agent to confirm those.

### ★ While a review is in flight, NOTHING moves the index

`review_gate` binds a review token to the *exact* staged diff, so any change to the index silently
retargets a review already underway. The reviewer then reports that the id moved, and a round is
spent for a reason unrelated to the code it was reading. The failure is quiet in the direction that
matters: nothing errors, the token simply stops matching.

So: while a review is live, nobody stages — not an authoring agent, not the lead. Agents lift their
routines and stop; the lead stages one unit at a time and unstages anything an agent added. A fix
for a NO-PASS either waits for the verdict to be recorded, or goes back to the reviewer as an
explicit re-review naming the new id. It is never slipped underneath one.

★ **Note the rule names the HAZARD, not an actor, and that is deliberate.** Written as "an authoring
agent must never `git add`" it looks equivalent and is not: the lead is a different actor, and walks
straight through the hole while obeying the words. **A rule scoped to a role has a hole exactly where
the role changes hands.** The general form is worth carrying past this file — after an incident the
instinct is to name whoever caused it, which yields a rule that stops that incident and nothing
adjacent to it.

The same reasoning says **do not run a naming/rename pass while authoring agents are live.** Their
modules import their callees by filename; a rename lands under them and breaks imports mid-flight.
Collect the batch first, then rename.

For each DECOMPILE batch:

1. **Pick ~10 routines with no un-decompiled callees.** Re-derive the leaf set *each* batch by
   closing the call graph over the `m.call` targets in the current sources — a worklist computed
   once goes stale the moment a batch lands, and a static list is not closed under the call graph.
   Two counting traps: subtract against **transcription coverage** (which address ranges are
   already lifted), never against filenames — a routine is a range, not a file; and **an interior
   branch target is not an entry**, so do not dispatch an agent at one.
2. **Disassemble and understand each one.** Before forming any theory, take the four theory-free
   measurements (below): does it execute and where, what is its write-set, who calls it and what do
   they do with the result, what changes on screen after it runs.
3. **Ground anything load-bearing, in-loop.** If the batch is about to commit an identity that
   downstream work will trust and the code alone cannot settle, fire the experiment *now*.
4. **Write the four artifacts per routine** — module, equivalence test, `ROUTINES` entry, green
   gate. All four or the routine is not in the layer, and the third is the one that gets skipped:
   the registry entry is what DISPATCHES the module, and nothing goes red when it is missing (see
   *How a routine joins the layer*, below). If the routine calls an already-decompiled
   callee, **dissolve that `m.call` into a direct call here**, as part of this routine's work.
5. **Leave it `loc_<addr>`.** A DECOMPILE batch ships address names and nothing else — R11 is
   explicit that English names arrive ONLY through a confirmed understanding-pass promotion, with
   a proposer and a separate confirmer (R4) and the corroboration written into the `why` field
   (R5). Derive a name if the mechanism is clear, and park it as a *proposal* for that pass; do
   not put it in `names.js`. A name that one agent derived and no second agent challenged is the
   sprite-record trap with a batch's worth of downstream work about to trust it.
6. **Land the batch as a DECOMPILE commit**, reviewed — and **run the whole suite yourself
   first**. What this commit adds is the address-to-module wiring in `ROUTINES` *and*, as a
   separate registry, a `loc_<addr>` name constant in `names.js` for every data address the batch
   accesses (Part IV — the data-name registry is seeded from first access, ROM included). What
   waits for the understanding pass is the *promotion* of those placeholders to descriptive names,
   not their creation. A per-agent "green" self-report is not the gate; a later dissolve in the
   same batch can break an earlier agent's routine after it reported.

### Dissolving belongs to the CALLER's unit, not the callee's

**Dissolve an `m.call` when you write the caller, not when the callee lands.** A leaf — including a
shared helper with thirty callers — is a landable unit on its own. Its callers are still translated
oracle files, which are frozen and never edited, so nothing goes stale when it lands and there is
nothing to retrofit. Later, when a caller is itself decompiled, that batch replaces its `m.call`s to
already-decompiled callees with direct calls as part of its own work.

Strict bottom-up order is what makes this hold. Violate it — decompile a caller before its callee —
and you buy the retrofit instead: the moment the callee lands, every already-idiomatic caller's
`m.call(0xADDR)` is stale and the `no-stale-mcall` lint goes red. Dissolving a
*tail* `return m.call` changes the Z80 pc/SP/stack, which false-fails any caller test still written
to the **strict** pc/SP/whole-stack contract; each must then be migrated to memory-equivalence —
excluding the dead `[SP-8, SP)` stack scratch, keeping the RAM diff and the teeth, and re-proving
that the relaxed gate still catches a broken-RAM twin at a *real* cell rather than a stack-scratch
ghost. That is a whole unit of unplanned work, and leaves-first is what avoids it.

**A cycle is the third case, and it is not a violation.** A strongly-connected cluster has no
leaves-first order — every member calls another member. Land the whole cluster as ONE unit and
dissolve within it; the rule is unchanged, since you are still dissolving at each caller as you
write it. Where a cycle runs through a routine that never returns, the lint needs a standing
allowlist for those boundary addresses rather than a fix.

Two rules for when you do dissolve, at the caller:

- **Partition the caller files across agents so no two touch one file.**
- **The lint must resolve file-local `const NAME = 0x….` aliases, not just literal hex** — otherwise
  `m.call(ACTOR_UPDATE)` is a const-alias evasion that hides a stale call from a lint that only
  greps for `m.call(0x…)`.

**A callee that is a bare-return no-op module dissolves to nothing, and the module is deleted.** Some
`loc_<addr>` files are not routines at all — they are a range boundary the transcription turned into a
file: a label the ROM's own `jp`/`ret` lands on, whose whole body reads and writes nothing (the
*routine-is-a-range-not-a-filename* trap). Do not preserve the call. Inline it — a tail
`return callee(m)` becomes `return;`, a mid-body call is deleted — then delete the module, its
`ROUTINES` entry, and its `equivalence-<addr>.test.js`. The frozen `translated/` twin stays as the
oracle, and the address harmlessly falls back to it since nothing dispatches it. **A bare-return
idiomatic module should be forbidden by a gate**, the way `registry-coverage` forbids an undispatched
one — a rule no gate checks decays (see *A check that cannot fail*, above).

## Then the mechanisms file

**Every understanding pass finishes by rewriting `games/<game>/mechanisms.md` from scratch, in the
same landable unit as the renames.** Not editing it — rewriting it.

The first step of the rewrite is to **read `gameplay.md`** as the outside-in frame, then re-derive
the inside-out model from the *current* code and grounding, blind to the prior map. Regenerate the
routine and RAM tables from what the idiomatic layer and `names.js` actually contain now,
re-synthesize the subsystem prose, move newly-answered questions to a resolved note, sharpen the
still-open ones, and recount by measuring rather than by adjusting the old numbers.

Incremental edits accumulate exactly the drift that keeps biting: a count that lags, `loc_`
references that outlive their rename, rows naming old callees, an internally inconsistent
structure. A map that lags the code is the tell that a pass was left half-done — the names shipped
and the understanding never reached where the next agent reads it.

**Enforced, not advised:** `tools/understanding_gate.py` runs in the pre-commit hook and blocks any
commit that renames routines or changes `names.js` exports without staging `mechanisms.md`, or that
leaves a retired name anywhere in the map.

---

# Part II — Grounding

## Two halves, different dependencies

- **Behavioural** — the game as a player sees it. Needs only MAME and a verified romset. Day zero.
- **Structural** — attaching that behaviour to specific addresses and routines ("*this* cell is the
  completion gate"). Needs the memory map, so it threads through the decompile.

**Meaning rides on the map.** Poke-assisted grounding needs to know where to poke. With no map yet,
bootstrap with memory-diffing: play, snapshot RAM around an event, find the byte that changed
("which cell decrements when I die?" → the lives counter, with zero decompilation).

## Grounding GATES a load-bearing pick — in-loop, not deferred

When the decompile is about to commit an identity that (a) downstream work will trust and (b) the
code alone cannot settle — laser vs terrain-scroll, enemy vs ship, which axis is X — fire the
experiment *then* and let the result set the name.

Do **not** name it from code and let grounding upgrade it later. Low-stakes or code-decidable calls
defer freely; this gate is for the picks everything downstream leans on.

## ★ A check that cannot fail is worse than no check

Before quoting a check's output as a fact, ask what would make it print the other answer. If nothing
would, it is measuring the runtime rather than the artifact.

The registry's entries were once verified "sorted" with

```js
const k = Object.keys(ROUTINES).map(Number);
k.every((v, i) => i === 0 || k[i - 1] < v);   // true for ANY registry, however scrambled
```

But an object key written `0x2bde:` becomes an integer-like property, and `Object.keys` returns
integer-like keys in ascending numeric order **whatever order they appear in the source**. The
expression returns true for any registry, however scrambled.

Two things generalise. **To check a property of the SOURCE, parse the source** — a regex over the
file would have answered it correctly, and the script that inserted those entries minutes earlier
already did exactly that, so the right tool was in hand and the convenient one got used instead.
And **the same vacuity flavours that make a test hollow make a one-off check hollow**: asserting
something the language guarantees is the register-only flavour wearing different clothes. Gates get
attacked with substitution; ad-hoc checks usually get none, which is precisely why they should be
read with more suspicion, not less.

## The experiment discipline

Every semantic claim is an experiment, not an assertion:

1. **Hypothesis** — "the on-screen tank is the timer that kills you."
2. **Reach the state** — play to it, or poke known cells to jump there fast.
3. **Watch** — log RAM cells, read annotated frames.
4. **A/B with a negative control.** The control is what makes it proof. To test "is X an enemy?",
   force X active and overlap it onto the player (death) **and** run the identical setup with X far
   away (no death); the difference is the finding. A same-cell pin on a *dormant* actor fires
   nothing — a missing control produced an inconclusive death test once.
5. **Prefer a natural run.** The strongest evidence is captured end-to-end in normal play with zero
   pokes; pokes are an accelerator, not the goal.

Cross-check a frame reading against the validated renderer's own computation of the same sprite RAM
— an independent second "yes" that the pixels mean what you think.

## Theory → prediction → measurement

"Ground it before you name it" is impossible as stated: you cannot instrument a routine without
some idea of what to look at. Reading the code and forming a theory is unavoidable and fine. The
rule is what happens next: **the theory must yield a prediction about something observable, and you
check the prediction before the name goes in the file.** A theory that cannot state a prediction is
not ready to be a name, and the routine stays `loc_`.

The worked failure is DK's `0x2C` cluster — **the sprite-record trap**, referred to by that name
throughout these docs. "A routine walking a byte table to a `0x7F` terminator is
a string renderer" is a reasonable first theory — and it makes a sharp prediction: text in this ROM
goes to VRAM at `0x7400+`. The routine writes 4-byte sprite records at `0x6900` and never touches
`0x7400+`. One measurement kills it, and that measurement was available on day one. Instead the
theory became the name, the name became the neighbouring files' framing by imitation, and it spread
through the cluster's routines, their gates, and the `names.js` roles those gates cite back.

**What you can measure before any theory at all.** None of this needs to know what the routine is,
and all of it narrows the hypothesis space:

- **Does it execute, and where?** A read tap at the entry, attributed to board / level / substate.
  Separates "runs constantly on 25m" from "never runs in attract."
- **What is its write-set?** Clone the machine at each dispatch, run the routine, diff RAM.
  Theory-free — but read it against the board's memory map, because a bare region name misleads.
  The example above writes only work RAM and never DK's sprite RAM, which under a naive reading says
  "not a renderer"; `0x6900` is the DMA shadow buffer that gets blitted to sprite RAM. The write-set
  is the evidence; the memory map is what lets it mean anything.
- **Who calls it, and what does the caller do with the result?**
- **What changes on screen in the frames after it runs?**

Do these first and the theory you form afterwards is already constrained by evidence, rather than
being a guess that evidence must later be found to fit.

**The cost asymmetry is why this is worth the trouble.** Idiomatic *code* has an oracle: checked
against the frozen translation mechanically and for free on every push. Idiomatic *prose* has none —
"this arm can never emit `0x1B`" is checkable only by a human disassembling the ROM, per claim.
Producing the expensive-to-verify kind at the speed of the cheap kind is how a repair backlog gets
made.

## Triage the backlog FIRST: sweep reachability before deciding anything is blocked

Before a naming pass decides which routines are "hard," **measure which ones the ROM actually
executes.** Install a one-byte read tap at each unnamed entry, drive the game through every board,
level and difficulty you can poke to, and count hits, attributing each to the live game state.

Do this because the intuition is wrong.

Three rules fall out:

1. **"Unnamed" is not "unreachable."** Sort the backlog by hit count before planning. Reaching a
   routine is necessary to ground it, not sufficient — but a routine nobody has run is blocked for a
   different reason than one nobody has looked at, and the sweep tells you which you have.
2. **A not-reached list is an UPPER BOUND on dead code, never a measurement of it.** It describes
   the states your sweep drove, not the ROM. Report it as "not reached by this sweep," and narrow it
   by driving more states rather than by concluding.
3. **Corroborate a dead-code claim — and check the two methods answer the SAME question.** A
   not-reached-by-sweep finding and a from-code claim that a write is unobservable are different
   questions — one says the ROUTINE never runs, the other says a WRITE is never read — so agreement
   between them is not corroboration unless both answer the same question. **Two results pointing the
   same direction are not corroboration unless they answer the same question** — and when a claim has
   been wrong twice, the next correction is the one to distrust most.

### Three limits of the sweep method itself — all silent

`tools/reach_sweep.lua` is the game-agnostic implementation (`ADDRLIST`, `REACHOUT`, `CTXCELLS`, and
a `DRIVER` chunk that coins up and drives inputs). **Without a `DRIVER` it measures attract mode
only**, which is the single easiest way to produce a falsely large not-reached set. Two further
limits carry to any new game, and none raises an error:

- **A hit count is not a dispatch count for a routine that WAITS.** Where a routine spins on the
  raster or on any other poll, the program counter passes its entry region on every turn of the
  wait, and the tap counts each turn. The inflation is not marginal: an address measured at *zero*
  dispatches inside our own machine reported tens of thousands of PC hits on the real one, purely
  because it lies inside a busy spin and is never called at all in that run. Two agents pointed at
  the same question with different instruments produced confident and **opposite** orderings.
  When comparing two routines that both wait, the hit count settles nothing — fall back to static
  call sites and to the structure of the wait itself, and say which you used.
  ★ **Counting call sites needs BOTH forms, and is still a lower bound.** The mnemonic form
  (`grep -hoE "(call|jp|jr) ([a-z]+,)?0xADDR"` over `translated/`) misses an entry the caller reaches
  without ever writing a `call 0xADDR` mnemonic — loading the address into a register first, or
  PUSHING IT AS A RETURN ADDRESS and letting a dispatched arm's `ret` land on it. One address scored
  zero by this form while being a perfectly live entry, and it turned out to be the pushed kind, not
  the computed kind — so do not assume which mechanism a zero is hiding. The transcription form
  (`grep -hoE "m\.call\(0xADDR\)"`) misses tail jumps the transcription renders as something other
  than a call. Measured across several addresses the two disagree in BOTH directions, so take their
  union — and even that misses table dispatch entirely. A zero from either form alone means "look
  harder", never "not an entry"; where both are unsatisfying the honest write-up is "not
  established", not whichever number you happen to have.

- **Encrypted / decrypted-opcodes sets.** A program-space read tap counts executions only where the
  CPU fetches opcodes through that space. On a driver with a separate `AS_OPCODES` region the tap
  sees nothing and the sweep reports **every** routine as not-reached, silently. **Before trusting a
  sweep on a new game, tap a known-executing address and check the count is non-zero.**
- **The boot blind spot, which is self-inflicted.** The taps install on the first frame
  notification, so anything before that — the reset vector, boot-time setup — runs untapped and
  reads as 0 hits. This is a choice, not a 0.288 limitation: both `devices[':maincpu']
  .spaces['program']` and `install_read_tap` work at chunk top level (measured: a top-level install
  counts the reset vector at `0x0000` once; the lazy install counts it zero times). If you care
  about boot code, install at top level. Either way, never conclude boot code is dead from a 0-hit
  row.

Two operational notes: MAME 0.288 has no start or stop hook, so the sweep writes output
periodically rather than at the end — and **every subscription token must be retained in a global**,
or it is collected silently and the sweep measures nothing at all.

**Forcing PC to an entry is a different, weaker move.** Poking *state* makes the game dispatch the
routine itself with the rest of the machine coherent, so the screen is still evidence. Forcing the
program counter runs code in an incoherent machine: it yields the mechanism, which the code already
told you, and renders garbage, which grounds nothing. Reach for it only to confirm a mechanism on a
genuinely dead path — and note a dead routine is still nameable, by its mechanism, marked unreached.

## Rounds: persistence plus a completeness critic

Run grounding in **rounds**, and keep going while each round still lands a *correction*. Then spend
the effort once more on a **completeness-critic** round that asks "what is still unlooked-at?", and
stop only when it comes back dry.

State the **honest floor**: what is structurally unobservable and stays `[guess]` — a sound-command
mapping with no audio oracle, a cell dormant on every reachable path. Naming "we couldn't observe
this" is a result, not a gap.

## The MAME observation rig

Agent-driven, headless, reproducible:

- Capture with `-video none -aviwrite` in the **displayed** orientation (rotation applied, *not*
  `-norotate`) so frames match what a player sees.
- A per-frame Lua notifier logs cells and can poke state or drive inputs. **Retain EVERY
  subscription token in a global** — the notifier and every write/read tap. A discarded token is
  silently garbage-collected mid-run and the tap stops firing, so the log flatlines partway through,
  which reads as *the game stalled* when it is running fine. Suspect an unheld **tap**
  before the notifier, and cross-check any "it stopped" reading against a GC-immune signal —
  `screens:at(1):frame_number()` is a register read, not a subscription, and never lies.
- Build a **properly-named, verified romset first**; a loose chip dump lacks the `.icNN` filenames
  `-verifyroms` needs.
- **Verify hardware citations against the actual MAME source**, never a web summary.

## What grounding feeds

`[seen]` facts flow into the **names** and into `mechanisms.md`. Grounding also **extends the pixel
gate** into deep gameplay: the same pokes drive the engine to states attract never reaches, which
can then be pixel-validated.

---

# Part III — Correctness

## Why the proxies are safe to drop

The registers, flags and cycles a routine leaves behind matter only if something downstream *reads*
them before they are overwritten. A dead value never reaches pixels.

- **Registers, flags and the stack are droppable.** A routine can have its entire register dance
  deleted and its whole-machine RAM trace stays byte-exact across every dispatch. Corrupting a
  register on a naturally-run path is *not* caught by the whole-machine gate precisely when the
  register is dead; when it is live, the corruption propagates into memory and the gate catches it
  for free.

  ★ **But a live register live-out is invisible to the unit gate, and that is not theoretical.** The
  unit gate compares memory. A routine whose product is left in a register can be entirely wrong and
  still pass it, every twin, and a real corpus — one such rewrite dropped `HL`, which its caller
  loops on, and wiring it hung the game while its own gate stayed green. So a module whose live-out IS a
  register or flag needs an arm that actually checks it.

  ★ And the trigger cannot be the module's own `LIVE-OUT:` line. That rewrite declared a MEMORY
  live-out — **the wrong declaration was the defect**, so a rule keyed on the declaration cannot fire
  on the case that motivates it. The check has to compare registers against the oracle regardless of
  what the file claims. And note the order this actually happened in, because it is the lesson: the
  bug was found by WIRING the routine and running a driven tape until the machine hung, diagnosed by
  reading the caller, and only then confirmed by a register probe built afterwards, with that very
  routine as its positive control — so the register comparison has to be STANDING, not reached for
  after a hang. Nor does the whole-machine gate stand in for
  it: attract ran clean, and a routine absent from `ROUTINES` is never dispatched there at all.

- **The one stack exception, and its three conditions.** The idiomatic layer models no stack.
  **Exception: when a routine transfers to a STILL-FROZEN callee that POPS a slot the caller is
  expected to have supplied, the idiomatic caller must park that slot.** This is not stack
  modelling — it is satisfying the calling interface of a routine that has not been lifted yet. It
  is temporary debt BY CONSTRUCTION: when that tail is lifted and dissolved, the push must go with
  it. Three conditions, all required: (1) the drift is MEASURED, not assumed — show the SP error per
  dispatch without it; (2) the gate ASSERTS the SP property, so removing or breaking it fails
  loudly; (3) the file says which tail it is coupled to, so the debt is discoverable when that tail
  lands.

  The debt really does liquidate: a routine reaching a tail that had already been lifted needed no
  park at all. And note what the exception does NOT cover — a routine whose ROM form ends by
  transferring into a frozen callee reaches it through a dispatch that runs that callee *including
  its own return*, so the seam must not supply a second one. That case is measured at the seam
  rather than parked here.
- **Cycles are droppable, under two conditions.** A frame-stepped engine that fires the vblank NMI
  at the main loop's natural poll yield produces per-frame RAM identical to a cycle-accurate engine,
  with the PRNG pinned on both sides. The conditions are real requirements: keep the PRNG pinned for
  validation, and fire the NMI at the vblank-poll yield — the real machine only accepts it when the
  main loop is idling, so the handler always runs against quiescent work.
- **The lift plus the RAM names carry the decompile on their own.** A routine can be hand-decompiled
  from the lift and `names.js` alone, with no purpose-prose, and its meaning recovered. That is the
  argument for front-loading the RAM-naming pass and keeping the names honest.

The one thing cycles still feed that this does not remove is **DMA sub-frame raster position** — a
pixel-only effect that never touches RAM.

## The fidelity contract

Per routine, the gate is **memory-equivalence, not byte-exactness**:

- Compare RAM (minus stack scratch) + `pc` + `SP` + the routine's *declared live-out* against the
  `loc_XXXX` lift. **Never** the full register file, **never** cycles.
- Determine live-out honestly by reading the exit successors. For most routines it is memory only.
- The PRNG is entropy-pinned so runs are deterministic.
- **A windowed stack exclusion is not expressible in the gate's return value.** The frozen routine
  pushes and the rewrite does not, so dead scratch differs — but the diff helper reports only the
  FIRST differing byte, so it can never say "differs only inside the window". A push-bearing routine
  needs its own full masked diff. Do not over-specify the window either: where the pushed byte
  already held its own value only one byte differs, and on an early exit none does.
- **Pick a batch by CALL TARGETS, not by execution count.** A program-counter-gated reachability
  tap cannot tell a routine entry from a loop head — a raster wait re-branching to its own address
  reported tens of thousands of executions for an interior block that is dispatched zero times.
  Intersect the hot list with addresses something actually calls.
- Every gate carries **teeth** — a deliberately-broken twin it must catch — or it proves nothing.
- Validate by **unit-capture at real dispatches**, plus a **reachability sweep** over natural
  dispatches, plus **crafted identical-both-sides entries** for arms attract never reaches.

Over the whole game the check stays the pinned-MAME pixel gate ([pixel-gate.md](pixel-gate.md)). Per-routine memory-equivalence
is the fast local proxy; MAME pixels are the falsifiable ground truth. **That gate runs from day
zero, not at the end** — see item 7 above and [the pixel gate](pixel-gate.md). Calling it the
capstone is how it came to be left off for a whole day of batches.

### Which gate owns which property — including the ones nothing owns

| property | owner | notes |
|---|---|---|
| RAM outside the stack window | unit gate **and** assembled-swap | the primary contract |
| the routine's declared live-out | unit gate | derive it from the ORACLE, never from the module's own header |
| `pc` and `SP` | unit gate | `SP` must return to its seat |
| stack scratch below the seated `SP` | **nobody, deliberately** | masked by `manifest.convergence.stateExclude` |
| the full register file | **nobody, deliberately** | the contract says "never the full register file" |
| **T-state cost** | **★ NOBODY, deliberately** | see below |
| DMA sub-frame raster position | nobody | pixel-only, never touches RAM |

★ **A property with no owner is fine. A property with no owner and NO RECORD of being unowned is a
trap**, because the next person to measure it reads a real, reproducible, meaningless difference and
reasonably concludes something is broken.

**T-states, the one that bit us.** No idiomatic module calls `m.step`/`m.tick` — not one, by design
— so every rewrite spends fewer T-states than its frozen twin. That is intended and harmless under the
cycle-free engine the assembled-swap GATE runs, which fires the vblank NMI on reaching a poll PC —
and that engine is a test seam, not what the player runs. It is NOT harmless on the cycle-driven
engine, where the missing T-states shift the foreground phase, the NMI interrupts
the idle spin at a different instruction, and its pushed PC and `push af` land at a different stack
depth. Those bytes are popped before sampling and survive only as residue in the masked-out stack
window — invisible to every gate we ship, and glaring to any hand-written probe that forgets the
mask. See R23.

★ **"Derive the live-out from the ORACLE, never from the module's own header"** is in the table
because the reverse has shipped. A gate whose `EXCLUDED` set was written to match its module rather
than the oracle it compares against does not merely have a hole — it **asserts the divergence**, so
it is green on a broken module and would go RED on the correct one. A gate you must edit in order to
accept correct code is inverted, and the next person to fix the module will read the red as evidence
their fix is wrong.

## Testing a routine without running the game — capture, clone, replay

The gate needs realistic *inputs*: the exact state a routine is really called with. Constructing a
valid one by hand is painful and error-prone — you build unrealistic states and miss the ones that
matter. So inputs are **captured**, not constructed:

1. **Run the real machine** — boot, then a couple thousand frames of attract or driven input.
2. **Hook the routine's address in the dispatch registry.** A wrapper does `m.clone()` — a deep copy
   of the entire machine — then lets the real routine run so the game continues undisturbed. Each
   snapshot is one real captured dispatch.
3. **Collect hundreds.**
4. **Replay each in isolation.** Clone twice, run oracle on one and candidate on the other, diff on
   the contract above. Identical across every captured dispatch → the rewrite reproduces the oracle
   on every state the game really produces.

Why capture beats construct: **realism** (real state combinations, not synthetic guesses), **no
guessing** (the game mints valid in-distribution inputs for free), **coverage**, and **isolation
with a fair start** (both sides get byte-identical input, so any divergence is the rewrite's fault).

For arms the real run never reaches, take a real captured state and poke the *one* variable that
forces the unhit path, identically on both sides — a **crafted entry**: a real state with a surgical
nudge, not a fabrication.

Helpers live in `core/equivalence.js`; the per-routine `capture*` functions in each
`equivalence-<addr>.test.js`.

## Entropy pinning — keeping validation deterministic

The one channel that does not confine itself to dead memory is the RNG, and because this method
drops the cycle model, a timing-seeded RNG *does* fork under validation unless pinned. Pinning is
the standard **test-only** technique that keeps a cycle-free routine's validation deterministic.

Donkey Kong seeds randomness from timing: each vblank mixes the frame counter and a spin count that
is a pure function of how many cycles the frame consumed. A correct collapse preserves each
routine's total, so the spin count and PRNG stay identical — **total-preservation is what keeps the
RNG out of the way.** A wrong total reseeds the PRNG, and unlike a stack byte a wrong random draw
does not wash out; it compounds. The RNG is the one place a timing error is permanent.

**The catch makes this a tool, not a shipping path.** Pinning changes the game's actual behaviour
versus a real cabinet, so it has replaced part of the oracle and forfeited falsifiability. Use it as
a **diagnostic**: pin both sides and see whether a stubborn divergence vanishes, which cleanly
separates a timing/RNG bug from a logic bug — then unpin and fix the timing. **The shipped game
never pins.**

**Discovery is automatic.** Diff attract-mode work RAM between the two engines per frame: exactly
the entropy set forks, and the tell is that it forks *while the interrupt counter stays
byte-identical* — the interrupt counter is the synced twin.

**What the pin does.** It makes the RNG working set read a deterministic 0 on both engines: drop
writes to the seed so it keeps its boot value (killing its single writer, the once-per-frame mix
routine), and point the spin counter's direct readers at the pinned seed. Redirecting the *readers*
sidesteps having to find every writer of the spin counter, and avoids depending on the interrupt
counter, which can carry ±1 cutscene jitter from the DMA artifact.

**★ The ROM patches must be cycle-neutral** — operand-only rewrites, never a NOP that changes an
instruction's length. NOP-ing the `inc` instead of retargeting it would shift frame timing and make
the diff *worse*.

**Realized on each side, from one config.** `manifest.entropyPin` declares it once:

| field | meaning |
|---|---|
| `seedBytes` | the seed address(es); the JS seam **drops writes** to each |
| `redirectReads` | `[{from: spin, to: seed}]`; a read of `from` returns `to`'s value instead |
| `romPatches` | `[{at, to}]` cycle-neutral operand rewrites for MAME — the seed store's target moved to a ROM address so the write is ignored, and each spin read's address moved to the seed |

`core/entropy-pin.js` `installEntropyPin` wraps the JS `mem` seam (`emit.js --pin-entropy`);
`games/<game>/tools/lua/pin_entropy.lua` applies the mirror ROM patches on MAME
(`mame_golden.py --pin-entropy "<spec>"`, the spec rendered by `entropyPinRomSpec`). Both sides
express the *same* intent twice, deliberately — so they can be checked against each other.

**Adding a new game:** attract-diff to find the spin counter (it forks next to a synced counter) and
the seed its mix routine writes; fill the three fields above; verify the seed goes byte-identical in
attract with the pin, then that a gameplay tape converges to the game's residual floor.

**Validate a pinned run with a convergent / align-tolerant diff, not a per-frame byte diff.** With
the pin on, RNG-driven divergence is gone, and what remains is whatever residual the game's own
hardware artifacts leave — for DK, the Kong-climb DMA phase, which no RNG work removes. Measure that
residual as a trend that reconverges rather than demanding equality at every frame.

**When the coupling is harder.** If a game samples its RNG from a free-running counter on *every
read*, or couples it to beam position or analog noise, no converge/diverge gate can save it. The
fallback is to **replace the timing-seeded RNG with a deterministic generator installed identically
on both sides** — a ROM patch or memory hook on MAME, a matching `mem`-seam hook on the port, seeded
identically at reset. With the stream pinned, cycle differences can no longer move it and
equivalence again isolates real logic bugs.

---

# Part IV — Output conventions

- **Direct function calls.** No `m.call`/address registry, and no `push16`/stack modelling **except
  the one measured case above** — a transfer to a still-frozen callee that pops a slot the caller
  must supply, under its three conditions. Everywhere else the Z80 stack
  becomes the JS call stack. Computed dispatch → a table of function references. The caller-skip
  idiom (`inc sp; inc sp; ret`) → a boolean return plus `if (!callee(m)) return;`.
  **Before you write `m.call(0xADDR)`, check whether that callee is already decompiled.** A stale
  `regs.a = 5; m.call(0x4ca5)` to an already-decompiled `enqueueSoundCommand` is a marshalling leak
  the equivalence gate does **not** catch — both paths are memory-equivalent — so it survives to the
  reviewer, who must reject it.
- **Memory access is indexed:** `mem8[ADDR]` / `mem16[ADDR]`, never `mem.read8`/`write8`. Pure sugar
  over the same accessors, so they wrap and diff identically. `ADDR` is **always a name from
  `names.js`** — a `loc_<addr>` placeholder until the naming pass promotes it, exactly as an
  un-decompiled routine is `loc_<addr>`. Neither a bare `mem8[0x….]` nor a routine-local
  `const NAME = 0x….` survives — both are unnamed data, the same legibility hole as an unnamed
  register, and both hide the address from the registry that is meant to list it. `names.js` is the
  **worklist**: a `loc_<addr>` entry is an address still needing a name, a descriptive name is one
  that earned it — so populate it with a `loc_<addr>` for every accessed address from first access,
  and the naming pass draws its work from there.
- **Every region, ROM included.** The old pass named RAM and silently dropped reads of ROM tables and
  constants, which is why raw ROM addresses survive; the region is no excuse — a ROM constant is as
  nameable as a work-RAM cell. To find them, trace each `mem8[]`/`mem16[]` base back to its source; a
  base born from a raw `= 0x….` is an address wherever the literal hides (a local `const`, the origin
  of a computed offset). A name is earned the way a routine's is — blind convergence, a confirmer
  (Part V) — so a name one agent assigned locally is only a *proposal*: it enters as `loc_<addr>` and
  must pass the naming pass before it is trusted. The namespace is shared with routines on purpose: an
  address is a routine OR a data cell, never both, so a `loc_<addr>` collision flags a location read
  *and* jumped to — surface it, do not hide it.
- **Name locals by meaning, never by register.** A local that survives from a Z80 register keeps the
  register's *value*, not its name: `const b = OBJ_X + 3` is `probeX`. Single-letter locals are the
  variable-level version of the assembly-comment smell, and the understanding pass's variable naming
  covers locals too.
- **Bottom-up.** Decompile callees before callers.
- **Naming.** Uniform `loc_<addr>` is the baseline. Drop the `sub_`/`entry_`/`handler_`/`arm_` prefix
  zoo — pseudo-semantics applied ad hoc. This holds **even when the frozen oracle carries a zoo
  name**: never mirror the oracle's cute filename into the idiomatic file. Promote to English only
  where the meaning is earned; the address lives in the registry key, never in the identifier.
- **A claim budget per header.** Default shape: what the routine does, the cells it reads and writes,
  its `LIVE-OUT:`, and the one derivation justifying its name **drawn from this file's own body**.
  Evidence from outside — a caller's use, a sibling, a write-set diff — goes in the `ROUTINES`
  entry's `why` field. Where the evidence stops, **say so in the file**; a named open question is
  worth more than a confident guess and costs nothing to verify.
- **Name by EFFECT, not internal mechanism — the verb is what the output causes.** Trace every value
  the routine writes to the last thing that consumes it, and ask what that consumer *does* as a
  result. If a live-out drives an action, the verb is `steer`/`play`/`spawn`/`advance`, never
  `classify`/`compute`/`check`/`detect`. Tell: if the output is read *in place of* another input — a
  routine feeding the movement dispatcher where the joystick normally goes — the routine *generates*
  that input.
- **Verify an action-driving name by OBSERVATION.** Write a short trace that runs a real session and
  logs the routine's output *and the downstream effect*, then confirm the name matches what you see.
  It is ~30 lines the agent writes itself, so naming is checkable at scale.
- **Disprove the existing name; ignore rename cost.** In an understanding pass, re-derive the name as
  if the routine were an unnamed `loc_` — the current name is a hypothesis to break, not a default to
  defend. Rename cost is never a reason to keep a name.
- **Honest signatures by default.** Register live-ins become named parameters, live-outs become
  returns, a routine that only maps inputs to outputs becomes a pure function. Keep register-passing
  only at a genuine oracle boundary.
- **Extremely limited comments until understanding is done.** While routines are still `loc_` and
  addresses bare, understanding is in flux — comment only what correctness needs, no walk-throughs.
  The full explanatory pass waits until as many routines and addresses are named as possible.
- **Comments describe behaviour, not the assembly it came from.** No register names, no mnemonics, no
  "the Z80 does X." Name methods directly — "the entropy pin", "the caller-skip idiom" — never a doc
  number or `.md` path; citations rot.
- **Comments may not exceed HALF a file's code lines.** Enforced by `tools/comment_gate.py` in the
  pre-commit hook, so it fails on your machine before a reviewer sees it. When it trips, **cut the
  prose — do not raise the cap.** The cap exists because prose that outgrows its code becomes a
  second account of the program that no gate checks: a renderer header here asserted the file was
  byte-exact against MAME while a swapped tile-flip bit sat twenty lines below it.

  **Scope and counting.** `.js`, `.mjs`, `.py` and `.lua` under `boards/ games/ tools/ core/ web/`.
  A line carrying code *and* a trailing comment counts as **both**, so a trailing mnemonic in
  `translated/` is a comment — it restates the line beside it, and the remedy when it trips the cap
  is to delete it. Nothing is exempt by kind; one file is exempt by **position**,
  `games/<game>/idiomatic/names.js`, whose comments are each entry's own content. Shell stays out
  deliberately: a hand-written scanner with nothing to check it against was measured wrong.

  **★ The rule is WHOLE-FILE, so an over-cap file is FROZEN against every edit.** There is no delta
  awareness — a commit *removing* fifty comment lines from an over-cap file blocks exactly as one
  adding a line does. The consequence is procedural: when a one-line correction lands on a file
  already over, bringing that file under the cap becomes a **prerequisite unit, sequenced first and
  reviewed on its own**. Do not park the correction in the working tree meanwhile — a parked edit
  makes a tree-wide grep report the fix as already made, and it is the state that most tempts a
  `--no-verify`.

  **A third outcome: the gate can refuse to judge.** `/` in JavaScript is either division or the
  start of a regex literal, and after `)`, `]` or `}` no scanner can tell which. Rather than guess,
  the file is scanned both ways; if the readings disagree about which lines are comments, the commit
  is BLOCKED with **"cannot lex"** and no verdict is given. Rewrite the line — name the regex, or
  space out the division. This is not a judgement about your prose.

  Only the hook's **staged** view is inspected, so an unswept file blocks nothing until it is next
  touched. **Migration is therefore per game, and `scan` is what says so:** until
  `python3 tools/comment_gate.py scan games/<game>` is green, do not read an existing header in that
  game as an example of these rules.

  And note what this section does not do — quote a count. `scan` prints violations, not totals.
  **Do not write a count of the tree into prose.** It is true when written, false after the next
  file is cleaned, and unfalsifiable to a later reader. If you need the number, run the tool; it
  expires the moment you paste it.
- **A comment in `idiomatic/` describes THIS FILE, and nothing else. Ever.** Not the ROM, not MAME,
  not the oracle, not a sibling, not a test, not a doc, not a to-do. Enforced by the same gate,
  because it tests REFERENCE rather than truth, which a script can decide. Exempt: `translated/**`
  (the address is its identity), `names.js` (the registry *is* the cross-file map), and
  `idiomatic/**/test/**` (a test cannot describe itself without naming its subject).
  Why absolute rather than taste: **a cross-file claim in a routine header is a cache.** The fact
  lives elsewhere, nothing updates the copy, and it goes stale the moment understanding improves
  anywhere else — across hundreds of files, once per pass, forever. Delete the cache and the
  invalidation step disappears.
- **Numbers are base-10.** Reserve hex for an irreducible bit operation. Most `& 0xff` is a Z80
  width artifact, not behaviour — the register and memory models already truncate. Where a wrap *is*
  load-bearing use `u8(x)`/`u16(x)`, never `% 256`, which is not even a correct 8-bit wrap.

## File format & directory layout

Validated output lives in `games/<game>/idiomatic/`, one module per routine. The frozen oracle stays
in `games/<game>/translated/`. RAM names live in `games/<game>/idiomatic/names.js`.

```js
// SPDX-License-Identifier: GPL-3.0-only
/**
 * <name> — <one-line role>.
 *
 * <what the routine does, in terms a reader of THIS file can check>
 * LIVE-OUT: <memory-only | + what it returns>.
 */
```

No `ROM 0x<addr>` tag, no `Memory-equivalent to …`, no `GATE:`, no `NAMES:` — each names something
outside the file, and each has a home a machine can keep honest:

| displaced from the header | goes to |
|---|---|
| `ROM 0x<addr>` tag | the `ROUTINES` registry key |
| `GATE:` / `Memory-equivalent to …` | the test file's own header, where it is file-local |
| `NAMES:` | the import list, which already states it |
| evidence justifying a promoted name | the `ROUTINES` entry's `why` field |
| a grounding finding | `mechanisms.md`, the one document whose job is cross-file facts |

The test header carries the gate, because a test cannot describe itself without naming its subject:

```js
/**
 * <subject> — memory-equivalent to the frozen oracle at ROM 0x<addr>.
 * GATE:  <strict | convergent | crafted-entry>; <what it actually exercises, holes stated>.
 */
```

## How a routine joins the layer — it is not done until it is DISPATCHED

Land the module; land `idiomatic/test/equivalence-<addr>.test.js`; add its address→`{name}` entry to
`ROUTINES`; gate. **All four, or it is not in the layer.**

A decompile unit is not done when the module and its gate are green. It is done when the routine is
DISPATCHED. The dispatch map is built by walking `ROUTINES` — that is what each game's
`resolveAllIdiomatic` does — so a module no entry names is never *dispatched*: its address is not
overridden, so every dispatch to it runs the frozen oracle instead, and the rewrite is reached only
by a sibling that imports it directly, which for many is nothing but their own gate. **The gate is
why it goes unnoticed:** it imports the module rather than dispatching to it, so it passes either
way. The registry entry ships in the same unit as the module. A `loc_<addr>` entry is correct here
and does not violate R11, which governs the NAME and not the wiring.

**Unwired is a legitimate state, but only as a DECISION with its reason recorded.** A routine that
cannot be dispatched — its argument arrives on the stack, it never returns, it is not an entry
point — belongs in the `UNWIRED` config, not in silence. Silence is indistinguishable from the
oversight above, and the next reader "fixes" it by wiring it.

**Enforced.** `tools/test/registry-coverage.test.js` reads every game's idiomatic layer against that
game's `ROUTINES` and fails on any module that is neither named by an entry nor listed in
`tools/registry-coverage.config.mjs` — `UNWIRED` for a decision with its reason, or `DEBT` for what
was already unwired when the guard first ran, recorded and not blessed. It also fails the converse,
a registry entry whose module is absent, which breaks `resolveAllIdiomatic` for the whole game. It
discovers its games, so a new game is enrolled by existing. Reviewer-rules **R22** carries the half
a script cannot judge: whether an exemption's stated reason is true.

★ **The check reads the INDEX — modules, their text, and the registry — not the working tree**,
because the invariant is a property of the repository and one scope keeps it answering one question.
A module you are still writing trips nothing; the moment it is STAGED it trips, which is exactly
when the defect is created; a committed one stays red until wired or recorded; and a registry entry
staged without its module fails too. A gate scoped to the working tree measures something no commit
describes, and it would block every push on work merely in flight, which is how a gate gets routed
around. Untracked modules are still *reported*, so a forming debt is visible before it lands.

★ **COVERAGE IS NOT EXECUTION, and this is the trap behind the trap.** A clean registry says every
module is *dispatchable*; it does not say the layer *runs*. `manifest.runtime` decides that, and a
game set to `"translated"` never calls `resolveAllIdiomatic` at all — so a fully-wired layer sits
there executed by nothing, with this check green. When a game's layer is meant to be live, the thing
that proves it is a whole-machine gate plus the manifest switch, never registry coverage.

So the check **prints each game's `manifest.runtime` on its verdict line**, every run, rather than
leaving that to this paragraph — `runtime: translated -- so the player runs no idiomatic module`
beside a clean coverage result states the problem without arguing it. It is a report and not an
assertion on purpose: `"translated"` can be a perfectly accurate declaration, and a gate that fires
on a correct declaration is one people learn to ignore. Whether a game *should* be live yet is a
judgement, so the instrument is the line, not a failure.

---

# Part V — Naming, and the three looks

An understanding pass is **two fan-outs, keyed differently**:

- **Routine names (per routine).** If you understand the routine, NAME it. A `loc_XXXX` a human
  can't read is nonsense to the next reader; a routine whose **mechanism** is confident MUST get a
  descriptive name *even when its game-purpose is still open* — record the open purpose as a
  `[guess]`, do not withhold the name over it. Name by mechanism, sharpen with callers: internals
  alone give `copyBytesToVram`, the callers reveal `drawScoreDigits`. `loc_` is reserved for a
  routine whose *mechanism itself* is unclear.
- **Variable names (per address, across routines).** Decided by the consensus of every routine that
  touches an address, never by one. A single routine's view of a cell is "a loop count"; the eighteen
  routines that stage it reveal `PLOT_RUN_LENGTH`. Divergent local names are the tell that it is
  being decided in the wrong place.

**Both kinds get the same three looks.** Two agents derive the name *blind* to each other — routine
from body plus callers, variable over all uses of the address — promote only on convergence, then a
**third adversarial review** before it lands. Two blind derivations can converge on the same wrong
reading.

**Distinguish an open purpose from a code-undecidable identity.** An open purpose is
defer-and-upgrade — name by mechanism now, let grounding sharpen it later. An identity the code
cannot settle and downstream work will trust is **not**: ground it in-loop before committing the
name, or the wrong pick propagates.

**A name is not done until the code USES it.** A name promoted to `names.js` but left unreferenced
is dead weight — the routines still read a hex literal, so nothing got more legible. Every naming
batch ends by retrofitting the referencing routines, and `names.js` plus the retrofit land in **one
commit**. Splitting them across two means the reviewer cannot confirm the second half happened.

**Promote the ABI in the same edit, and dissolve anything left over.** Promote register live-ins to
real parameters — a rename already rewrites every idiomatic caller, so the ABI promotion rides along
for free. Dissolving `m.call` is NOT this pass's job: it belongs to each caller's own decompile
unit. Replace only what genuinely remains, which in practice means a cluster landed as one unit.

---

# Part VI — Traps

- **Running the idiomatic layer live HANGS.** A vblank busy-wait never returns because idiomatic
  routines charge zero cycles, so the cycle-driven NMI never fires to tick the wait down. Expected,
  not a bug. The fix is the frame-stepped engine, switched in as the whole-game capstone — **not**
  re-adding cycles to unstick it.
- **The poll-PC seam goes dark when the poll routines are themselves idiomatic.** Idiomatic code
  never calls `m.step`, so there is no step to catch. Fix: the engine that fires the NMI on the
  once-per-frame watchdog kick instead. Do not keep a token `m.step` inside an idiomatic poll routine.
  - **Corollary — an `m.call` INTO a poll routine is load-bearing, and the dissolve rule does not
    reach it.** `swap_check` keeps the routine containing a poll PC translated by deleting it from
    the override set. A dispatch honours that deletion; a direct import defeats it and wires the
    idiomatic twin in unconditionally, so the drain spins with the NMI never firing — and the
    engine's spin backstop counts `m.step` calls, which that loop never makes, so nothing catches
    it and the process simply stops. Record the routine and its caller in
    `tools/no-stale-mcall.config.mjs` under `ALLOWED` and leave the caller alone. These dissolve only
    once the yield moves off the poll PC, i.e. under the generator engine.
- **Idiomatic routines silently DROP load-bearing stack ops** that looked dead in the swap harness
  because a translated caller balanced them — a main-loop SP re-seat, an NMI handler's normal-exit
  `ret`. When a whole-game run leaks or creeps stack, suspect one of those before anything exotic.
- **The mixed-migration stack leak is benign only if something HEALS it. Check; do not assume.**
  A translated caller pushes a return address its idiomatic callee never pops. Three of the five games ported so
  far answer differently: The Pit re-seats SP from a literal at the top of every main-loop pass, so
  the leak dies once a frame; DK's idiomatic callers drop the oracle's `push16`/`ret` bracket at the
  call site, so the bytes are never pushed; Time Pilot seats SP once at boot and does neither, and
  there the leak walks the stack through live work RAM and kills the run in a frame or two. Where
  nothing heals it the SEAM must, and the seam is the override RESOLVER — not `m.call`, and not the
  idiomatic modules, which must stay free of stack modelling. Note this makes `resolveOverrides`
  mean "wrapped" for Time Pilot and "bare" for the other two, so read a game's own resolver rather
  than assuming from the shared name.
- **An UNCONDITIONAL resolver-supplied `ret` over-pops any rewrite that already performed one, so
  the seam must MEASURE the dispatch instead of assuming it.** The tail-jump shape is where this
  bites: `ld hl,<table> / jp <target>` carries no `ret` of its own and borrows its target's. Reach
  that target by DIRECT IMPORT and the rewrite is ret-free, which is what an unconditional seam
  assumes. But the import only exists once the target has a twin, and until then the only way in is
  `m.call` — which R10 permits precisely because there is nothing to import, and which runs the
  target INCLUDING its `ret`. The rewrite then returns having already popped the caller's slot and
  set pc, and a seam that adds a second `ret` walks SP ABOVE its power-on seat, putting the next
  push above the stack. **Both shapes are legitimate, and one routine can take one on one path and
  the other on another** — a `ret z` beside a `jp` does exactly that — so this cannot be a flag on
  the routine. Measure: SP unmoved means the `ret` was omitted, so supply it; SP up two with pc on
  the address the slot held means a transfer already performed it, so stand aside; anything else is
  a fault to raise, naming the routine. Time Pilot's `withOmittedRet` is written that way, and its
  whole-game gate measures SP across every dispatch as well, because the byte diff alone reports a
  corrupted cell and names nobody.
- **Bound the stack exclusion by the MEASURED STACK, not by the game-state ceiling.** They are
  different numbers, and the dead space between them is written by nothing — so comparing it is
  free, and it is exactly where a leaking SP lands first. Excluding it blinds the gate at the one
  place the seam can fail.
- **The NMI can LONG-JUMP into a new main loop.** A coin/start path is a warm restart driven from the
  interrupt: the handler resets SP and tail-calls a new forever loop, so the nested call never
  returns and a re-trigger guard freezes the game the instant a coin drops.
- **Attract-only gates are BLIND to input.** "The whole game reproduces the oracle byte-for-byte"
  passed green while the browser froze on the first coin. Every game's gates MUST replay its input
  tapes through the runtime and the oracle, and assert the game **responds** — a credit banks, the
  game starts at the tape's contract frame, the player moves and scores — as well as idiomatic ==
  translated through the play sequence. Expand thin tapes so they exercise much of the game, not just
  coin and start.

## The tool question — mechanical vs manual

The decompile is **manual (LLM)**, and for a single game that is the whole job. The best output is a
hybrid: a mechanical pass for provably-correct clean *structure*, then an LLM *semantic* pass for
names, comments and idiom, both memory-validated. Pure-mechanical is correct-but-soulless;
pure-hand is great but doesn't generalize. Build the mechanical tool for the transfer thesis, where
the front and middle end amortize across games. A manual pass cannot tell you whether a mechanical
tool suffices — the LLM smuggles in understanding a tool lacks — so that question needs its own
stripped-from-IR experiment.
