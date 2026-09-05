// SPDX-License-Identifier: GPL-3.0-only

// loc_18a6  (ROM 0x18a6-0x18b1) — normal per-frame lfo step. Return unless 0x425f == 0xff (add a,1 sets
// carry only from 0xff); then unless the 0x421f level is 0; else decrement it and fall through into loc_18b2
// to broadcast the new value to the latches.
export function loc_18a6(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(0x425f);
  m.step(0x18a9, 13);

  regs.add(0x01); // carry set only when 0x425f was 0xff
  m.step(0x18ab, 7);

  if (regs.fNC) {
    m.ret(11); // ret nc -- 0x425f not armed
    return;
  }
  m.step(0x18ac, 5);

  regs.a = mem.read8(0x421f);
  m.step(0x18af, 13);

  regs.and(regs.a); // Z when the 0x421f level == 0
  m.step(0x18b0, 4);

  if (regs.fZ) {
    m.ret(11); // ret z -- level already 0
    return;
  }
  m.step(0x18b1, 5);

  regs.a = regs.dec8(regs.a);
  m.step(0x18b2, 4);

  // fall through into loc_18b2 (broadcast) -- separate head, delegate
  return m.call(0x18b2);
}
