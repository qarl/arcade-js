// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_08bc — memory-equivalent to the frozen oracle at ROM 0x08bc. Services a timing block, all live-outs
 * in work RAM (captured by dumpState), so EQUAL is ramDiff==null across the four paths:
 *   - DRAIN, no flag: gate bit0 set, counter high -> counter -= 4, flag untouched.
 *   - DRAIN, flag: gate bit0 set, drained value lands in the borrow window (14..17) -> flag = 1.
 *   - RESET from source: gate bit0 clear, trigger bit0 set -> counter = 0xdc, field = source byte.
 *   - RESET, zero field: gate bit0 clear, trigger bit0 clear -> counter = 0xdc, field = 0.
 * Teeth: no-op, wrong drain step, the naive `<18` flag threshold (window logic), wrong reset value, and a
 * wrong field source. Positive controls confirm the oracle really moves each cell.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { craft, ramDiff, romsPresent } from "./_bootSetup.js";
import { loc_08bc as cand } from "../loc_08bc.js";
import { loc_08bc as oracle } from "../../translated/loc_08bc.js";

const GATE = 0x4208;
const COUNTER = 0x4209;
const FIELD = 0x420a;
const FLAG = 0x420b;
const TRIGGER = 0x4200;
const SOURCE = 0x4202;
const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const drainNoFlag = () => craft((mem, m) => { m.push16(0x9999); mem[GATE] = 1; mem[COUNTER] = 0x40; mem[FLAG] = 0; });
const drainFlag = () => craft((mem, m) => { m.push16(0x9999); mem[GATE] = 1; mem[COUNTER] = 0x14; mem[FLAG] = 0; });
const drainLow = () => craft((mem, m) => { m.push16(0x9999); mem[GATE] = 1; mem[COUNTER] = 0x08; mem[FLAG] = 0; });
const resetFromSource = () => craft((mem, m) => {
  m.push16(0x9999); mem[GATE] = 0; mem[TRIGGER] = 1; mem[SOURCE] = 0x77; mem[COUNTER] = 0; mem[FIELD] = 0;
});
const resetZeroField = () => craft((mem, m) => {
  m.push16(0x9999); mem[GATE] = 0; mem[TRIGGER] = 0; mem[COUNTER] = 0; mem[FIELD] = 0x55;
});

test("EQUAL (crafted): loc_08bc == oracle on all four paths", { skip }, () => {
  for (const [name, e] of [
    ["drain-no-flag", drainNoFlag()], ["drain-flag", drainFlag()],
    ["reset-source", resetFromSource()], ["reset-zero", resetZeroField()],
  ]) {
    assert.equal(ramDiff(oracle, cand, e), null, `loc_08bc diverged on ${name}`);
  }
  // Positive controls: the oracle really moves each cell.
  let a = drainNoFlag(); oracle(a);
  assert.equal(a.mem8[COUNTER], 0x3c, "drain: counter 0x40 -> 0x3c");
  assert.equal(a.mem8[FLAG], 0, "drain-no-flag: flag stays clear");
  a = drainFlag(); oracle(a);
  assert.equal(a.mem8[COUNTER], 0x10, "drain: counter 0x14 -> 0x10");
  assert.equal(a.mem8[FLAG], 1, "drain-flag: flag raised in the window");
  a = resetFromSource(); oracle(a);
  assert.equal(a.mem8[COUNTER], 0xdc, "reset: counter -> 0xdc");
  assert.equal(a.mem8[FIELD], 0x77, "reset: field <- source");
  a = resetZeroField(); oracle(a);
  assert.equal(a.mem8[FIELD], 0, "reset: field -> 0");
  console.log("  EQUAL: loc_08bc == oracle across drain/flag/reset paths");
});

test("TEETH: broken twins are caught", { skip }, () => {
  const noOp = () => {};
  const wrongDrain = (m) => { m.mem8[COUNTER] = (m.mem8[COUNTER] - 3) & 0xff; };
  const flagNaive = (m) => { m.mem8[COUNTER] = (m.mem8[COUNTER] - 4) & 0xff; if (m.mem8[COUNTER] < 18) m.mem8[FLAG] = 1; };
  const wrongReset = (m) => { m.mem8[COUNTER] = 0xdd; m.mem8[FIELD] = (m.mem8[TRIGGER] & 1) ? m.mem8[SOURCE] : 0; };
  const wrongField = (m) => { m.mem8[COUNTER] = 0xdc; m.mem8[FIELD] = (m.mem8[TRIGGER] & 1) ? (m.mem8[SOURCE] + 1) & 0xff : 0; };

  assert.ok(ramDiff(oracle, noOp, drainFlag()), "the no-op twin escaped");
  assert.ok(ramDiff(oracle, wrongDrain, drainNoFlag()), "the wrong-drain twin escaped");
  assert.ok(ramDiff(oracle, flagNaive, drainLow()), "the naive-threshold twin escaped (window logic)");
  assert.ok(ramDiff(oracle, wrongReset, resetZeroField()), "the wrong-reset twin escaped");
  assert.ok(ramDiff(oracle, wrongField, resetFromSource()), "the wrong-field-source twin escaped");
  console.log("  TEETH: no-op, wrong-drain, naive-threshold, wrong-reset, wrong-field all caught");
});
