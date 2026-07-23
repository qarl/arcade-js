// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_16bb — hand-optimized rewrite of the translated routine at ROM 0x16BB,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Its three tail callees (0x16E1 / 0x16D5 / 0x16D0) are each
 * reached through `m.call`, the routine registry (games/dkong/routines.js), so they
 * resolve to the oracle — or to a future optimized rewrite — never a copy. No RAM
 * name is imported: every address loc_16bb touches (0x62A0, 0x63A3, 0x6910) is in
 * the board-object bookkeeping / engine-scratch region that ram.js deliberately
 * left hex (0x62A0/0x6910 unnamed; 0x63A3 unnamed, near the rejected 0x63A0), so
 * they stay hex here too rather than gaining an unevidenced name.
 */

/**
 * loc_16bb -- board-load VARIANT selector: entry 1 of loc_1615's 0x1637 rst-0x28
 * table. [ROM 0x16BB-0x16D0.]
 *
 * DISPATCH PATH. Runs INSIDE the vblank NMI during BOARD-ADVANCE:
 * dispatchGameState(GAME_STATE(0x6005)==3) -> loc_06fe -> loc_1615
 * (GAME_SUBSTATE(0x600A)==0x16) -> [BOARD(0x6227) bit0 clear, bit1 SET -> the
 * 0x1637 table] -> rst 0x28 on the 0x6388 selector -> this routine when
 * 0x6388==1.
 *
 * WHAT IT DOES. Clears the board-object flag at 0x62A0, then classifies the board
 * object by two RAM reads and dispatches one of three load paths:
 *   - xor a / ld (0x62A0),a         -- clear 0x62A0 to 0.
 *   - ld a,(0x63A3) / ld c,a        -- C = object descriptor byte (its bit 7 is
 *                                      tested on the low path).
 *   - ld a,(0x6910) / cp 0x5A       -- A = object code; compare against 0x5A.
 *   - jp nc,0x16E1  (A >= 0x5A)     -> loc_16e1 (the >= 0x5A classifier: it further
 *                                      splits on cp 0x5D and bit7(C) into 0x16EE
 *                                      reinit / 0x16D0 / 0x16D5).
 *   - else bit 7,c
 *   - jp z,0x16D5   (bit7 clear)    -> loc_16d5 (call 0x2602, rst 0x38, ret).
 *   - else (fall through to 0x16D0) -> loc_16d0 (0x62A0 = 1, then loc_16d5).
 * All three are TAIL calls (`return m.call`): loc_16bb pushes no return for them,
 * so each callee's own `ret` returns straight to loc_16bb's caller (the rst-0x28
 * dispatch tail). loc_16bb makes NO hardware (0x7Dxx) writes -- its one store is
 * work RAM (0x62A0) -- so, unlike loc_0a8a, the collapse has no --writes-trace
 * consequence and there is no write-trace test.
 *
 * INPUTS: RAM 0x63A3 (-> C) and 0x6910 (-> A, the branch discriminant).
 * OUTPUTS: RAM 0x62A0 := 0; and everything the selected callee writes. Registers
 * handed to the callee: A = (0x6910), C = (0x63A3) -- loc_16e1 consumes BOTH
 * (`cp 0x5d` on A, `bit 7,c`); loc_16d5/loc_16d0 reload from 0x63A3 themselves.
 *
 * FLAGS. loc_16bb's own flags (from xor / cp / bit) are load-bearing ONLY to pick
 * its internal branch; nothing downstream consumes them because every branch tail-
 * calls a routine that overwrites F before any ret (loc_16e1 `cp 0x5d`; loc_16d5's
 * sub_2602; loc_16d0 falls into loc_16d5). So the final observable F the unit gate
 * compares is the callee's, identical on both sides (same callee via m.call). The
 * xor / cp / bit are kept verbatim regardless: they also produce the A and C the
 * callees read, and computing carry/zero exactly is what selects the right branch.
 *
 * ATOMIC -- cycles collapsed to ONE total per branch (A 64t, B and C 82t each; the
 * jp cc costs 10t taken OR not, so B and C are equal). loc_16bb is dispatched from
 * inside the NMI, where the mask is held, so the vblank NMI can never land inside
 * it OR its callees -- its internal cycle DISTRIBUTION is therefore unobservable
 * and collapses to one m.step placed immediately before each tail call, so the
 * callee still starts at the oracle's exact cumulative cycle. The TOTAL stays
 * load-bearing -- as part of the NMI's cost it sets the main-loop vblank-spin count
 * (README §2, SPIN_COUNT) and where a LATER frame's NMI lands in diffed stack RAM
 * -- so each branch's sum is preserved exactly; whole-machine EQUAL confirms it,
 * and a wrong total (81) is caught (same downstream-landing teeth as loc_17b6).
 */
export function loc_16bb(m) {
  const { regs, mem } = m;

  // xor a / ld (0x62a0),a -- clear the board-object flag.
  regs.xor(regs.a); // A = 0
  mem.write8(0x62a0, regs.a);

  // ld a,(0x63a3) / ld c,a -- C = object descriptor (bit 7 tested on the low path).
  regs.a = mem.read8(0x63a3);
  regs.c = regs.a;

  // ld a,(0x6910) / cp 0x5a -- A = object code; classify against 0x5A.
  regs.a = mem.read8(0x6910);
  regs.cp(0x5a);

  if (regs.fNC) {
    // jp nc,0x16e1 -- (0x6910) >= 0x5A. own total 4+13+13+4+13+7+10 = 64t.
    m.step(0x16e1, 64);
    return m.call(0x16e1);
  }

  // bit 7,c -- test bit 7 of the descriptor.
  regs.bit(7, regs.c);

  if (regs.fZ) {
    // jp z,0x16d5 -- bit 7 clear. own total 64 + 8(bit) + 10(jp) = 82t.
    m.step(0x16d5, 82);
    return m.call(0x16d5);
  }

  // fall through to 0x16d0 -- bit 7 set. own total 64 + 8(bit) + 10(jp z n/t) = 82t.
  m.step(0x16d0, 82);
  return m.call(0x16d0);
}
