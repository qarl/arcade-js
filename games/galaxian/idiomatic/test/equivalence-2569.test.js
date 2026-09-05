// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_2569 — crafted-entry equivalence vs the frozen hex-to-BCD tail.
 * This leaf writes no RAM; its only live-out is the accumulator, the packed-BCD form of the input.
 * ramDiff is blind to registers, so EQUAL is asserted on register A (run oracle vs candidate from the
 * same entry, compare A) across a spread of inputs, plus ramDiff==null to prove no RAM is touched.
 * Non-vacuous: the oracle really transforms A. Teeth: no-op, swapped-nibbles, and off-by-one twins.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { craft, ramDiff, romsPresent, STUBS } from "./_bootSetup.js";
import { loc_2569 as cand } from "../loc_2569.js";
import { loc_2569 as oracle } from "../../translated/loc_2569.js";

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

// A crafted entry with the input byte in A and a ret target for the oracle's ret.
const entry = (value) => craft((mem, mm) => { mm.regs.a = value; mm.push16(0x9999); });

// The live-out is register A; observe it directly (ramDiff is blind to registers).
function aDiff(twin, e) {
  const a = e.clone(); a.routines = STUBS; oracle(a);
  const b = e.clone(); b.routines = STUBS; twin(b);
  return a.regs.a === b.regs.a ? null : `A: 0x${a.regs.a.toString(16)} vs 0x${b.regs.a.toString(16)}`;
}

const bcd = (v) => (Math.floor((v % 100) / 10) << 4) | ((v % 100) % 10);

test("EQUAL (crafted): loc_2569 == oracle on register A", { skip }, () => {
  for (const v of [0, 1, 9, 10, 15, 16, 42, 63, 99, 100, 155, 200, 255]) {
    assert.equal(aDiff(cand, entry(v)), null, `loc_2569 A diverged for input ${v}`);
    assert.equal(ramDiff(oracle, cand, entry(v)), null, `loc_2569 touched RAM for input ${v}`);
    // Non-vacuous: the oracle produces the packed-BCD form for this input.
    const a = entry(v); a.routines = STUBS; oracle(a);
    assert.equal(a.regs.a, bcd(v), `oracle BCD wrong for input ${v}`);
  }
  console.log("  EQUAL: loc_2569 == oracle on register A across 0..255 samples, no RAM touched");
});

test("TEETH: broken twins are caught", { skip }, () => {
  const noOp = () => {};
  const swapNibbles = (m) => { const v = m.regs.a % 100; m.regs.a = ((v % 10) << 4) | Math.floor(v / 10); };
  const offByOne = (m) => { const v = m.regs.a % 100; m.regs.a = (((Math.floor(v / 10) << 4) | (v % 10)) + 1) & 0xff; };
  assert.ok(aDiff(noOp, entry(42)), "the no-op twin escaped");
  assert.ok(aDiff(swapNibbles, entry(42)), "the swapped-nibbles twin escaped");
  assert.ok(aDiff(offByOne, entry(42)), "the off-by-one twin escaped");
  console.log("  TEETH: no-op, swapped-nibbles, off-by-one all caught on register A");
});
