// SPDX-License-Identifier: GPL-3.0-only

// loc_0722  (ROM 0x0722-0x073c) — state handler reached from loc_06d8/loc_07f2. If the 0x4006 frame flag
// bit0 is clear, fall to loc_070d; else select next state 1 (0x4005), clear 0x4006/0x400a, silence sound
// (loc_1cb5), and tail-jump into loc_08f2 with DE=0x0600 (enqueue that word).
export function loc_0722(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(0x4006);
  m.step(0x0725, 13); // ld a,(0x4006)

  regs.rrca();
  m.step(0x0726, 4); // rrca -- old bit0 -> carry

  if (regs.fNC) {
    m.step(0x070d, 12); // jr nc,0x070d (taken) -- flag clear
    return m.call(0x070d);
  }
  m.step(0x0728, 7); // jr nc,0x070d (not taken)

  regs.a = 0x01;
  m.step(0x072a, 7); // ld a,0x01

  mem.write8(0x4005, regs.a); // 0x4005 <- 1 -- next state select
  m.step(0x072d, 13); // ld (0x4005),a

  regs.xor(regs.a);
  m.step(0x072e, 4); // xor a

  mem.write8(0x4006, regs.a); // 0x4006 <- 0
  m.step(0x0731, 13); // ld (0x4006),a

  mem.write8(0x400a, regs.a); // 0x400a <- 0
  m.step(0x0734, 13); // ld (0x400a),a

  m.push16(0x0737);
  m.step(0x1cb5, 17); // call 0x1cb5 -- silence sound hardware
  m.call(0x1cb5);

  regs.de = 0x0600;
  m.step(0x073a, 10); // ld de,0x0600

  m.step(0x08f2, 10); // jp 0x08f2 -- enqueue DE word (tail)
  return m.call(0x08f2);
}
