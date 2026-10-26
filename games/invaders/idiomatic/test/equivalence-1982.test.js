// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for storeTaskFlags (ROM 0x1982) -- "store A into TASK_FLAGS". Input register A, live-out
// memory only, so each side runs on a fresh clone and the contract is RAM (dumpState, minus stack scratch below the entry SP).
// Run: node --test games/invaders/idiomatic/test/equivalence-1982.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1982 as oracleBody } from "../../translated/loc_1982.js";
import { storeTaskFlags } from "../storeTaskFlags.js";
import { Machine } from "../../machine.js";
import { entered, ramDiff } from "./_liveStack.js";
import { TASK_FLAGS } from "../names.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x1982;

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x1982 dispatches -- storeTaskFlags == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); storeTaskFlags(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: A is stored at TASK_FLAGS for several values", () => {
  for (const a of [0x00, 0x01, 0x7f, 0xff, 0xa5]) {
    const o = new Machine(ROM); o.regs.a = a;
    const c = new Machine(ROM); c.regs.a = a;
    oracle(o); storeTaskFlags(c);
    assert.equal(ramDiff(o, c), null, `A=0x${a.toString(16)}`);
    assert.equal(c.mem.read8(TASK_FLAGS), a, `stored A=0x${a.toString(16)}`);
  }
});

test("TEETH: a wrong stored byte is caught", () => {
  const o = new Machine(ROM); o.regs.a = 0xa5;
  const c = new Machine(ROM); c.regs.a = 0xa5;
  oracle(o);
  storeTaskFlags(c); c.mem.write8(TASK_FLAGS, 0x5a); // BUG: wrong byte
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong stored byte");
  assert.equal(d.addr, TASK_FLAGS & 0xffff);
});
