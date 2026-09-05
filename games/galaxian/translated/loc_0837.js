// SPDX-License-Identifier: GPL-3.0-only

// loc_0837  (ROM 0x0837-0x0897) — object move dispatch (called from 0x0661). HL=0x4200; if the active flag
// (bit0 of 0x4200) is clear, take the 0x0877 arm; else HL=0x4202 (position cell) and pick the movement byte:
// (0x4006) bit0 clear -> A=(0x423f) [0x0892 arm], (0x4018) bit0 set -> A=(0x4011) [0x088c arm], else A=(0x4010).
// All three movement arms converge on the clamp at 0x0850; the 0x0877 arm converges on the negate at 0x0865
// (else its 0x0882 sub-arm on the writer at 0x086b). Shared tail (all interior jr/jp inlined): 0x0850 clamp ->
// 0x0865 negate -> 0x086b writes 4 (A,C) pairs into staging 0x4054 -> ret. `entry` selects the tail entry point.
export function loc_0837(m) {
  const { regs, mem } = m;

  // Tail entry: 0=clamp(0x0850), 1=negate(0x0865), 2=writer(0x086b). Set by the head/arm that flows in.
  let entry;

  regs.hl = 0x4200;
  m.step(0x083a, 10);

  regs.bit(0, mem.read8(regs.hl));
  m.step(0x083c, 12); // bit 0,(0x4200) -- object active flag

  if (regs.fZ) {
    // jr z,0x0877 (taken) -- inactive object arm 0x0877
    m.step(0x0877, 12);

    regs.l = regs.inc8(regs.l);
    m.step(0x0878, 4); // inc l

    regs.bit(0, mem.read8(regs.hl));
    m.step(0x087a, 12); // bit 0,(hl)

    if (regs.fNZ) {
      // jr nz,0x0882 (taken) -- 0x0882 sub-arm: C=0x07, jp writer
      m.step(0x0882, 12);

      regs.l = regs.inc8(regs.l);
      m.step(0x0883, 4); // inc l

      regs.a = mem.read8(regs.hl);
      m.step(0x0884, 7); // ld a,(hl)

      regs.cpl();
      m.step(0x0885, 4); // cpl

      regs.add(0x80);
      m.step(0x0887, 7); // add a,0x80

      regs.c = 0x07;
      m.step(0x0889, 7); // ld c,0x07 -- pair-code

      m.step(0x086b, 10); // jp 0x086b
      entry = 2;
    } else {
      m.step(0x087c, 7); // jr nz,0x0882 (not taken)

      regs.l = regs.inc8(regs.l);
      m.step(0x087d, 4); // inc l

      mem.write8(regs.hl, 0x00);
      m.step(0x087f, 10); // ld (hl),0x00

      m.step(0x0865, 10); // jp 0x0865
      entry = 1;
    }
  } else {
    m.step(0x083e, 7); // jr z,0x0877 (not taken)

    regs.l = regs.inc8(regs.l);
    m.step(0x083f, 4);

    regs.l = regs.inc8(regs.l);
    m.step(0x0840, 4); // HL = 0x4202 (position cell)

    regs.a = mem.read8(0x4006);
    m.step(0x0843, 13);

    regs.rrca();
    m.step(0x0844, 4); // carry = bit0 of (0x4006)

    if (regs.fNC) {
      // jp nc,0x0892 (taken) -- 0x0892 arm: A=(0x423f), jp clamp
      m.step(0x0892, 10);

      regs.a = mem.read8(0x423f);
      m.step(0x0895, 13); // ld a,(0x423f)

      m.step(0x0850, 10); // jp 0x0850
      entry = 0;
    } else {
      m.step(0x0847, 10); // jp nc,0x0892 (not taken)

      regs.a = mem.read8(0x4018);
      m.step(0x084a, 13);

      regs.rrca();
      m.step(0x084b, 4); // carry = bit0 of (0x4018)

      if (regs.fC) {
        // jr c,0x088c (taken) -- 0x088c arm: A=(0x4011), jp clamp
        m.step(0x088c, 12);

        regs.a = mem.read8(0x4011);
        m.step(0x088f, 13); // ld a,(0x4011)

        m.step(0x0850, 10); // jp 0x0850
        entry = 0;
      } else {
        m.step(0x084d, 7); // jr c,0x088c (not taken)

        regs.a = mem.read8(0x4010);
        m.step(0x0850, 13); // A = raw IN0, fall into 0x0850
        entry = 0;
      }
    }
  }

  // --- shared tail: clamp -> negate -> writer -> ret (each block falls into the next) ---

  if (entry <= 0) {
    // loc_0850 clamp on (HL): B=A holds the movement bits. bit3 -> dec (HL) while >= 0x17; bit2 -> inc (HL)
    // while < 0xe9. 0x085b (bit2 arm) is an interior branch target inlined here.
    regs.b = regs.a;
    m.step(0x0851, 4); // B = movement bits

    regs.bit(3, regs.a);
    m.step(0x0853, 8); // bit 3,a -- decrement request

    if (regs.fZ) {
      m.step(0x085b, 12); // jr z,0x085b (taken) -- no decrement
    } else {
      m.step(0x0855, 7); // jr z,0x085b (not taken)

      regs.a = mem.read8(regs.hl);
      m.step(0x0856, 7);

      regs.cp(0x17);
      m.step(0x0858, 7); // cp 0x17 -- low bound

      if (regs.fC) {
        m.step(0x085b, 12); // jr c,0x085b (taken) -- already at/below floor
      } else {
        m.step(0x085a, 7); // jr c,0x085b (not taken)

        regs.decMem8(mem, regs.hl);
        m.step(0x085b, 11); // dec (HL) -- move down
      }
    }

    // loc_085b: bit2 arm -- increment request
    regs.bit(2, regs.b);
    m.step(0x085d, 8); // bit 2,b

    if (regs.fZ) {
      m.step(0x0865, 12); // jr z,0x0865 (taken) -- no increment
    } else {
      m.step(0x085f, 7); // jr z,0x0865 (not taken)

      regs.a = mem.read8(regs.hl);
      m.step(0x0860, 7);

      regs.cp(0xe9);
      m.step(0x0862, 7); // cp 0xe9 -- high bound

      if (regs.fNC) {
        m.step(0x0865, 12); // jr nc,0x0865 (taken) -- already at/above ceiling
      } else {
        m.step(0x0864, 7); // jr nc,0x0865 (not taken)

        regs.incMem8(mem, regs.hl);
        m.step(0x0865, 11); // inc (HL) -- move up
      }
    }
  }

  if (entry <= 1) {
    // loc_0865 negate/offset: A = ~(HL) + 0x80, pair-code C=0x06, fall into the writer.
    regs.a = mem.read8(regs.hl);
    m.step(0x0866, 7); // ld a,(hl)

    regs.cpl();
    m.step(0x0867, 4); // cpl -- A = ~A

    regs.add(0x80);
    m.step(0x0869, 7); // add a,0x80

    regs.c = 0x06;
    m.step(0x086b, 7); // ld c,0x06 -- pair-code
  }

  // loc_086b writer: write B=4 interleaved (A,C) byte pairs into staging 0x4054-0x405b, then ret.
  regs.hl = 0x4054;
  m.step(0x086e, 10); // ld hl,0x4054 -- staging block base (work RAM)

  regs.b = 0x04;
  m.step(0x0870, 7); // ld b,0x04

  for (;;) {
    // loc_0870 loop top
    mem.write8(regs.hl, regs.a);
    m.step(0x0871, 7); // ld (hl),a

    regs.l = regs.inc8(regs.l);
    m.step(0x0872, 4); // inc l

    mem.write8(regs.hl, regs.c);
    m.step(0x0873, 7); // ld (hl),c

    regs.l = regs.inc8(regs.l);
    m.step(0x0874, 4); // inc l

    if (regs.djnz() !== 0) { // djnz decrements B, branches on B!=0, affects no flags
      m.step(0x0870, 13); // djnz 0x0870 (taken)
      continue;
    }
    m.step(0x0876, 8); // djnz 0x0870 (not taken)
    break;
  }

  m.ret(); // ret at 0x0876
}
