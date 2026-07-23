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

**"Never edited" means its LOGIC and ADDRESSES never change — not that the file is frozen.**
Two behaviour-neutral changes are allowed, because they touch neither the logic nor the
disassembly correspondence a reader checks:

- **Every routine is `export`ed.** An optimized routine reuses the oracle's own implementation
  of any callee it hasn't rewritten (so there is one implementation, never a copy that can
  drift). We can't predict which routines a future rewrite will call, so *all* of `translated/`'s
  top-level routines are exported up front. `export function foo` runs identically to
  `function foo`; the body, the hex, and the mnemonics are untouched.
- That is the *only* license. Renaming an address, changing a value, restructuring control
  flow — anything that alters what runs or breaks the line-up with the disassembly — stays
  forbidden. The names go in `ram.js` and the optimized copy, never in `translated/`.

The rule that would have forced a *copy* of every unexported callee — reproducing a routine
verbatim in `optimized/` — is retired: it manufactured exactly the drift hazard this whole
design avoids. Exporting is strictly better and just as faithful.

### 2. The ROM self-synchronises, so cycles are mostly unobservable

The instinct is that `m.step(addr, tstates)` charges are load-bearing everywhere, because the
NMI fires on accumulated cycles — so an optimized routine that runs "instantly" would move the
interrupt and diverge. That is true in `translated/`, which *generates* the schedule. It is
mostly false here, and `mainLoop` (ROM 0x02BD) shows why: it compares `0x601a` against `0x6383`
and **spins until the NMI moves it**. An explicit wait-for-vblank. The machine deliberately
parks itself and idles until the frame boundary.

> **The cycle clock's only observable job is deciding where the NMI lands, and the ROM already
> decides that itself. For a routine that completes within the frame's work phase, its internal
> cycle distribution is unobservable.**

So an optimized routine does not need per-instruction `m.step()` calls. What it needs is for the
frame's work to still **reach the spin before vblank**.

**MEASURED CAVEAT — this only holds for MAIN-LOOP routines, NOT NMI-path routines.** The very
first routine we took down the ladder (`handler_01c3`, game-state-0 init) exposed the boundary,
and the harness proved it rather than us guessing. That routine runs *inside the NMI*, and the
NMI's total cycle cost sets when it returns — which sets how long the main loop then spins
before the next NMI. That spin count *is* the PRNG's entropy (`SPIN_COUNT` = 0x6019, feeding
`RNG` = 0x6018). So dropping the `m.step()` charges from an NMI-path routine is observable:
stripping them from `handler_01c3` diverged at **frame 5, address 0x6019, 65 vs 66** — one fewer
cycle in the NMI, one extra spin, a reseeded PRNG. The charges had to stay.

So the sharpened rule: **cycle distribution is unobservable for a routine that runs in the main
loop and finishes before the vblank spin. For a routine that runs inside the NMI, its total
cycle cost is observable through the spin count, and the `m.step()` charges must be preserved.**
Optimizing an NMI-path routine therefore buys readability (names, structure, dropped register
churn) but not fewer cycle charges — and the harness is what tells you which kind you have.

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
