# games/dkong/optimized/ — idiomatic-JS rewrites

The translation in `../translated/` is deliberately close to the original Z80 assembly: each
routine mirrors the instruction sequence, T-state charges and all. That faithfulness is what
makes it validate against MAME — but it is not idiomatic JavaScript.

This directory is where individual routines get **rewritten as ordinary, higher-level
JavaScript** — same behaviour, clearer code. The rule that makes it safe:

> An optimized routine may replace its `translated/` counterpart **only after it passes the
> gates that prove equivalence**. Equivalence is proven, never assumed.

The manifest selects, per routine, whether the machine dispatches into `translated/` or
`optimized/`, so the two coexist and the optimized set grows one proven routine at a time.

## The four decisions this project runs on

### 1. `translated/` is never edited — it is the oracle

It is not legacy code awaiting replacement. Its value is **evidential**: every routine sits
directly beneath its own disassembly, so `mem.write8(0x6007, …)` lines up character-for-
character with `ld (0x6007),a` in the docstring above it. That is what lets a reader check the
translation is faithful. Rename those addresses and it stops being a translation and becomes an
interpretation — destroying the only thing that makes the claim checkable.

So the addresses stay hex **here**, and meaning lives over **there**, in this directory.

It also means `translated/` never goes stale: an optimized routine is proven against it, so it
stays permanently exercised as the reference rather than rotting once the manifest routes past
it.

**The rule is simply: `translated/` is never changed** (after the one-time retrofits below). An
optimized routine reuses the oracle's own implementation of any callee it hasn't rewritten, so
there is one implementation and never a copy that can drift. The reuse works through the **routine
registry** (`../routines.js`): every call is written `m.call(0xADDR)`, which resolves the address
to the optimized rewrite if one exists, else the oracle. So an optimized routine names its callees
by address and never imports them — and installing an override swaps that callee at *every* call
site, not just the two dispatch points, which is what lets a leaf subroutine go live at all. The
only imports here are RAM *names* (from `ram.js`) and the odd error class (`NotImplemented`, for an
untranslated stub); code — every callee — is reached by address, never imported. See `docs/02` for the
`m.call`, export-everything, and one-file-per-routine conventions the next game writes from line one.

(Donkey Kong predates those conventions, so two one-time, behaviour-neutral, gate-verified passes
were made before/around optimization: every routine was `export`ed, and its ~880 call sites were
converted to `m.call`. Both are provably identical with an empty override map. Future games do it
from the first line, and `translated/` is then genuinely frozen.)

### 2. A routine's TOTAL cycle cost is preserved; its distribution is free

This section was wrong twice before the harness pinned it down — a good example of why the rule
here is *measured*, not reasoned. The instinct is that `m.step(addr, tstates)` charges are
load-bearing because the NMI fires on accumulated cycles. The counter-instinct (that the ROM's
own wait-for-vblank spin makes cycles free) is *also* wrong. Here is what is actually true.

`mainLoop` (ROM 0x02BD) does its per-frame work and then **spins until the NMI moves the frame
counter** — an explicit wait-for-vblank. The NMI fires at a fixed cycle interval, so the spin
absorbs *whatever cycle slack the frame's work leaves*: `spin = CYCLES_PER_FRAME − (work
cycles)`. And the number of spin iterations **is the PRNG's entropy** (`SPIN_COUNT` = 0x6019,
feeding `RNG` = 0x6018). Make the frame's work cheaper and it reaches the spin sooner, spins one
more time, and reseeds the PRNG.

> **So a routine's TOTAL cycle cost is observable — for EVERY routine, main-loop or NMI —
> because the spin count absorbs the difference. Its internal DISTRIBUTION is not: you can
> replace a routine's per-instruction `m.step()` charges with a SINGLE charge of the same total
> and nothing downstream can tell.**

Both halves are harness-proven, on two routines from the two dispatch paths, and they gave the
*same* answer:

| routine | dispatch | strip ALL cycles | collapse to one total charge |
|---|---|---|---|
| `handler_01c3` | NMI (game-state) | diverges @ 0x6019, 65→66 | (kept per-instr.; equivalent) |
| `handler_05c6` | main loop (task) | diverges @ 0x6019, 65→66 | **EQUAL** |

Identical divergence address and values from both paths — so `handler_01c3`'s divergence was
never NMI-specific; it is the spin-count mechanism, which is universal.

**The de-scaffolding, therefore:** you do *not* drop the cycle charges, but you do *not* keep one
per instruction either. Compute each executed path's total and charge it once — `m.step(entry,
TOTAL)` per branch. `handler_05c6` went from eleven `m.step` calls to one per branch (58 or 68
cycles), which is most of the readability win with the total preserved exactly. Optimization
buys names, structure, dropped register churn, and this collapse — never fewer *total* cycles.
(A routine whose total genuinely doesn't reach the spin-count-sensitive path could in principle
drop them, but neither routine we've measured is that routine — so the rule is: preserve the
total unless the harness says otherwise, and it has not yet.)

Two further caveats, narrower:

- **Overrunning frames.** If the original ever took longer than a frame, the NMI lands mid-logic
  and interleaving becomes real — and speeding that frame up would diverge from MAME by *fixing*
  a slowdown the hardware had. Don't assume DK never overruns: **assert that every frame reaches
  the spin**, so an exception announces itself instead of hiding.
- **DMA and the watchdog.** Sprite DMA steals cycles and reading `0x7D00` kicks the watchdog;
  both are timing-coupled. The known ~98 px difference on Pauline during Kong's climb is a
  DMA-timing artifact — proof that timing reaches pixels at least a little.

- **The calling convention is not scaffolding.** Each callee ends in its own `ret`, which pops a
  return address; the `m.push16(retaddr)` before the call is what balances it. Drop the push and
  the callee's `ret` unbalances SP (a register the harness compares). So `m.push16(addr); callee(m)`
  stays as a pair even in idiomatic code — only the `m.step()` cycle charge between them is a
  candidate for removal (and only for main-loop routines, per above).

### 3. Flags are paid for in `translated/` so they can be dropped here

Z80 flags are load-bearing in the translation: later instructions branch on them (`jr nz`,
`ret c`), and the NMI pushes `AF` to the stack, so flag bits reach RAM and the state diff.

Idiomatic JavaScript does not compute a half-carry, and it shouldn't have to. The rule is not
"optimized code ignores flags", it is:

> **An optimized routine must leave observable state identical. A flag it never sets is fine
> only if nothing reads it before it is overwritten.**

That is a provable property, not a preference. Some routines end in `ret cc`, where the carry
*is* the return value and the caller branches on it — the translation already models these by
returning `true`/`false`. So the equivalence harness needs to know, per routine, whether the
caller consumes flags. Take that from the disassembly (the `ret cc`, the branch after the
call), never from taste.

### 4. Names are interpretation; they need evidence

`ram.js` here maps addresses to meaning — `0x6203` → Mario's X. That is a *claim*, not a fact
of the ROM, which is why it lives in this directory rather than beside the manifest.

A wrong name is worse than hex. `0x6203` is honestly opaque; `MARIO_X` on the barrel's X
actively misleads every future reader and will be believed. So:

> **Name only what can be evidenced. Leave the rest hex.** An unnamed address is fine; a
> confidently wrong one is not.

Evidence is cheap here, which is what makes review worth doing: change one thing in the game and
watch which byte moves. A reviewer can *re-derive* a claim rather than judge it — so the agent
that proposes a name must never be the one that confirms it.

## The equivalence harness

Build this **before** the first rewrite, so the first rewrite has something to prove itself
against. Per routine, run `translated/` and `optimized/` from identical machine state and assert
identical observable results:

- **RAM** — always. This is the real contract.
- **Registers/flags** — only where the routine's contract says the caller consumes them.
- **Cycles** — not required (see §2), but the frame must still reach the vblank spin.

This is a far tighter gate than pixels: it catches a wrong flag that never reaches the screen,
which is exactly how a subtly-wrong optimization fails. The state diff and write diff exist for
the same reason — "same pixels, different RAM" and "same RAM, different write order" are the
failure modes that a pixel gate alone lets through.
