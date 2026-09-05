// SPDX-License-Identifier: GPL-3.0-only

// loc_03d7  (ROM 0x03d7-0x03f1) — if (0x4002)!=0: bump substate (0x4005)++, zero (0x4007), and clear game
// state (0x400a) + flags (0x41c2, 0x41df, 0x40b0); all work RAM. Its address is pushed as loc_0156's
// post-dispatch continuation (ld hl,0x03d7).
export function loc_03d7(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(0x4002);
  m.step(0x03da, 13); // ld a,(0x4002)

  regs.and(regs.a);
  m.step(0x03db, 4); // and a

  if (regs.fZ) {
    m.ret(11); // ret z (taken)
    return;
  }
  m.step(0x03dc, 5); // ret z (not taken)

  regs.hl = 0x4005;
  m.step(0x03df, 10); // ld hl,0x4005 -- substate counter

  mem.write8(regs.hl, regs.inc8(mem.read8(regs.hl)));
  m.step(0x03e0, 11); // inc (hl) -- (0x4005)++

  regs.l = regs.inc8(regs.l);
  m.step(0x03e1, 4); // inc l -> 0x4006

  regs.l = regs.inc8(regs.l);
  m.step(0x03e2, 4); // inc l -> 0x4007

  mem.write8(regs.hl, 0x00);
  m.step(0x03e4, 10); // ld (0x4007),0x00

  regs.xor(regs.a);
  m.step(0x03e5, 4); // xor a

  mem.write8(0x400a, regs.a);
  m.step(0x03e8, 13); // ld (0x400a),a -- game state

  mem.write8(0x41c2, regs.a);
  m.step(0x03eb, 13); // ld (0x41c2),a

  mem.write8(0x41df, regs.a);
  m.step(0x03ee, 13); // ld (0x41df),a

  mem.write8(0x40b0, regs.a);
  m.step(0x03f1, 13); // ld (0x40b0),a

  m.ret();
}
