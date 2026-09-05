// SPDX-License-Identifier: GPL-3.0-only

// loc_0e6b  (ROM 0x0e6b-0x0e98) — object state handler, slot 4 of the rst-28 table at 0x0ce6. Advances
// position (ix+0x03) by 1 or 2 depending on the frame-parity bit of (0x425f), then range-checks
// (pos-6 vs 3). In range it recomputes a Y in (ix+0x04) from (ix+0x19)+(ix+0x09) (signed via jp m), and on
// a carry-out from that add it bumps the state (ix+0x02) (loc_0e95); otherwise stores the new Y (loc_0e8c).
export function loc_0e6b(m) {
  const { regs, mem } = m;
  const R = (d) => (regs.ix + d) & 0xffff;

  regs.a = mem.read8(0x425f);
  m.step(0x0e6e, 13); // ld a,(0x425f) -- frame counter

  regs.and(0x01);
  m.step(0x0e70, 7); // and 0x01 -- parity

  regs.a = regs.inc8(regs.a);
  m.step(0x0e71, 4); // inc a -- step = 1 or 2

  regs.add(mem.read8(R(0x03)));
  m.step(0x0e74, 19); // add a,(ix+0x03)

  mem.write8(R(0x03), regs.a);
  m.step(0x0e77, 19); // ld (ix+0x03),a -- new position

  regs.sub(0x06);
  m.step(0x0e79, 7); // sub 0x06

  regs.cp(0x03);
  m.step(0x0e7b, 7); // cp 0x03

  if (regs.fC) { m.step(0x0e95, 12); return advanceState(); } // jr c,0x0e95
  m.step(0x0e7d, 7); // jr c,0x0e95 (not taken)

  m.push16(0x0e80); m.step(0x116b, 17); m.call(0x116b); // call 0x116b

  regs.a = mem.read8(R(0x19));
  m.step(0x0e83, 19); // ld a,(ix+0x19)

  regs.and(regs.a);
  m.step(0x0e84, 4); // and a -- test sign

  if (regs.fM) {
    // jp m,0x0e90 -- loc_0e90
    m.step(0x0e90, 10);
    regs.add(mem.read8(R(0x09)));
    m.step(0x0e93, 19); // add a,(ix+0x09)
    if (regs.fC) { m.step(0x0e8c, 12); return storeY(); } // jr c,0x0e8c
    m.step(0x0e95, 7); // jr c,0x0e8c (not taken, falls into 0e95)
    return advanceState();
  }
  m.step(0x0e87, 10); // jp m,0x0e90 (not taken)

  regs.add(mem.read8(R(0x09)));
  m.step(0x0e8a, 19); // add a,(ix+0x09)

  if (regs.fC) { m.step(0x0e95, 12); return advanceState(); } // jr c,0x0e95
  m.step(0x0e8c, 7); // jr c,0x0e95 (not taken, falls into 0e8c)
  return storeY();

  // loc_0e8c: store the computed Y and ret
  function storeY() {
    mem.write8(R(0x04), regs.a);
    m.step(0x0e8f, 19); // ld (ix+0x04),a
    m.ret();
  }

  // loc_0e95: bump the state index and ret
  function advanceState() {
    regs.incMem8(mem, R(0x02));
    m.step(0x0e98, 23); // inc (ix+0x02)
    m.ret();
  }
}
