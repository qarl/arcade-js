# core/ — the game-agnostic engine

`core/` holds what is **not** specific to any one game: the CPU, and the abstractions
(audio) that sit above the emulation. Anything tied to a particular arcade PCB lives in
`boards/`; anything tied to a particular romset lives in `games/`.

## The three layers

```
CPU     core/cpu/z80.js                       the processor       — shared by any Z80 game
board   boards/<driver>/ (memory·io·video)    the PCB hardware    — shared by games on that PCB
game    games/<romset>/  (translated ROM …)   the program/data    — one per romset
```

These are **independent axes**. Two games can share a CPU but differ in board (Frogger and
Donkey Kong are both Z80, on different boards); two games can share a board but differ in ROM
(Donkey Kong and Donkey Kong Jr.). A game's `manifest.js` names its `cpu` and `board`, and the
machine assembles CPU + board + translated ROM.

Boards are named after their **MAME driver** (`boards/dkong` ↔ `dkong.cpp`,
`boards/galaxian` ↔ `galaxian.cpp`), so the board that happens to share its name with its
flagship game does so on purpose — exactly like MAME.

## What's in core/ today

- **`cpu/z80.js`** — the Z80 core: registers, ALU, flags, DAA/BCD, the full instruction set.
  Game-agnostic; verbatim-reusable. Future siblings: `cpu/6502.js`, `cpu/6809.js`, …
- **`audio.js`** — the sample-player abstraction (see below).

## The seams (deliberately parameterized / stubbed for later)

**Audio is above the emulation, not inside it.** The core does not emulate sound chips. A
board observes the program's *sound-command writes* and hands the command value to a
`SamplePlayer` (`core/audio.js`), which maps it to a pre-recorded sample. This keeps the
emulation core deterministic and sound-free (the pixel gate never depends on audio), and makes
audio a thin, swappable layer. A game supplies the trigger map + samples in `games/<x>/audio/`.

**Optimization is layered, not in-place.** The translated ROM in `games/<x>/translated/` is
deliberately close to the original assembly. Idiomatic-JS rewrites of individual routines go
in `games/<x>/optimized/` and are swapped in via the manifest — only after passing the same
pixel/mutation gates that prove equivalence to the assembly-JS version. (Future work; the room
is here now.)

**A shared board is factored out on the second game.** DK's hardware lives in `boards/dkong/`.
When a second romset reuses it (DK Jr. / DK3 / Mario Bros family), it just references
`board: 'dkong'` — no duplication.

## Parameterizing the core for a second board (the future seam)

`cpu/z80.js` is already generic. Making the *machine scaffolding* generic — so a new board only
supplies data, not forked code — means lifting four things out of the DK board into
parameterized core pieces (deferred until a second board actually needs them):

1. **Address map** — RAM/ROM/sprite/video/DMA ranges (today hardcoded in `boards/dkong/memory.js`).
2. **I/O config** — input-bit maps, dip switches, the i8257/watchdog/latch layout
   (today in `boards/dkong/io.js`).
3. **Video pipeline** — gfx/sprite/PROM/palette decode + screen geometry
   (today in `boards/dkong/video.js`; genuinely rewritten per board).
4. **Machine timing** — cycles/frame, NMI vector + reset hooks (today in the board's machine wiring).
