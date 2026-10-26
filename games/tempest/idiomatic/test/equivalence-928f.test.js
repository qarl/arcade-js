// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for clearActiveShots (ROM 0x928f) -- zeros $2d3..$2de then clears $135 and $a6. Live-out is
// RAM plus the exit X it returns (0xff; ageShotsAndAdvanceFrameClock hands it on), so every arm compares RAM
// (-stack) and the CAPTURE arm also the exit X. Pure leaf (no
// dispatch): the seam completes it by omitting the ROM ret. No POKEY reads. Seeds pre-dirty the cells so
// the clear (and its absence in the mutant) is observable.
// Run: node --test games/tempest/idiomatic/test/equivalence-928f.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_928f as oracle } from "../../translated/loc_928f.js";
import { clearActiveShots } from "../clearActiveShots.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, ACTIVE_ENEMY_COUNT, ACTIVE_OBJECT_COUNT, SLOT_STATE } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const opt = (name) => {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
};
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x928f;
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

test("CAPTURE: real 0x928f dispatches -- clearActiveShots == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); { const ey = c.regs.y; c.regs.x ^= 0xff; c.regs.y ^= 0xff; // takes no entry X/Y; returns X and leaves Y alone, so the exit is [X, entry Y]
      assert.deepEqual([clearActiveShots(c), ey], [o.regs.x, o.regs.y], "returned exit [X, Y] = the oracle's"); }
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// Pre-dirty every touched cell so the clear is a visible change on both arms.
function seedDirty(m) {
  for (let a = 0x02d3; a <= 0x02de; a++) m.mem8[a] = 0x5a;
  m.mem8[ACTIVE_OBJECT_COUNT] = 0x77;
  m.mem8[ACTIVE_ENEMY_COUNT] = 0x99;
}

test("CRAFTED: array + both flag cells cleared to zero == oracle (RAM -stack)", () => {
  const o = new Machine(ROM, OPTS); seedDirty(o);
  const c = new Machine(ROM, OPTS); seedDirty(c);
  oracle(o); clearActiveShots(c);
  assert.equal(ramDiff(o, c), null, "cleared block + flags match oracle");
  // Independent confirmation the fields actually went to zero.
  for (let a = 0x02d3; a <= 0x02de; a++) assert.equal(c.mem8[a], 0x00, `array ${a.toString(16)} cleared`);
  assert.equal(c.mem8[ACTIVE_OBJECT_COUNT], 0x00, "$135 cleared");
  assert.equal(c.mem8[ACTIVE_ENEMY_COUNT], 0x00, "$a6 cleared");
});

test("TEETH: a rewrite that skips clearing $a6 diverges from the oracle", () => {
  const o = new Machine(ROM, OPTS); seedDirty(o); // $a6 seeded 0x99 (non-default so the skip bites)
  const c = new Machine(ROM, OPTS); seedDirty(c);
  oracle(o);
  const brokenSkipA6 = (m) => { // BUG: clears the array and $135 but leaves $a6 dirty
    for (let x = 0x0b; x >= 0; x--) m.mem8[(0x02d3 + x) & 0xffff] = 0x00;
    m.mem8[ACTIVE_OBJECT_COUNT] = 0x00;
  };
  brokenSkipA6(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch a skipped $a6 clear");
});
