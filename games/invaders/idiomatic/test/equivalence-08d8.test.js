// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for setAlienShotStepWhenFew (ROM 0x08d8) -- "if mem[0x2082] < 9: mem[0x207e] = 0xfb". Input is the
// counter cell 0x2082; live-out is memory (0x207e), so the contract is RAM (dumpState, minus
// stack scratch below the entry SP). Crafts span the threshold and pre-seed 0x207e to a sentinel to see both branches.
// Run: node --test games/invaders/idiomatic/test/equivalence-08d8.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_08d8 as oracleBody } from "../../translated/loc_08d8.js";
import { setAlienShotStepWhenFew } from "../setAlienShotStepWhenFew.js";
import { Machine } from "../../machine.js";
import { entered, ramDiff } from "./_liveStack.js";
import { ALIEN_COUNT, ALIEN_SHOT_STEP } from "../names.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x08d8;
const SENTINEL = 0x11; // a non-0xfb marker so "not written" is distinguishable from "written 0xfb"

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x08d8 dispatches -- setAlienShotStepWhenFew == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); setAlienShotStepWhenFew(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: 0x207e seated 0xfb below the threshold, untouched at/above it", () => {
  for (const cnt of [0x00, 0x01, 0x08, 0x09, 0x0a, 0xff]) {
    const o = new Machine(ROM); o.mem.write8(ALIEN_COUNT, cnt); o.mem.write8(ALIEN_SHOT_STEP, SENTINEL);
    const c = new Machine(ROM); c.mem.write8(ALIEN_COUNT, cnt); c.mem.write8(ALIEN_SHOT_STEP, SENTINEL);
    oracle(o); setAlienShotStepWhenFew(c);
    assert.equal(ramDiff(o, c), null, `cnt=0x${cnt.toString(16)}`);
    const expected = cnt < 0x09 ? 0xfb : SENTINEL;
    assert.equal(c.mem.read8(ALIEN_SHOT_STEP), expected, `0x207e for cnt=0x${cnt.toString(16)}`);
  }
});

test("TEETH: a wrong stored byte is caught", () => {
  const brokenLoc08d8 = (m) => { if (m.mem8[ALIEN_COUNT] < 0x09) m.mem8[ALIEN_SHOT_STEP] = 0x5a; }; // BUG: 0x5a
  const o = new Machine(ROM); o.mem.write8(ALIEN_COUNT, 0x00); o.mem.write8(ALIEN_SHOT_STEP, SENTINEL);
  const c = new Machine(ROM); c.mem.write8(ALIEN_COUNT, 0x00); c.mem.write8(ALIEN_SHOT_STEP, SENTINEL);
  oracle(o); brokenLoc08d8(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong stored byte");
  assert.equal(d.addr, ALIEN_SHOT_STEP & 0xffff);
});
