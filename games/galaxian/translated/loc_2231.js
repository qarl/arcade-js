// SPDX-License-Identifier: GPL-3.0-only

// loc_2231  (ROM 0x2231-0x2255) — select the WRAM BCD source (DE) for counter index A, then tail into the
// digit render at loc_2256. A>=3 recurses down to the base index (interior loc_224d); A==0/1/2 pick
// DE=0x40a4/0x40a7/0x40aa, index 1 early-outs when (0x400e)==0. Interior arm loc_2248 (index 2 -> loc_21f8).
export function loc_2231(m) {
  const { regs, mem } = m;

  regs.cp(0x03);
  m.step(0x2233, 7); // classify the index

  if (regs.fNC) {
    // jr nc,0x224d (taken) -- A>=3: interior loc_224d, recurse toward the base index
    m.step(0x224d, 12);
    for (;;) {
      regs.a = regs.dec8(regs.a);
      m.step(0x224e, 4);
      m.push16(regs.af);
      m.step(0x224f, 11); // push af -- carry the dec'd index's Z past the call
      m.push16(0x2252);
      m.step(0x2231, 17); // call 0x2231 -- recurse on the lower index
      m.call(0x2231);
      regs.af = m.pop16();
      m.step(0x2253, 10); // pop af
      if (regs.fZ) { m.ret(11); return; } // ret z -- index reached 0
      m.step(0x2254, 5);
      m.step(0x224d, 12); // jr 0x224d
    }
  }
  m.step(0x2235, 7); // jr nc (not taken)

  regs.and(regs.a);
  m.step(0x2236, 4); // index 0?

  regs.de = 0x40a4; // BCD source for index 0
  m.step(0x2239, 10);

  if (regs.fZ) {
    m.step(0x2256, 12); // jr z,0x2256 (taken)
    return m.call(0x2256);
  }
  m.step(0x223b, 7);

  regs.a = regs.dec8(regs.a);
  m.step(0x223c, 4); // index 1?

  if (regs.fNZ) {
    // jr nz,0x2248 (taken) -- interior loc_2248: index 2
    m.step(0x2248, 12);
    regs.de = 0x40aa; // BCD source for index 2
    m.step(0x224b, 10);
    m.step(0x21f8, 12); // jr 0x21f8
    return m.call(0x21f8);
  }
  m.step(0x223e, 7);

  regs.a = mem.read8(0x400e);
  m.step(0x2241, 13); // index-1 gate value

  regs.and(regs.a);
  m.step(0x2242, 4);

  if (regs.fZ) { m.ret(11); return; } // ret z -- (0x400e)==0: nothing to draw
  m.step(0x2243, 5);

  regs.de = 0x40a7; // BCD source for index 1
  m.step(0x2246, 10);

  m.step(0x2256, 12); // jr 0x2256
  return m.call(0x2256);
}
