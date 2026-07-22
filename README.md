# arcade-js

Arcade games faithfully **translated from their original machine code to JavaScript**,
validated **pixel-exact against MAME**. Not a re-implementation from observation — the
game's ROM is disassembled and translated instruction-by-instruction, then checked frame
against frame until the pixels match.

**Donkey Kong** is the first game. The repo is structured to host many: multiple CPUs,
multiple arcade boards, and multiple game romsets, sharing what they genuinely share.

> **Status:** under active construction. Donkey Kong runs end-to-end (all four boards,
> progression, and the level loop) and is validated against MAME; the multi-game
> restructuring and the docs are in progress.

## What's here (and what isn't)

This repo ships our **tools**, our **translation** (the JavaScript — our own expression of
the ROM's logic), and **analysis metadata**. It does **not** ship the copyrighted ROM data.
You supply your own ROM; `make rom` assembles and **sha256-verifies** it locally. See
[`games/dkong/rom/README.md`](games/dkong/rom/README.md).

## Layout

```
core/                 game-agnostic engine
  cpu/z80.js          the Z80 processor        (any Z80 game reuses this)
  audio.js            sample-player abstraction (audio lives ABOVE emulation)
boards/               arcade hardware, named by MAME driver (a "board")
  dkong/              memory map · i8257/watchdog/latches · video/palette/geometry
games/                one directory per romset
  dkong/
    manifest.js       declares its cpu + board + rom set + metadata
    translated/       the assembly-JS translation of the ROM
    optimized/        (room for) idiomatic-JS rewrites, gated for equivalence
    audio/            sound-command → sample trigger map
    rom/              gitignored — `make rom` builds it locally
    tapes/            test input tapes (published)
web/                  browser front-end: pick a game and play it
tools/                disassembler · tracer · MAME golden capture · pixel/state diff · mutation gate
test/                 unit suite + the pixel-validation gate runner
docs/                 how it's done: disassembly → translation → testing → the pixel gate
```

The three layers — **CPU**, **board**, **game** — are independent axes. A game's
`manifest.js` names its CPU (`z80`) and board (`dkong`); the machine assembles
CPU + board + translated ROM. Frogger, for example, would reuse `core/cpu/z80.js` on a
future `boards/galaxian/`.

## Quickstart

```sh
make -C games/dkong rom     # assemble your ROM locally (sha256-checked)
npm run serve               # dev server (sets COOP/COEP), then open the printed URL
npm test                    # unit suite
```

Requirements: Node, Python 3 (+ numpy, Pillow for the pixel gate), and — for
regenerating MAME goldens — MAME 0.288 and ffmpeg.

## Adding a game

See [`docs/`](docs/) for the full methodology and the "add a game" guide. In short: pick
(or write) the CPU and board, disassemble and translate the ROM into `games/<name>/`, and
drive it under the pixel gate until it matches MAME.

## License

[GPLv3](LICENSE). The translation and tools are ours and free software; the original ROM
data is not included and is not ours.
