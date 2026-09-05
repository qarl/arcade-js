// SPDX-License-Identifier: GPL-3.0-only

// loc_090d  (ROM 0x090d-0x096e) — main-loop mover (called from 0x0156/0x03f2/0x0536/0x077b): nudges the
// 16-bit word at 0x420e one step toward the bound pair in DE=(0x4210), throttled to once per 4 frames
// (0x425f & 3) and steered by the direction byte (0x420d). Edge/limit paths tail-jump to loc_0988, loc_097d
// or loc_0983; the normal path stores 0x420e and falls through loc_096f. A leading proximity gate
// (0x4208 bit0, nibble index into 0x41f0) can shortcut to loc_0988. Interior labels 093e/0953/095d/0965/096c
// are inlined via labeled-block control flow.
export function loc_090d(m) {
  const { regs, mem } = m;

  BIG: {
    CHAIN1: {
      ENTRY: {
        regs.hl = 0x4208;
        m.step(0x0910, 10); // ld hl,0x4208 -- proximity gate flag

        regs.bit(0, mem.read8(regs.hl));
        m.step(0x0912, 12); // bit 0,(hl)

        if (regs.fZ) { m.step(0x093e, 12); break ENTRY; } // jr z,0x093e (gate clear)
        m.step(0x0914, 7);

        regs.l = regs.inc8(regs.l);
        m.step(0x0915, 4); // inc l -> 0x4209

        regs.a = mem.read8(regs.hl);
        m.step(0x0916, 7); // ld a,(0x4209)

        regs.sub(0x22);
        m.step(0x0918, 7); // sub 0x22

        regs.cp(0x50);
        m.step(0x091a, 7); // cp 0x50

        if (regs.fNC) { m.step(0x093e, 12); break ENTRY; } // jr nc,0x093e (out of window)
        m.step(0x091c, 7);

        regs.l = regs.inc8(regs.l);
        m.step(0x091d, 4); // inc l -> 0x420a

        regs.a = mem.read8(0x420e);
        m.step(0x0920, 13); // ld a,(0x420e)

        regs.sub(mem.read8(regs.hl));
        m.step(0x0921, 7); // sub (0x420a)

        regs.neg();
        m.step(0x0923, 8); // neg -- A = (0x420a)-(0x420e)

        regs.b = regs.a;
        m.step(0x0924, 4); // ld b,a

        regs.add(0x02);
        m.step(0x0926, 7); // add a,0x02

        regs.and(0x0f);
        m.step(0x0928, 7); // and 0x0f

        regs.cp(0x03);
        m.step(0x092a, 7); // cp 0x03

        if (regs.fNC) { m.step(0x093e, 12); break ENTRY; } // jr nc,0x093e
        m.step(0x092c, 7);

        regs.a = regs.b;
        m.step(0x092d, 4); // ld a,b

        regs.rrca();
        m.step(0x092e, 4);
        regs.rrca();
        m.step(0x092f, 4);
        regs.rrca();
        m.step(0x0930, 4);
        regs.rrca();
        m.step(0x0931, 4); // rrca x4 -- high nibble -> low

        regs.and(0x0f);
        m.step(0x0933, 7); // and 0x0f -- nibble index

        regs.e = regs.a;
        m.step(0x0934, 4); // ld e,a

        regs.d = 0x00;
        m.step(0x0936, 7); // ld d,0x00

        regs.hl = 0x41f0;
        m.step(0x0939, 10); // ld hl,0x41f0

        regs.addHl(regs.de);
        m.step(0x093a, 11); // add hl,de -- 0x41f0+n

        regs.bit(0, mem.read8(regs.hl));
        m.step(0x093c, 12); // bit 0,(hl)

        if (regs.fNZ) { m.step(0x0988, 12); return m.call(0x0988); } // jr nz,0x0988 (shortcut)
        m.step(0x093e, 7); // fall to loc_093e
      }

      // loc_093e:
      regs.hl = mem.read16(0x420e);
      m.step(0x0941, 16); // ld hl,(0x420e) -- current word

      regs.de = mem.read16(0x4210);
      m.step(0x0945, 20); // ld de,(0x4210) -- bound pair (E=lo,D=hi)

      regs.a = mem.read8(0x420d);
      m.step(0x0948, 13); // ld a,(0x420d) -- direction

      regs.and(regs.a);
      m.step(0x0949, 4); // and a

      if (regs.fNZ) { m.step(0x095d, 12); break CHAIN1; } // jr nz,0x095d (dir set -> decreasing arm)
      m.step(0x094b, 7);

      regs.bit(7, regs.h);
      m.step(0x094d, 8); // bit 7,h

      if (regs.fNZ) {
        m.step(0x0953, 12); // jr nz,0x0953 (taken: word negative)
      } else {
        m.step(0x094f, 7); // jr nz,0x0953 not taken
        regs.a = regs.l;
        m.step(0x0950, 4); // ld a,l
        regs.cp(regs.e);
        m.step(0x0951, 4); // cp e
        if (regs.fNC) { m.step(0x097d, 12); return m.call(0x097d); } // jr nc,0x097d (reached bound)
        m.step(0x0953, 7); // fall to loc_0953
      }

      // loc_0953:
      regs.a = mem.read8(0x425f);
      m.step(0x0956, 13); // ld a,(0x425f) -- frame counter
      regs.and(0x03);
      m.step(0x0958, 7); // and 0x03 -- 4-frame throttle
      if (regs.fNZ) { m.ret(11); return; } // ret nz (not this frame)
      m.step(0x0959, 5);
      regs.hl = (regs.hl + 1) & 0xffff;
      m.step(0x095a, 6); // inc hl -- step up
      m.step(0x096c, 10); break BIG; // jp 0x096c
    }

    // loc_095d:
    regs.bit(7, regs.h);
    m.step(0x095f, 8); // bit 7,h
    if (regs.fNZ) {
      m.step(0x0961, 7); // jr z,0x0965 not taken
      regs.a = regs.l;
      m.step(0x0962, 4); // ld a,l
      regs.cp(regs.d);
      m.step(0x0963, 4); // cp d
      if (regs.fC) { m.step(0x0983, 12); return m.call(0x0983); } // jr c,0x0983 (reached bound)
      m.step(0x0965, 7); // fall to loc_0965
    } else {
      m.step(0x0965, 12); // jr z,0x0965 (taken: word negative)
    }

    // loc_0965:
    regs.a = mem.read8(0x425f);
    m.step(0x0968, 13); // ld a,(0x425f)
    regs.and(0x03);
    m.step(0x096a, 7); // and 0x03 -- throttle
    if (regs.fNZ) { m.ret(11); return; } // ret nz
    m.step(0x096b, 5);
    regs.hl = (regs.hl - 1) & 0xffff;
    m.step(0x096c, 6); // dec hl -- step down
  }

  // loc_096c:
  mem.write16(0x420e, regs.hl);
  m.step(0x096f, 16); // ld (0x420e),hl -- store advanced word
  // fall-through into loc_096f (genuine, jp target of loc_0988) -- delegate
  return m.call(0x096f);
}
