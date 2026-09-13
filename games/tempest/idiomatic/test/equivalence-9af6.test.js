// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for loc_9af6 (ROM 0x9af6) -- the shared pointer-pair setup entered past both table
// loads: the caller has already set the low pointer ($2c), so this takes the high pointer straight from A
// ($2d), stashes the index (y->$2b), and reloads A from its holding cell ($29). Inputs are A (high pointer)
// and Y (index); live-out is RAM (dumpState minus STACK_SCRATCH) plus A. The oracle is the frozen mid-entry
// export loc_9af6 in translated/loc_9aee.js.
// Run: node --test games/tempest/idiomatic/test/equivalence-9af6.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_9af6 as oracle } from "../../translated/loc_9aee.js";
import { loc_9af6 } from "../loc_9aee.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, loc_29, loc_2b, loc_2c, loc_2d } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x9af6;
const inDeadStack = (a) => a != null && a >= STACK_SCRATCH.lo && a < STACK_SCRATCH.hi;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0x9af6 dispatches -- loc_9af6 == oracle in RAM (-stack) and A", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); loc_9af6(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(c.regs.a, o.regs.a, "A live-out matches");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

function seed(m, high, y, a29) {
  m.regs.a = high; m.regs.y = y; // A carries the high pointer, Y the index
  m.mem.write8(loc_29, a29);
  m.mem.write8(loc_2c, 0xa1); m.mem.write8(loc_2b, 0xa2); m.mem.write8(loc_2d, 0xa3); // dirty sentinels
}

test("CRAFTED: caller high pointer + index seated, A reloaded -- RAM and A equal", () => {
  for (const [high, y] of [[0x6e, 0x02], [0x00, 0x05], [0xff, 0x00]]) {
    const o = new Machine(ROM, OPTS); seed(o, high, y, 0x42);
    const c = new Machine(ROM, OPTS); seed(c, high, y, 0x42);
    oracle(o); loc_9af6(c);
    assert.equal(ramDiff(o, c), null, `RAM equal after setup (high=${high},y=${y})`);
    assert.equal(c.regs.a, o.regs.a, `A live-out matches (high=${high},y=${y})`);
    assert.equal(c.mem.read8(loc_2d), high, `$2d = caller high pointer (high=${high},y=${y})`);
    assert.equal(c.mem.read8(loc_2b), y, `$2b holds the index (high=${high},y=${y})`);
    assert.equal(c.mem.read8(loc_2c), 0xa1, `$2c untouched -- caller already set the low pointer (high=${high},y=${y})`);
    assert.equal(c.regs.a, 0x42, `A reloaded from $29 (high=${high},y=${y})`);
  }
});

test("MUTATION: a twin that stores A into $2c (like loc_9af1) instead of $2d diverges from the oracle", () => {
  const high = 0x6e, y = 0x02;
  const o = new Machine(ROM, OPTS); seed(o, high, y, 0x42);
  const c = new Machine(ROM, OPTS); seed(c, high, y, 0x42);
  oracle(o);
  const broken = (m, a = m.regs.a, yy = m.regs.y) => {
    const { mem8 } = m;
    mem8[loc_2b] = yy;
    mem8[loc_2c] = a; // BUG: writes the low pointer cell, clobbering the caller's $2c and skipping $2d
    m.regs.a = mem8[loc_29];
  };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the wrong-cell store");
});
