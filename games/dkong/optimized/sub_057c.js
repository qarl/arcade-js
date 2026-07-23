// SPDX-License-Identifier: GPL-3.0-only
/**
 * sub_057c — hand-optimized rewrite of the translated routine at ROM 0x057C,
 * proven equal to its oracle (../translated/state0.js) by the equivalence harness.
 *
 * One routine per file. Its one callee (0x0593) is reached through `m.call`, the
 * routine registry (games/dkong/routines.js), so it resolves to the oracle
 * (mainloop.js `sub_0593`) or to a future optimized rewrite — never a copy. No
 * RAM names are imported: sub_057c touches no fixed work-RAM address of its own
 * (it reads the caller's source through HL and writes through the caller's IX),
 * so its only literal is the tilemap row step, a ROM constant defined below.
 */

// -- sub_057c constants (ROM literals; NOT work-RAM, so none belong in ram.js) --
const VRAM_ROW_STEP = 0xffe0; // -0x20: back one tilemap row per digit (vertical draw)
const BYTE_COUNT = 0x0304; //    ld bc,0x0304 -> B=3 source bytes, C=4 (a dead marker,
//                               kept so the register file matches: C is never read)

/**
 * sub_057c -- unpack 3 source bytes into 6 nibbles up a video column (a BCD
 * digit renderer).  [ROM 0x057C-0x0592]
 *
 *   057d  eb           ex   de,hl              ; HL := source ptr (was DE, live-in)
 *   0580  11 e0 ff     ld   de,0xffe0          ; DE := row step (-0x20, up one row)
 *   0583  01 04 03     ld   bc,0x0304          ; B := 3 bytes, C := 4 (unused)
 *   0583  7e           ld   a,(hl)     ; loop  ; source byte
 *   0584  0f..0f       rrca x4                 ; A := high nibble (rotated low)
 *   0588  cd 93 05     call 0x0593             ; write HIGH nibble, IX -= 0x20
 *   058b  7e           ld   a,(hl)             ; same byte again
 *   058c  cd 93 05     call 0x0593             ; write LOW  nibble, IX -= 0x20
 *   058f  2b           dec  hl                 ; next source byte (DESCENDING)
 *   0590  10 f1        djnz 0x0583
 *   0592  c9           ret
 *
 * WHAT IT DOES. Called by sub_1486 (the on-board bonus-item display, phase 21) to
 * paint the 6-digit item value. DE (source pointer, e.g. ROM 0x01BF) and IX
 * (destination VRAM cell) are LIVE-IN. `ex de,hl` moves the source into HL and
 * parks the old HL in DE, which the very next `ld de,0xffe0` overwrites — so the
 * source survives only in HL and old-HL is discarded (irrelevant to the result).
 * For each of B=3 bytes: emit the HIGH nibble, then the LOW nibble, then step the
 * source DOWN (`dec hl`). The helper at 0x0593 masks A to a nibble, stores it at
 * (ix+0), and adds DE to IX (up one tilemap row). Six writes → six cells climbing
 * the column from IX. (Reachable only through sub_1486 — a transitive path the
 * reachcrawler originally missed.)
 *
 * INPUTS  : DE = source pointer, IX = destination VRAM cell (both live-in).
 * OUTPUTS : six nibble writes to VRAM via 0x0593; HL := source-3, DE := 0xFFE0,
 *           B := 0, C := 4, IX := IX-0xC0, A/F from the last 0x0593.
 * IDIOM   : the four `rrca`s are a nibble SWAP, not a shift — rotating A right
 *           four times puts the high nibble low, and 0x0593's `and 0x0f` keeps it.
 *           HL walks BACKWARDS while IX walks by DE, reversing source-byte order
 *           into display order.
 *
 * DEAD-CODE DROPPED. The oracle carries a NESTED `function sub_0593` copy, but
 * both call sites go through `m.call(0x0593)`, which resolves via the registry to
 * mainloop.js's exported `sub_0593` — the nested copy is never invoked. It is a
 * translator artifact and is simply omitted here; behaviour is unchanged because
 * both the oracle and this rewrite reach the SAME registry 0x0593.
 *
 * FLAGS. Kept verbatim (the unit gate compares F). Final F is whatever the last
 * `add ix,de` inside 0x0593 leaves (`dec hl` on a 16-bit reg and `djnz` set no
 * flags), and A is the last low nibble masked by 0x0593 — both match the oracle
 * by reproducing its exact operations.
 *
 * LADDER STATUS -- rung: named + documented + dead-code-dropped, PER-INSTRUCTION.
 * ATOMICITY: sub_057c's ONLY caller is sub_1486, which is dispatched from INSIDE
 * the vblank NMI (entry_0066 -> the 0x00CA game-state table -> loc_06fe -> the
 * 0x0702 sub-state table). The NMI clears its own mask on entry (0x7D84), so no
 * second NMI can land inside sub_1486 or its callees — sub_057c is therefore
 * ATOMIC on its one call path, and its internal cycle DISTRIBUTION would be free
 * to collapse to one total. It is kept PER-INSTRUCTION anyway, for the same
 * reason sub_1486 (its parent, same call path) documents: the body is dominated
 * by two `m.call(0x0593)` sites per iteration whose push16/step/call scaffolding
 * must stay at each call site regardless, so collapsing the few charges around
 * them buys essentially no readability while adding per-segment-total bookkeeping.
 * Per-instruction is byte-identical to the oracle, so it preserves each path's
 * TOTAL (which IS observable — it is part of the NMI's total, which sets the
 * main-loop spin count / PRNG entropy, README §2) for free. "When unsure, keep
 * per-instruction — it is always correct."
 */
export function sub_057c(m) {
  const { regs, mem } = m;

  regs.exDeHl(); // HL := source (was DE, live-in); old HL parked in DE...
  m.step(0x057d, 4);
  regs.de = VRAM_ROW_STEP; // ...and immediately overwritten with the -0x20 step.
  m.step(0x0580, 10);
  regs.bc = BYTE_COUNT; // B = 3 source bytes, C = 4 (dead).
  m.step(0x0583, 10);

  do {
    regs.a = mem.read8(regs.hl); // source byte
    m.step(0x0584, 7);
    for (const nxt of [0x0585, 0x0586, 0x0587, 0x0588]) {
      regs.rrca(); // x4 -> A's high nibble rotated into the low four bits
      m.step(nxt, 4);
    }
    m.push16(0x058b);
    m.step(0x0593, 17);
    m.call(0x0593); // write HIGH nibble, IX -= 0x20

    regs.a = mem.read8(regs.hl); // same byte again
    m.step(0x058c, 7);
    m.push16(0x058f);
    m.step(0x0593, 17);
    m.call(0x0593); // write LOW nibble, IX -= 0x20

    regs.hl = (regs.hl - 1) & 0xffff; // next source byte (descending)
    m.step(0x0590, 6);
    regs.djnz(); // B-- (sets no flags)
    m.step(regs.b ? 0x0583 : 0x0592, regs.b ? 13 : 8);
  } while (regs.b);

  m.ret(10); // ret @0x0592
}
