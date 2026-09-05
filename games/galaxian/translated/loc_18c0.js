// SPDX-License-Identifier: GPL-3.0-only

// loc_18c0  (ROM 0x18c0-0x18e6) — text/message scroller step, gated by 0x40b0 bit0. Countdown *(0x40b1)&7
// nonzero -> tail loc_18e8; source char *(0x40b3)==0x3f -> tail loc_18e7; else emit one char to VRAM via
// *(0x40b5) (char-0x30 tile, pointer bumped -0x20), advance the source, and fall through into loc_18e7.
export function loc_18c0(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(0x40b0); // 0x40b0: scroller enable/state byte
  m.step(0x18c3, 13);

  regs.rrca();
  m.step(0x18c4, 4); // rrca -- carry = old bit0 (active flag)

  if (regs.fNC) { m.ret(11); return; } // ret nc -- bit0 clear: scroller idle
  m.step(0x18c5, 5); // ret nc (not taken)

  regs.hl = mem.read16(0x40b1); // 0x40b1: pointer to the countdown/control byte
  m.step(0x18c8, 16);

  regs.a = mem.read8(regs.hl);
  m.step(0x18c9, 7); // ld a,(hl) -- control byte

  regs.and(0x07);
  m.step(0x18cb, 7); // and 0x07

  if (regs.fNZ) {
    // jr nz,0x18e8 (taken) -- still delaying: go tick the countdown
    m.step(0x18e8, 12);
    return m.call(0x18e8);
  }
  m.step(0x18cd, 7); // jr nz (not taken)

  regs.exDeHl();
  m.step(0x18ce, 4); // ex de,hl -- stash the countdown pointer in DE

  regs.hl = mem.read16(0x40b3); // 0x40b3: source text pointer
  m.step(0x18d1, 16);

  regs.a = mem.read8(regs.hl);
  m.step(0x18d2, 7); // ld a,(hl) -- next source char

  regs.cp(0x3f);
  m.step(0x18d4, 7); // cp 0x3f -- end-of-text marker

  if (regs.fZ) {
    // jr z,0x18e7 (taken) -- terminator: swap back + tick the countdown
    m.step(0x18e7, 12);
    return m.call(0x18e7);
  }
  m.step(0x18d6, 7); // jr z (not taken)

  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x18d7, 6); // inc hl -- advance source

  mem.write16(0x40b3, regs.hl); // 0x40b3: store advanced source pointer
  m.step(0x18da, 16);

  regs.sub(0x30);
  m.step(0x18dc, 7); // sub 0x30 -- char -> tile code

  regs.hl = mem.read16(0x40b5); // 0x40b5: destination VIDEORAM pointer
  m.step(0x18df, 16);

  mem.write8(regs.hl, regs.a); // ld (hl),a -- tile -> VIDEORAM
  m.step(0x18e0, 7);

  regs.bc = 0xffe0;
  m.step(0x18e3, 10); // ld bc,0xffe0 (-0x20)

  regs.addHl(regs.bc);
  m.step(0x18e4, 11); // add hl,bc -- up one screen column

  mem.write16(0x40b5, regs.hl); // 0x40b5: store advanced dest pointer
  m.step(0x18e7, 16); // ld (0x40b5),hl

  // fall-through into loc_18e7 (ex de,hl -> dec the countdown)
  return m.call(0x18e7);
}
