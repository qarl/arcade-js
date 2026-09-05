// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_2279 — memory-equivalent to the frozen oracle at ROM 0x2279 (single BCD-digit VRAM painter).
 * GATE: crafted-entry. Register live-in is A (the nibble), C (the leading-zero blank counter), IX (the
 * VRAM cursor) and DE (the cursor stride); the memory effect is one glyph tile written at IX. Its caller
 * loc_2269 chains IX (the VRAM cursor) and C (the blank counter) across a per-digit loop, so BOTH are
 * load-bearing register live-outs invisible to the RAM diff. So EQUAL asserts the tile write (ramDiff)
 * AND registers IX + C. We drive all three glyph paths:
 *   digit!=0            -> tile 0x90+digit (and blanking cleared)
 *   digit==0, blank!=0  -> tile 0x10 (a blanked leading zero)
 *   digit==0, blank==0  -> tile 0x90 (a shown '0')
 * TEETH: no-op, blanking-ignored, wrong-glyph-base (RAM); wrong-IX and wrong-C (registers).
 */
import test from "node:test";
import assert from "node:assert/strict";

import { craft, ramDiff, romsPresent, STUBS } from "./_bootSetup.js";
import { loc_2279 as cand } from "../loc_2279.js";
import { loc_2279 as oracle } from "../../translated/loc_2279.js";

const CELL = 0x4200; // scratch cell, clear of the masked stack window
const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

function seed(digit, blank) {
  return craft((mem8, m) => {
    m.push16(0x9999);
    m.regs.a = digit;
    m.regs.c = blank;
    m.regs.ix = CELL;
    m.regs.de = 1;
    mem8[CELL] = 0x66; // sentinel distinct from any glyph tile
  });
}

// IX (VRAM cursor) and C (blank counter) are register live-outs the caller chains; observe them directly.
function ixcDiff(twin, e) {
  const a = e.clone(); a.routines = STUBS; oracle(a);
  const b = e.clone(); b.routines = STUBS; twin(b);
  if (a.regs.ix !== b.regs.ix) return `IX: 0x${a.regs.ix.toString(16)} vs 0x${b.regs.ix.toString(16)}`;
  if (a.regs.c !== b.regs.c) return `C: ${a.regs.c} vs ${b.regs.c}`;
  return null;
}

// [A, C, expected tile]: A carries junk in the high nibble to prove the &0x0f mask.
const CASES = [
  [0xf5, 0x00, 0x95], // significant digit 5
  [0x09, 0x05, 0x99], // significant digit 9 (blanking cleared)
  [0x00, 0x03, 0x10], // leading zero, still blanking -> blank tile
  [0x00, 0x01, 0x10], // leading zero, one blank slot left
  [0x00, 0x00, 0x90], // zero after blanking finished -> real '0'
];

test("EQUAL (crafted): loc_2279 == oracle across all glyph paths (RAM + IX + C)", { skip }, () => {
  for (const [a, c] of CASES) {
    assert.equal(ramDiff(oracle, cand, seed(a, c)), null, `A=0x${a.toString(16)} C=0x${c.toString(16)} RAM diverged`);
    assert.equal(ixcDiff(cand, seed(a, c)), null, `A=0x${a.toString(16)} C=0x${c.toString(16)} IX/C diverged`);
  }
  // Positive control: the oracle stamps each expected tile and advances the cursor past it.
  for (const [a, c, tile] of CASES) {
    const e = seed(a, c); const before = e.regs.ix; e.routines = STUBS; oracle(e);
    assert.equal(e.mem8[CELL], tile, `control: A=0x${a.toString(16)} C=0x${c.toString(16)} -> tile 0x${tile.toString(16)}`);
    assert.notEqual(e.regs.ix, before, "non-vacuous: oracle advanced the IX cursor");
  }
});

test("TEETH: broken twins are caught", { skip }, () => {
  const noOp = () => {};
  const ignoreBlank = (m) => { m.mem8[m.regs.ix] = ((m.regs.a & 0x0f) + 0x90) & 0xff; }; // never blanks
  const wrongBase = (m) => { // correct blanking, wrong glyph base (0x80 not 0x90)
    const digit = m.regs.a & 0x0f;
    let base;
    if (digit !== 0) base = digit;
    else if (m.regs.c !== 0) base = 0x80;
    else base = 0;
    m.mem8[m.regs.ix] = (base + 0x80) & 0xff;
  };
  const wrongCursor = (m) => { cand(m); m.regs.ix = (m.regs.ix + 1) & 0xffff; }; // right tile, wrong IX advance
  const wrongBlank = (m) => { cand(m); m.regs.c = (m.regs.c + 1) & 0xff; };       // right tile, wrong C
  assert.ok(CASES.some(([a, c]) => ramDiff(oracle, noOp, seed(a, c))), "no-op twin escaped");
  assert.ok(CASES.some(([a, c]) => ramDiff(oracle, ignoreBlank, seed(a, c))), "blanking-ignored twin escaped");
  assert.ok(CASES.some(([a, c]) => ramDiff(oracle, wrongBase, seed(a, c))), "wrong-glyph-base twin escaped");
  assert.ok(ixcDiff(wrongCursor, seed(0xf5, 0x00)), "wrong-IX twin escaped (register)");
  assert.ok(CASES.some(([a, c]) => ixcDiff(wrongBlank, seed(a, c))), "wrong-C twin escaped (register)");
});
