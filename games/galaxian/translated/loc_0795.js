// SPDX-License-Identifier: GPL-3.0-only

// loc_0795  (ROM 0x0795-0x07e7) — sub-state 2 handler. Expands the 0x41a0 bitmask via loc_0646, block-copies
// 8 bytes into 0x4218, clears the frame timer (0x425f) and 0x4220. If (0x400f)!=0 it also stamps 0x4018 and
// the flip-screen latches (0x7006/0x7007). Interior loc_07ba: advance sub-state (0x400a) + arm timer 0x4009,
// stash pointer 0x0830 at 0x4245, and when (0x4006) bit0 set fire five sound cmds to 0x08f2 (last is a tail).
export function loc_0795(m) {
  const { regs, mem } = m;

  regs.de = 0x41a0;
  m.step(0x0798, 10); // ld de,0x41a0 -- source bitmask for the expander

  m.push16(0x079b);
  m.step(0x0646, 17); // call 0x0646
  m.call(0x0646);

  regs.exDeHl();
  m.step(0x079c, 4); // ex de,hl

  regs.de = 0x4218;
  m.step(0x079f, 10); // ld de,0x4218 -- ldir destination

  regs.bc = 0x0008;
  m.step(0x07a2, 10); // ld bc,0x0008

  m.ldirAt(0x07a2, 0x07a4); // ldir -- 8 bytes HL -> 0x4218

  regs.xor(regs.a);
  m.step(0x07a5, 4); // xor a -- A=0

  mem.write8(0x425f, regs.a);
  m.step(0x07a8, 13); // 0x425f (frame timer) <- 0

  mem.write8(0x4220, regs.a);
  m.step(0x07ab, 13); // 0x4220 <- 0

  regs.a = mem.read8(0x400f);
  m.step(0x07ae, 13); // A = (0x400f) flag

  regs.and(regs.a);
  m.step(0x07af, 4); // and a

  if (regs.fZ) {
    m.step(0x07ba, 12); // jr z,0x07ba (taken) -- skip the flip-screen stamp
  } else {
    m.step(0x07b1, 7); // jr z,0x07ba (not taken)

    mem.write8(0x4018, regs.a);
    m.step(0x07b4, 13); // 0x4018 <- (0x400f)

    mem.write8(0x7006, regs.a, 10); // flip_screen_x_w D0
    m.step(0x07b7, 13);

    mem.write8(0x7007, regs.a, 10); // flip_screen_y_w D0
    m.step(0x07ba, 13);
  }

  // loc_07ba (interior: fall-through + the jr-z target above)
  regs.hl = 0x400a;
  m.step(0x07bd, 10); // ld hl,0x400a

  regs.incMem8(mem, regs.hl);
  m.step(0x07be, 11); // inc (0x400a) -- advance sub-state

  regs.l = regs.dec8(regs.l);
  m.step(0x07bf, 4); // dec l -- HL=0x4009

  mem.write8(regs.hl, 0x96);
  m.step(0x07c1, 10); // 0x4009 (state timer) <- 0x96

  regs.hl = 0x0830;
  m.step(0x07c4, 10); // ld hl,0x0830

  mem.write16(0x4245, regs.hl);
  m.step(0x07c7, 16); // 0x4245 <- 0x0830 (routine pointer)

  regs.a = mem.read8(0x4006);
  m.step(0x07ca, 13); // A = (0x4006)

  regs.rrca();
  m.step(0x07cb, 4); // rrca -- bit0 -> carry

  if (regs.fNC) {
    m.ret(11); // ret nc -- bit0 clear: no sound
    return;
  }
  m.step(0x07cc, 5); // ret nc (not taken)

  regs.de = 0x0503;
  m.step(0x07cf, 10); // ld de,0x0503 -- sound cmd

  m.push16(0x07d2);
  m.step(0x08f2, 17); // call 0x08f2
  m.call(0x08f2);

  regs.de = 0x0603;
  m.step(0x07d5, 10); // ld de,0x0603

  m.push16(0x07d8);
  m.step(0x08f2, 17); // call 0x08f2
  m.call(0x08f2);

  regs.e = regs.inc8(regs.e);
  m.step(0x07d9, 4); // inc e -- DE=0x0604

  m.push16(0x07dc);
  m.step(0x08f2, 17); // call 0x08f2
  m.call(0x08f2);

  regs.de = 0x0703;
  m.step(0x07df, 10); // ld de,0x0703

  m.push16(0x07e2);
  m.step(0x08f2, 17); // call 0x08f2
  m.call(0x08f2);

  regs.de = 0x0700;
  m.step(0x07e5, 10); // ld de,0x0700

  // jp 0x08f2 -- tail-dispatch (0x08f2 rets to loc_0795's caller)
  m.step(0x08f2, 10);
  return m.call(0x08f2);
}
