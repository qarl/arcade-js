// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for storeGameActive (ROM 0x19d3) -- store A into GAME_ACTIVE. Input A, live-out memory only.
// Run: node --test games/invaders/idiomatic/test/equivalence-19d3.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_19d3 as oracleBody } from "../../translated/loc_19d3.js";
import { storeGameActive } from "../storeGameActive.js";
import { Machine } from "../../machine.js";
import { entered, ramDiff } from "./_liveStack.js";
import { GAME_ACTIVE } from "../names.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x19d3;

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x19d3 dispatches -- storeGameActive == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); storeGameActive(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: A stored at GAME_ACTIVE for several values", () => {
  for (const a of [0x00, 0x01, 0x7f, 0xff, 0xa5]) {
    const o = new Machine(ROM); o.regs.a = a;
    const c = new Machine(ROM); c.regs.a = a;
    oracle(o); storeGameActive(c);
    assert.equal(ramDiff(o, c), null, `A=0x${a.toString(16)}`);
    assert.equal(c.mem.read8(GAME_ACTIVE), a, `stored A=0x${a.toString(16)}`);
  }
});

test("TEETH: a wrong stored byte is caught", () => {
  const o = new Machine(ROM); o.regs.a = 0xa5;
  const c = new Machine(ROM); c.regs.a = 0xa5;
  oracle(o);
  storeGameActive(c); c.mem.write8(GAME_ACTIVE, 0x5a); // BUG
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong stored byte");
  assert.equal(d.addr, GAME_ACTIVE & 0xffff);
});
