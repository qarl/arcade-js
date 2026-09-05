// SPDX-License-Identifier: GPL-3.0-only

// loc_0f7b  (ROM 0x0f7b-0x0f86) — shared object tail: call 0x0ddd (per-object setup), then seed (ix+0x18)=3
// and (ix+0x10)=0x64. Entered by fall-through/branch from loc_0f66 and by tail-jump from loc_1091 (0x1098).
// ix = the object struct in work RAM.
export function loc_0f7b(m) {
  const { regs, mem } = m;

  m.push16(0x0f7e);
  m.step(0x0ddd, 17); // call 0x0ddd
  m.call(0x0ddd);

  mem.write8((regs.ix + 0x18) & 0xffff, 0x03);
  m.step(0x0f82, 19); // (ix+0x18) <- 3

  mem.write8((regs.ix + 0x10) & 0xffff, 0x64);
  m.step(0x0f86, 19); // (ix+0x10) <- 0x64

  m.ret();
}
