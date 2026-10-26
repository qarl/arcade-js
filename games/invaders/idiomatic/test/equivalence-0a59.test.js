// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for isArmTriggerSet (ROM 0x0a59) -- "is [loc_2015] == 0xff?". The oracle loads A from
// loc_2015 and `cp 0xff`, leaving the answer in the Z flag; A is dead (no caller reads it -- the frozen
// callers waitNextRoundArm/loc_081f/runAttractCycle/loc_16e6 branch on Z only). So the declared live-out is the Z flag,
// and isArmTriggerSet sets it (return-assignment bridge) and returns the boolean. It writes no memory, so the
// contract is the Z-flag register-comparison arm (RAM diff stays null, checked for accidental writes).
// Run: node --test games/invaders/idiomatic/test/equivalence-0a59.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0a59 as oracleBody } from "../../translated/loc_0a59.js";
import { isArmTriggerSet } from "../isArmTriggerSet.js";
import { Machine } from "../../machine.js";
import { entered, ramDiff } from "./_liveStack.js";
import { loc_2015 } from "../names.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x0a59;

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x0a59 dispatches -- isArmTriggerSet == oracle in RAM (-stack) and the Z flag", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); const b = isArmTriggerSet(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(c.regs.fZ, o.regs.fZ, "Z-flag live-out matches the oracle");
    assert.equal(b, o.regs.fZ, "the returned boolean equals the Z result");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: Z set iff [loc_2015] == 0xff; boolean tracks the flag", () => {
  for (const v of [0x00, 0x01, 0x7f, 0x80, 0xfe, 0xff]) {
    const o = new Machine(ROM); o.regs.sp = 0x2400; o.mem.write8(loc_2015, v);
    const c = new Machine(ROM); c.regs.sp = 0x2400; c.mem.write8(loc_2015, v);
    oracle(o); const b = isArmTriggerSet(c);
    const tag = `[loc_2015]=0x${v.toString(16)}`;
    assert.equal(ramDiff(o, c), null, tag);
    assert.equal(c.regs.fZ, o.regs.fZ, `Z vs oracle ${tag}`);
    assert.equal(c.regs.fZ, v === 0xff, `Z value ${tag}`);
    assert.equal(b, v === 0xff, `boolean ${tag}`);
  }
});

test("TEETH: a broken twin (compares to 0x00) sets the wrong Z flag", () => {
  // Broken twin of isArmTriggerSet: tests the wrong constant, so for 0xff it clears Z where the oracle sets it.
  function isArmTriggerSet_broken(m) { return (m.regs.fZ = m.mem8[loc_2015] === 0x00); }
  const o = new Machine(ROM); o.regs.sp = 0x2400; o.mem.write8(loc_2015, 0xff);
  const c = new Machine(ROM); c.regs.sp = 0x2400; c.mem.write8(loc_2015, 0xff);
  oracle(o); isArmTriggerSet_broken(c);
  assert.notEqual(c.regs.fZ, o.regs.fZ, "the Z-flag check FAILED to catch the wrong compare constant");
});
