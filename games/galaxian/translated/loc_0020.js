// SPDX-License-Identifier: GPL-3.0-only

// loc_0020  (ROM 0x0020-0x0027) — the RST 20 vector: 8-bit index into a table at HL. Computes
// HL = HL + A (with carry into the high byte) then loads A = (HL). Caller passes the index in A
// and the table base in HL; A returns the fetched byte.
//   0020  85        add a,l
//   0021  6f        ld l,a
//   0022  3e 00     ld a,0x00
//   0024  8c        adc a,h
//   0025  67        ld h,a
//   0026  7e        ld a,(hl)
//   0027  c9        ret
export function loc_0020(m) {
  const { regs, mem } = m;

  regs.add(regs.l);
  m.step(0x0021, 4); // add a,l -- A = index + L (sets carry)

  regs.l = regs.a;
  m.step(0x0022, 4); // ld l,a -- new low byte of HL

  regs.a = 0x00;
  m.step(0x0024, 7); // ld a,0x00 (flags untouched: carry from add a,l survives)

  regs.adc(regs.h);
  m.step(0x0025, 4); // adc a,h -- A = H + carry (high-byte propagate)

  regs.h = regs.a;
  m.step(0x0026, 4); // ld h,a -- HL = base + index

  regs.a = mem.read8(regs.hl);
  m.step(0x0027, 7); // ld a,(hl) -- fetch the table entry

  m.ret();
}
