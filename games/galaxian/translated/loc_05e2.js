// SPDX-License-Identifier: GPL-3.0-only

// loc_05e2  (ROM 0x05e2-0x05fb) — sound-cue burst: fires five sound commands via loc_08f2, carrying the D
// register in from the caller (loc_05a5 fall-through sets D=0x05; loc_05fc jp sets D=0x05). The last cue
// (D:E=0x0700) tail-jumps loc_08f2. Entered by fall-through from loc_05a5 and by jp from loc_05fc.
export function loc_05e2(m) {
  const { regs } = m;

  regs.e = 0x02;
  m.step(0x05e4, 7);

  m.push16(0x05e7);
  m.step(0x08f2, 17); // call 0x08f2 -- sound command (D:E)
  m.call(0x08f2);

  regs.d = regs.inc8(regs.d);
  m.step(0x05e8, 4); // inc d -- next channel

  m.push16(0x05eb);
  m.step(0x08f2, 17);
  m.call(0x08f2);

  regs.e = 0x04;
  m.step(0x05ed, 7);

  m.push16(0x05f0);
  m.step(0x08f2, 17);
  m.call(0x08f2);

  regs.de = 0x0703;
  m.step(0x05f3, 10);

  m.push16(0x05f6);
  m.step(0x08f2, 17);
  m.call(0x08f2);

  regs.de = 0x0700;
  m.step(0x05f9, 10);

  m.step(0x08f2, 10); // jp 0x08f2 -- tail cue
  return m.call(0x08f2);
}
