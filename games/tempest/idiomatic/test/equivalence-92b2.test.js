// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for swapParallelTables (ROM 0x92b2) -- swaps the two 18-byte tables $03aa,x <-> $03bc,x for
// x = 0x11..0. Live-out is RAM plus the exit [X, Y] it returns (0xff, slot 0's old $03bc byte), so the CAPTURE
// and CRAFTED arms compare RAM (dumpState, minus stack scratch below the entry SP) and the returned pair (the CAPTURE arm may capture none). No POKEY/clock coupling -> the crafted diff is deterministic.
// Run: node --test games/tempest/idiomatic/test/equivalence-92b2.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_92b2 } from "../../translated/loc_92b2.js";
import { swapParallelTables } from "../swapParallelTables.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { SWEEP_STAGE, loc_3bc } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const opt = (name) => existsSync(new URL(name, ROM_DIR)) ? new Uint8Array(readFileSync(new URL(name, ROM_DIR))) : undefined;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x92b2;
const oracle = atEntry(loc_92b2);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

// Fill the two tables with distinguishable values so a swap is observable.
function seed(m) {
  for (let x = 0; x <= 0x11; x++) {
    m.mem.write8(SWEEP_STAGE + x, (0x40 + x) & 0xff);
    m.mem.write8(loc_3bc + x, (0x90 + x) & 0xff);
  }
}

test("CAPTURE: real 0x92b2 dispatches -- swapParallelTables == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); { c.regs.x ^= 0xff; c.regs.y ^= 0xff; // m.regs poisoned: this routine takes no entry X/Y, so its exit must not depend on them
      assert.deepEqual(swapParallelTables(c), [o.regs.x, o.regs.y], "returned exit [X, Y] = the oracle's"); }
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: entry-for-entry swap == oracle (RAM -stack)", () => {
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); assert.deepEqual(swapParallelTables(c), [o.regs.x, o.regs.y], "returned exit [X, Y] = the oracle's");
  assert.equal(ramDiff(o, c), null);
  // Sanity: the tables actually crossed over.
  assert.equal(c.mem.read8(loc_3bc + 0x05), 0x45, "$03bc,5 holds old $03aa,5");
  assert.equal(c.mem.read8(SWEEP_STAGE + 0x05), 0x95, "$03aa,5 holds old $03bc,5");
});

test("TEETH: a twin that skips the top slot (x=0x11) diverges from the oracle", () => {
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o);
  // BUG: swap only x=0x10..0, leaving slot 0x11 untouched -- the RAM diff must catch it.
  for (let x = 0x10; x >= 0; x--) {
    const lo = c.mem.read8(SWEEP_STAGE + x), hi = c.mem.read8(loc_3bc + x);
    c.mem.write8(loc_3bc + x, lo); c.mem.write8(SWEEP_STAGE + x, hi);
  }
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch a skipped top slot");
});
