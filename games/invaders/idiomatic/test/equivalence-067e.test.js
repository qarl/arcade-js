// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for loc_067e (ROM 0x067e) -- "store HL (16-bit) into loc_2048". Input register HL,
// live-out memory only, so each side runs on a fresh clone and the contract is RAM (dumpState, minus
// stack scratch below the entry SP). Run: node --test games/invaders/idiomatic/test/equivalence-067e.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_067e as oracleBody } from "../../translated/loc_067e.js";
import { loc_067e } from "../loc_067e.js";
import { Machine } from "../../machine.js";
import { entered, ramDiff } from "./_liveStack.js";
import { loc_2048 } from "../names.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x067e;

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x067e dispatches -- loc_067e == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); loc_067e(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(c.mem.read16(loc_2048), o.mem.read16(loc_2048), "stored word matches the oracle");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: HL is stored (16-bit little-endian) at loc_2048 for several values", () => {
  for (const hl of [0x0000, 0x0001, 0x1234, 0x2007, 0xabcd, 0xffff]) {
    const o = new Machine(ROM); o.regs.hl = hl;
    const c = new Machine(ROM); c.regs.hl = hl;
    oracle(o); loc_067e(c);
    assert.equal(ramDiff(o, c), null, `HL=0x${hl.toString(16)}`);
    assert.equal(c.mem.read16(loc_2048), hl, `stored HL=0x${hl.toString(16)}`);
  }
});

test("TEETH: a wrong stored word is caught", () => {
  const o = new Machine(ROM); o.regs.hl = 0x1234;
  const c = new Machine(ROM); c.regs.hl = 0x1234;
  oracle(o);
  loc_067e(c); c.mem.write16(loc_2048, 0x5678); // BUG: wrong stored word
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong stored word");
  assert.equal(d.addr, loc_2048 & 0xffff);
});
