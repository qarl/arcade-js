// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for seedPerLaneSpikeArray (ROM 0x9234) -- seeds $3ab from $15b and fills $3ac..$3bb from $15a.
// Live-out is RAM plus the exit X it returns (0xff; tickWaveSpawnCadence hands it on as its own exit X), so every
// arm compares RAM (-stack) and the CAPTURE arm also the exit X. It is a
// pure leaf (no dispatch), so the seam completes it by omitting its ROM ret. No POKEY reads.
// Run: node --test games/tempest/idiomatic/test/equivalence-9234.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_9234 as oracle } from "../../translated/loc_9234.js";
import { seedPerLaneSpikeArray } from "../seedPerLaneSpikeArray.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, LANE_FILL_INIT, INITIAL_ACTIVE_COUNT, FIRE_GATE, LANE_LIMIT } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const opt = (name) => {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
};
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x9234;
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

test("CAPTURE: real 0x9234 dispatches -- seedPerLaneSpikeArray == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); { const ey = c.regs.y; c.regs.x ^= 0xff; c.regs.y ^= 0xff; // takes no entry X/Y; returns X and leaves Y alone, so the exit is [X, entry Y]
      assert.deepEqual([seedPerLaneSpikeArray(c), ey], [o.regs.x, o.regs.y], "returned exit [X, Y] = the oracle's"); }
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

function seed(m, s) {
  m.mem8[LANE_FILL_INIT] = s.s15a;
  m.mem8[INITIAL_ACTIVE_COUNT] = s.s15b;
}

test("CRAFTED: header from $15b and 16-byte fill from $15a == oracle (RAM -stack)", () => {
  const cases = [
    { tag: "distinct header/body", s15a: 0x33, s15b: 0xaa },
    { tag: "both zero", s15a: 0x00, s15b: 0x00 },
    { tag: "header 0, body 0xff", s15a: 0xff, s15b: 0x00 },
  ];
  for (const s of cases) {
    const o = new Machine(ROM, OPTS); seed(o, s);
    const c = new Machine(ROM, OPTS); seed(c, s);
    oracle(o); seedPerLaneSpikeArray(c);
    assert.equal(ramDiff(o, c), null, `RAM: ${s.tag}`);
  }
});

test("TEETH: a rewrite that fills the body from $15b (wrong source) diverges from the oracle", () => {
  // Non-default seed so the mutation bites: body source $15a=0x33 differs from header source $15b=0xaa.
  const s = { s15a: 0x33, s15b: 0xaa };
  const o = new Machine(ROM, OPTS); seed(o, s);
  const c = new Machine(ROM, OPTS); seed(c, s);
  oracle(o);
  const brokenFill = (m) => { // BUG: fills the body from $15b instead of $15a
    m.mem8[FIRE_GATE] = m.mem8[INITIAL_ACTIVE_COUNT];
    const fill = m.mem8[INITIAL_ACTIVE_COUNT];
    for (let x = 0x0f; x >= 0; x--) m.mem8[(LANE_LIMIT + x) & 0xffff] = fill;
  };
  brokenFill(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch a wrong body source");
});
