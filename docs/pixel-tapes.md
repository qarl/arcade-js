# Poke-tapes: pixel-validating the distant routines

**This is a required step of the idiomatic layer, not an optional extra. Do it for every game.**
Decompiling a game's routines and proving each memory-equivalent to the frozen oracle establishes that
the port's *logic* matches the lift — `[code]`. It does not establish that the port *renders* those
routines the way the real machine does — `[seen]`. The [pixel gate](pixel-gate.md) supplies `[seen]`,
but only for the states its tape actually reaches.

## The gap this closes

The pixel gate's tape coins up, presses start, and plays one credit — so it reaches boot, the attract
demo, and early play. It does **not** reach the *distant* states: later eras/levels, two-player, a
game-over / high-score entry, a boss (mother-ship) fight, or deep rounds. A large fraction of every
decompile batch lives only in those states (timeplt examples: the two-player start, the era-4 collision
dispatcher, the high-score insertion, the era-branching launchers, the whole-wave spawner). Left at the
default tape, those routines are logic-verified against the oracle and **never pixel-verified against
MAME**. That is the gap a poke-tape closes.

## The other gap: elapsed time

Poke-tapes close the *state* gap. There is a second, independent one — *elapsed time*. Every gate above
runs a short fixed span (the base tape and each poke-tape run about 1,800 frames), so a divergence that
only appears after many frames of continuous play is invisible to all of them. So a **long continuous
idiomatic run, diffed against a matching-length MAME golden, is also a required check, per game** — run
the idiomatic layer for many minutes and diff it, RAM first (RAM is the ground truth; pixels follow it):
dump the generator's per-frame RAM and diff against the golden `state.bin`. This must be the *idiomatic*
engine run long, **not** the oracle — the oracle is cycle-accurate and matches trivially; the point is to
catch a time-accumulated bug in the layer that actually ships.

Run one.

## What a poke-tape is

An input tape carries more than button bits: it carries a **poke schedule** — `(nmiOrdinal, addr,
value)` writes — applied **identically to both sides**:

- to **MAME** (the golden), through the tape shim's `mem:write_u8` (the reach/grounding drivers already
  do this), and
- to **our engine** (the candidate), through the same schedule on the generator path in `render.js`.

Both sides are then driven forward from the poked state and the frames are pixel-diffed exactly as the
gate already does. A routine reached this way moves from `[code]` (our JS vs the oracle) to `[seen]`
(our render vs MAME in that state).

## The rules that make it sound

- **Key pokes on the NMI ordinal, never a raw frame index.** The two clocks disagree on frame origin
  (the gate aligns on a landmark, `--tape-origin` / golden offset); a poke applied on different game
  frames on the two sides is not a comparison. One NMI fires per frame once interrupts are live, so the
  ordinal is the shared clock.
- **Pin the RNG identically on both sides.** A live mid-game state has RNG-driven actors (enemy motion,
  spawns, the boss). Without the same entropy pin the two engines diverge on motion alone and the diff
  means nothing. See [idiomatic generation](idiomatic-generation.md) on the entropy pin.
- **Poke the TRIGGER, then play in — don't poke a raw end-state.** Setting `ERA_INDEX = 4` directly can
  leave the rest of work RAM inconsistent (the game never ran era 4's setup), so both engines render the
  same *garbage* — a valid equivalence check, but a weak one. Winding the round counter, arming the boss
  timer, or crediting a second start reaches a *coherent* distant state that exercises the routine as the
  game does.
- **A post-poke divergence is a finding, not a failure of the method.** Either our engine really differs
  from MAME in that state (a bug worth catching — the whole point), or an entropy source is unpinned (to
  pin). Both are results.

## Per-game worklist

For each game, after its routines are decompiled, enumerate the distant states its routines need and add
one poke-tape per state to the pixel gate. State plainly which routines each tape now covers, and which
remain oracle-only. "The pixel gate covers this game" is a claim about that list being worked, not about
one credit's worth of play.

**timeplt (worked):** the tapes live in `games/timeplt/tapes/*.poke.json`, run by
`games/timeplt/tools/distant_suite.py`, each pixel-validated against MAME — era 1 (1940), era 4 (2001),
two-player, game-over, high-score entry, mother-ship (boss) armed collision, a deep round, and an era-3
countdown slot. Most carry a
game-set `responded` cell — a value the ROM writes only on reaching the state, read from the golden dump — so
a pass is not two engines agreeing on the same wrong thing; the two era tapes' `responded` instead confirms
the held era poke landed in the golden (that state's coherence comes from the MAME grounding, not the cell).
Entropy pinning proved unnecessary (the JS PRNG runs in lockstep with MAME even in the spawn-heavy fields,
measured).

⚠ **History, stated plainly:** until this wiring landed the distant tapes were in NO gate. Commit `b60b1dec`
("decompile the last nine oracle-served routines") reported gates green; those gates did not include the
distant tapes — they had to be run by hand.

**Wiring.**
- Per commit: `tools/pixel_gate_required.py` GLOBS `games/<g>/tapes/*.poke.json` at import (a new tape is
  gated the moment it lands) and adds one entry per tape, accepted only on its anchored
  `distant_suite: PASS -- <name>` line. Every entry passes the same `--work games/<g>/out/distantwork`; the
  suite partitions it into `<name>/<layer>/`, so no two tapes or layers share a dir. After the verdict the
  suite deletes the raw `frames.rgb`/`state.bin` dumps (on PASS, FAIL, an exception or SIGTERM/SIGHUP, after
  stopping a capture in flight; a SIGKILL is left to the disk sweep), keeping the hashes, `reach.json` and a
  `summary.json` (on FAIL, the worst frames and their pixel counts); `--keep-frames` keeps them. This is the
  repo-wide rule, not a timeplt one: every script that drives `mame_golden.py`/`render.js` cleans up through
  `tools/raw_dumps.py`, and an ad-hoc driver runs under its `run` wrapper (docs/mame-golden.md, "Raw dumps are
  deleted once the verdict is in"). The tapes, `distant_suite.py` and `tools/render-lib.js` are
  render-affecting and shared, so a change to any runs both layers. Every tape PASSes on `--layer oracle` and
  `--layer idiomatic`, so both are wired.
- DONE: `tools/done_gate.py` `check_pixel` runs every tape on the idiomatic layer before either pixel
  branch — a legacy game is not excused.
- Standing, MAME-free: `games/timeplt/test/distant-reach-tape.test.js` (picked up by `check_wholegame`)
  renders each schedule through `render-lib.js` from the argv `distant_suite.py --print-render-argv`
  builds, and requires the JS `responded` state plus every declared reach. Each declared routine has a
  mutant that must turn it red; removing a tape's pokes must too.

**Reach — the routines each tape exists for.** A schedule's `reaches` lists them; `render.js --reach`
counts each one's executions per painted frame and `distant_suite.py` FAILS a tape if any declared routine
has no execution inside the compared distant window (from the golden's first responded frame, in JS
frames, to where the comparison ends). Override-dispatched routines count at the dispatch;
directly-called ones by host call-stack attribution on a read their own body makes
(`render-lib.js DIRECT_PROBES`). Measured on both layers:

| tape | reaches |
|---|---|
| boss-armed, deep-round | postRoundStartCaptionsAndResetPlayfield, flyRoundIntroFlashingEraYearThenEraseIntroCaptions, flyEnemyFreeLeadInThenStepSequence |
| two-player | the three above + loadActivePlayerContextAndPostRoundHud |
| era-one | the three above + serviceEra1EnemyCraftSlot |
| era-advance | flyRoundIntroFlashingEraYearThenEraseIntroCaptions, flyEnemyFreeLeadInThenStepSequence, serviceSlotByMarkerThenCloseSweepTurn |
| countdown-slot | stepCountdownSlotThenCloseTurn, serviceSlotByMarkerThenCloseSweepTurn |
| game-over | fileScoreAfterGameOverHoldElsePassTurn — **reached, pixel-invisible** (see below) |
| high-score | fileScoreAfterGameOverHoldElsePassTurn (its filing arm), erasePenRouteThenOpenInitialsEntry, stepHighScoreInitialsEntry |

- **stepCountdownSlotThenCloseTurn (0x4108): covered by countdown-slot.** It is inlined into
  serviceSlotByMarkerThenCloseSweepTurn as the sweep's drifting-countdown arm. The tape loads era 3 from
  the player's saved era (PLAYER_ONE_ERA_INDEX) and pokes SHOT_BURST_PENDING in bursts until a shot destroys
  an object in the era-2+ object bank and its slot takes a countdown marker. Its `responded` cell (0xAA58 eq
  0x0D) is the slot's SPRITE_STATE byte (iy+0x30), and 0x0D is the arm's NEAR_STATE. The only ROM store of
  0x0D to (iy+0x30) is at 0x4169, inside 0x413C, whose only caller is 0x4108 (static byte scan), so the golden
  responding shows MAME running the arm. The arm's whole visible effect is one small sprite, so at the
  default budgets a broken arm passed. The tape sets `distant_budget_px`, a per-tape budget that only
  tightens (`distant_suite.py` refuses a value above the default band budget), for the distant-state window
  and the band, set just above the correct layers' measured floor. With it, two arm mutants fail against
  MAME. The measurement is in the tape's note. The arm is probed (a call into
  stepDriftingCountdownObjectByEraFrames with the sweep on the stack); the standing test's planted-marker
  control on era-advance proves the probe fires and its mutant silences it.
- **Not in a window:** postRoundStartCaptionsAndResetPlayfield runs in era-advance, game-over and
  high-score only before the distant state, so those tapes do not declare it.
- **Not reach-checked:** startTwoPlayerGame and handPlayOverToOtherPlayer (two-player) are called directly
  and have no probe yet.
- **Pixel-invisible — chosen: mark, not RAM-compare.** A routine whose in-window effect is RAM-only is
  listed in the schedule's `pixel_invisible` with the reason, and printed as "reached, pixel-invisible"; it
  is NOT `[seen]` from that tape. game-over's fileScoreAfterGameOverHoldElsePassTurn only ticks the
  SEQUENCE_DELAY hold until its expiry. The sweep's own bookkeeping (cursors, turn count) is likewise
  RAM-only; serviceSlotByMarkerThenCloseSweepTurn is declared because its era-4 handler flies and animates
  the slot's object (a [code] reading of the handler, not a separate measurement). A golden-vs-JS RAM compare of the written cells (`pixel_suite.state_column`) would upgrade
  these; not built.

Remaining: promote each reached, pixel-visible routine from `[code]` to `[seen]` in names.js. Per
reviewer-rules R3a the reach count itself is our engine's number (`[code]`); what grounds the routine is the
MAME pixel diff over the window the count proves it ran in.
