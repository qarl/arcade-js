// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_15f4 — crafted-entry equivalence vs the frozen slot-scan tail.
 * Live-out is RAM only: the (slot index, base value) pair is stored at 0x4213 / 0x4214, which the
 * callers read back from memory (the DE register is clobbered by the next call). So ramDiff is the
 * whole check (return-stack window masked). We exercise: alt flag off with a hit at the second slot,
 * alt flag on with a hit at the first slot's odd byte, and the not-found fall-through. Teeth: a no-op,
 * a never-scan twin (always the seed slot), a wrong-base twin, and an off-by-one-slot twin.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { craft, ramDiff, romsPresent } from "./_bootSetup.js";
import { loc_15f4 as cand } from "../loc_15f4.js";
import { loc_15f4 as oracle } from "../../translated/loc_15f4.js";

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const ALT = 0x421b; // alt-seed flag
const SLOTS = 0x41e8; // eight scan bytes (four two-byte slots)
const RESULT = 0x4213; // stored (slot, base) pair
const SENTINEL = 0xaa; // pre-poked into the result cells so every write is observable

function clearScan(mem) {
  for (let i = 0; i < 8; i++) mem[SLOTS + i] = 0;
  mem[RESULT] = SENTINEL;
  mem[RESULT + 1] = SENTINEL;
}

// alt off, first hit at the second slot's first byte -> slot 2, base 132.
const secondSlot = () => craft((mem, mm) => {
  mm.push16(0x9999); clearScan(mem); mem[ALT] = 0; mem[SLOTS + 2] = 1;
});
// alt on, first hit at the first slot's odd byte -> slot 2 (start), base 157.
const oddByte = () => craft((mem, mm) => {
  mm.push16(0x9999); clearScan(mem); mem[ALT] = 1; mem[SLOTS + 1] = 1;
});
// alt off, nothing set -> slot walks to 5, base 132.
const notFound = () => craft((mem, mm) => {
  mm.push16(0x9999); clearScan(mem); mem[ALT] = 0;
});

test("EQUAL (crafted): loc_15f4 == oracle across scan paths", { skip }, () => {
  for (const [name, e] of [["second slot", secondSlot], ["odd byte", oddByte], ["not found", notFound]]) {
    assert.equal(ramDiff(oracle, cand, e()), null, `loc_15f4 diverged on the ${name} path`);
  }
  // Non-vacuous: the oracle really writes the computed pair.
  const a = secondSlot(); oracle(a);
  assert.equal(a.mem8[RESULT], 2, "positive control: second-slot index wrong");
  assert.equal(a.mem8[RESULT + 1], 132, "positive control: primary base wrong");
  const b = notFound(); oracle(b);
  assert.equal(b.mem8[RESULT], 5, "positive control: not-found slot wrong");
  console.log("  EQUAL: loc_15f4 == oracle (RAM) across second-slot/odd-byte/not-found");
});

test("TEETH: broken twins are caught", { skip }, () => {
  const noOp = () => {};
  const neverScan = (m) => { m.mem8[RESULT] = 1; m.mem8[RESULT + 1] = 132; };      // ignores the scan
  const wrongBase = (m) => { m.mem8[RESULT] = 2; m.mem8[RESULT + 1] = 157; };      // primary base wrong
  const offByOneSlot = (m) => { m.mem8[RESULT] = 3; m.mem8[RESULT + 1] = 132; };   // slot index off by one
  assert.ok(ramDiff(oracle, noOp, secondSlot()), "the no-op twin escaped");
  assert.ok(ramDiff(oracle, neverScan, secondSlot()), "the never-scan twin escaped");
  assert.ok(ramDiff(oracle, wrongBase, secondSlot()), "the wrong-base twin escaped");
  assert.ok(ramDiff(oracle, offByOneSlot, secondSlot()), "the off-by-one-slot twin escaped");
  console.log("  TEETH: no-op, never-scan, wrong-base, off-by-one-slot all caught");
});
