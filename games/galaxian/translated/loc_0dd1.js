// SPDX-License-Identifier: GPL-3.0-only

// loc_0dd1  (ROM 0x0dd1-0x0ddc) — actor state-step: bump the phase counter (ix+0x03), then branch on the
// actor's kind field (ix+0x07): if (ix+0x07)&0x70 == 0x60, hand off to loc_0e20; else fall into loc_0ddd.
export function loc_0dd1(m) {
  const { regs, mem } = m;

  regs.incMem8(mem, (regs.ix + 0x03) & 0xffff); // inc (ix+0x03) -- phase/anim counter
  m.step(0x0dd4, 23);

  regs.a = mem.read8((regs.ix + 0x07) & 0xffff); // (ix+0x07) -- actor kind/flags
  m.step(0x0dd7, 19);

  regs.and(0x70);
  m.step(0x0dd9, 7);

  regs.cp(0x60);
  m.step(0x0ddb, 7);

  if (regs.fZ) {
    // jr z,0x0e20 (taken) -- kind 0x60: delegate to the alternate target-select entry
    m.step(0x0e20, 12);
    return m.call(0x0e20);
  }
  m.step(0x0ddd, 7); // jr z,0x0e20 (not taken) -> fall into loc_0ddd

  return m.call(0x0ddd);
}
