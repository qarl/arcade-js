# The pixel gate

The final arbiter is the picture: does our frame look like MAME's frame? But "look like" needs a
precise definition, and there are two, used in different places.

## Byte-exact, where it must be

For deterministic stretches — the boot sequence, and any window where the two machines must agree
to the pixel — `tools/framediff.py` compares **byte for byte**. It applies a frozen frame offset
(the AVI lags the state by one frame; the offset is pinned, never auto-calibrated, because a
free offset can manufacture a green result over identical boot frames), compares raw bytes rather
than trusting any stored hash, and requires completeness in both directions (a short run can report
`PARTIAL` but never `PASS`). On the first divergence it reports the pixel count, the bounding box,
the tiles touched, and names likely whole-frame modes (a red/blue swap, a vertical flip, a row
shift) so the failing routine is easy to find.

## Rough tolerance, where reality is jittery

Requiring byte-exact equality *everywhere* is wrong. A single sprite one frame early — an artefact
of sub-frame timing that no player could see — would fail an otherwise-perfect translation. But
*unbounded* divergence (the screens drifting further and further apart) is always a real bug. The
rough gate distinguishes them:

> A frame may differ from MAME by a few pixels and still pass, **as long as the pixels don't
> diverge arbitrarily.** Concretely (`tools/pixel_gate.py`, which every game's suite calls): PASS iff
> no frame in the window exceeds **5%** of the frame. An EMPTY window is `INCOMPLETE`, never a pass —
> a run that died before the window began differs in nothing because it compared nothing, so a caller
> must consume the verdict rather than re-derive one from the max and the over-count.

The key word is *reconverge*. A translation that's right will differ from MAME only in brief,
bounded transients and then snap back to identical; a translation that's wrong will diverge and
stay diverged. The percent-of-frame threshold accepts the former and rejects the latter.

`games/dkong/tools/prize_suite.py` runs the same rough gate over the bonus-item pickups — Pauline's dropped
parasol/hat/purse, worth level-scaled points — across the boards that carry them (50m/75m/100m).
It applies the identical rule (max per-frame difference under 5%, no single frame over ~5%, from
frame ~1600) plus a pickup assertion the movement gate doesn't need: the prize slot at RAM
`0x6A0C` clears (its X byte drops to 0) and the BCD score at `0x60B2` grows by the level's point
value. Nine scenarios — `{50m,75m,100m} × {hat,parasol,purse}` — each with its own committed tape
in `games/dkong/tapes/`.

## Gameplay, not just attract (The Pit)

Attract is the easy half — it takes no input, so a golden captures itself. The gate that matters
runs the game. `games/thepit/tools/pixel_suite.py` drives **coin → start → dig** into both MAME
and the JS renderer on the *same* entropy-pinned input. With `--layer oracle` it asserts the
translated layer's frame buffer is byte-identical to MAME's, pixel-for-pixel, through the
tunnelling gameplay. The shipped idiomatic layer (the default `--layer`) drifts a few frames at
each collapsed busy-wait, so it gets a drift-tolerant comparison instead, which is not byte
parity. `render.js --pin` freezes the RNG the same way MAME's `--pin-entropy` does, so random
actor content never adds to the difference on either layer. BYO-ROM: the golden is captured live
from your own romset (never committed), and the gate SKIPs green if MAME can't verify it.

Two artifacts are handled in the open, not papered over — both instances of "the reading is the
instrument first":
- **A one-frame boot-transition phase.** One edge tile turns on a frame earlier in the JS render
  than in MAME (the frame-stepped boot phase differs by one) — cosmetically invisible, present in
  attract too. The diff window starts at frame 2 so *that* transient is excluded; a regression at
  any later attract-or-gameplay frame still fails. Skipping two boot frames is not "widening the
  tolerance" — the floor stays 0 px everywhere the game is actually drawing.
- **A false "watchdog reset" flag.** The golden tool's boot-signature heuristic fires on the
  coin/start frames, where the screen blanks and *looks* like boot. It is not a reset: the gate
  re-checks the STATE dump (work RAM at those frames is not the boot image; GAME_STATE steps
  0→3→1 normally) and only fails on a *real* reset (work RAM == boot).

## The discipline around the gate

Three rules keep the gate honest, each learned the hard way:

- **Never lower the floor.** If a frame fails, fix the engine — don't widen the tolerance to make
  it pass. The threshold is a property of the hardware's jitter, not a knob to reach green.
- **Calibrate once.** Constants like the frame offset are pinned and committed; re-deriving them
  per-run lets a bug hide inside a "recalibration".
- **Instrument for falsifiability.** A check that cannot fail proves nothing. Prefer diffs that
  would catch a planted error (that's what mutation testing verifies for the unit tests, and what
  the both-directions and no-auto-offset rules verify for the pixel gate).

## ★★ The gate is a PRECONDITION for the idiomatic layer, not a capstone after it

This picture-against-MAME gate is the falsifiable ground truth; per-routine memory-equivalence is
the fast local proxy. Easy to misread as *"proxy now, truth at the end"* — do not.

> **Before the first idiomatic module of a game is written, the pixel gate must be running and
> green, and stay green for the life of that layer.** Day-zero item 7 in
> [idiomatic generation](idiomatic-generation.md).

**Why the proxy cannot stand alone.** The per-routine equivalence gates and the assembled swap
compare RAM outside the stack and a declared live-out; **neither looks at a pixel.** No idiomatic
module spends T-states, so every rewrite is cheaper than its frozen twin — harmless under the
cycle-free swap engine, *not* harmless under the cycle-driven engine a player runs, where it shifts
the foreground phase, the NMI's interruption point, and what the beam has drawn when it fires. The
DMA sub-frame raster position has no owner among the memory gates. So a layer built with this gate
off can be green everywhere and still wrong on the glass, and switching it on late turns a bug
report (one routine, one diff) into a bisect (many green routines, one diff).

**Check where it is wired; the answer changes.** ⚠ `make verify`
is NOT this gate — it is `verify_decoder.py`, a disassembly check defaulting to `GAME=dkong`, and
says nothing about pixels.

## Where it is wired, and why a doc could not have fixed this

**`hooks/pre-commit` runs `tools/pixel_gate_required.py check`.** When the staged diff touches, for
some game, its `idiomatic/`, `translated/`, `routines.js`, `machine.js`, `manifest.js`, its own
`tools/render.js`/`tools/pixel_suite.py`, or its `boards/<board>/`, that game's suite runs and the
commit is REFUSED unless the suite prints its literal `PASS` line. `make pixel GAME=<id>` runs it by
hand; the board is resolved through each manifest's `board:` field. Instruction alone could not fix
this: forgetting is a **write-time** failure, and a doc or reviewer rule is a **read-time**
instrument that fires only when someone chooses to look — the moment a person who forgot is not.

★ **The interlock does not trust the suite's exit code.** `pixel_suite.py` exits 0 when it cannot
run (no MAME, no romset), so a gate on that code would report success loudest on the machine that
checked nothing — the silent-skip defect `no-stale-mcall` has. It requires the literal PASS line and
treats SKIP, INCOMPLETE, FAIL, a crash and a timeout alike as refusals; `selftest` asserts the PASS
case is ACCEPTED first, or the refusals prove only that the predicate rejects everything.

A game with no declared suite is **refused, not skipped** — Donkey Kong's `move_suite.py`/
`prize_suite.py` have a deliberately un-encoded pass line, because a predicate never observed
matching returns a believable answer without measuring. The escape is an `EXEMPT` entry with a
reviewable reason, which waives its game **until someone removes it**. ⚠ Knowingly left: `core/` and
`tools/pixel_gate.py` do not fire — shared by every game, so firing would demand suites a machine
with one romset cannot run, and `pixel_gate.py` holds `ROUGH_TOLERANCE`, which changes every
verdict. Recorded, not fixed.

### ★★ Which layer a green suite covers, and what it still does not

**A suite renders the layer its own `pixel_suite.py` asks for.** `render.js` builds from
`buildRoutines()` — the oracle — unless given `--idiomatic`, which routes it through
`resolveAllIdiomatic` and the generator engine; the suite passes that flag only when
`manifest.runtime` reads `"idiomatic"` at run time. **Today only Time Pilot's suite does.** dkong and
thepit declare `"idiomatic"` too but thepit's `render.js` has no override path, so its suite still
renders the ORACLE — **a declared runtime is not evidence about what got rendered**, which is why
`suite_renders_idiomatic()` requires the flag, the path and the manifest together. Where the oracle
is rendered, the idiomatic layer still RUNS (on the generator engine) but is not RENDERED, so an idiomatic *render*
regression is uncovered; the tool prints a not-rendered caveat on such a PASS rather than a bare one,
so it travels with the verdict.

An absence is evidence only once the instrument is shown able to detect presence.

⚠ **A PASS on an idiomatic-rendering game is real coverage, not parity.** Two limits, both measured
in `pixel_suite.py`: the frames before the first vblank yield have no counterpart on a yield clock
and are not compared, and the upper rows carry a scanline-compositing residual worth about half the
tolerance — which is why that suite adds a tight second criterion on the band below it.

⚠ **The gate only covers what its tape REACHES** (one credit + attract); the distant routines need [poke-tapes](pixel-tapes.md) — a required idiomatic-layer step, per game.
