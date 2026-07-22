# 6. Porting a new game

Nothing in the method is Donkey Kong specific. A new game differs along two independent axes — its
**CPU** and its **board** — and brings one thing of its own, its **ROM**.

## The three layers

```
core/cpu/<chip>.js        the processor        shared by every game using that CPU
boards/<driver>/          the arcade hardware  shared by every game on that PCB
games/<romset>/           the translated ROM   one per game
```

- **CPU** (`core/cpu/z80.js`, and future siblings) is fully game-agnostic. A new Z80 game reuses it
  verbatim; a new CPU (6502, 6809, …) is a new module here.
- **Board** (`boards/<driver>/`: memory map, i/o chips, video/palette/geometry) is named after its
  **MAME driver**. Games on the same PCB share it — Donkey Kong Jr. and Donkey Kong 3 would reuse
  `boards/dkong/`; Frogger would need `boards/galaxian/`.
- **Game** (`games/<id>/`) is the ROM translation plus a **manifest** declaring its cpu, board, ROM
  images (with checksums), and metadata.

A game's `manifest.js` ties the three together, and the machine assembles CPU + board + translated
ROM at load time.

## The manifest's `inputs` block is required for the web player

`web/` is game-agnostic: it derives its keyboard map and its worker port list entirely from
`manifest.inputs`, never from hardcoded literals. A manifest that omits `inputs` can still pass
every gate — the pixel harness never reads it — but it can't be played in the browser. Declare:

- **`ports`** — the input-port addresses the board exposes, e.g. `{ in0, in1, in2 }`, matching the
  board's i/o module (`boards/<driver>/io.js`).
- **`actions`** — logical action name → `{ port, bit }`, e.g. `right: { port: 0x7c00, bit: 0x01 }`.
  One entry per button/direction the game reads, plus `coin` and `start1` (and `start2` if the
  cabinet has a two-player start).
- **`keys`** — `KeyboardEvent.code` → action name, e.g. `ArrowRight: "right"`. The web player builds
  its per-port key→bit maps from this at load time; it needs no per-game code of its own.

See `games/dkong/manifest.js` for the reference shape.

## The steps

1. **Pick or write the CPU.** If it's Z80, reuse `core/cpu/z80.js`. Otherwise translate the CPU core
   first (it's game-agnostic and reusable, so it's worth doing well once).
2. **Pick or write the board.** If the romset shares an existing board, reference it in the manifest.
   Otherwise model the hardware in a new `boards/<driver>/` — memory map, i/o, video — from the ROM's
   accesses and MAME (doc 1).
3. **Disassemble** the ROM (`make trace`, doc 1) into `games/<id>/translated/`.
4. **Translate** it routine by routine into assembly-JavaScript (doc 2), each routine carrying a unit
   test and a mutation that proves the test catches its failure (doc 3).
5. **Gate every step against MAME** (docs 4–5): capture a golden, emit the same artifacts, diff
   state → writes → pixels, and fix the engine until it passes. Never widen the tolerance to pass.
6. **Register** the game: add its id to `games/registry.js`, and write `games/<id>/manifest.js`
   (with the ROM part list + sha256 checksums, and the `inputs` block below) and a `Makefile` `rom`
   target.

## The ROM stays out

Arcade ROM data is copyrighted and is **never committed**. Each game ships a manifest that lists the
part filenames and their checksums; `make -C games/<id> rom` assembles the images from a dump the user
supplies and verifies them against the pinned sha256, so a wrong romset fails loudly. This repo
distributes tools, translation, and analysis metadata — never the original bytes.
