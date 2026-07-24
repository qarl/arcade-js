// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_0d5f — hand-optimized rewrite of the translated routine at ROM 0x0D5F,
 * proven equal to its oracle by the equivalence harness. Names its work-RAM operands
 * from ram.js; the sprite-record sub-fields (0x6903/0x690B) and ROM table addresses
 * (0x385C, 0x003D coefficient tables) stay hex.
 */

import { SUBSTATE_TIMER, GAME_SUBSTATE, BOARD, SPRITE_OBJ_BLOCK, SPRITE_BUFFER } from "./ram.js";

/**
 * loc_0d5f -- finish board setup: advance the substate and seed the board sprites.
 * [ROM 0x0D5F-0x0DA6]
 *
 * The tail of the per-board build chain (reached from loc_3fa0). It runs two setup
 * helpers (sub_0f56, sub_2441), then arms the sub-state machine: SUBSTATE_TIMER(0x6009)
 * = 0x40 and GAME_SUBSTATE(0x600A) += 1 (so the board-setup substate advances). It
 * copies a 0x28-byte sprite template from ROM 0x385C into SPRITE_OBJ_BLOCK (via sub_004e,
 * which leaves HL at 0x3884 — LIVE across the call), then an 8-byte ldir into
 * SPRITE_BUFFER. Finally, on BOARD(0x6227):
 *   - == 4 (100m rivets): seed the rivet sprite records (rst 0x38 fill + two sub_003d
 *     strided fills over SPRITE_BUFFER), then return.
 *   - else: test bit 1 of the board number (rrca x2); if set, return; otherwise adjust
 *     sprite-record field +3 (0x690B) by -4 via rst 0x38, then return.
 *
 * CYCLES -- PER-INSTRUCTION, not collapsed. Reached via the board-build chain (loc_3fa0)
 * and calling the interruptible sub_004e; atomicity across its callers is not pinned to
 * the mask-cleared NMI, so the per-instruction charges are kept verbatim (always
 * correct). Every `call`/`rst` keeps its push16/step scaffolding, and callees route
 * through m.call (the registry). The naming of SUBSTATE_TIMER/GAME_SUBSTATE/BOARD and
 * the documented HL-live-across-sub_004e idiom are the win.
 */
export function loc_0d5f(m) {
  const { regs, mem } = m;

  m.push16(0x0d62);
  m.step(0x0f56, 17);
  m.call(0x0f56);

  m.push16(0x0d65);
  m.step(0x2441, 17);
  m.call(0x2441);

  // arm the board-setup substate: SUBSTATE_TIMER = 0x40, GAME_SUBSTATE += 1.
  regs.hl = SUBSTATE_TIMER;
  m.step(0x0d68, 10);
  mem.write8(regs.hl, 0x40);
  m.step(0x0d6a, 10);
  regs.hl = (regs.hl + 1) & 0xffff; // -> GAME_SUBSTATE (0x600A)
  m.step(0x0d6b, 6);
  mem.write8(regs.hl, regs.inc8(mem.read8(regs.hl))); // inc (hl) -- sets flags
  m.step(0x0d6c, 11);

  // copy the 0x28-byte sprite template from ROM 0x385C into SPRITE_OBJ_BLOCK.
  // HL IS LIVE across sub_004e: it leaves HL = 0x385C + 0x28 = 0x3884, the source
  // the ldir below consumes -- do NOT re-derive HL.
  regs.hl = 0x385c;
  m.step(0x0d6f, 10);
  m.push16(0x0d72);
  m.step(0x004e, 17);
  m.call(0x004e);
  regs.de = SPRITE_BUFFER;
  m.step(0x0d75, 10);
  regs.bc = 0x0008;
  m.step(0x0d78, 10);
  m.ldirAt(0x0d78, 0x0d7a);

  regs.a = mem.read8(BOARD);
  m.step(0x0d7d, 13);
  regs.cp(0x04);
  m.step(0x0d7f, 7);

  if (regs.fZ) {
    // BOARD == 4 -- the 100m rivets setup arm (0x0D8B-0x0DA6).
    m.step(0x0d8b, 12); // jr z taken

    regs.hl = SPRITE_OBJ_BLOCK; // 0x6908
    m.step(0x0d8e, 10);
    regs.c = 0x44;
    m.step(0x0d90, 7);
    m.push16(0x0d91);
    m.step(0x0038, 11); // rst 0x38
    m.call(0x0038);

    regs.de = 0x0004;
    m.step(0x0d94, 10);
    regs.bc = 0x0210;
    m.step(0x0d97, 10);
    regs.hl = SPRITE_BUFFER; // 0x6900
    m.step(0x0d9a, 10);
    m.push16(0x0d9d);
    m.step(0x003d, 17); // call 0x003d
    m.call(0x003d);

    regs.bc = 0x02f8;
    m.step(0x0da0, 10);
    regs.hl = 0x6903; // SPRITE_BUFFER + 3
    m.step(0x0da3, 10);
    m.push16(0x0da6);
    m.step(0x003d, 17); // call 0x003d
    m.call(0x003d);

    m.ret(); // 0x0DA6 -- returns to loc_0d5f's caller
    return;
  }

  m.step(0x0d81, 7); // jr z not taken

  // test bit 1 of the board number by rotating it into carry (rrca x2).
  regs.rrca();
  m.step(0x0d82, 4);
  regs.rrca();
  m.step(0x0d83, 4);
  if (regs.fC) {
    m.ret(11); // ret c -- bit 1 of BOARD was set
    return;
  }
  m.step(0x0d84, 5);

  // adjust sprite-record field +3 (0x690B) by -4 via rst 0x38.
  regs.hl = 0x690b; // SPRITE_BUFFER + 0x0B
  m.step(0x0d87, 10);
  regs.c = 0xfc; // -4 signed
  m.step(0x0d89, 7);
  m.push16(0x0d8a);
  m.step(0x0038, 11); // rst 0x38
  m.call(0x0038);

  m.ret(); // 0x0D8A
}
