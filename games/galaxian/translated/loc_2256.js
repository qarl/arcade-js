// SPDX-License-Identifier: GPL-3.0-only

// loc_2256  (ROM 0x2256-0x2260) — pick the VIDEORAM destination IX for the digit render and fall through
// into loc_2261. IX=0x5381 when A==0 (default field), else IX=0x5121. Also a `call` target from loc_21d6.
export function loc_2256(m) {
  const { regs, mem } = m;

  regs.ix = 0x5381; // default VIDEORAM digit field
  m.step(0x225a, 14);

  regs.and(regs.a);
  m.step(0x225b, 4); // A==0 -> keep the default

  if (regs.fZ) {
    m.step(0x2261, 12); // jr z,0x2261 (taken)
    return m.call(0x2261);
  }
  m.step(0x225d, 7);

  regs.ix = 0x5121; // alternate VIDEORAM field
  m.step(0x2261, 14);

  // fall-through into loc_2261
  return m.call(0x2261);
}
