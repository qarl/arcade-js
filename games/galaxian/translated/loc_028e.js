// SPDX-License-Identifier: GPL-3.0-only

// loc_028e  (ROM 0x028e-0x029c) — a state handler: runs the four per-frame updates (0x0363, 0x0bbe,
// 0x0cc3, 0x0367) then tail-jumps to 0x0336.
export function loc_028e(m) {
  const { regs, mem } = m;

  m.push16(0x0291);
  m.step(0x0363, 17); // call 0x0363
  m.call(0x0363);

  m.push16(0x0294);
  m.step(0x0bbe, 17); // call 0x0bbe
  m.call(0x0bbe);

  m.push16(0x0297);
  m.step(0x0cc3, 17); // call 0x0cc3
  m.call(0x0cc3);

  m.push16(0x029a);
  m.step(0x0367, 17); // call 0x0367
  m.call(0x0367);

  // jp 0x0336 -- tail-jump
  m.step(0x0336, 10);
  return m.call(0x0336);
}
