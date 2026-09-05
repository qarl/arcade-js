// SPDX-License-Identifier: GPL-3.0-only

// loc_06d8  (ROM 0x06d8-0x0700) — rst-28 state handler (dispatch target). HL=0x400A; branches on
// 0x421D/0x41B5/0x400E/0x4006 to advance the sub-state at 0x400A/0x4009 or delegate. The 0x0701 arm
// (jr nz path) is interior and inlined here; it falls through to loc_070d.
export function loc_06d8(m) {
  const { regs, mem } = m;

  regs.hl = 0x400a;
  m.step(0x06db, 10);

  regs.a = mem.read8(0x421d);
  m.step(0x06de, 13);

  regs.and(regs.a);
  m.step(0x06df, 4);

  if (regs.fNZ) {
    // jr nz,0x0701 (taken) -- interior arm loc_0701, inlined
    m.step(0x0701, 12);

    regs.a = mem.read8(0x41b5);
    m.step(0x0704, 13);

    regs.and(regs.a);
    m.step(0x0705, 4);

    if (regs.fZ) {
      m.step(0x0712, 12); // jr z,0x0712 (taken)
      return m.call(0x0712);
    }
    m.step(0x0707, 7);

    regs.a = mem.read8(0x400e);
    m.step(0x070a, 13);

    regs.and(regs.a);
    m.step(0x070b, 4);

    if (regs.fZ) {
      m.step(0x0712, 12); // jr z,0x0712 (taken)
      return m.call(0x0712);
    }
    m.step(0x070d, 7); // not taken -- fall through to loc_070d

    return m.call(0x070d);
  }
  m.step(0x06e1, 7); // jr nz,0x0701 (not taken)

  regs.a = mem.read8(0x41b5);
  m.step(0x06e4, 13);

  regs.and(regs.a);
  m.step(0x06e5, 4);

  if (regs.fZ) {
    m.step(0x0722, 12); // jr z,0x0722 (taken)
    return m.call(0x0722);
  }
  m.step(0x06e7, 7);

  regs.a = mem.read8(0x400e);
  m.step(0x06ea, 13);

  regs.and(regs.a);
  m.step(0x06eb, 4);

  if (regs.fZ) {
    m.step(0x0722, 12); // jr z,0x0722 (taken)
    return m.call(0x0722);
  }
  m.step(0x06ed, 7);

  regs.incMem8(mem, regs.hl);
  m.step(0x06ee, 11); // inc (0x400a) -- sub-state counter

  regs.l = regs.dec8(regs.l);
  m.step(0x06ef, 4); // HL = 0x4009

  mem.write8(regs.hl, 0x82);
  m.step(0x06f1, 10); // 0x4009 <- 0x82 (timer)

  regs.a = mem.read8(0x4006);
  m.step(0x06f4, 13);

  regs.rrca();
  m.step(0x06f5, 4); // carry = bit0 of 0x4006

  if (regs.fNC) {
    m.ret(11); // ret nc (taken)
    return;
  }
  m.step(0x06f6, 5); // ret nc (not taken)

  regs.de = 0x0602;
  m.step(0x06f9, 10);

  m.push16(0x06fc);
  m.step(0x08f2, 17); // call 0x08f2
  m.call(0x08f2);

  regs.e = 0x00;
  m.step(0x06fe, 7);

  // jp 0x08f2 -- tail
  m.step(0x08f2, 10);
  return m.call(0x08f2);
}
