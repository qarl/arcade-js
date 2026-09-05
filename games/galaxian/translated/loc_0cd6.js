// SPDX-License-Identifier: GPL-3.0-only

// loc_0cd6  (ROM 0x0cd6-0x0ce5) — per-slot object driver, called by loc_0cc3. If (ix+1) bit0 set, hand off
// to loc_10e4. Else if (ix+0) bit0 clear, do nothing (ret). Else dispatch on the object state (ix+2) via
// rst 0x28 (loc_0028), whose inline word table is the 16 entries at 0x0ce6-0x0d05 (DATA, not code):
//   0d06 0d71 0dd1 0e2b 0e6b 0e99 0f07 0f3c 0f66 0faf 101f 108e 1091 109b 10c2 10d8.
// loc_0028 pops that pushed table base and jp(hl)s the target, which rets to loc_0cc3 — so no continuation.
export function loc_0cd6(m) {
  const { regs, mem } = m;

  regs.bit(0, mem.read8((regs.ix + 0x01) & 0xffff));
  m.step(0x0cda, 20); // bit 0,(ix+1)

  if (regs.fNZ) {
    m.step(0x10e4, 10); // jp nz,0x10e4 (taken) -- hand off
    return m.call(0x10e4);
  }
  m.step(0x0cdd, 10); // jp nz,0x10e4 (not taken)

  regs.bit(0, mem.read8((regs.ix + 0x00) & 0xffff));
  m.step(0x0ce1, 20); // bit 0,(ix+0)

  if (regs.fZ) {
    m.ret(11); // ret z (taken) -- slot inactive
    return;
  }
  m.step(0x0ce2, 5); // ret z (not taken)

  regs.a = mem.read8((regs.ix + 0x02) & 0xffff);
  m.step(0x0ce5, 19); // A = object state

  m.push16(0x0ce6); // rst 0x28 -- state dispatch; pushed value = inline table base
  m.step(0x0028, 11);
  return m.call(0x0028);
}
