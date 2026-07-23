# 6. Optimization — from assembly-JavaScript to idiomatic JavaScript

The [translation](02-translation.md) is deliberately *not* idiomatic JavaScript. Each routine
mirrors the Z80 instruction-for-instruction — hex addresses, per-instruction T-state charges,
flags computed by hand — because that faithfulness is what lets it validate against MAME. It reads
like the disassembly, which is the point during translation and a liability afterwards.

Optimization is the separate, later project of rewriting those routines as **ordinary,
higher-level JavaScript** — named variables, structured control flow, dropped register churn —
*without changing what they do*. The whole discipline is one sentence:

> An optimized routine may replace its translated counterpart **only after it passes the gates
> that prove it observably equivalent**. Equivalence is proven, never assumed.

This document is what we have learned doing it. It is **not complete** — the sweep is ongoing and
some of these rules were wrong before the harness corrected them (twice, on cycles alone). It
records the method and the traps as they stand. The per-directory working reference is
[`games/dkong/optimized/README.md`](../games/dkong/optimized/README.md); the conventions the next
game should write from line one are in [doc 2](02-translation.md).

## The frozen oracle

`translated/` is never edited. It is not legacy code awaiting replacement — it is **evidential**.
Every routine sits directly beneath its own disassembly, so `mem.write8(0x6007, …)` lines up
character-for-character with `ld (0x6007),a` in the comment above it, and a reader can check the
translation is faithful. Rename an address there and it stops being a translation and becomes an
interpretation, destroying the only thing that makes the claim checkable.

So the oracle stays hex and literal, meaning lives in `optimized/`, and the oracle stays
permanently exercised: every optimized routine is proven *against* it, so it never rots into a
stale reference. (One consequence worth stating plainly: oracle docstrings written early can go
stale — several say a routine is "not yet wired" or "a frontier" when the swap layer and the live
demo have since made it reachable. The **reachability probe** below is what catches that; we fix
the optimized routine's understanding, never the frozen oracle.)

## The swap layer: any routine, not just dispatch targets

The mechanism that lets an optimized routine run live is a **routine registry**
([`games/dkong/routines.js`](../games/dkong/routines.js)): a `Map<romAddr, fn>` holding every
translated routine, with the manifest's proven-equal optimized rewrites laid over the top. Every
inter-routine call is written `m.call(0xADDR)`, which resolves the address through that map and
invokes whichever implementation is registered — oracle, or optimized once one exists.

This matters because the naive approach — intercepting only at the two dispatch points (the task
loop and the NMI game-state switch) — can reach only ~79 dispatch-target routines. The other ~360
are ordinary subroutines reached by a direct call, invisible to a dispatch-level override. Routing
*every* call through `m.call` makes the override a **patch table over the whole address space**,
exactly like patched ROM: install an optimized routine at an address and it replaces its oracle at
every call site, so a leaf subroutine goes live the instant it is proven equal. The `push16`/`step`
that model the CALL's stack push and cycle cost stay at the call site; only *which implementation
runs* goes through the registry. With an empty override map it resolves to the oracle, so the
retrofit that introduced it is provably behaviour-neutral.

## What "equivalent" means — and the gate that proves it

Observable state is: **work/sprite/video RAM, the CPU register file (including flags), the program
counter, and the frame's total cycle cost** (via the mechanism in the next section). Two
routines are equivalent iff, run from the same entry state, they leave all of that identical.

The equivalence engine ([`core/equivalence.js`](../core/equivalence.js)) proves it two ways, and a
routine must pass both:

- **Whole-machine** — run the game N frames twice, once with the optimized routine overridden and
  once without, and diff the full per-frame RAM trace. This is the strict gate: a *timing*
  divergence (an optimized routine that pushed the frame's work past its natural sync point) does
  not hide here, it surfaces as downstream state drift. An **invocation counter** guarantees the
  override actually fired — an EQUAL result that never ran the optimized code cannot pass
  vacuously — and a health assertion fails any run that didn't reach its per-frame sync.
- **Unit** — capture the machine at the instant the routine is first entered, clone it, run oracle
  vs optimized on the two clones, and diff RAM + the full register file + pc. Faster, and it
  localizes a failure to the routine instead of to some frame downstream. (The snapshot override is
  installed at *construction*, so it reaches routines entered only by `m.call`, not just dispatch
  targets.)

And every routine's test must **have teeth**: a deliberately-broken twin of the routine must be
*caught* by the gate. A test that passes but cannot fail proves nothing. See
[doc 3](03-drafter-testing-and-mutation.md) for the mutation discipline this inherits.

## Cycles: the total is load-bearing, its distribution usually is not

This is the rule the harness corrected twice, so it is stated as *measured*, not reasoned.

The instinct is that the per-instruction `m.step(addr, tstates)` charges are load-bearing because
the NMI fires on accumulated cycles. The counter-instinct — that the ROM's own wait-for-vblank
spin makes cycles free — is *also* wrong. What is actually true:

> A routine's **total** cycle cost is observable; its internal **distribution** is not (usually).

The total is observable through **two** downstream mechanisms, both demonstrated by the harness:

1. **The spin count / PRNG.** The main loop does its per-frame work and then spins until the NMI
   moves the frame counter. The number of spin iterations *is* the PRNG's entropy (`SPIN_COUNT`
   0x6019 feeds `RNG` 0x6018). Cheaper work reaches the spin sooner, spins once more, and reseeds
   the PRNG — so a wrong total diverges at 0x6019, for main-loop *and* NMI routines alike.
2. **The NMI stack landing.** The vblank NMI pushes the live PC onto the Z80 stack, which lives in
   *diffed* work RAM. A routine's total changes where the cumulative cycle count sits when a *later*
   frame's NMI fires, so a wrong total shifts the pushed PC and diverges in the stack region
   (near the 0x6BFF stack top — observed divergences cluster around 0x6BFx).

Because the total is observable but the distribution is not, the de-scaffolding is: **do not drop
the cycle charges, but do not keep one per instruction either.** Compute each executed path's total
and charge it once — one `m.step`/`m.ret` per branch — placed immediately before the branch's
control transfer. Data-dependent loops charge one total per *iteration*. That is most of the
readability win with the total preserved exactly.

Three caveats, each of which the sweep has hit:

- **Atomicity is the precondition, and it must be checked, not assumed.** Collapsing is only safe
  if the NMI cannot fire *inside* the routine — otherwise a mid-routine interrupt pushes the live
  PC, and a routine that redistributed its cycles pushes the *wrong* PC. A routine is atomic when it
  runs inside the NMI (whose handler clears the NMI mask on entry, so it cannot re-enter) **and**
  calls nothing that itself spans a frame. The in-game update cascade `loc_197a` is the
  counter-example: it dispatches the longest interruptible per-frame work, the NMI routinely lands
  mid-cascade, and collapsing its total is *demonstrably wrong* — the harness diverges it in the
  stack region. It is kept per-instruction. When in doubt, keep per-instruction and let the harness
  tell you the collapse is safe; never the other way round.
- **Hardware writes carry a bus cycle the RAM gate cannot see.** A write to a tagged hardware latch
  (`0x7D80`–`0x7D87` palette bank / flip-screen / sound, `0x7C00`, `0x7800`-block) records its bus
  cycle — `clock() + busOffset` — in the `emit --writes` trace. That column is invisible to the
  RAM+register gate, so a full collapse *across* such a write silently moves it. The rule: keep
  enough per-instruction granularity that each tagged hardware write lands at the oracle's exact
  cumulative cycle (a **partial collapse**), and add a dedicated write-trace test whose teeth are a
  flat collapse. `loc_0a8a` is the worked pattern. (An *untagged* hardware write — one where the
  oracle omits the bus offset — throws if the write trace is ever active, so it never sits on a
  traced path; there is nothing to preserve for it. And a write in a *callee* reached at the exact
  oracle cycle is automatically preserved, since the callee starts identically.)
- **DMA and the watchdog.** Sprite DMA steals cycles and reading `0x7D00` kicks the watchdog; both
  are timing-coupled to pixels. The known ~98 px difference on Pauline during Kong's climb is a
  DMA-timing artifact — proof that timing reaches pixels at least a little, which is why "the frame
  reaches its sync" is asserted rather than hoped.

## Flags: paid for in the oracle so they can be dropped here

Z80 flags are load-bearing in the translation — later instructions branch on them, and the NMI
pushes `AF`, so flag bits reach diffed RAM. Idiomatic JavaScript does not compute a half-carry and
should not have to. The rule is not "ignore flags", it is:

> An optimized routine must leave observable state identical. A flag it never sets is fine **only
> if nothing reads it before it is overwritten.**

That is a provable property, taken from the disassembly, never from taste. The unit gate compares
the *whole* register file including F (and the undocumented F3/F5 bits), so a dropped-but-read flag
is caught. In practice: keep the flag-producing op verbatim when the routine's own branch reads it,
when a `ret cc` returns it as a boolean, or when it is simply the last flag-writer before the exit
(so the exit F matches). Drop it — replace `cp 0x03` with a plain `board === 3` — only when the
disassembly shows the flag is dead before its next writer. Some routines (a carry threaded through
`rra`/`rl`, an `and a` clearing carry for an `adc` chain) have almost no droppable churn; there the
win is entirely names, structure, and the cycle collapse.

## Names are interpretation; they need evidence

`ram.js` maps addresses to meaning — `0x6203` → `MARIO_X`. That is a *claim*, not a fact of the
ROM, which is why names live in `optimized/` and not beside the oracle.

> Name only what can be evidenced. Leave the rest hex. An unnamed address is honest; a confidently
> wrong one misleads every future reader and will be believed.

The bar is **control**, not correlation: the strongest evidence is a poke that the world obeys
(write `MARIO_X` and Mario is there), or an unambiguous ROM citation. A subtle trap the sweep hit
repeatedly: an address that is `MARIO_SPRITE_RECORD` during gameplay may be repurposed as an
attract-mode blinker or a cutscene sprite by a routine that runs in a different state — naming it
"Mario" there would mislead, so it stays hex with a comment. The reviewer who confirms a name must
never be the agent who proposed it.

### Expanding the table is a standing job of optimization

The name table is never "done", and growing it is part of the work, not a separate project.
Optimizing a routine means reading it closely enough to understand what its addresses *mean* — so
every optimization is also an opportunity to name an address that was hex before, and the
understanding **compounds across routines**: an address a dozen routines all decrement as a timer,
or all index the same table with, is far better evidenced than any single routine could show.
Cross-routine agreement is the strongest signal the sweep produces, and it only appears once several
routines have been dug into.

The discipline that keeps this safe is the same proposer-≠-confirmer split, mechanised:

1. **Optimizers propose, they do not edit `ram.js`.** `ram.js` is a shared file most optimized
   routines import (the rest touch only unevidenced addresses and import nothing); a proposer
   editing it would both violate proposer-≠-confirmer and collide with other in-flight work. So when a routine reveals an address's meaning *with evidence*, the
   optimizer keeps the address hex in its own code (with a comment) and **reports it as a naming
   candidate** — address, proposed name, the evidence (control poke or ROM cite), and which routines
   corroborate it.
2. **A separate confirmer re-derives each candidate** against the control-not-correlation bar — a
   poke the world obeys, or an unambiguous citation — never trusting the proposal. A candidate that
   only correlates, or whose meaning is state-dependent (the sprite-record trap above), is rejected
   or scoped, not named.
3. **Confirmed names land in `ram.js` in one serialized step**, and the routines that referenced the
   address as hex are swept to the new name. Doing this centrally, not per-routine, is what avoids
   two rewrites racing on the shared file.

The same loop runs *backward* over already-optimized routines: because later routines evidence
addresses earlier ones left hex, periodically mining the finished set surfaces names that no single
routine could justify at the time it was written.

## Reaching the routine to test it

Most routines do not run in a bare boot. The equivalence gates need the routine to actually
execute, so the test has to *drive the machine into the state that dispatches it* — and whatever it
does must be applied **identically to the baseline and the optimized side**, or the comparison is
meaningless. Three patterns, in order of preference:

1. **Natural dispatch.** Some routines run in attract; run enough frames and capture the entry.
2. **Driven input.** A coin+start input tape reaches in-game states; a held direction or a second
   coin+start-2 reaches two-player and death-handoff states. This is genuine gameplay, not a poke.
3. **Identical-both-sides poke.** For a deep sub-state a tape can't cheaply reach, poke the deciding
   RAM (e.g. `GAME_SUBSTATE = 0x16`, `BOARD = 4`) — applied to both machines through a shared
   factory — so the game's *own* dispatch then runs the routine. This is sanctioned precisely
   because it steers the real machine rather than faking the routine's effect.

Two recurring wrinkles: a routine that re-poked its own output every frame masks that store in the
frame-boundary dump, so the whole-machine teeth target a persistent/callee store while the unit
teeth target the routine's own output directly. And a genuinely **unreachable frontier** (its
dispatcher is untranslated, verified 0 dispatches) can't use a natural gate at all — it is proven
by synthesised entries with cycle teeth, kept per-instruction (a collapse it can't whole-machine
verify), and wired live but inert. Beware over-claiming "unreachable" on too short a window: the
guard family looked unreachable at 40 frames and was in fact dispatched hundreds of times once the
selecting byte was held and the window widened.

## Full-branch coverage

The natural or driven run reaches whatever branches that path happens to take — often not all of
them. Every *reachable* branch gets committed teeth: where the run doesn't reach an arm, the test
**synthesises** its entry (clone the captured state, set the deciding register/RAM) and asserts
that arm EQUAL, and for a *collapsed* arm it also asserts the branch's **cycle total** equals the
oracle's — otherwise a wrong collapsed total on an unreached arm has no teeth. A genuinely
untranslated/`NotImplemented` arm is exempt and noted. No branch is left unproven.

## The workflow

Each routine is its own file, `optimized/<name>.js`, exporting one function with a documented
behaviour block (what it does, its inputs/outputs, and the cycle/flag decisions and *why*) — so the
next optimization has that reasoning to build on. One file per routine also means two rewrites never
touch the same file, which is what lets many run in parallel. Each is proven by its own equivalence
test, wired into the manifest, and — because the manifest is a shared file and the pixel gates are
global — the wiring and the whole-game gates (`npm test`, `move_suite` 6/6, `prize_suite` 9/9) run
once per batch, not per routine. The author never gates their own reach: a separate reviewer reads
the rewrite against the oracle and must substantiate any finding before reporting it. Only then does
it commit.
