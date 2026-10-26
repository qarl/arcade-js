// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for armRequestedSoundSlot (ROM 0xad22) -- scans the packed request word, and for the first
// in-range slot builds the paired value, arms selectProjectionScale + resetPerSlotStateTable, and writes a status into $0000. The
// oracle m.calls the translated callees; the idiomatic dissolves them into direct idiomatic calls. Both
// are memory-equivalent, so each arm compares RAM (dumpState, minus STACK_SCRATCH). Status is in $0000 (RAM); the
// exit [X, Y] it returns (the frame loop carries it to the sound loader's stash) is compared too. No POKEY read -> deterministic.
// Run: node --test games/tempest/idiomatic/test/equivalence-ad22.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_ad22 as oracle } from "../../translated/loc_ad22.js";
import { armRequestedSoundSlot } from "../armRequestedSoundSlot.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, GAME_MODE, VG_MODE_FLAG, VG_SCALE, ENEMY_SLOT_FLAGS, SLOT_METRIC, ACTIVE_SLOT, REQUEST_BITS } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const rd = (n) => new Uint8Array(readFileSync(new URL(n, ROM_DIR)));
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? rd("maincpu.bin") : null;
const opt = (n) => (existsSync(new URL(n, ROM_DIR)) ? rd(n) : undefined);
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xad22;
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

// Seed one in-range request: word=0x01 -> index 0 -> slot $0600 = 0x03 (in 1..8) -> process path.
function seeded() {
  const m = new Machine(ROM, OPTS);
  m.mem.write8(REQUEST_BITS, 0x01);
  m.mem.write8(SLOT_METRIC, 0x03);
  m.mem.write8(VG_MODE_FLAG, 0xff);  // ca48 folds a bit out of this
  m.mem.write8(VG_SCALE, 0x77);  // ca48 overwrites this
  m.mem.write8(ENEMY_SLOT_FLAGS, 0xaa); // a789 must clear this table byte
  return m;
}

test("CAPTURE: real 0xad22 dispatches -- armRequestedSoundSlot == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); { const ex = c.regs.x; c.regs.x ^= 0xff; c.regs.y ^= 0xff; // entry X goes in as the argument; the routine takes no entry Y
      assert.deepEqual(armRequestedSoundSlot(c, ex), [o.regs.x, o.regs.y], "returned exit [X, Y] = the oracle's"); }
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: an in-range slot builds $0602, arms ca48+a789, sets $0000 (== oracle, RAM)", () => {
  const o = seeded(), c = seeded();
  o.regs.x = 0x3c; c.regs.x = 0xc3;
  oracle(o); assert.deepEqual(armRequestedSoundSlot(c, 0x3c), [o.regs.x, o.regs.y], "returned exit [X, Y] = the oracle's");
  assert.equal(ramDiff(o, c), null, "RAM equal after process path");
  assert.equal(c.mem.read8(GAME_MODE), 0x24, "$0000 armed status");
  assert.equal(c.mem.read8(ENEMY_SLOT_FLAGS), 0x00, "a789 cleared the table byte");
  assert.equal(c.mem.read8(VG_SCALE), o.mem.read8(VG_SCALE), "ca48 wrote $b4");
});

test("CRAFTED: an exhausted word exits idle with $0000 = 0x14 (== oracle, RAM)", () => {
  const o = new Machine(ROM, OPTS); o.mem.write8(REQUEST_BITS, 0x00);
  const c = new Machine(ROM, OPTS); c.mem.write8(REQUEST_BITS, 0x00);
  o.regs.x = 0x3c; c.regs.x = 0xc3;
  oracle(o); assert.deepEqual(armRequestedSoundSlot(c, 0x3c), [o.regs.x, o.regs.y], "returned exit [X, Y] = the oracle's");
  assert.equal(ramDiff(o, c), null, "RAM equal after idle exit");
  assert.equal(c.mem.read8(GAME_MODE), 0x14, "$0000 idle status");
});

test("TEETH: a twin that skips the a789 dissolve leaves the table dirty and diverges", () => {
  const o = seeded(); oracle(o);
  assert.equal(o.mem.read8(ENEMY_SLOT_FLAGS), 0x00, "precondition: oracle cleared the table byte");
  const c = seeded(); armRequestedSoundSlot(c);
  c.mem.write8(ENEMY_SLOT_FLAGS, 0xaa); // BUG: as if the a789 call never ran
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch a skipped a789");
});

test("TEETH: a twin with an off-by-one in the scaled $0602 value diverges", () => {
  const o = seeded(); oracle(o);
  const c = seeded(); armRequestedSoundSlot(c);
  c.mem.write8(ACTIVE_SLOT, (c.mem.read8(ACTIVE_SLOT) + 1) & 0xff); // BUG: wrong scale
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch a wrong $0602");
});
