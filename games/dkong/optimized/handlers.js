// SPDX-License-Identifier: GPL-3.0-only
/**
 * optimized/ — rung 1 of the ladder: a VERBATIM relocation, not yet an
 * optimization.
 *
 * `handler_01c3` below is a character-for-character copy of the same routine in
 * ../translated/state0.js: same logic, same `m.step()` T-state charges, same
 * write order. Its ONLY purpose is to give the equivalence harness a routine it
 * can prove EQUAL against the oracle — the identity case that must pass before
 * any real rewrite is trusted. Do NOT optimize it here; that is the next phase,
 * and it happens only after the harness gate is green on this copy.
 *
 * WHAT IS IMPORTED vs COPIED, and why:
 *   - sub_0874, sub_0a53, sub_309f (state0.js) and entry_06b8 (mainloop.js) are
 *     EXPORTED by translated/, so the copy calls them directly — the oracle
 *     stays the single implementation of each.
 *   - sub_0207 is NOT exported by state0.js, and translated/ is the oracle and
 *     is never edited (README §1) — so it cannot be imported. It is reproduced
 *     here verbatim as a file-private helper. It is self-contained (it calls no
 *     other translated routine, only machine/register/memory methods), so the copy is
 *     exact and needs no further imports.
 */

import { sub_0874, sub_0a53, sub_309f } from "../translated/state0.js";
import { entry_06b8 } from "../translated/mainloop.js";

/**
 * handler_01c3 -- ROM 0x01C3-0x0206  (game state 0)  [VERBATIM copy]
 *
 * See ../translated/state0.js for the full disassembly and commentary. This is
 * a byte-for-byte behavioural twin, relocated only so the harness can diff the
 * two implementations from identical machine state.
 */
export function handler_01c3(m) {
  const { regs, mem } = m;

  m.push16(0x01c6);
  m.step(0x0874, 17);
  sub_0874(m);

  regs.hl = 0x01ba;
  m.step(0x01c9, 10);
  regs.de = 0x60b2;
  m.step(0x01cc, 10);
  regs.bc = 0x0009;
  m.step(0x01cf, 10);
  m.ldir(0x01d1);

  regs.a = 0x01;
  m.step(0x01d3, 7);
  mem.write8(0x6007, regs.a);
  m.step(0x01d6, 13);
  mem.write8(0x6229, regs.a);
  m.step(0x01d9, 13);
  mem.write8(0x6228, regs.a);
  m.step(0x01dc, 13);

  // A real `call` here, unlike sub_0350's tail jump into the same routine.
  m.push16(0x01df);
  m.step(0x06b8, 17);
  entry_06b8(m);

  m.push16(0x01e2);
  m.step(0x0207, 17);
  sub_0207(m);

  regs.a = 0x01;
  m.step(0x01e4, 7);
  mem.write8(0x7d82, regs.a, 10); // flipscreen = 1
  m.step(0x01e7, 13);
  mem.write8(0x6005, regs.a); // advance the game state
  m.step(0x01ea, 13);
  mem.write8(0x6227, regs.a);
  m.step(0x01ed, 13);
  regs.xor(regs.a);
  m.step(0x01ee, 4);
  mem.write8(0x600a, regs.a);
  m.step(0x01f1, 13);

  m.push16(0x01f4);
  m.step(0x0a53, 17);
  sub_0a53(m);

  // Three tasks queued, each a 16-bit (D,E) pair.
  for (const [de, after, next] of [
    [0x0304, 0x01f7, 0x01fa],
    [0x0202, 0x01fd, 0x0200],
    [0x0200, 0x0203, 0x0206],
  ]) {
    regs.de = de;
    m.step(after, 10);
    m.push16(next);
    m.step(0x309f, 17);
    sub_309f(m);
  }

  m.ret();
}

/**
 * sub_0207 -- ROM 0x0207-0x0264  [VERBATIM copy; see note in the file header]
 *
 * Unpacks DSW0 into the settings block at 0x6020 (lives, bonus threshold in
 * BCD, coinage counters, two-player flag) and ends with an `ldir` of 0xAA bytes
 * from ROM 0x3565 to 0x6100. Copied here only because state0.js does not export
 * it; behaviour is identical to the oracle's.
 */
function sub_0207(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(0x7d80); // DSW0
  m.step(0x020a, 13);
  regs.c = regs.a;
  m.step(0x020b, 4);
  regs.hl = 0x6020;
  m.step(0x020e, 10);
  regs.and(0x03);
  m.step(0x0210, 7);
  regs.add(0x03);
  m.step(0x0212, 7);
  mem.write8(regs.hl, regs.a); // lives
  m.step(0x0213, 7);
  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x0214, 6);

  regs.a = regs.c;
  m.step(0x0215, 4);
  regs.rrca();
  m.step(0x0216, 4);
  regs.rrca();
  m.step(0x0217, 4);
  regs.and(0x03);
  m.step(0x0219, 7);
  const zero = regs.fZ; // captured BEFORE the flag-neutral loads below
  regs.b = regs.a;
  m.step(0x021a, 4);
  regs.a = 0x07;
  m.step(0x021c, 7);
  if (zero) {
    m.step(0x0226, 10); // jp z taken -- bonus stays 7
  } else {
    m.step(0x021f, 10);
    regs.a = 0x05;
    m.step(0x0221, 7);
    do {
      regs.add(0x05);
      m.step(0x0223, 7);
      regs.daa(); // BCD -- exact semantics matter here
      m.step(0x0224, 4);
      regs.djnz();
      m.step(regs.b !== 0 ? 0x0221 : 0x0226, regs.b !== 0 ? 13 : 8);
    } while (regs.b !== 0);
  }

  mem.write8(regs.hl, regs.a); // bonus threshold
  m.step(0x0227, 7);
  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x0228, 6);
  regs.a = regs.c;
  m.step(0x0229, 4);
  regs.bc = 0x0101;
  m.step(0x022c, 10);
  regs.de = 0x0102;
  m.step(0x022f, 10);
  regs.and(0x70); // coinage bits
  m.step(0x0231, 7);
  for (const nxt of [0x0232, 0x0233, 0x0234, 0x0235]) {
    regs.rla();
    m.step(nxt, 4);
  }

  if (regs.fZ) {
    m.step(0x0247, 10); // jp z -- defaults already in BC/DE
  } else {
    m.step(0x0238, 10);
    if (regs.fC) {
      m.step(0x0241, 10);
      regs.add(0x02);
      m.step(0x0243, 7);
      regs.b = regs.a;
      m.step(0x0244, 4);
      regs.d = regs.a;
      m.step(0x0245, 4);
      regs.add(regs.a); // add a,a
      m.step(0x0246, 4);
      regs.e = regs.a;
      m.step(0x0247, 4);
    } else {
      m.step(0x023b, 10);
      regs.a = regs.inc8(regs.a);
      m.step(0x023c, 4);
      regs.c = regs.a;
      m.step(0x023d, 4);
      regs.e = regs.d;
      m.step(0x023e, 4);
      m.step(0x0247, 10); // jp 0x0247
    }
  }

  // loc_0247: store D, E, B, C into 0x6022-0x6025
  for (const [v, nxt, inc] of [
    [regs.d, 0x0248, 0x0249], [regs.e, 0x024a, 0x024b],
    [regs.b, 0x024c, 0x024d], [regs.c, 0x024e, 0x024f],
  ]) {
    mem.write8(regs.hl, v);
    m.step(nxt, 7);
    regs.hl = (regs.hl + 1) & 0xffff;
    m.step(inc, 6);
  }

  regs.a = mem.read8(0x7d80); // DSW0 again
  m.step(0x0252, 13);
  regs.rlca(); // bit 7 into carry
  m.step(0x0253, 4);
  regs.a = 0x01;
  m.step(0x0255, 7);
  if (regs.fC) {
    m.step(0x0259, 10); // jp c taken -- A stays 1
  } else {
    m.step(0x0258, 10);
    regs.a = regs.dec8(regs.a); // A = 0
    m.step(0x0259, 4);
  }
  mem.write8(regs.hl, regs.a);
  m.step(0x025a, 7);

  regs.hl = 0x3565;
  m.step(0x025d, 10);
  regs.de = 0x6100;
  m.step(0x0260, 10);
  regs.bc = 0x00aa;
  m.step(0x0263, 10);
  m.ldirAt(0x0263, 0x0265);

  m.ret();
}
