// SPDX-License-Identifier: GPL-3.0-only
/**
 * entry_2913 — hand-optimized rewrite of the translated routine at ROM 0x2913,
 * proven equal to its oracle by the equivalence harness. A read-only collision query over
 * IX object records; it writes no work RAM and names none.
 */

/**
 * entry_2913 -- proximity/collision test: is the IY subject inside any active IX record's
 * box?  [ROM 0x2913-0x2954]
 *
 * Eight callers (wrappers like sub_2a22 that preset B/DE/IX). It walks B records at stride
 * DE from IX, and for each ACTIVE one (bit 0 of ix+0x00 set) tests whether the subject's
 * position falls inside the record's box:
 *   - X: |C - (ix+5)| + 1, compared against L (near span) then (ix+0x0A) (far span),
 *   - Y: |(iy+3) - (ix+3)|, compared against H then (ix+0x09).
 * `neg` forms the absolute difference; `sub`/carry do the span comparisons.
 *
 * THE EXITS FOLLOW THE sub_0008 SKIP CONVENTION:
 *   - HIT (0x2945): A=1, restore IX, then `inc sp` TWICE to DISCARD this routine's own
 *     return address and `ret` to the CALLER'S CALLER -- returns `false` (SKIPPED).
 *   - list exhausted (0x2950): A=0, restore IX, normal `ret` -- returns `true` (NORMAL).
 * Callers branch on that boolean (`if (!m.call(0x2913)) { ... }`), so the return value is
 * load-bearing and reproduced exactly.
 *
 * The `bit 0,(ix+0x00)` uses the indexed-addressing F3/F5 source (the effective-address
 * high byte, cpu.js's third `bit` argument), not the operand -- preserved verbatim.
 *
 * CYCLES -- PER-INSTRUCTION, not collapsed: it manipulates SP directly (the skip exit), so
 * it could never collapse, and its callers are not all provably mask-cleared regardless.
 */
export function entry_2913(m) {
  const { regs, mem } = m;

  m.push16(regs.ix); // push ix -- OUTSIDE the loop (djnz targets 0x2915)
  m.step(0x2915, 15);

  for (;;) {
    // `advance` = the ROM's 0x294C target: every "not a match" jump lands there.
    advance: {
      const ea2915 = (regs.ix + 0x00) & 0xffff;
      regs.bit(0, mem.read8(ea2915), (ea2915 >> 8) & 0xff); // F3/F5 from EA high byte
      m.step(0x2919, 20);
      if (regs.fZ) {
        m.step(0x294c, 10); // jp z -- slot inactive
        break advance;
      }
      m.step(0x291c, 10);

      regs.a = regs.c;
      m.step(0x291d, 4);
      regs.sub(mem.read8((regs.ix + 0x05) & 0xffff));
      m.step(0x2920, 19);
      if (regs.fNC) {
        m.step(0x2925, 10);
      } else {
        m.step(0x2923, 10);
        regs.neg();
        m.step(0x2925, 8); // absolute difference
      }

      regs.a = regs.inc8(regs.a);
      m.step(0x2926, 4);
      regs.sub(regs.l);
      m.step(0x2927, 4);
      if (regs.fC) {
        m.step(0x2930, 10); // within the near span
      } else {
        m.step(0x292a, 10);
        regs.sub(mem.read8((regs.ix + 0x0a) & 0xffff));
        m.step(0x292d, 19);
        if (regs.fNC) {
          m.step(0x294c, 10); // out of range
          break advance;
        }
        m.step(0x2930, 10);
      }

      regs.a = mem.read8((regs.iy + 0x03) & 0xffff);
      m.step(0x2933, 19);
      regs.sub(mem.read8((regs.ix + 0x03) & 0xffff));
      m.step(0x2936, 19);
      if (regs.fNC) {
        m.step(0x293b, 10);
      } else {
        m.step(0x2939, 10);
        regs.neg();
        m.step(0x293b, 8); // absolute difference
      }

      regs.sub(regs.h);
      m.step(0x293c, 4);
      if (regs.fC) {
        m.step(0x2945, 10); // HIT
      } else {
        m.step(0x293f, 10);
        regs.sub(mem.read8((regs.ix + 0x09) & 0xffff));
        m.step(0x2942, 19);
        if (regs.fNC) {
          m.step(0x294c, 10); // out of range
          break advance;
        }
        m.step(0x2945, 10); // falls into the HIT exit
      }

      // ---- 0x2945 HIT: A=1, restore IX, DISCARD our return address, ret ----
      regs.a = 0x01;
      m.step(0x2947, 7);
      regs.ix = m.pop16();
      m.step(0x2949, 14);
      regs.sp = (regs.sp + 1) & 0xffff;
      m.step(0x294a, 6); // inc sp
      regs.sp = (regs.sp + 1) & 0xffff;
      m.step(0x294b, 6); // inc sp -- our return address is now discarded
      m.ret(); // ret -> the CALLER'S CALLER
      return false; // SKIPPED (sub_0008 convention)
    }

    // ---- 0x294C: advance to the next record and loop ----
    regs.addIx(regs.de);
    m.step(0x294e, 15);
    regs.djnz();
    m.step(regs.b !== 0 ? 0x2915 : 0x2950, regs.b !== 0 ? 13 : 8);
    if (regs.b === 0) break;
  }

  // ---- 0x2950: list exhausted -- A=0, restore IX, NORMAL return ----
  regs.xor(regs.a);
  m.step(0x2951, 4);
  regs.ix = m.pop16();
  m.step(0x2953, 14);
  m.ret(); // ret -> the caller
  return true; // returned NORMALLY (sub_0008 convention)
}
