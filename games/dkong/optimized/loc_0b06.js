// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_0b06 — hand-optimized rewrite of the translated routine at ROM 0x0B06,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Every callee (0x0038, 0x004E, 0x304A, 0x0DA7) is reached
 * through `m.call`, the routine registry (games/dkong/routines.js), so each
 * resolves to the oracle — or to a future optimized rewrite — never a copy. Only
 * RAM *names* are imported (from ram.js).
 */

import { FRAME, SUBSTATE_TIMER, INTRO_STEP } from "./ram.js";

/**
 * loc_0b06 -- opening-cutscene table walker / terminal setup. [ROM 0x0B06-0x0B67;
 * one entry of loc_0a76's 0x0A7A rst-0x28 table, dispatched via dispatchGameState
 * (the NMI game-state path) while GAME_SUBSTATE(0x600A)==7 and INTRO_STEP(0x6385)
 * selects this index during the Kong-climb intro.]
 *
 * WHAT IT DOES. Every other frame (a FRAME-parity gate) it walks the ROM record
 * table pointed at by the indirect walk pointer 0x63C2 (seeded to 0x38B4 by
 * loc_0a8a), one byte per call, appending each byte through sub_0038 to the 0x690B
 * display-list cell. When the walk reaches the 0x7F terminator it performs the
 * phase-end setup instead. Three data-dependent paths:
 *
 *   A — PARITY GATE (bit0 of FRAME set): `ld a,(FRAME) / rrca / ret c`. On odd
 *       frames the routine does nothing but return. (Halves the walk rate so the
 *       cutscene scrolls at the intended speed.)
 *   B — WALK A NON-SENTINEL BYTE (*0x63C2 != 0x7F): read the table byte, advance
 *       0x63C2 by one, and `rst 0x38` (sub_0038) to add that byte into the running
 *       total at 0x690B. Returns.
 *   C — THE 0x7F SENTINEL -> TERMINAL SETUP: the walk is finished, so
 *         - sub_004E copies 0x28 bytes from ROM 0x385C (it LEAVES HL = 0x3884),
 *         - `ldir` 8 bytes FROM 0x3884 (HL is NOT reloaded) into 0x6900,
 *         - two `rst 0x38` adds: +0x50 into 0x6908, and +(-4)=0xFC into 0x690B,
 *         - spin `call 0x304A` until 0x638E reaches 0x0A (a synchronous advance),
 *         - store 3 to the 0x6082 sound-trigger latch (a 3-frame audio assert),
 *         - call 0x0DA7 with DE=0x392C (unpack another ROM record table),
 *         - stamp two video-RAM cells 0x74AA/0x748A <- 0x10, write 0x638D <- 5,
 *         - arm SUBSTATE_TIMER(0x6009) <- 0x20 (a 32-frame phase countdown),
 *         - `inc (INTRO_STEP)` to advance the cutscene step (HL stays 0x6385),
 *         - seed loc_3069's pointer 0x63C0 <- 0x6385.
 *
 * INPUTS: FRAME (0x601A, parity gate); the indirect walk pointer 0x63C2 and the
 *   ROM table it addresses; on path C the ROM tables at 0x385C/0x392C and the loop
 *   variable 0x638E. OUTPUTS: path B -> 0x63C2 (advanced) + 0x690B (via sub_0038);
 *   path C -> 0x6900..0x6908/0x690B display list, 0x6082, video RAM 0x74AA/0x748A,
 *   0x638D, SUBSTATE_TIMER, INTRO_STEP (incremented), 0x63C0, plus whatever
 *   sub_004E/sub_0DA7/sub_304A write.
 *
 * FLAGS. The caller (dispatchGameState's rst-0x28 tail) makes no `ret cc` and
 *   branches on no flag loc_0b06 sets — but the unit gate compares the whole
 *   register file (F included), so every flag/value writer is kept verbatim:
 *   `rrca` (path A's carry return value AND A's final rotated value), `cp 0x7f`
 *   (path selector; A/flags), and path C's `inc (0x6385)`. A ends 0x20 on path C
 *   (the last `ld a,0x20`), the rotated FRAME on path A; HL ends 0x6385 on path C.
 *   Everything else in the register file is left by the callees, which run
 *   identically because they are reached via `m.call`.
 *
 * ATOMIC — cycles collapsed per branch, each branch's TOTAL preserved. loc_0b06
 *   runs INSIDE the vblank NMI (dispatchGameState), which does not re-enter, so
 *   the NMI never lands inside it OR any callee — its internal cycle DISTRIBUTION
 *   is unobservable and the per-instruction m.step charges collapse to ONE per
 *   straight-line segment. The TOTAL stays load-bearing (as part of the NMI's cost
 *   it sets the main-loop spin count, README §2), so each segment's sum is
 *   preserved exactly. The collapse is done PER INTER-CALL SEGMENT rather than one
 *   lump per branch, deliberately: charging each segment's glue immediately before
 *   its m.call keeps the ABSOLUTE clock at every callee's entry byte-identical to
 *   the oracle, so if any callee makes a hardware write its trace bus-cycle is
 *   unchanged. loc_0b06 itself makes NO hardware write — the 0x74AA/0x748A writes
 *   are video RAM (isHardwareWrite is false there), so no --writes trace entry and
 *   no write-trace test is needed (cf. loc_0a8a's video-RAM epilogue). Whole-
 *   machine EQUAL across all three branches confirms the totals (a wrong total
 *   would diverge downstream via the spin count / shifted NMI landing).
 */
export function loc_0b06(m) {
  const { regs, mem } = m;

  // ld a,(FRAME) / rrca -- rotate the parity bit (bit0) into carry.
  regs.a = mem.read8(FRAME);
  regs.rrca();
  if (regs.fC) {
    // -- PATH A: ret c taken -- odd frame, do nothing. total 13+4+11 = 28t.
    m.ret(28);
    return;
  }

  // gate open (13+4+5t so far). Read the indirect walk pointer and its byte.
  regs.hl = mem.read16(0x63c2); // ld hl,(0x63c2) -- INDIRECT walk pointer
  regs.a = mem.read8(regs.hl); // ld a,(hl) -- the table byte
  regs.cp(0x7f); // cp 0x7f -- 0x7F is the terminator

  if (!regs.fZ) {
    // -- PATH B: walk a non-sentinel byte, append it via sub_0038, return. --
    regs.hl = (regs.hl + 1) & 0xffff; // inc hl
    mem.write16(0x63c2, regs.hl); // advance the walk pointer
    regs.c = regs.a; // ld c,a -- the byte to add
    regs.hl = 0x690b; // rst 0x38 adds C into (0x690b..)
    m.push16(0x0b1d);
    // 13+4+5(prologue) + 16+7+7(indirect load/cp) + 10(jp z not taken)
    //   + 6+16+4+10(inc/store/ldc/ldhl) + 11(rst call-site) = 109t
    m.step(0x0038, 109);
    m.call(0x0038);
    m.ret(); // ret @0x0B1D (10t) -- pops loc_0b06's return
    return;
  }

  // -- PATH C: the 0x7F sentinel -> terminal phase setup. --

  // Copy 0x28 bytes from ROM 0x385C via sub_004E, which LEAVES HL = 0x3884.
  regs.hl = 0x385c;
  m.push16(0x0b24);
  // 13+4+5(prologue) + 16+7+7(indirect load/cp) + 10(jp z taken)
  //   + 10(ld hl,385c) + 17(call 004e call-site) = 89t
  m.step(0x004e, 89);
  m.call(0x004e);

  // ldir 8 bytes FROM 0x3884 (HL untouched -- sub_004E left it there) into 0x6900.
  regs.de = 0x6900;
  regs.bc = 0x0008;
  m.step(0x0b2a, 20); // ld de (10) + ld bc (10)
  m.ldir(0x0b2c); // ldir -- charges its own 163t; leaves HL=0x388C/DE=0x6908/BC=0

  // rst 0x38: add +0x50 into the display-list cell 0x6908.
  regs.hl = 0x6908;
  regs.c = 0x50;
  m.push16(0x0b32);
  m.step(0x0038, 28); // ld hl (10) + ld c (7) + rst 0x38 opcode (11)
  m.call(0x0038);

  // rst 0x38: add +0xFC (== -4) into 0x690B.
  regs.hl = 0x690b;
  regs.c = 0xfc;
  m.push16(0x0b38);
  m.step(0x0038, 28); // ld hl (10) + ld c (7) + rst 0x38 opcode (11)
  m.call(0x0038);

  // do { call 0x304A } while ((0x638E) != 0x0A) -- synchronous advance to 0x0A.
  for (;;) {
    m.push16(0x0b3b);
    m.step(0x304a, 17); // call 0x304A call-site
    m.call(0x304a);
    regs.a = mem.read8(0x638e); // ld a,(0x638e)
    regs.cp(0x0a); // cp 0x0a
    if (regs.fZ) {
      m.step(0x0b43, 30); // ld a (13) + cp (7) + jp nz NOT taken (10) -> exit
      break;
    }
    m.step(0x0b38, 30); // ld a (13) + cp (7) + jp nz taken (10) -> loop
  }

  // store 3 to the 0x6082 sound-trigger latch (a 3-frame audio assert), then
  // call 0x0DA7 with DE = 0x392C (unpack another ROM record table).
  regs.a = 0x03;
  mem.write8(0x6082, regs.a); // ld (0x6082),a
  regs.de = 0x392c;
  m.push16(0x0b4e);
  // 7(ld a,03) + 13(ld(6082)) + 10(ld de,392c) + 17(call 0da7 call-site) = 47t
  m.step(0x0da7, 47);
  m.call(0x0da7);

  // Epilogue: stamp two video-RAM cells, arm the timer, advance the step, seed
  // 0x63C0. No hardware writes (video + work RAM only) and atomic, so the ten
  // per-instruction charges collapse to one 110t total.
  regs.a = 0x10;
  mem.write8(0x74aa, regs.a, 10); // video-RAM cell (isHardwareWrite=false)
  mem.write8(0x748a, regs.a, 10); // video-RAM cell (isHardwareWrite=false)
  regs.a = 0x05;
  mem.write8(0x638d, regs.a); // record index for the next phase
  regs.a = 0x20;
  mem.write8(SUBSTATE_TIMER, regs.a); // arm the 32-frame phase countdown
  regs.hl = INTRO_STEP; // 0x6385
  regs.incMem8(mem, regs.hl); // inc (hl) -- advance the cutscene step; HL stays 0x6385
  mem.write16(0x63c0, regs.hl); // seed loc_3069's pointer

  // ld a,0x10 (7) + ld(74aa) (13) + ld(748a) (13) + ld a,0x05 (7) + ld(638d) (13)
  //   + ld a,0x20 (7) + ld(6009) (13) + ld hl (10) + inc(hl) (11) + ld(63c0),hl (16)
  //   = 110t
  m.step(0x0b67, 110);
  m.ret(); // ret (0x0B67) -- 10t; pops loc_0b06's return
}
