# 1. Disassembly

Before you can translate a ROM you must know which bytes are code, which are data, and what
each instruction is. Two tools recover that (`make trace`).

## A decoder that is complete by construction

`tools/z80_decode.py` decodes Z80 instructions from the **structural x/y/z/p/q decomposition**
of the opcode byte, not from a hand-written 256-entry table. Every opcode is described by the
same small set of fields, so instruction-set coverage is complete by construction rather than
by proofreading a table — the class of "we forgot one opcode" bug cannot occur.

The decoder is verified independently: `make verify` cross-checks every decoded instruction
boundary against `z80dasm` (an external Z80 disassembler). Agreement in **both directions**
(nothing we call an instruction that it doesn't, and nothing inside our code spans that it
splits differently) is the check — a one-directional check can pass vacuously.

## Recursive-descent tracing, not linear sweep

A linear disassembly of an arcade ROM is wrong: code and data are interleaved, and disassembling
a data table as instructions produces garbage. `tools/trace.py` instead does **reachability-driven
recursive descent**: it starts at the real entry points — the reset vector (`0x0000`) and the
interrupt handler (`0x0066`) — and follows control flow, classifying every byte as CODE,
TABLE-DATA, or UNREACHED.

The hard parts it handles:

- **Dispatch tables.** The Z80 `rst` vectors are used as compact table-driven dispatchers
  (e.g. `rst 28h` reads a jump table indexed by a state byte). The tracer recognises these and
  follows every table entry, bounding the table so it doesn't run off into data.
- **No-return fixpoint.** Some routines never return (they tail-jump or splice the stack). The
  tracer iterates to a fixpoint so control flow that only becomes reachable after another pass
  is still followed.
- **Discovered entries.** Entry points that only reveal themselves through data (pointer tables
  the code computes into) are recorded in `tools/entrypoints.json` and folded into the trace.

Output: `dk.asm` (the disassembly), `blocks.def` (the code map), `coverage.json` (what was
reached), and `unreached.txt`. Anything left UNREACHED is either data or a genuinely dead path,
and is flagged rather than silently disassembled.

## Modelling the hardware the code drives

The ROM is only half the machine; the code reads and writes hardware. Disassembly is paired with
**modelling the board from the ROM's own accesses**: the memory map (where RAM, sprite RAM, video
RAM and the DMA registers live), the interrupt/watchdog behaviour, the graphics/PROM/palette
decode, and the DMA timing. Each fact is *verified* against the reference emulator, not guessed —
the same discipline as the code translation. For Donkey Kong this modelling is written down as a
worked example in the board sources under `boards/dkong/` and their comments.
