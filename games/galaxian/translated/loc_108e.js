// SPDX-License-Identifier: GPL-3.0-only

// loc_108e  (ROM 0x108e-0x1090) — dispatch-table entry @0x0cfc that is a lone `jp 0x0d71`: this state
// simply reuses the handler at 0x0d71.
export function loc_108e(m) {
  // jp 0x0d71 -- tail-jump into the shared handler
  m.step(0x0d71, 10);
  return m.call(0x0d71);
}
