// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_0a32 — crafted-entry equivalence vs the frozen arm-the-trigger-flags tail.
 * Live-out is RAM only: it writes the arm flag at 0x4208 (both paths) and the companion flag at
 * 0x41cc (input-mask path only). No register is read back by the caller, so ramDiff is the whole
 * check (return-stack window masked). We exercise: the input-mask hit (arms both), the range-test
 * hit (arms 0x4208 only), and the two bail gates (enable clear / already armed). Teeth: a no-op, an
 * arms-only-one twin, and a wrong-cell twin.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { craft, ramDiff, romsPresent } from "./_bootSetup.js";
import { loc_0a32 as cand } from "../loc_0a32.js";
import { loc_0a32 as oracle } from "../../translated/loc_0a32.js";

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const GATE = 0x4200; // enable gate (bit 0)
const ARM = 0x4208; // arm flag (bit 0 = already armed)
const COMPANION = 0x41cc; // companion arm flag (input path only)
const CONTROL = 0x4006; // branch control (bit 0)
const SELECT = 0x4018; // input-pair select (bit 0)
const LINE_A = 0x4010; // primary input line
const GUARD_A = 0x4013; // primary guard mask
const LINE_B = 0x4011; // alternate input line
const GUARD_B = 0x4014; // alternate guard mask
const RANGE = 0x425f; // low-5-bits range cell

// Input-mask hit: gate open, not armed, control bit set, primary pair, bit 4 set in line & clear in guard.
const inputHit = () => craft((mem, mm) => {
  mm.push16(0x9999);
  mem[GATE] = 1; mem[ARM] = 0; mem[COMPANION] = 0;
  mem[CONTROL] = 1; mem[SELECT] = 0; mem[LINE_A] = 0x10; mem[GUARD_A] = 0x00;
});
// Alternate-pair input hit: select bit set, alt line/guard carry the active bit.
const altHit = () => craft((mem, mm) => {
  mm.push16(0x9999);
  mem[GATE] = 1; mem[ARM] = 0; mem[COMPANION] = 0;
  mem[CONTROL] = 1; mem[SELECT] = 1; mem[LINE_B] = 0x10; mem[GUARD_B] = 0x00;
});
// Range hit: control bit clear, low 5 bits of the range cell clear -> arm 0x4208 only.
const rangeHit = () => craft((mem, mm) => {
  mm.push16(0x9999);
  mem[GATE] = 1; mem[ARM] = 0; mem[COMPANION] = 0; mem[CONTROL] = 0; mem[RANGE] = 0x20;
});
// Gate closed: nothing is armed.
const gateClosed = () => craft((mem, mm) => {
  mm.push16(0x9999);
  mem[GATE] = 0; mem[ARM] = 0; mem[COMPANION] = 0;
});
// Already armed: bit 0 of the arm flag set -> bail before touching anything.
const alreadyArmed = () => craft((mem, mm) => {
  mm.push16(0x9999);
  mem[GATE] = 1; mem[ARM] = 1; mem[COMPANION] = 0; mem[CONTROL] = 1; mem[SELECT] = 0;
  mem[LINE_A] = 0x10; mem[GUARD_A] = 0x00;
});

test("EQUAL (crafted): loc_0a32 == oracle across all paths", { skip }, () => {
  for (const [name, e] of [
    ["input-mask hit", inputHit], ["alternate-pair hit", altHit], ["range hit", rangeHit],
    ["gate closed", gateClosed], ["already armed", alreadyArmed],
  ]) {
    assert.equal(ramDiff(oracle, cand, e()), null, `loc_0a32 diverged on the ${name} path`);
  }
  // Non-vacuous: the oracle really arms both flags on the input path and only 0x4208 on the range path.
  const a = inputHit(); oracle(a);
  assert.equal(a.mem8[ARM], 1, "positive control: input path did not set the arm flag");
  assert.equal(a.mem8[COMPANION], 1, "positive control: input path did not set the companion flag");
  const r = rangeHit(); oracle(r);
  assert.equal(r.mem8[ARM], 1, "positive control: range path did not set the arm flag");
  assert.equal(r.mem8[COMPANION], 0, "positive control: range path wrongly set the companion flag");
  console.log("  EQUAL: loc_0a32 == oracle (RAM) across input/range/bail paths");
});

test("TEETH: broken twins are caught", { skip }, () => {
  const noOp = () => {};
  const armsOnlyOne = (m) => { m.mem8[ARM] = 1; };               // misses the companion flag
  const wrongCell = (m) => { m.mem8[ARM] = 1; m.mem8[COMPANION + 1] = 1; }; // arms the wrong companion
  assert.ok(ramDiff(oracle, noOp, inputHit()), "the no-op twin escaped");
  assert.ok(ramDiff(oracle, armsOnlyOne, inputHit()), "the arms-only-one twin escaped");
  assert.ok(ramDiff(oracle, wrongCell, inputHit()), "the wrong-cell twin escaped");
  console.log("  TEETH: no-op, arms-only-one, wrong-cell all caught");
});
