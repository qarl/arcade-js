// SPDX-License-Identifier: GPL-3.0-only
/**
 * sub_11fa — hand-optimized rewrite of the translated routine at ROM 0x11FA,
 * proven equal to its oracle by the equivalence harness. A straight-line record scatter;
 * it names no work RAM (operands are the caller's HL and the fixed IX/DE bases).
 */

/**
 * sub_11fa -- scatter a source record into an IX object slot (and mirror it).  [ROM 0x11FA-0x1229]
 *
 * Reached from the per-board setups (loc_0fd7 supplies HL=0x3DF4). Straight-line, no loop.
 * IX = 0x66A0 (the object slot), DE = 0x6A28 (a mirror in the sprite buffer). It marks the
 * slot live (IX+0 = 0x01) then reads six consecutive source bytes (HL) and scatters them:
 *   src0 -> IX+3 and DE+0,  src1 -> IX+7 and DE+1,  src2 -> IX+8 and DE+2,
 *   src3 -> IX+5 and DE+3,  src4 -> IX+9 (no mirror), src5 -> IX+0A (no mirror).
 * The IX offsets are +3,+7,+8,+5 in that order (the same permutation sub_11d3 gathers), and
 * the DE mirror advances by `inc e` (D fixed) for the first four only, ending at 0x6A2B.
 * HL exits at source+6. The `ld (ix+d),0x01` at 0x1205 is the IMMEDIATE form (dd 36 d n).
 *
 * CYCLES -- PER-INSTRUCTION, not collapsed. Reached from the board setups, whose atomicity
 * is not pinned to the mask-cleared NMI, so charges are kept verbatim.
 */
export function sub_11fa(m) {
  const { regs, mem } = m;

  regs.ix = 0x66a0;
  m.step(0x11fe, 14);
  regs.de = 0x6a28;
  m.step(0x1201, 10);
  mem.write8((regs.ix + 0x00) & 0xffff, 0x01); // ld (ix+0x00),0x01 -- mark slot live
  m.step(0x1205, 19);

  // src0 -> IX+3, mirror DE+0
  regs.a = mem.read8(regs.hl); // HL is the caller's, never set here
  m.step(0x1206, 7);
  mem.write8((regs.ix + 0x03) & 0xffff, regs.a);
  m.step(0x1209, 19);
  mem.write8(regs.de, regs.a);
  m.step(0x120a, 7);
  regs.e = regs.inc8(regs.e); // `inc e` -- D untouched
  m.step(0x120b, 4);
  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x120c, 6);

  // src1 -> IX+7, mirror DE+1
  regs.a = mem.read8(regs.hl);
  m.step(0x120d, 7);
  mem.write8((regs.ix + 0x07) & 0xffff, regs.a);
  m.step(0x1210, 19);
  mem.write8(regs.de, regs.a);
  m.step(0x1211, 7);
  regs.e = regs.inc8(regs.e);
  m.step(0x1212, 4);
  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x1213, 6);

  // src2 -> IX+8, mirror DE+2
  regs.a = mem.read8(regs.hl);
  m.step(0x1214, 7);
  mem.write8((regs.ix + 0x08) & 0xffff, regs.a);
  m.step(0x1217, 19);
  mem.write8(regs.de, regs.a);
  m.step(0x1218, 7);
  regs.e = regs.inc8(regs.e);
  m.step(0x1219, 4);
  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x121a, 6);

  // src3 -> IX+5 (+5 AFTER +8), mirror DE+3 -- no inc e after, DE stays 0x6A2B
  regs.a = mem.read8(regs.hl);
  m.step(0x121b, 7);
  mem.write8((regs.ix + 0x05) & 0xffff, regs.a);
  m.step(0x121e, 19);
  mem.write8(regs.de, regs.a);
  m.step(0x121f, 7);
  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x1220, 6);

  // src4 -> IX+9 (no mirror)
  regs.a = mem.read8(regs.hl);
  m.step(0x1221, 7);
  mem.write8((regs.ix + 0x09) & 0xffff, regs.a);
  m.step(0x1224, 19);
  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x1225, 6);

  // src5 -> IX+0A (no mirror). HL exits at source+6.
  regs.a = mem.read8(regs.hl);
  m.step(0x1226, 7);
  mem.write8((regs.ix + 0x0a) & 0xffff, regs.a);
  m.step(0x1229, 19);

  m.ret(); // 0x1229
}
