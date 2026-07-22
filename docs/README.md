# How arcade-js works

The thesis of this project is simple and unusual:

> **Don't reimplement the game from observation — translate its actual machine code.**
> Disassemble the original ROM, translate every routine to JavaScript that mirrors the
> original instruction-for-instruction, and prove the result **pixel-exact against MAME**.

Reimplementing an arcade game by watching it and guessing the rules *diverges*: every
behaviour you didn't observe is a bug waiting to happen. Translating the ROM *converges*:
the JavaScript does what the silicon did because it runs the same logic the same way, and a
frame-against-frame diff against a reference emulator (MAME) catches any place it doesn't.

These documents describe the strategies, in the order you'd apply them to a new game:

1. [Disassembly](01-disassembly.md) — recovering code and hardware structure from the ROM.
2. [Translation to "assembly-JavaScript"](02-translation.md) — turning Z80 routines into JS.
3. [Drafter testing & mutation](03-drafter-testing-and-mutation.md) — per-routine tests that prove they have teeth.
4. [Integration testing](04-integration-testing.md) — the MAME ground-truth harness.
5. [The pixel gate](05-pixel-gate.md) — byte-exact where it must be, tolerant where reality is.
6. [Porting a new game](06-porting-a-new-game.md) — the CPU / board / game layering in practice.

The running example throughout is **Donkey Kong** (Z80, Nintendo `dkong` board), the first
game translated here. Nothing about the method is DK-specific; see doc 6 for what transfers.
