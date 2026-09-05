// SPDX-License-Identifier: GPL-3.0-only

// loc_2089  (ROM 0x2089-0x209b) — active-slot handler + shared loop epilogue. call 0x20e1, C=0, call 0x211d,
// call 0x2131, then restore HL/BC saved in loc_207d, advance the slot pointer L by the stride C, and djnz
// back to loc_207d for the next slot; ret when the 6 slots are done.
export function loc_2089(m) {
  const { regs, mem } = m;

  // call 0x20e1
  m.push16(0x208c);
  m.step(0x20e1, 17);
  m.call(0x20e1);

  regs.c = 0x00;
  m.step(0x208e, 7); // ld c,0x00 -- stride arg for 0x211d

  // call 0x211d
  m.push16(0x2091);
  m.step(0x211d, 17);
  m.call(0x211d);

  // call 0x2131
  m.push16(0x2094);
  m.step(0x2131, 17);
  m.call(0x2131);

  regs.hl = m.pop16();
  m.step(0x2095, 10); // pop hl -- restore slot pointer

  regs.bc = m.pop16();
  m.step(0x2096, 10); // pop bc -- restore stride+count

  regs.a = regs.l;
  m.step(0x2097, 4); // ld a,l

  regs.add(regs.c);
  m.step(0x2098, 4); // add a,c -- advance pointer by the stride

  regs.l = regs.a;
  m.step(0x2099, 4); // ld l,a

  if (regs.djnz() !== 0) {
    m.step(0x207d, 13); // djnz 0x207d (taken) -- next slot
    return m.call(0x207d);
  }
  m.step(0x209b, 8); // djnz 0x207d (not taken)

  m.ret();
}
