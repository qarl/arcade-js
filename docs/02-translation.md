# 2. Translation to "assembly-JavaScript"

Each ROM routine becomes a JavaScript function that operates on a machine object `m` and mirrors
the original Z80 instruction sequence **one instruction at a time**. We call the result
*assembly-JavaScript*: it is JavaScript, but its shape is the assembly's.

## What a translated routine looks like

A routine reads and writes the CPU registers (`m.regs`), memory (`m.mem`), and hardware (`m.io`),
and calls `m.step(addr, tstates)` at each instruction to advance the program counter to that
address and charge the instruction's T-states. For example, a fragment that loads a byte, tests
it, and branches translates to the equivalent register/flag operations plus the `m.step(...)`
calls that account for exactly the cycles the Z80 spent.

Faithfulness is the whole point:

- **T-states are charged, not ignored.** The cycle budget per frame is fixed by the hardware, and
  the video output depends on *when* within the frame each write lands. A translation that gets the
  logic right but the timing wrong fails the pixel gate. `stepcheck` audits that every `m.step`
  target lands on a real instruction boundary — a cycle error that moves no memory is invisible to
  the state and pixel diffs, so it needs its own check.
- **Flags are exact,** including the awkward ones (`DAA`/BCD, half-carry, parity/overflow, the
  signed vs unsigned distinctions). Each flag helper was pinned against the reference CPU across
  all cases before use.
- **Control flow is modelled honestly.** Tail-jumps that discard the current return address are
  modelled as returns to the caller's caller; the `rst`-dispatch tables become switch/dispatch on
  the same state byte; "caller-skip" idioms (a subroutine that pops its own return to skip the
  caller's remainder) are modelled as an early return the caller checks. Getting these wrong
  changes *which* frame resumes where, so they are translated as the ROM actually behaves.

## Why translation converges

Because the JavaScript runs the ROM's real logic, correctness is a property you can *drive toward*
rather than *guess at*: wherever the translation diverges from the reference emulator, the diff
points at the exact routine that ran on the diverging frame, and you fix that routine. Coverage
grows monotonically — a routine, once translated and gated, stays correct. Contrast reimplementation
from observation, where an unobserved case is simply absent and nothing tells you it's missing.

## Faithful now, idiomatic later

Assembly-JavaScript is deliberately *not* idiomatic JavaScript — it trades readability for a
provable correspondence to the ROM. Rewriting individual routines as ordinary, higher-level JS is a
separate, later project: an optimized routine may replace its translated counterpart only after it
passes the same gates that prove equivalence (unit + mutation + pixel). See `games/<id>/optimized/`.

### Convention: export every translated routine

**Every top-level routine in `translated/` is `export`ed — no exceptions, from the first line of
a new game.** The optimization layer reuses the oracle's own implementation of any callee it
hasn't rewritten yet, so each routine has exactly one implementation and there is never a copy to
drift out of sync. You cannot predict which routines a future rewrite will call, so exporting them
all up front is the only way to avoid discovering a missing export mid-optimization and being
tempted to paste a verbatim copy into `optimized/` (which reintroduces the drift the whole design
avoids).

Do this *at translation time*, as you write each routine — not later. That is the whole point:
once every routine is exported up front, the optimization layer never needs to reach into
`translated/`, so the rule there stays the simplest possible one — **`translated/` is never
changed.** (`export function foo` runs identically to `function foo`, so it costs nothing.
Donkey Kong predates this convention and was exported in a one-time retrofit; the next game does
it from the first line.)
