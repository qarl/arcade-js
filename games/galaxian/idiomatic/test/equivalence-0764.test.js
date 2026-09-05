// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_0764 — equivalent to the frozen oracle at ROM 0x0764.
 * Bit-packer: reads bit 0 of 128 flag bytes at 0x4100 and packs them LSB-first into a 16-byte bitmap
 * at DE. Two live-outs: the 16 output bytes (in the state dump) and the advanced DE = entry + 16 (a
 * register the callers loc_073d/loc_0818 chain straight into an ldir dest — invisible to ramDiff). So
 * EQUAL asserts ramDiff==null on the bitmap AND register DE. A crafted entry seats DE at a work-RAM
 * dest, lays a varied flag pattern, and pre-dirties the 16 dest cells with a sentinel so the oracle
 * demonstrably changes them. Teeth: no-op (RAM), wrong-DE-advance (register), MSB-first packing (RAM).
 */
import test from "node:test";
import assert from "node:assert/strict";

import { craft, ramDiff, romsPresent, STUBS } from "./_bootSetup.js";
import { loc_0764 as cand } from "../loc_0764.js";
import { loc_0764 as oracle } from "../../translated/loc_0764.js";

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const FLAGS = 0x4100; // 128 source flag bytes
const DEST = 0x41a0;  // work-RAM bitmap dest (clear of the flag span and the masked stack window)
const SENT = 0xcc;    // pre-poked into the 16 dest cells so the oracle's writes are observable

// A varied flag pattern (bit 0 set every third byte) so per-cell / bit-order errors show up.
const entry = () => craft((mem, mm) => {
  for (let i = 0; i < 128; i++) mem[FLAGS + i] = i % 3 === 0 ? 1 : 0;
  for (let i = 0; i < 16; i++) mem[DEST + i] = SENT;
  mm.regs.de = DEST;
  mm.push16(0x9999);
});

// DE is a register live-out (ramDiff is blind); observe it directly.
function deDiff(twin, e) {
  const a = e.clone(); a.routines = STUBS; oracle(a);
  const b = e.clone(); b.routines = STUBS; twin(b);
  if (a.regs.de !== b.regs.de) return `DE: 0x${a.regs.de.toString(16)} vs 0x${b.regs.de.toString(16)}`;
  return null;
}

const noOp = () => {};
const wrongDe = (m) => { cand(m); m.regs.de = (m.regs.de + 1) & 0xffff; };
// Correct source read but packs MSB-first (bit 7-k instead of bit k) -> different bitmap bytes.
const msbFirst = (m) => {
  const { mem8 } = m;
  for (let byte = 0; byte < 16; byte++) {
    let packed = 0;
    for (let bit = 0; bit < 8; bit++) if (mem8[FLAGS + byte * 8 + bit] & 1) packed |= 1 << (7 - bit);
    mem8[DEST + byte] = packed;
  }
  m.regs.de = (DEST + 16) & 0xffff;
};

test("EQUAL (crafted): loc_0764 == oracle packs the bitmap and advances DE", { skip }, () => {
  assert.equal(ramDiff(oracle, cand, entry()), null, "loc_0764 bitmap diverged");
  assert.equal(deDiff(cand, entry()), null, "loc_0764 advanced DE diverged");
  // non-vacuous: the oracle really rewrites the dest and advances DE by 16.
  const a = entry().clone(); a.routines = STUBS; oracle(a);
  assert.notEqual(a.mem8[DEST], SENT, "positive control: oracle rewrote the first bitmap byte");
  assert.equal(a.regs.de, (DEST + 16) & 0xffff, "positive control: oracle advanced DE by 16");
  console.log("  EQUAL: loc_0764 == oracle (16-byte bitmap + DE advance)");
});

test("TEETH: broken twins are caught", { skip }, () => {
  assert.ok(ramDiff(oracle, noOp, entry()), "the no-op twin escaped (RAM)");
  assert.ok(deDiff(wrongDe, entry()), "the wrong-DE-advance twin escaped (register)");
  assert.ok(ramDiff(oracle, msbFirst, entry()), "the MSB-first packing twin escaped (RAM)");
  console.log("  TEETH: no-op (RAM), wrong-DE (register), MSB-first packing (RAM) all caught");
});
