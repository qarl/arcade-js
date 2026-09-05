// SPDX-License-Identifier: GPL-3.0-only

// loc_0e99  (ROM 0x0e99-0x0f06) — object state handler, slot 5 of the rst-28 table at 0x0ce6. Inits
// (ix+0x03)=8, bumps counter (ix+0x17), clears (ix+0x05). If (ix+0x07)&0x70==0x70 it branches to the
// difficulty/bit-count block (loc_0eda); else runs loc_0ead: gated by 0x4200/0x4224/0x4221 it either just
// advances the state (loc_0ed6) or reseeds a random Y in (ix+0x04) via prng loc_003c then advances (+2).
// loc_0ef2 (0x422a!=0) counts the set bits of (ix+0x20)/(ix+0x40) into 0x422a and jp's back into loc_0ead.
export function loc_0e99(m) {
  const { regs, mem } = m;
  const R = (d) => (regs.ix + d) & 0xffff;

  mem.write8(R(0x03), 0x08);
  m.step(0x0e9d, 19); // ld (ix+0x03),0x08

  regs.incMem8(mem, R(0x17));
  m.step(0x0ea0, 23); // inc (ix+0x17)

  mem.write8(R(0x05), 0x00);
  m.step(0x0ea4, 19); // ld (ix+0x05),0x00

  regs.a = mem.read8(R(0x07));
  m.step(0x0ea7, 19); // ld a,(ix+0x07)

  regs.and(0x70);
  m.step(0x0ea9, 7); // and 0x70

  regs.cp(0x70);
  m.step(0x0eab, 7); // cp 0x70

  if (regs.fZ) { m.step(0x0eda, 12); return runEda(); } // jr z,0x0eda
  m.step(0x0ead, 7); // jr z,0x0eda (not taken, falls into 0ead)
  return runEad();

  // loc_0ead: gated random-Y reseed then state-advance; ret. Also the jp target from 0x0f04.
  function runEad() {
    regs.a = mem.read8(0x4200);
    m.step(0x0eb0, 13); // ld a,(0x4200) -- global flags

    regs.rrca();
    m.step(0x0eb1, 4); // rrca -- bit0 -> carry

    if (regs.fNC) { m.step(0x0ed6, 12); return ed6(); } // jr nc,0x0ed6
    m.step(0x0eb3, 7); // jr nc,0x0ed6 (not taken)

    regs.a = mem.read8(0x4224);
    m.step(0x0eb6, 13); // ld a,(0x4224)

    regs.and(regs.a);
    m.step(0x0eb7, 4); // and a

    if (regs.fNZ) {
      m.step(0x0ebf, 12); // jr nz,0x0ebf
    } else {
      m.step(0x0eb9, 7); // jr nz,0x0ebf (not taken)
      regs.a = mem.read8(0x4221);
      m.step(0x0ebc, 13); // ld a,(0x4221)
      regs.and(regs.a);
      m.step(0x0ebd, 4); // and a
      if (regs.fZ) { m.step(0x0ed6, 12); return ed6(); } // jr z,0x0ed6
      m.step(0x0ebf, 7); // jr z,0x0ed6 (not taken, falls into 0ebf)
    }

    // loc_0ebf:
    regs.a = mem.read8(R(0x04));
    m.step(0x0ec2, 19); // ld a,(ix+0x04)

    regs.rra();
    m.step(0x0ec3, 4); // rra

    regs.c = regs.a;
    m.step(0x0ec4, 4); // ld c,a

    m.push16(0x0ec7); m.step(0x003c, 17); m.call(0x003c); // call 0x003c -- prng seed*5+1

    regs.and(0x1f);
    m.step(0x0ec9, 7); // and 0x1f

    regs.add(regs.c);
    m.step(0x0eca, 4); // add a,c

    regs.add(0x20);
    m.step(0x0ecc, 7); // add a,0x20

    mem.write8(R(0x04), regs.a);
    m.step(0x0ecf, 19); // ld (ix+0x04),a -- new Y

    mem.write8(R(0x10), 0x28);
    m.step(0x0ed3, 19); // ld (ix+0x10),0x28

    regs.incMem8(mem, R(0x02));
    m.step(0x0ed6, 23); // inc (ix+0x02) (falls into 0ed6 for a second bump)
    return ed6();
  }

  // loc_0ed6: inc (ix+0x02); ret
  function ed6() {
    regs.incMem8(mem, R(0x02));
    m.step(0x0ed9, 23); // inc (ix+0x02)
    m.ret();
  }

  // loc_0eda: (ix+0x07) fully set -> either difficulty ramp (0x422a==0) or bit-count reseed.
  function runEda() {
    regs.a = mem.read8(0x422a);
    m.step(0x0edd, 13); // ld a,(0x422a)

    regs.and(regs.a);
    m.step(0x0ede, 4); // and a

    if (regs.fNZ) { m.step(0x0ef2, 12); return runEf2(); } // jr nz,0x0ef2
    m.step(0x0ee0, 7); // jr nz,0x0ef2 (not taken)

    mem.write8(R(0x00), 0x00);
    m.step(0x0ee4, 19); // ld (ix+0x00),0x00

    regs.a = mem.read8(0x421e);
    m.step(0x0ee7, 13); // ld a,(0x421e) -- difficulty

    regs.a = regs.inc8(regs.a);
    m.step(0x0ee8, 4); // inc a

    regs.cp(0x03);
    m.step(0x0eea, 7); // cp 0x03

    if (regs.fC) {
      m.step(0x0eee, 12); // jr c,0x0eee
    } else {
      m.step(0x0eec, 7); // jr c,0x0eee (not taken)
      regs.a = 0x02;
      m.step(0x0eee, 7); // ld a,0x02 -- clamp difficulty at 2
    }

    // loc_0eee:
    mem.write8(0x421e, regs.a);
    m.step(0x0ef1, 13); // ld (0x421e),a
    m.ret();
  }

  // loc_0ef2: 0x422a = popcount of bit0 of (ix+0x20) and (ix+0x40); then jp 0x0ead (re-run loc_0ead).
  function runEf2() {
    regs.xor(regs.a);
    m.step(0x0ef3, 4); // xor a

    regs.bit(0, mem.read8(R(0x20)), (R(0x20) >> 8) & 0xff);
    m.step(0x0ef7, 20); // bit 0,(ix+0x20)

    if (regs.fZ) {
      m.step(0x0efa, 12); // jr z,0x0efa
    } else {
      m.step(0x0ef9, 7); // jr z,0x0efa (not taken)
      regs.a = regs.inc8(regs.a);
      m.step(0x0efa, 4); // inc a
    }

    // loc_0efa:
    regs.bit(0, mem.read8(R(0x40)), (R(0x40) >> 8) & 0xff);
    m.step(0x0efe, 20); // bit 0,(ix+0x40)

    if (regs.fZ) {
      m.step(0x0f01, 12); // jr z,0x0f01
    } else {
      m.step(0x0f00, 7); // jr z,0x0f01 (not taken)
      regs.a = regs.inc8(regs.a);
      m.step(0x0f01, 4); // inc a
    }

    // loc_0f01:
    mem.write8(0x422a, regs.a);
    m.step(0x0f04, 13); // ld (0x422a),a

    m.step(0x0ead, 10); // jp 0x0ead
    return runEad();
  }
}
