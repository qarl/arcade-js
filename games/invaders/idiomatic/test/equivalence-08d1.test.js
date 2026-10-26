// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for readStartingShips (ROM 0x08d1) -- "A = (portIn(2) & 3) + 3". Input is IN2 (io.in2 idle,
// no active-low bits); live-out is the register A (not RAM), so each craft seeds IN2 and asserts A
// directly, while RAM (dumpState, minus stack scratch below the entry SP) must stay identical between oracle and module.
// Run: node --test games/invaders/idiomatic/test/equivalence-08d1.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_08d1 as oracleBody } from "../../translated/loc_08d1.js";
import { readStartingShips } from "../readStartingShips.js";
import { Machine } from "../../machine.js";
import { entered, ramDiff } from "./_liveStack.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x08d1;

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x08d1 dispatches -- readStartingShips == oracle in RAM (-stack) and A", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); readStartingShips(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(c.regs.a, o.regs.a, "A live-out mismatch");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: A = (IN2 & 3) + 3 for several port values", () => {
  for (const p of [0x00, 0x01, 0x02, 0x03, 0x7f, 0xfc, 0xff, 0xa5]) {
    const o = new Machine(ROM); o.io.in2 = p;
    const c = new Machine(ROM); c.io.in2 = p;
    oracle(o); readStartingShips(c);
    assert.equal(ramDiff(o, c), null, `IN2=0x${p.toString(16)}`);
    assert.equal(c.regs.a, (p & 0x03) + 0x03, `A for IN2=0x${p.toString(16)}`);
    assert.equal(c.regs.a, o.regs.a, `A vs oracle for IN2=0x${p.toString(16)}`);
  }
});

test("TEETH: a wrong bias in A is caught", () => {
  const brokenLoc08d1 = (m) => (m.regs.a = (m.io.portIn(0x02) & 0x03) + 0x02); // BUG: +2 not +3
  const o = new Machine(ROM); o.io.in2 = 0x00;
  const c = new Machine(ROM); c.io.in2 = 0x00;
  oracle(o); brokenLoc08d1(c);
  assert.equal(ramDiff(o, c), null, "RAM alone cannot see the register live-out");
  assert.notEqual(c.regs.a, o.regs.a, "the A check FAILED to catch a wrong bias");
});
