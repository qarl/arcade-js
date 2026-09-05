// SPDX-License-Identifier: GPL-3.0-only

// loc_0e20  (ROM 0x0e20-0x0e2a) — alternate target-select entry (kind 0x60, from loc_0dd1): test bit0 of the
// flag at 0x42d0. If clear, use the ordinary reference-relative select (delegate to loc_0ddd); if set, load a
// fixed target from 0x42e9 and hand it straight to loc_0df6.
export function loc_0e20(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(0x42d0);
  m.step(0x0e23, 13);

  regs.rrca(); // bit0 -> carry
  m.step(0x0e24, 4);

  if (regs.fNC) {
    // jr nc,0x0ddd (taken) -- bit0 clear: normal reference-relative select
    m.step(0x0ddd, 12);
    return m.call(0x0ddd);
  }
  m.step(0x0e26, 7); // jr nc,0x0ddd (not taken)

  regs.a = mem.read8(0x42e9); // fixed target X
  m.step(0x0e29, 13);

  m.step(0x0df6, 12); // jr 0x0df6
  return m.call(0x0df6);
}
