// SPDX-License-Identifier: GPL-3.0-only

// loc_2055  (ROM 0x2055-0x205d) — first entry of the jp(hl) dispatch table at 0x203d. Resolves the VRAM
// cell for A via 0x20e1, runs 0x2104, then tail-jumps to 0x2131.
export function loc_2055(m) {
  m.push16(0x2058);
  m.step(0x20e1, 17); // call 0x20e1 -- HL = VRAM cell for A
  m.call(0x20e1);

  m.push16(0x205b);
  m.step(0x2104, 17); // call 0x2104
  m.call(0x2104);

  // jp 0x2131 -- tail-jump
  m.step(0x2131, 10);
  return m.call(0x2131);
}
