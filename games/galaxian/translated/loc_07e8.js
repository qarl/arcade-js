// SPDX-License-Identifier: GPL-3.0-only

// loc_07e8  (ROM 0x07e8-0x0817) — sub-state 6 handler. If (0x421d)!=0, run loc_080c (inlined). Else if (0x4195)==0
// tail to loc_0722. Otherwise advance sub-state (0x400a) + arm timer 0x4009<-0x82, and when (0x4006) bit0 is
// set fire two sound cmds (0x0603, 0x0600) via 0x08f2 (the last a tail-dispatch).
export function loc_07e8(m) {
  const { regs, mem } = m;

  regs.hl = 0x400a;
  m.step(0x07eb, 10); // ld hl,0x400a

  regs.a = mem.read8(0x421d);
  m.step(0x07ee, 13); // A = (0x421d)

  regs.and(regs.a);
  m.step(0x07ef, 4); // and a

  if (regs.fNZ) {
    // jr nz,0x080c (taken). loc_080c inlined -- interior tail reached only from here; HL=0x400a holds.
    m.step(0x080c, 12); // jr nz,0x080c (taken)

    regs.a = mem.read8(0x4195);
    m.step(0x080f, 13); // ld a,(0x4195)

    regs.and(regs.a);
    m.step(0x0810, 4); // and a

    if (regs.fZ) { m.step(0x0712, 10); return m.call(0x0712); } // jp z,0x0712 -- tail to loc_0712
    m.step(0x0813, 10); // jp z,0x0712 (not taken)

    regs.incMem8(mem, regs.hl);
    m.step(0x0814, 11); // inc (0x400a)

    regs.l = regs.dec8(regs.l);
    m.step(0x0815, 4); // dec l -- HL=0x4009

    mem.write8(regs.hl, 0x50);
    m.step(0x0817, 10); // (0x4009) <- 0x50

    m.ret(); // ret at 0x0817
    return;
  }
  m.step(0x07f1, 7); // jr nz,0x080c (not taken)

  regs.a = mem.read8(0x4195);
  m.step(0x07f4, 13); // A = (0x4195)

  regs.and(regs.a);
  m.step(0x07f5, 4); // and a

  if (regs.fZ) {
    m.step(0x0722, 10); // jp z,0x0722 (taken) -- tail to loc_0722
    return m.call(0x0722);
  }
  m.step(0x07f8, 10); // jp z,0x0722 (not taken)

  regs.incMem8(mem, regs.hl);
  m.step(0x07f9, 11); // inc (0x400a) -- advance sub-state

  regs.l = regs.dec8(regs.l);
  m.step(0x07fa, 4); // dec l -- HL=0x4009

  mem.write8(regs.hl, 0x82);
  m.step(0x07fc, 10); // 0x4009 (state timer) <- 0x82

  regs.a = mem.read8(0x4006);
  m.step(0x07ff, 13); // A = (0x4006)

  regs.rrca();
  m.step(0x0800, 4); // rrca -- bit0 -> carry

  if (regs.fNC) {
    m.ret(11); // ret nc -- bit0 clear: no sound
    return;
  }
  m.step(0x0801, 5); // ret nc (not taken)

  regs.de = 0x0603;
  m.step(0x0804, 10); // ld de,0x0603 -- sound cmd

  m.push16(0x0807);
  m.step(0x08f2, 17); // call 0x08f2
  m.call(0x08f2);

  regs.e = 0x00;
  m.step(0x0809, 7); // ld e,0x00 -- DE=0x0600

  // jp 0x08f2 -- tail-dispatch (0x08f2 rets to loc_07e8's caller)
  m.step(0x08f2, 10);
  return m.call(0x08f2);
}
