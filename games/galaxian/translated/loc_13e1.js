// SPDX-License-Identifier: GPL-3.0-only

// loc_13e1  (ROM 0x13e1-0x140b) — sets the direction flag (0x4215) from two positions HL=(0x420e) and
// DE=(0x4210). If H bit7 set (HL negative): if (L-D) < 0x1c -> (0x4215)=0; else if (E-L) < 0x1c ->
// (0x4215)=1; otherwise call 0x003c (a coin-flip/RNG) and store its bit0. Interior labels 13f7/1403 inlined.
export function loc_13e1(m) {
  const { regs, mem } = m;

  regs.hl = mem.read16(0x420e);
  m.step(0x13e4, 16);
  regs.de = mem.read16(0x4210);
  m.step(0x13e8, 20);
  regs.bit(7, regs.h);
  m.step(0x13ea, 8);

  let toRng = false;
  if (regs.fZ) {
    m.step(0x13f7, 12); // jr z,0x13f7 -- HL positive
    // loc_13f7:
    regs.a = regs.e;
    m.step(0x13f8, 4);
    regs.sub(regs.l);
    m.step(0x13f9, 4);
    regs.cp(0x1c);
    m.step(0x13fb, 7);
    if (regs.fNC) {
      m.step(0x1403, 12); // jr nc,0x1403
      toRng = true;
    } else {
      m.step(0x13fd, 7);
      regs.a = 0x01;
      m.step(0x13ff, 7);
      mem.write8(0x4215, regs.a);
      m.step(0x1402, 13); // (0x4215) = 1
      m.ret();
      return;
    }
  } else {
    m.step(0x13ec, 7);
    regs.a = regs.l;
    m.step(0x13ed, 4);
    regs.sub(regs.d);
    m.step(0x13ee, 4);
    regs.cp(0x1c);
    m.step(0x13f0, 7);
    if (regs.fNC) {
      m.step(0x1403, 12); // jr nc,0x1403
      toRng = true;
    } else {
      m.step(0x13f2, 7);
      regs.xor(regs.a);
      m.step(0x13f3, 4);
      mem.write8(0x4215, regs.a);
      m.step(0x13f6, 13); // (0x4215) = 0
      m.ret();
      return;
    }
  }

  // loc_1403: (both far branches land here)
  if (toRng) {
    m.push16(0x1406);
    m.step(0x003c, 17);
    m.call(0x003c);
    regs.and(0x01);
    m.step(0x1408, 7);
    mem.write8(0x4215, regs.a);
    m.step(0x140b, 13); // (0x4215) = rng bit0
    m.ret();
    return;
  }
}
