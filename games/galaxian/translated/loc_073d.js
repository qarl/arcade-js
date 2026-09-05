// SPDX-License-Identifier: GPL-3.0-only

// loc_073d  (ROM 0x073d-0x0763) — RST-28 dispatch state (table @0x054e). Counts down the timer at 0x4009;
// stays (ret nz) until it hits 0. On expiry: clears 0x400a/0x4222/0x422b, packs the 128 spawn flags into the
// 16-byte bitmap at 0x4180 (loc_0764, which leaves DE=0x4190), copies an 8-byte template 0x4218->(de), then
// sets 0x400d=1 and advances to state 4 (0x4005).
export function loc_073d(m) {
  const { regs, mem } = m;

  regs.hl = 0x4009;
  m.step(0x0740, 10); // ld hl,0x4009

  regs.decMem8(mem, regs.hl);
  m.step(0x0741, 11); // dec (hl) -- 0x4009 countdown

  if (regs.fNZ) {
    m.ret(11); // ret nz -- timer not expired
    return;
  }
  m.step(0x0742, 5); // ret nz (not taken)

  regs.l = regs.inc8(regs.l);
  m.step(0x0743, 4); // inc l -- HL=0x400a

  regs.xor(regs.a);
  m.step(0x0744, 4); // xor a

  mem.write8(regs.hl, regs.a); // (0x400a) <- 0
  m.step(0x0745, 7); // ld (hl),a

  mem.write8(0x4222, regs.a); // 0x4222 <- 0
  m.step(0x0748, 13); // ld (0x4222),a

  mem.write8(0x422b, regs.a); // 0x422b <- 0
  m.step(0x074b, 13); // ld (0x422b),a

  regs.de = 0x4180;
  m.step(0x074e, 10); // ld de,0x4180 -- bitmap dest

  m.push16(0x0751);
  m.step(0x0764, 17); // call 0x0764 -- pack spawn-flag bitmap (leaves DE=0x4190)
  m.call(0x0764);

  regs.hl = 0x4218;
  m.step(0x0754, 10); // ld hl,0x4218

  regs.bc = 0x0008;
  m.step(0x0757, 10); // ld bc,0x0008

  m.ldirAt(0x0757, 0x0759); // ldir 0x4218->(de), 8 bytes

  regs.a = 0x01;
  m.step(0x075b, 7); // ld a,0x01

  mem.write8(0x400d, regs.a); // 0x400d <- 1
  m.step(0x075e, 13); // ld (0x400d),a

  regs.a = 0x04;
  m.step(0x0760, 7); // ld a,0x04

  mem.write8(0x4005, regs.a); // 0x4005 <- 4 -- next state
  m.step(0x0763, 13); // ld (0x4005),a

  m.ret();
}
