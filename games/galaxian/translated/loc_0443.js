// SPDX-License-Identifier: GPL-3.0-only

// loc_0443  (ROM 0x0443-0x0472) — rst-0x28 state routine (state table @0x0400, idx 2). Through pointer
// (0x400b) it fills two 0x1c-byte runs of 0x10 (bytes p..p+0x1b and p+0x20..p+0x3b), advances the pointer by
// 0x40, and counts down (0x4009). While nonzero it returns; on zero it bumps state (0x400a), clears flip_x/
// flip_y (0x7006/0x7007) and (0x4018), fires two loc_08f2 calls, then falls through into loc_0473.
export function loc_0443(m) {
  const { regs, mem } = m;

  regs.hl = mem.read16(0x400b);
  m.step(0x0446, 16); // ld hl,(0x400b) -- current pointer

  regs.b = 0x1c;
  m.step(0x0448, 7);

  regs.a = 0x10;
  m.step(0x044a, 7); // fill value 0x10

  m.push16(0x044b);
  m.step(0x0010, 11); // rst 0x10 -- fill 0x1c bytes at HL <- 0x10
  m.call(0x0010);

  regs.de = 0x0004;
  m.step(0x044e, 10);

  regs.addHl(regs.de);
  m.step(0x044f, 11); // add hl,de -- +4 gap (HL advanced 0x1c by the fill)

  regs.b = 0x1c;
  m.step(0x0451, 7);

  m.push16(0x0452);
  m.step(0x0010, 11); // rst 0x10 -- fill 0x1c bytes at HL <- 0x10 (A preserved)
  m.call(0x0010);

  regs.addHl(regs.de);
  m.step(0x0453, 11); // add hl,de -- +4

  mem.write16(0x400b, regs.hl);
  m.step(0x0456, 16); // ld (0x400b),hl -- pointer advanced by 0x40

  regs.hl = 0x4009;
  m.step(0x0459, 10);

  regs.decMem8(mem, regs.hl);
  m.step(0x045a, 11); // dec (0x4009) -- row counter

  if (regs.fNZ) { m.ret(11); return; } // ret nz -- more rows
  m.step(0x045b, 5); // ret nz (not taken)

  regs.l = regs.inc8(regs.l);
  m.step(0x045c, 4); // inc l -- HL = 0x400a

  regs.incMem8(mem, regs.hl);
  m.step(0x045d, 11); // inc (0x400a) -- bump state selector

  regs.xor(regs.a);
  m.step(0x045e, 4); // xor a -- 0

  mem.write8(0x7006, regs.a, 10);
  m.step(0x0461, 13); // ld (0x7006),a -- flip_screen_x_w <- 0

  mem.write8(0x7007, regs.a, 10);
  m.step(0x0464, 13); // ld (0x7007),a -- flip_screen_y_w <- 0

  mem.write8(0x4018, regs.a);
  m.step(0x0467, 13); // ld (0x4018),a <- 0

  regs.de = 0x0702;
  m.step(0x046a, 10);

  m.push16(0x046d);
  m.step(0x08f2, 17); // call 0x08f2 (DE=0x0702)
  m.call(0x08f2);

  regs.de = 0x0601;
  m.step(0x0470, 10);

  m.push16(0x0473);
  m.step(0x08f2, 17); // call 0x08f2 (DE=0x0601)
  m.call(0x08f2);

  // fall-through into loc_0473 -- separate routine (state table idx 3), delegate
  return m.call(0x0473);
}
