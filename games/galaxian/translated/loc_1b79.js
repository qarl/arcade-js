// SPDX-License-Identifier: GPL-3.0-only

// loc_1b79  (ROM 0x1B79-0x1BCC) — ROM CHECKSUM + power-on init tail: sum 0x28 ROM pages; a nonzero
// total -> jp 0x1b34 (bad-ROM hang). On A==0, block-fill work RAM via rst 0x10, seed latches, jp 0x2000.
export function loc_1b79(m) {
  const { regs, mem } = m;

  // ---- checksum: outer djnz over B pages, inner sum over 0x100 bytes ----
  for (;;) {
    for (;;) {
      // loc_1b79:
      regs.add(mem.read8(regs.hl));
      m.step(0x1b7a, 7);

      regs.l = regs.inc8(regs.l);
      m.step(0x1b7b, 4); // inc l -- Z iff L wrapped to 0

      if (regs.fNZ) {
        m.step(0x1b79, 10); // jp nz,0x1b79 (taken)
        continue;
      }
      m.step(0x1b7e, 10); // jp nz,0x1b79 (not taken)
      break;
    }

    regs.h = regs.inc8(regs.h);
    m.step(0x1b7f, 4); // inc h -- next page

    regs.c = regs.a;
    m.step(0x1b80, 4); // ld c,a -- stash running sum

    regs.a = mem.read8(0x7800);
    m.step(0x1b83, 13); // ld a,(0x7800) -- pet the watchdog

    regs.a = regs.c;
    m.step(0x1b84, 4); // ld a,c -- restore running sum

    if (m.regs.djnz() !== 0) {
      m.step(0x1b79, 13); // djnz 0x1b79 (taken)
      continue;
    }
    m.step(0x1b86, 8); // djnz 0x1b79 (not taken)
    break;
  }

  regs.and(regs.a);
  m.step(0x1b87, 4); // and a -- Z iff the 8-bit checksum is 0

  if (regs.fNZ) {
    m.step(0x1b34, 10); // jp nz,0x1b34 (taken) -- bad ROM, hang path
    return m.call(0x1b34);
  }
  m.step(0x1b8a, 10); // jp nz,0x1b34 (not taken) -- checksum OK

  // ---- good-ROM init: block-fill work RAM via rst 0x10 (loc_0010) ----
  regs.hl = 0x4000;
  m.step(0x1b8d, 10);

  regs.b = 0xc0;
  m.step(0x1b8f, 7);

  m.push16(0x1b90);
  m.step(0x0010, 11); // rst 0x10 -- fill 0xc0 bytes at 0x4000 with A(=0)
  m.call(0x0010);

  regs.a = regs.dec8(regs.a);
  m.step(0x1b91, 4); // dec a -- A=0xff

  regs.b = 0x40;
  m.step(0x1b93, 7);

  m.push16(0x1b94);
  m.step(0x0010, 11); // rst 0x10 -- fill 0x40 bytes with 0xff
  m.call(0x0010);

  regs.xor(regs.a);
  m.step(0x1b95, 4); // xor a -- A=0

  m.push16(0x1b96);
  m.step(0x0010, 11); // rst 0x10 -- B is 0 here => 0x100-byte fill with 0
  m.call(0x0010);

  m.push16(0x1b97);
  m.step(0x0010, 11); // rst 0x10 -- B is 0 again => another 0x100-byte fill with 0
  m.call(0x0010);

  regs.b = 0xa0;
  m.step(0x1b99, 7);

  m.push16(0x1b9a);
  m.step(0x0010, 11); // rst 0x10 -- fill 0xa0 bytes with 0
  m.call(0x0010);

  mem.write8(0x7001, regs.a, 10);
  m.step(0x1b9d, 13); // ld (0x7001),a -- irq_enable D0=0

  mem.write8(0x7005, regs.a);
  m.step(0x1ba0, 13); // ld (0x7005),a -- 0x7000 reg5 unmapped on Galaxian (drops)

  mem.write8(0x7006, regs.a, 10);
  m.step(0x1ba3, 13); // ld (0x7006),a -- flip_x D0=0

  mem.write8(0x7007, regs.a, 10);
  m.step(0x1ba6, 13); // ld (0x7007),a -- flip_y D0=0

  mem.write8(0x4018, regs.a);
  m.step(0x1ba9, 13); // ld (0x4018),a -- work RAM

  regs.a = mem.read8(0x7800);
  m.step(0x1bac, 13); // ld a,(0x7800) -- pet the watchdog

  regs.a = 0x20;
  m.step(0x1bae, 7);

  mem.write8(0x4008, regs.a);
  m.step(0x1bb1, 13); // ld (0x4008),a -- work RAM

  regs.a = 0x03;
  m.step(0x1bb3, 7);

  mem.write8(0x401a, regs.a);
  m.step(0x1bb6, 13); // ld (0x401a),a -- work RAM

  regs.hl = 0xc0c0;
  m.step(0x1bb9, 10);

  mem.write16(0x40a0, regs.hl);
  m.step(0x1bbc, 16); // ld (0x40a0),hl -- work RAM (0x40a0=0xc0, 0x40a1=0xc0)

  regs.a = 0x01;
  m.step(0x1bbe, 7);

  mem.write8(0x7004, regs.a, 10);
  m.step(0x1bc1, 13); // ld (0x7004),a -- stars_enable D0=1

  mem.write8(0x7002, regs.a);
  m.step(0x1bc4, 13); // ld (0x7002),a -- 0x7000 reg2 unmapped on Galaxian (drops)

  mem.write8(0x7003, regs.a);
  m.step(0x1bc7, 13); // ld (0x7003),a -- 0x7000 reg3 unmapped on Galaxian (drops)

  mem.write8(0x7001, regs.a, 10);
  m.step(0x1bca, 13); // ld (0x7001),a -- irq_enable D0=1 (NMI ON)

  // jp 0x2000 -- into the game entry point (its flow is ours)
  m.step(0x2000, 10);
  return m.call(0x2000);
}
