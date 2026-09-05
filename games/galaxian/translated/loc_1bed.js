// SPDX-License-Identifier: GPL-3.0-only

// loc_1bed  (ROM 0x1BED-0x1C2B) — scan a 256-byte page at (HL): while A==(HL) step A+=0x2F and inc L;
// a mismatch bails to loc_1c2c. On a full match, dec (0x4008); if zero, reset a batch of state, then ret.
export function loc_1bed(m) {
  const { regs, mem } = m;

  for (;;) {
    // loc_1bed:
    regs.cp(mem.read8(regs.hl));
    m.step(0x1bee, 7); // cp (hl)

    if (regs.fNZ) {
      m.step(0x1c2c, 12); // jr nz (taken) -- mismatch: bail to loc_1c2c
      return m.call(0x1c2c);
    }
    m.step(0x1bf0, 7);

    regs.add(0x2f);
    m.step(0x1bf2, 7);

    regs.l = regs.inc8(regs.l);
    m.step(0x1bf3, 4);

    if (regs.fNZ) {
      m.step(0x1bed, 10); // jp nz (taken) -- loop until L wraps to 0
      continue;
    }
    m.step(0x1bf6, 10); // jp nz (not taken) -- whole page matched
    break;
  }

  regs.a = mem.read8(0x7800);
  m.step(0x1bf9, 13); // ld a,(0x7800) -- watchdog reset_r (value discarded)

  m.push16(0x1bfc);
  m.step(0x003c, 17);
  m.call(0x003c);

  regs.hl = 0x4008;
  m.step(0x1bff, 10);

  regs.decMem8(mem, regs.hl);
  m.step(0x1c00, 11); // dec (hl) -- (0x4008)--

  if (regs.fNZ) {
    m.ret(11); // ret nz (taken) -- counter not exhausted
    return;
  }
  m.step(0x1c01, 5);

  regs.xor(regs.a);
  m.step(0x1c02, 4); // xor a -- A=0

  regs.hl = 0x5800;
  m.step(0x1c05, 10);

  regs.b = regs.a;
  m.step(0x1c06, 4); // ld b,a -- B=0 -> rst 0x10 fills 256 bytes

  // rst 0x10 -- block-fill helper (loc_0010): stores A into (HL), B times
  m.push16(0x1c07);
  m.step(0x0010, 11);
  m.call(0x0010);

  regs.a = 0x01;
  m.step(0x1c09, 7);

  mem.write8(0x4006, regs.a);
  m.step(0x1c0c, 13); // ld (0x4006),a -- work RAM

  mem.write8(0x401a, regs.a);
  m.step(0x1c0f, 13); // ld (0x401a),a -- work RAM

  mem.write8(0x6000, regs.a, 10);
  m.step(0x1c12, 13); // ld (0x6000),a -- latch: start_lamp[0]

  mem.write8(0x6001, regs.a, 10);
  m.step(0x1c15, 13); // ld (0x6001),a -- latch: start_lamp[1]

  mem.write8(0x6002, regs.a, 10);
  m.step(0x1c18, 13); // ld (0x6002),a -- latch: coin_lock

  mem.write8(0x4226, regs.a);
  m.step(0x1c1b, 13); // ld (0x4226),a -- work RAM

  mem.write8(0x425f, regs.a);
  m.step(0x1c1e, 13); // ld (0x425f),a -- work RAM

  mem.write8(0x4238, regs.a);
  m.step(0x1c21, 13); // ld (0x4238),a -- work RAM

  regs.a = 0x1f;
  m.step(0x1c23, 7);

  mem.write8(0x5213, regs.a);
  m.step(0x1c26, 13); // ld (0x5213),a -- VRAM

  regs.a = 0x1b;
  m.step(0x1c28, 7);

  mem.write8(0x51f3, regs.a);
  m.step(0x1c2b, 13); // ld (0x51f3),a -- VRAM

  m.ret();
}
