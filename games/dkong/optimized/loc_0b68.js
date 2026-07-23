// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_0b68 — hand-optimized rewrite of the translated routine at ROM 0x0B68,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Its callees (0x0038 = rst 0x38, and 0x0DA7 = sub_0da7)
 * are reached through `m.call`, the routine registry (games/dkong/routines.js),
 * so each resolves to the oracle — or to a future optimized rewrite — never a
 * copy. Only RAM *names* are imported (ram.js).
 */

import { FRAME, SUBSTATE_TIMER, INTRO_STEP } from "./ram.js";

/**
 * loc_0b68 -- opening-cutscene phase 6: walk the 0x63C4 record table, render a
 * record every other frame, count down to the next phase. [ROM 0x0B68-0x0BB2;
 * entry 6 of loc_0a76's 0x0A7A rst-0x28 table, reached via dispatchGameState
 * while GAME_SUBSTATE(0x600A)==7 and INTRO_STEP(0x6385)==6.]
 *
 * WHAT IT DOES. Steps the Kong-climb intro's "unpack the next scripted record"
 * animation. Three data-dependent paths:
 *
 *   GATE  -- FRAME(0x601A) bit0 rotated into carry; if set (odd frame) return at
 *            once. So the render advances only on even frames (half rate).
 *
 *   Then it reads the byte at the INDIRECT walk pointer 0x63C4 and compares 0x7F:
 *
 *   ADVANCE (byte != 0x7F) -- an ordinary record byte. Bump 0x63C4 by one, then
 *            apply the byte to a pair of object slots via two rst 0x38 (0x0038)
 *            signed-add passes: `+byte` into the four 0x690B bytes, then `-1`
 *            into the four 0x6908 bytes. Return.
 *
 *   SENTINEL (byte == 0x7F) -- the ROM table is exhausted. RESET the walk pointer
 *            to 0x38CB (loop the table), fire sound latch 0x6082 (=3), then index
 *            the record table at 0x38DC by (0x638D-1)*16, `ex de,hl`, and call
 *            sub_0da7 (0x0DA7) to unpack that record into the 0x63AB.. region.
 *            Then `dec (0x638D)`:
 *              C1 (still nonzero) -- more records to render; return.
 *              C2 (hit zero)      -- last record: arm SUBSTATE_TIMER(0x6009)=0xB0
 *                 (a 176-frame countdown) and `inc (0x6385)` to advance INTRO_STEP
 *                 so the next NMI dispatches phase 7 (loc_0bb3). Return.
 *
 * INPUTS: FRAME(0x601A); the walk pointer 0x63C4 and the ROM bytes it points at;
 *   the record index/countdown 0x638D. OUTPUTS: 0x63C4 (advanced or reset); the
 *   object bytes at 0x690B/0x6908 (via rst 0x38, ADVANCE); sound latch 0x6082 and
 *   the 0x63AB.. records (via sub_0da7, SENTINEL); 0x638D (decremented);
 *   SUBSTATE_TIMER and INTRO_STEP (C2 only).
 *
 * FLAGS. Nothing downstream consumes loc_0b68's flags -- its caller is the NMI
 *   game-state dispatch tail (dispatchGameState), which makes no `ret cc` and
 *   branches on no flag it sets; the NMI epilogue restores AF/BC/DE/HL/IX/IY. But
 *   the unit gate compares the WHOLE register file (F and pc included), so every
 *   flag- and register-writer is kept verbatim and in order: `rrca` (GATE carry),
 *   `cp 0x7f` (the sentinel test), `dec a` + 4x `rlca` (the *16 index), and the
 *   final `dec (hl)` / `inc (hl)`. A, HL, DE, BC after each branch therefore match
 *   the oracle exactly -- including whatever rst 0x38 / sub_0da7 leave, since both
 *   sides invoke the identical callee through `m.call`.
 *
 * ATOMIC -- cycles collapsed to one lump per straight-line segment, each branch's
 *   TOTAL preserved exactly. loc_0b68 runs INSIDE the vblank NMI
 *   (dispatchGameState), which is non-reentrant (the NMI mask is the guard), and
 *   every callee it reaches (rst 0x38 -> sub_003d; sub_0da7 -> ... -> sub_2ff0)
 *   runs within that same NMI and none waits for vblank -- so the NMI never lands
 *   inside loc_0b68 or its callees. Its internal cycle DISTRIBUTION is thus
 *   unobservable and each segment's per-instruction m.step charges collapse to
 *   one. The TOTAL stays load-bearing (as part of the NMI's cost it feeds the
 *   main-loop spin count, README §2, SPIN_COUNT), so each branch's sum is kept
 *   exactly:
 *     GATE       28t                 (13 + 4 + 11)
 *     ADVANCE    147t + 2x rst 0x38  (109 + 28 + 10, plus the two m.call'd rsts)
 *     SENTINEL/C1 226t + sub_0da7    (194 + 32)
 *     SENTINEL/C2 271t + sub_0da7    (194 + 67 + 10)
 *   Whole-machine EQUAL over 700 frames (all four paths taken) confirms the totals
 *   (a wrong sum would diverge at 0x6019 / a shifted downstream NMI landing); the
 *   per-branch cycle-total teeth in the test pin each collapsed sum in isolation.
 *
 * NO HARDWARE WRITES. Every store loc_0b68 makes is work RAM (0x63C4, 0x6082,
 *   0x638D, 0x6009, 0x6385); the callees write only work/video RAM (sub_003d to
 *   (hl) in the 0x69xx object region, sub_0da7 to 0x63AB.. + video). There is no
 *   0x7Dxx latch write, so the collapse has no write-bus-cycle to preserve and no
 *   write-trace test is needed (contrast loc_0a8a's palette latches).
 */
export function loc_0b68(m) {
  const { regs, mem } = m;

  // ---- Frame gate: render only on even FRAME (bit0 == 0) ----
  regs.a = mem.read8(FRAME);
  regs.rrca(); // bit0 -> carry
  if (regs.fC) {
    m.ret(28); // ret c -- odd frame, skip. 13 + 4 + 11 = 28t
    return;
  }

  // ---- Read the current record byte via the indirect walk pointer 0x63C4 ----
  regs.hl = mem.read16(0x63c4); // the walk pointer
  regs.a = mem.read8(regs.hl); // the record byte
  regs.cp(0x7f); // 0x7F = table-end sentinel

  if (!regs.fZ) {
    // ---- ADVANCE: an ordinary record -- bump the pointer, apply the byte ----
    regs.hl = (regs.hl + 1) & 0xffff;
    mem.write16(0x63c4, regs.hl); // advance the walk pointer
    regs.hl = 0x690b; // object slot A
    regs.c = regs.a; // C = the record byte (signed add operand)
    m.push16(0x0b7f);
    m.step(0x0038, 109); // prologue 22 + pointer read/advance + rst = 109t
    m.call(0x0038); // rst 0x38: add +byte into the 0x690B object bytes
    regs.hl = 0x6908; // object slot B
    regs.c = 0xff; // C = -1
    m.push16(0x0b85);
    m.step(0x0038, 28); // ld hl 10 + ld c 7 + rst 11 = 28t
    m.call(0x0038); // rst 0x38: add -1 into the 0x6908 object bytes
    m.ret(10); // ret -- 10t
    return;
  }

  // ---- SENTINEL: table exhausted -- reset the pointer, render one record ----
  regs.hl = 0x38cb;
  mem.write16(0x63c4, regs.hl); // RESET the walk pointer (loop the ROM table)
  regs.a = 0x03;
  mem.write8(0x6082, regs.a); // 0x6082 = SND_TRIGGER[2] sound latch (3-frame assert)
  regs.hl = 0x38dc; // base of the ROM record table
  regs.a = mem.read8(0x638d); // 0x638D = record index / countdown
  regs.a = regs.dec8(regs.a); // index - 1
  regs.rlca();
  regs.rlca();
  regs.rlca();
  regs.rlca(); // four rlca = nibble swap = *16 for A < 16
  regs.e = regs.a;
  regs.d = 0x00;
  regs.addHl(regs.de); // HL = 0x38DC + (0x638D-1)*16
  regs.exDeHl(); // DE = the record address for sub_0da7
  m.push16(0x0ba4);
  m.step(0x0da7, 194); // prologue 22 + reset/index calc + call = 194t
  m.call(0x0da7); // render the record into the 0x63AB.. region

  regs.hl = 0x638d;
  regs.decMem8(mem, regs.hl); // dec the record countdown; sets Z
  if (regs.fNZ) {
    m.ret(32); // ret nz -- more records. ld hl 10 + dec 11 + ret 11 = 32t
    return;
  }

  // ---- Last record rendered -- arm the phase countdown, advance INTRO_STEP ----
  regs.a = 0xb0;
  mem.write8(SUBSTATE_TIMER, regs.a); // arm the 176-frame phase countdown
  regs.hl = INTRO_STEP; // 0x6385
  regs.incMem8(mem, regs.hl); // advance the cutscene step -> phase 7
  // ld hl 10 + dec 11 + ret-nz-not-taken 5 + ld a 7 + ld(6009) 13 + ld hl 10
  //   + inc(hl) 11 = 67t
  m.step(0x0bb2, 67);
  m.ret(); // ret -- 10t
}
