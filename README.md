# arcade-js

Arcade games faithfully **translated from their original machine code to JavaScript**,
validated **pixel-exact against MAME**. Not a re-implementation from observation — the
game's ROM is disassembled and translated instruction-by-instruction, then checked frame
against frame until the pixels match.

**Donkey Kong** is the first game. The repo is structured to host many: multiple CPUs,
multiple arcade boards, and multiple game romsets, sharing what they genuinely share.

> **Status:** under active construction. All four Donkey Kong board *types* boot and play,
> reached via board-state pokes, and are pixel-validated against MAME 0.288; natural
> progression and the level loop are still in progress. The multi-game restructuring and
> the docs are in progress too.

## What's here (and what isn't)

This repo ships our **tools** and our **translation** (the JavaScript — our own expression of
the ROM's logic). It does **not** ship the copyrighted ROM data, and it does not ship analysis
metadata either — `dk.asm`, `coverage.json`, `blocks.def`, `unreached.txt` under
`games/dkong/out/` are gitignored build output; regenerate them locally with `make trace`. You
supply your own ROM; `make rom-dkong` assembles and **sha256-verifies** it locally. See
[`games/dkong/rom/README.md`](games/dkong/rom/README.md).

## Layout

```
core/                 game-agnostic engine
  cpu/z80.js          the Z80 processor        (any Z80 game reuses this)
  cpu/test/           unit tests for the CPU core
  audio.js            sample-player abstraction (audio lives ABOVE emulation)
boards/               arcade hardware, named by MAME driver (a "board")
  dkong/              memory map · i8257/watchdog/latches · video/palette/geometry
  dkong/test/         unit tests for the board
games/                one directory per romset
  dkong/
    manifest.js       declares its cpu + board + rom set + metadata
    translated/       the assembly-JS translation of the ROM
    optimized/        (room for) idiomatic-JS rewrites, gated for equivalence
    audio/            sound-command → sample trigger map
    rom/              gitignored — `make rom-dkong` builds it locally
    tapes/            test input tapes (published)
    test/             unit + integration tests for the translation
    entrypoints.json  disassembly entry points (folded into the trace)
    tools/            per-game gate runners (emit.js · move_suite.py · prize_suite.py)
web/                  browser front-end: pick a game and play it
tools/                disassembler · tracer · MAME golden capture · pixel/state diff ·
                       gate runner (verdict.sh) — shared, game-agnostic
docs/                 how it's done: disassembly → translation → testing → the pixel gate
```

Tests are colocated with the code they test (`core/**/test/`, `boards/**/test/`,
`games/**/test/` — see `npm test`'s glob), not in a separate top-level `test/`.

The three layers — **CPU**, **board**, **game** — are independent axes. A game's
`manifest.js` names its CPU (`z80`) and board (`dkong`); the machine assembles
CPU + board + translated ROM. Frogger, for example, would reuse `core/cpu/z80.js` on a
future `boards/galaxian/`.

## Quickstart

```sh
make rom-dkong     # assemble your ROM locally (sha256-checked)
make serve         # dev server (sets COOP/COEP), then open the printed URL
npm test           # unit suite
```

(`make rom-dkong` is an alias for `make -C games/dkong rom`; `make serve` is an alias for
`npm run serve` — either form works, pick one.)

Requirements: Node, Python 3 (+ numpy, Pillow for the pixel gate), z80dasm (cross-checks the
decoder for `make verify`), and — for regenerating MAME goldens — MAME 0.288 and ffmpeg.

## Adding a game

See [`docs/`](docs/) for the full methodology and the "add a game" guide. In short: pick
(or write) the CPU and board, disassemble and translate the ROM into `games/<name>/`, and
drive it under the pixel gate until it matches MAME.

## License

[GPLv3](LICENSE). The translation and tools are ours and free software; the original ROM
data is not included and is not ours.
