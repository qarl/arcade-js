// SPDX-License-Identifier: GPL-3.0-only
/**
 * sub_11a6 — hand-optimized rewrite of the translated routine at ROM 0x11A6,
 * proven equal to its oracle by the equivalence harness. A coordinator over three fill
 * helpers plus two direct object-slot marks; it names no work RAM.
 */

/**
 * sub_11a6 -- build the object slots at 0x6680/0x6690 and their sprite mirrors.  [ROM 0x11A6-0x11D2]
 *
 * Three call sites (0x1003 here from loc_0fd7, plus 0x1073 and 0x1140), each supplying HL.
 * It chains three fill helpers and marks two slots live:
 *   - sub_11ec: interleaved copy of the caller's HL record into 0x6683 (BC = 0x020E),
 *   - sub_122a: strided fill of ROM 0x3E08 into 0x6687 (BC = 0x020C -- HL reloaded, so this
 *     one is NOT the caller's record; 0x3E08 sits 4 below loc_0fd7's 0x3E0C),
 *   - IX = 0x6680; mark IX+0 (0x6680) and IX+0x10 (0x6690) live (= 0x01),
 *   - sub_11d3: permuting gather into 0x6A18 (B = 2, DE = 0x0010 stride; C still holds
 *     sub_122a's restored 0x0C -- the preservation sub_122a guarantees),
 *   - ret.
 *
 * CYCLES -- PER-INSTRUCTION, not collapsed. Reached from the board setups, whose atomicity
 * is not pinned to the mask-cleared NMI; every call keeps its push16/step scaffolding and
 * callees route through m.call (the registry).
 */
export function sub_11a6(m) {
  const { regs, mem } = m;

  // HL is this routine's live-in, passed through to sub_11ec.
  regs.de = 0x6683;
  m.step(0x11a9, 10);
  regs.bc = 0x020e;
  m.step(0x11ac, 10);
  m.push16(0x11af);
  m.step(0x11ec, 17);
  m.call(0x11ec);

  regs.hl = 0x3e08; // ROM table pointer, 4 below the caller's 0x3E0C
  m.step(0x11b2, 10);
  regs.de = 0x6687;
  m.step(0x11b5, 10);
  regs.bc = 0x020c;
  m.step(0x11b8, 10);
  m.push16(0x11bb);
  m.step(0x122a, 17);
  m.call(0x122a);

  regs.ix = 0x6680;
  m.step(0x11bf, 14);
  mem.write8((regs.ix + 0x00) & 0xffff, 0x01); // -> 0x6680
  m.step(0x11c3, 19);
  mem.write8((regs.ix + 0x10) & 0xffff, 0x01); // -> 0x6690, stride 0x10
  m.step(0x11c7, 19);

  regs.hl = 0x6a18; // a DESTINATION here
  m.step(0x11ca, 10);
  regs.b = 0x02; // B only -- C still holds sub_122a's restored 0x0C
  m.step(0x11cc, 7);
  regs.de = 0x0010; // a STRIDE here
  m.step(0x11cf, 10);
  m.push16(0x11d2);
  m.step(0x11d3, 17);
  m.call(0x11d3);

  m.ret(); // 0x11D2
}
