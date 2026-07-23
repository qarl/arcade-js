// SPDX-License-Identifier: GPL-3.0-only
/**
 * sub_0028 — hand-optimized rewrite of the translated routine at ROM 0x0028,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. sub_0028's `jp (hl)` tail is modelled by the translator's
 * `dispatchGameState` helper (translated/nmi.js) — the switch that turns the
 * computed target address into `m.call(target)` for every whitelisted rst-0x28
 * handler (and `throw NotImplemented` for anything else). `dispatchGameState` is
 * NOT a `prefix_hhhh` ROM routine, so it has no registry address and cannot be
 * reached with `m.call`; the oracle sub_0028 calls it DIRECTLY. This rewrite reuses
 * it exactly as the oracle does — imported from translated/ and called directly —
 * so there is a single implementation of the dispatcher and it can never drift, and
 * every actual handler is still reached through `m.call` INSIDE it, so an override
 * for a handler still applies. (This is the same sanctioned import-of-translated-
 * *code* exception loc_18c6 takes for its `loc_18c6_wrap` fragment; every other
 * callee — the handlers themselves — goes via m.call. No RAM *names* are read or
 * written by this routine, so nothing is imported from ram.js.)
 */

import { dispatchGameState } from "../translated/nmi.js";

/**
 * sub_0028 -- the `rst 0x28` inline-jump-table trampoline.  [ROM 0x0028-0x0037]
 *
 *   0028  87           add  a,a              ; A = index*2 (word stride)
 *   0029  e1           pop  hl               ; HL = table base (the rst return addr)
 *   002a  5f           ld   e,a
 *   002b  16 00        ld   d,0x00           ; DE = index*2, zero-extended
 *   002d  c3 32 00     jp   0x0032           ; a plain in-ROM hop, no state change
 *   0032  19           add  hl,de            ; HL = &table[index]  (loc_0032)
 *   0033  5e           ld   e,(hl)           ; E = target low byte
 *   0034  23           inc  hl
 *   0035  56           ld   d,(hl)           ; D = target high byte  (DE = target)
 *   0036  eb           ex   de,hl            ; HL = target, DE = &table[index]+1
 *   0037  e9           jp   (hl)             ; -> the handler (dispatchGameState)
 *
 * WHAT IT DOES. Every `rst 0x28` in the ROM is placed immediately in front of an
 * inline word table; the `rst`'s own return address (pushed by the caller, and
 * modelled at the call site by `m.push16(base)`) therefore POINTS AT that table.
 * sub_0028 pops that base, indexes it by A*2, reads the little-endian target word,
 * and `jp (hl)`s to it. It is the ROM's single computed-dispatch primitive, shared
 * by the NMI game-state table (base 0x00CA), the state-1/state-3 sub-state tables,
 * the cutscene/how-high sequence tables, the object-collision table, etc. -- one
 * body, many call sites, each supplying its own `site` label and (on the stack) its
 * own table base + A index.
 *
 * INPUTS: A = the dispatch index; the caller-pushed table base on the stack.
 *   `site` is a diagnostic string label ONLY -- it is threaded straight through to
 *   dispatchGameState and is read there solely to name the table in the
 *   NotImplemented message on an unwhitelisted target. It never affects behaviour
 *   on any reachable path, so it does not alter RAM/registers. Its default matches
 *   the oracle's ("0x00CA (NMI game state)") so a bare `sub_0028(m)` (the unit
 *   harness's call shape, and the NMI caller at nmi.js) behaves identically.
 * OUTPUTS handed to the dispatched handler (all load-bearing -- the oracle note
 *   records that the state handlers see them): A = index*2, HL = the target
 *   address, DE = &table[index]+1 (the pointer the `ex de,hl` leaves behind -- NOT
 *   the target; the oracle's inline comment is loose here), and the flags left by
 *   `add a,a` (S/Z/P/V) over-stamped with `add hl,de`'s (H/C, N=0). No work RAM is
 *   written; the `pop` reads the stack without clearing it (Z80 semantics), so the
 *   two return-address bytes stay resident below SP in diffed work RAM exactly as
 *   in the oracle. Every register op and its exact flag helper (`regs.add`,
 *   `regs.addHl`, `regs.exDeHl`) is kept VERBATIM so A/DE/HL/F match the oracle
 *   bit-for-bit; nothing here is dead churn to drop, and the unit gate compares the
 *   whole register file, F included.
 *
 * FLAGS: kept verbatim (above) -- the handoff flags are part of the contract.
 *
 * CYCLES -- PER-INSTRUCTION, NOT collapsed (deliberate; matches sub_0008/0010/0018
 *   and the rst family). sub_0028 is a LEAF reached via m.call from MANY callers,
 *   and atomicity is per-call-path: while the NMI-dispatch callers run with the
 *   vblank mask cleared, sub_0028 is also `m.call`d from IN-GAME dispatchers
 *   (loc_06fe and friends) whose downstream handlers are interruptible, so a
 *   collapse of this trampoline's cumulative cycle positions is NOT provably safe on
 *   every path -- and "when unsure, per-instruction is always correct." It is also
 *   structurally required here: the routine ends every path in `m.tick` (never
 *   `m.step`), which leaves `m.pcKnown` false across it BY DESIGN -- an NMI accepted
 *   inside would push a stale PC, so the machine asserts (throws) rather than push a
 *   guess. Keeping each instruction's own tick preserves that boundary structure and
 *   the exact 74-T-state total (4+10+4+7+10+11+7+6+7+4+4). Straight-line anyway
 *   (no data-dependent branch), so a collapse would buy no readability.
 */
export function sub_0028(m, site = "0x00CA (NMI game state)") {
  const { regs, mem } = m;

  // add a,a -- index * 2 (each table entry is a 2-byte word).
  regs.add(regs.a);
  m.tick(4);

  // pop hl -- the rst's own return address IS the inline table's base address.
  regs.hl = m.pop16();
  m.tick(10);

  // ld e,a / ld d,0 -- DE = the byte offset (index*2), zero-extended to 16 bits.
  regs.e = regs.a;
  m.tick(4);
  regs.d = 0x00;
  m.tick(7);

  // jp 0x0032 -- unconditional hop over the (elsewhere-shared) 0x0032 tail.
  m.tick(10);

  // add hl,de -- HL now points at table[index] (the target's low byte).
  regs.addHl(regs.de);
  m.tick(11);

  // ld e,(hl) / inc hl / ld d,(hl) -- read the little-endian target word into DE.
  regs.e = mem.read8(regs.hl);
  m.tick(7);
  regs.hl = (regs.hl + 1) & 0xffff;
  m.tick(6);
  regs.d = mem.read8(regs.hl);
  m.tick(7);

  // ex de,hl -- HL = target; DE keeps &table[index]+1.
  regs.exDeHl();
  m.tick(4);

  // jp (hl) -- transfer to the handler. Modelled by the shared dispatchGameState,
  // which routes the target through m.call (so handler overrides still apply) and
  // returns the target's skip-boolean for the skip-capable dispatch families.
  m.tick(4);
  return dispatchGameState(m, regs.hl, site);
}
