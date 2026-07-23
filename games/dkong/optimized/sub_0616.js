// SPDX-License-Identifier: GPL-3.0-only
/**
 * sub_0616 — hand-optimized rewrite of the translated routine at ROM 0x0616,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Both callees (0x05e9, 0x0583) are reached through
 * `m.call(0xADDR)` — the routine registry (games/dkong/routines.js) — so each
 * resolves to the oracle or to its own optimized rewrite once one exists, never a
 * copy. Only the RAM name CREDITS is imported (from ram.js).
 */

import { CREDITS } from "./ram.js";

/**
 * sub_0616 -- draw string 5, then render the credit count as one BCD byte.
 * [ROM 0x0616-0x0629]
 *
 *   0616  3e 05        ld   a,0x05        ; A = string index 5
 *   0618  cd e9 05     call 0x05e9        ; draw string 5 (handler_05e9)
 *   061b  21 01 60     ld   hl,0x6001     ; HL -> CREDITS
 *   061e  11 e0 ff     ld   de,0xffe0     ; DE = -32 (one tilemap ROW per digit)
 *   0621  dd 21 bf 74  ld   ix,0x74bf     ; IX -> VRAM destination
 *   0625  06 01        ld   b,0x01        ; B = 1 source byte to expand
 *   0627  c3 83 05     jp   0x0583        ; TAIL JUMP into loop_0583 (BCD expand)
 *
 * WHAT IT DOES. Two acts, no branches of its own:
 *   1. Loads the fixed string index 5 into A and calls handler_05e9 -- the shared
 *      doubly-indirected string handler -- which draws string 5 vertically into
 *      VRAM. handler_05e9 returns NORMALLY here: at its 0x3F terminator it borrows
 *      sub_0020's `pop hl / ret` tail, but the `pop hl` discards handler_05e9's own
 *      outstanding `push af` (from 0x05EE), NOT the 0x061B return address, so
 *      control comes back to 0x061B and sub_0616's tail below DOES run.
 *   2. Points HL at CREDITS (0x6001), sets DE = -32 so each expanded digit steps
 *      one tilemap row back (vertical text on the 270°-rotated screen), IX at the
 *      VRAM cell 0x74BF, B = 1 (one source byte), then TAIL JUMPS to loop_0583,
 *      which splits that byte into its two BCD nibbles and renders them. This is
 *      the on-screen "CREDIT nn" digit pair.
 *
 * The `jp 0x0583` is a TAIL jump, not a call: loop_0583's `ret` pops the return
 * address sub_0616's OWN caller pushed, so sub_0616 has no `ret` of its own and
 * pushes nothing before the jump. Modelled as `m.call(0x0583)` with NO preceding
 * `m.push16` -- loop_0583 performs the return to sub_0616's caller.
 *
 * INPUTS  (read):  memory at CREDITS (0x6001) + the string-5 pointer/char data
 *                  (both read inside the callees). Every incoming register is
 *                  overwritten before use, so nothing is read from the registers.
 * OUTPUTS (write): VRAM only -- string 5 (via handler_05e9) and the two credit
 *                  digits (via loop_0583/sub_0593). This routine's OWN body writes
 *                  no work RAM; registers/flags are left exactly as loop_0583
 *                  leaves them.
 *
 * FLAGS. sub_0616's own body sets NO flags -- every instruction here is a plain
 * `ld` (no flag effect) or a transfer of control. The observable register+flag
 * state at exit is produced entirely by the callees reached through m.call, so it
 * matches the oracle by construction; the unit gate (which compares the whole
 * register file incl. F, and pc) confirms it. Nothing to keep or drop.
 *
 * CYCLES -- PER-INSTRUCTION, NOT collapsed. sub_0616 is NOT atomic. It calls
 * handler_05e9 (interruptible -- itself a main-loop task handler) and tail-jumps
 * into loop_0583 -> sub_0593 (also interruptible), and EVERY call path that
 * reaches sub_0616 runs with the vblank NMI mask ENABLED: entry_0611's task-table
 * fall-through from the main loop (ROM 0x0611), loc_141e (0x141E), sub_1486
 * (0x1489), and the state-0 attract site at 0x08F0. So the NMI CAN land inside
 * this routine, and WHERE it lands -- hence which PC it pushes into the compared
 * stack RAM -- depends on the exact per-instruction cumulative cycle position.
 * Collapsing the charges would move that landing and diverge. (This is the very
 * mechanism entry_0611 documents: entry_0611 keeps its own fall-through TOTAL
 * precisely because its interruptible callee is THIS routine.) So each
 * `m.step(target, tstates)` is kept verbatim at the oracle's cycle, and the
 * `m.push16(0x061b)` before the 0x05e9 call is kept as the calling convention
 * (handler_05e9's `ret` balances it). This rung buys names + documentation +
 * structure, not fewer operations.
 */
export function sub_0616(m) {
  const { regs } = m;

  // ld a,0x05 -- string index 5 for the shared string handler.
  regs.a = 0x05;
  m.step(0x0618, 7);

  // call 0x05e9 -- draw string 5. Returns normally to 0x061b (see header).
  m.push16(0x061b);
  m.step(0x05e9, 17);
  m.call(0x05e9);

  // Set up the one-byte BCD expansion of CREDITS into VRAM 0x74BF.
  regs.hl = CREDITS; // 0x6001
  m.step(0x061e, 10);
  regs.de = 0xffe0; // -32: step one tilemap row back per digit (vertical text)
  m.step(0x0621, 10);
  regs.ix = 0x74bf; // VRAM destination (display RAM, not work RAM -> stays hex)
  m.step(0x0625, 14); // DD-prefixed ld ix,nn
  regs.b = 0x01; // one source byte
  m.step(0x0627, 7);

  // jp 0x0583 -- TAIL jump into loop_0583; its ret returns to sub_0616's caller.
  m.step(0x0583, 10);
  m.call(0x0583);
}
