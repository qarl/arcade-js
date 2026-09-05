// SPDX-License-Identifier: GPL-3.0-only

// loc_0712  (ROM 0x0712-0x0721) — test bit0 of 0x4006: store 0x0e at (HL) if clear, 0x04 if set, then
// tail-jp to loc_070e. Reached by jr z from loc_06d8's 0x0701 arm and by jp z from 0x0810. The 0x071d arm
// is interior (jr nc from 0x0716 only), inlined.
export function loc_0712(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(0x4006);
  m.step(0x0715, 13);

  regs.rrca();
  m.step(0x0716, 4); // carry = bit0 of 0x4006

  if (regs.fNC) {
    m.step(0x071d, 12); // jr nc,0x071d (taken) -- loc_071d inlined (interior arm)
    mem.write8(regs.hl, 0x0e);
    m.step(0x071f, 10); // (hl) <- 0x0e
    m.step(0x070e, 10); // jp 0x070e -- tail
    return m.call(0x070e);
  }
  m.step(0x0718, 7); // jr nc,0x071d (not taken)

  mem.write8(regs.hl, 0x04);
  m.step(0x071a, 10); // (hl) <- 0x04

  // jp 0x070e -- tail
  m.step(0x070e, 10);
  return m.call(0x070e);
}
