// SPDX-License-Identifier: GPL-3.0-only

// loc_2094  (ROM 0x2094-0x209b) — loop tail of the loc_207d table walk (reached by fall-through from
// loc_2089): restore the HL/BC pushed at loc_207d, advance L by stride C, djnz back to the loc_207d head.
export function loc_2094(m) {
  const { regs } = m;

  regs.hl = m.pop16();
  m.step(0x2095, 10); // pop hl -- row pointer saved at loc_207d

  regs.bc = m.pop16();
  m.step(0x2096, 10); // pop bc -- loop counter B + stride C

  regs.a = regs.l;
  m.step(0x2097, 4);

  regs.add(regs.c);
  m.step(0x2098, 4); // add a,c -- L += stride C

  regs.l = regs.a;
  m.step(0x2099, 4);

  if (regs.djnz() !== 0) {
    // djnz 0x207d (taken) -- loc_207d is a separate head, delegate
    m.step(0x207d, 13);
    return m.call(0x207d);
  }
  m.step(0x209b, 8); // djnz (not taken)

  return m.ret(10);
}
