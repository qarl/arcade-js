// SPDX-License-Identifier: GPL-3.0-only
/**
 * sub_306f — hand-optimized rewrite of the translated routine at ROM 0x306F,
 * proven equal to its oracle by the equivalence harness. It touches sprite-animation work
 * RAM (counter 0x62AF, sprite fields 0x6909/0x690B/0x691D/0x692D) that lacks settled ram.js
 * names, so those stay hex.
 */

/**
 * sub_306f -- every-8th-frame sprite animation tick.  [ROM 0x306F-0x3095]
 *
 * Three callers. It bumps the frame counter at 0x62AF every call and returns early on 7 of
 * every 8 (the `and 0x07` gate). On the 8th:
 *   - rst 0x38 subtracts 4 from each of 10 bytes at 0x690B (C=0xFC), and leaves DE=0x0004
 *     as the side effect the two sub_3096 calls consume,
 *   - sub_3096 twice (mask C=0x81) toggles fields at 0x6909 and 0x691D,
 *   - sub_0057 folds the PRNG (A = 0x6018+0x601A+0x6019, written back to 0x6018),
 *   - bit 7 of that sum XOR-toggles bit 7 of 0x692D (a sprite mirror/attribute).
 * The `xor (hl)` flags at 0x3094 escape through the `ret`.
 *
 * CYCLES -- PER-INSTRUCTION, not collapsed. Three call paths, not all provably mask-cleared;
 * the rst/call scaffolding is kept and callees route through m.call (the registry).
 */
export function sub_306f(m) {
  const { regs, mem } = m;

  regs.hl = 0x62af;
  m.step(0x3072, 10);
  mem.write8(regs.hl, regs.inc8(mem.read8(regs.hl))); // inc (hl) -- counter++, inc8 preserves carry
  m.step(0x3073, 11);
  regs.a = mem.read8(regs.hl);
  m.step(0x3074, 7);
  regs.and(0x07);
  m.step(0x3076, 7);
  if (regs.fNZ) {
    m.ret(11); // ret nz -- 7 of every 8 calls exit here
    return;
  }
  m.step(0x3077, 5);

  regs.hl = 0x690b;
  m.step(0x307a, 10);
  regs.c = 0xfc; // -4: loc_0038 subtracts 4 from each of 10 bytes
  m.step(0x307c, 7);
  // rst 0x38 -- a real CALL to loc_0038; sets DE=0x0004 as a side effect.
  m.push16(0x307d);
  m.step(0x0038, 11);
  m.call(0x0038);

  regs.c = 0x81; // XOR mask for the two sub_3096 calls
  m.step(0x307f, 7);
  regs.hl = 0x6909;
  m.step(0x3082, 10);
  m.push16(0x3085);
  m.step(0x3096, 17);
  m.call(0x3096); // DE=0x0004 from the rst; preserves DE and C

  regs.hl = 0x691d;
  m.step(0x3088, 10);
  m.push16(0x308b);
  m.step(0x3096, 17);
  m.call(0x3096); // DE still 0x0004 from the rst

  m.push16(0x308e);
  m.step(0x0057, 17);
  m.call(0x0057); // A = (0x6018)+(0x601A)+(0x6019), written back to 0x6018

  regs.and(0x80); // keep bit 7 of the sum
  m.step(0x3090, 7);
  regs.hl = 0x692d;
  m.step(0x3093, 10);
  regs.xor(mem.read8(regs.hl)); // xor (hl) -- toggle bit 7 of 0x692D
  m.step(0x3094, 7);
  mem.write8(regs.hl, regs.a);
  m.step(0x3095, 7);

  m.ret(); // 0x3095 -- xor (hl) flags escape to the caller
}
