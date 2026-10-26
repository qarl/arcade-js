// SPDX-License-Identifier: GPL-3.0-only
// Memory+register equivalence for fleetStepSize -- B := 2, or 3 when (ALIEN_COUNT)==1; the caller reads B.
// Neither side writes RAM, so the observable live-out is B: each side runs on a clone and the contract
// is RAM (dumpState, minus stack scratch below the entry SP) AND the returned B.
// Run: node --test games/invaders/idiomatic/test/equivalence-18f1.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_18f1 as oracleBody } from "../../translated/loc_18f1.js";
import { fleetStepSize } from "../fleetStepSize.js";
import { Machine } from "../../machine.js";
import { entered, ramDiff } from "./_liveStack.js";
import { ALIEN_COUNT } from "../names.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x18f1;

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x18f1 dispatches -- fleetStepSize == oracle in RAM (-stack) and B", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); fleetStepSize(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(c.regs.b, o.regs.b, "live-out B");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: B := 2, or 3 only when (ALIEN_COUNT) == 1", () => {
  for (const v of [0x00, 0x01, 0x02, 0x7f, 0xff]) {
    const o = new Machine(ROM); o.mem.write8(ALIEN_COUNT, v);
    const c = new Machine(ROM); c.mem.write8(ALIEN_COUNT, v);
    oracle(o);
    const ret = fleetStepSize(c);
    assert.equal(ramDiff(o, c), null, `(ALIEN_COUNT)=0x${v.toString(16)}`);
    const want = v === 1 ? 3 : 2;
    assert.equal(o.regs.b, want, `oracle B for 0x${v.toString(16)}`);
    assert.equal(c.regs.b, want, `module B for 0x${v.toString(16)}`);
    assert.equal(ret, want, `module returns B for 0x${v.toString(16)}`);
  }
});

test("TEETH: a dropped B bump is caught", () => {
  const o = new Machine(ROM); o.mem.write8(ALIEN_COUNT, 0x01); // (ALIEN_COUNT)==1 -> B should be 3
  const c = new Machine(ROM); c.mem.write8(ALIEN_COUNT, 0x01);
  oracle(o);
  fleetStepSize(c); c.regs.b = 0x02; // BUG: dropped the inr b
  assert.notEqual(o.regs.b, c.regs.b, "the live-out check FAILED to catch a wrong B");
});
