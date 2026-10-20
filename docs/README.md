# The Method

*The front door to `docs/`: the shape of how arcade-js works. The other files each detail one
technique; read them in any order the work needs — the model below is the map, not the filenames.*

## The thesis

> **Don't reimplement the game from observation — translate its actual machine code.**
> Disassemble the original ROM, translate every routine to JavaScript that mirrors the original
> instruction-for-instruction, and prove the result **against MAME, frame by frame**.

Reimplementing an arcade game by watching it and guessing the rules *diverges*: every behaviour you
didn't observe is a bug waiting to happen. Translating the ROM *converges*: the JavaScript does what
the silicon did because it runs the same logic, and a frame-against-frame diff against a reference
emulator catches any place it doesn't. The port is produced by AI agents — see
[how the agents worked](how-the-agents-worked.md) for the division of labour and the failure modes
actually hit.

**One oracle, one spiral, then ship.** The authoritative, executable procedure is
[the runbook](runbook.md) — a numbered §0→§5 sequence run top to bottom. Its heart (§4) is a *spiral
up the call graph*, not a one-pass conveyor: the same two moves (Structure, Meaning) repeat each lap,
sharpening the map and the meaning. This page is the conceptual map; the runbook is the drill.

## Day zero — GAMEPLAY (know the game before you touch the ROM)

Before disassembling a single byte, research the game from **public sources** and write down how it's
*played* — objective, controls, enemies, scoring, the boards/levels — in `games/<game>/gameplay.md`.
This is the **outside-in** view: what a player or researcher can know *without* the code. It's the north
star for everything after, and cheap insurance against building the wrong thing.

`gameplay.md` has an **inside-out counterpart, `mechanisms.md`** — the *earned* model built from the code
plus grounding, at the end. The two bookend the port: what the world says the game is, versus what the
silicon actually does. The gap between them is informative — public lore is often vague or wrong, and a
game with almost nothing online (The Pit) is exactly the one that must be grounded by hand.

Drafting `mechanisms.md` **starts by reading `gameplay.md`** — take the outside-in view as the frame,
then correct and deepen it against the code and grounding (while staying blind to any *prior*
MECHANISMS, so the map is re-derived, not inherited).

---

## One oracle — MAME

The reference emulator runs the real ROM. It has two faces, and we use both:

- **gate** — *is our JS correct?* Frame-by-frame pixels within a measured tolerance, and per-routine memory-equivalence against the
  frozen faithful translation. Correctness is falsifiable frame-by-frame.
- **probe** — *what does the game mean?* Play it, poke it, watch RAM and frames. Meaning is
  falsifiable experiment-by-experiment.

Same oracle, both jobs. Most of the corpus only ever describes the gate face; the probe face is
just as load-bearing.

## One spiral

Repeat **up the call graph** until the game is both *correct* and *understood*. Each lap is two
moves. Structure feeds Meaning; Meaning picks the next lap's target.

### Structure — on the *gate* face → produces **the map**
- **translate** — Z80→JS, faithful, memory-equivalence gated. Routines named `loc_<addr>`.
- **decompile** — idiomatic, direct calls, gated against the frozen `translated/` oracle.

### Meaning — on the *probe* face → produces **the understood game**, consolidated in `mechanisms.md`
- **name** — label the map at the current understanding level. One confidence vocabulary for RAM cells
  *and* routines — `[seen]`/`[code]`/`[guess]` (+ `loc_<addr>` for an unnamed cell) — and the tags carry
  between laps, so a later lap sharpens an earlier `[guess]` instead of starting cold.
- **ground** — play/poke in MAME to learn what things mean; feed it back into naming.
- **MECHANISMS** — the written game model. The *capstone of Meaning*, not a ship artifact.

> **Meaning rides on the map.** Naming labels the map; poke-grounding needs it to know *where* to
> poke. Only *watch-only* grounding is map-free (day-zero); bootstrap pokes with **memory-diffing**
> ("which byte changed when I died?") when there's no map yet.

## Ship

The idiomatic layer has run **live since the skeleton** — the generator engine, wired in
routine-by-routine as each is decompiled — so ship is *packaging*, not a wiring milestone: the web
player, the web-worker contract, audio (by ear — no audio oracle exists), publish.

---

## Techniques live inside a move — they are not extra steps

Each links to the doc that details it.

**Structure**
- disassembly / recursive-descent tracer, modelling the board from ROM accesses — [disassembly](disassembly.md)
- per-routine tests proven to have teeth by mutation — [testing & mutation](testing-and-mutation.md)
- boot-gap-driven order (the gate doubles as the work-list) — [integration testing](integration-testing.md)
- memory-equivalence fidelity contract, collapse (total-preservation), entropy-pinning,
  capture-clone-replay, NMI-at-vblank-yield, the `no-stale-mcall` guard **(must resolve const-aliases,
  not just literal hex)** — [idiomatic generation](idiomatic-generation.md)
- **a unit is done when the routine is DISPATCHED, not when its gate is green** — the dispatch map is
  built from `ROUTINES`, so an unwired module's address is never overridden and every dispatch to it
  runs the oracle, while every per-routine test passes; the `registry-coverage` guard reads the
  **index** and fails on any module neither wired nor recorded (`UNWIRED` with a reason, or `DEBT`),
  and on any entry whose module is missing. **Coverage is not execution** — `manifest.runtime` decides
  whether the layer runs at all — [idiomatic generation](idiomatic-generation.md), [reviewer rules](reviewer-rules.md) R22

**Gate face**
- pixel gate (byte-exact vs tolerance, never lower the floor) — [pixel gate](pixel-gate.md)
- poke-tapes drive the DISTANT routines (later eras, 2P, game-over, boss) onto the pixel gate, per game — [poke-tapes](pixel-tapes.md)
- integration state→writes→pixels diff order — [integration testing](integration-testing.md)

**Meaning**
- confidence tags (`[seen]/[code]/[guess]`) + the build/maintain loops — [understanding](understanding.md)
- **one source per fact**: `names.js` owns a cell's name/role/tag; `mechanisms.md` tags *mechanisms* not cells, comments never restate registry status — a fail-closed gate (`tools/names_consistency.py`) blocks prose that calls a named cell "hex/unnamed" — [the names registry](names-registry.md)
- proposer≠confirmer (RAM *and* routines) + third adversarial review; `loc_<addr>`-placeholder-if-ungrounded; name a routine once its **mechanism** is understood (`loc_` only when the mechanism itself is unclear) — [understanding](understanding.md), [idiomatic generation](idiomatic-generation.md)
- grounding = poke-to-trigger + watch-in-MAME + A/B with a **negative control**; memory-diffing to
  find where to poke; persistence + completeness-critic rounds — [idiomatic generation](idiomatic-generation.md)

**Ship**
- web-worker contract, audio record/replay (without emulating the sound CPU), ROM stays out — [porting](porting.md)

## Two properties that fall out of the shape

1. **Meaning rides on structure** — pokes need the map, so poke-assisted grounding lives inside the
   spiral, not before it. Front-load only the *watch-only* half of grounding at day zero.
2. **The spiral lifts understanding each lap** — early names, chosen at partial understanding, get
   re-derived later (that's why a game's `names.js` grows 4→85→140 across laps, not in one sitting).
   Schedule one adversarial **name-revisit** once grounding is complete; if you front-loaded
   watch-only grounding, it shrinks from a re-derivation to a confirmation.
3. **Load-bearing picks ride on grounding** — the converse of (1). When the code alone can't settle
   an identity that later work will *trust* — is this sprite the laser or a terrain-scroll? an enemy
   or a ship? which axis is X? — grounding is a **gate on the pick, not a later upgrade**.
   Ground the load-bearing,
   code-undecidable call **in-loop, before you build on it**; low-stakes or code-decidable calls
   defer freely. The `[guess]` list is that work-list — resolve a load-bearing guess *as it's
   generated*.

---

## The technique docs

Each details one cluster inside a move (read in any order):

- [disassembly](disassembly.md) · [translation](translation.md) · [testing & mutation](testing-and-mutation.md) · [integration testing](integration-testing.md) · [pixel gate](pixel-gate.md) — **Structure & the gate face**
- [understanding](understanding.md) — **Meaning** (cross-cutting; starts day one)
- [the names registry](names-registry.md) — **Meaning**: `names.js`, the one file mapping every address (RAM cell and routine) to its name
- [idiomatic generation](idiomatic-generation.md) — **Structure & Meaning together**: the batch loop that rewrites the lift into readable code, and the grounding that recovers what it means (the probe face of the oracle)
- [porting a new game](porting.md) — **Ship** + CPU / board / game layering
- [how the agents worked](how-the-agents-worked.md) — the experiment (the agents, not the method)
- [contributing a disassembly](contributing-disassembly.md) — **beyond the port**: publishing a clean-room ROM disassembly to an external archive

The running example is **Donkey Kong** (Z80, `dkong` board); later ports — The Pit (`thepit`), Time
Pilot (`timeplt`), Frogger (`frogger`), Pooyan (`pooyan`) — exercised the same method on new boards.
Nothing about the method is game-specific.
