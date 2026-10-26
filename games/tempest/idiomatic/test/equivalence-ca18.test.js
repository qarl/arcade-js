// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for seedModeParamsFromMaskedFlags (ROM 0xca18) -- masks $05 &= 0x3f, then lays a fixed init block:
// $3e=0, $02=0x1a, $00=0x0a, $04=0xa0, $016b=0x01, $01=0x0a. Live-out is RAM plus the entry X/Y it hands back
// as its exit pair (A is store scratch no caller reads), so every arm compares RAM (-stack) and the CAPTURE arm
// also the returned pair. Pure leaf (no dispatch): the seam completes it by
// omitting the ROM ret. No POKEY reads. Seeds set $05's high bits (must survive the mask only in their low
// six) and pre-dirty the block so both the mask and the constant stores are observable.
// Run: node --test games/tempest/idiomatic/test/equivalence-ca18.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_ca18 as oracle } from "../../translated/loc_ca18.js";
import { seedModeParamsFromMaskedFlags } from "../seedModeParamsFromMaskedFlags.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, STATUS_FLAGS, ACTIVE_SLOT_COUNT, GAME_MODE_PENDING, GAME_MODE, MODE_DELAY_TIMER, MODE_DELAY_GUARD, MODE_DISPATCH_SEL } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const opt = (name) => {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
};
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xca18;
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

test("CAPTURE: real 0xca18 dispatches -- seedModeParamsFromMaskedFlags == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); { const ex = c.regs.x, ey = c.regs.y; c.regs.x ^= 0xff; c.regs.y ^= 0xff; // entry X/Y go in as arguments
      assert.deepEqual(seedModeParamsFromMaskedFlags(c, ey, ex), [o.regs.x, o.regs.y], "returned exit [X, Y] = the oracle's"); }
    assert.equal(ramDiff(o, c), null);
    // No-argument call on an unpoisoned clone: the parameter defaults must read Y and X from the right registers.
    assert.ok(cap.regs.x !== cap.regs.y && cap.regs.x !== 0 && cap.regs.y !== 0, "positive control: entry X/Y distinct and nonzero, so a zero or swapped default shows");
    assert.deepEqual(seedModeParamsFromMaskedFlags(cap.clone()), [o.regs.x, o.regs.y], "no-argument call: defaults read the entry Y/X");
  }
  assert.ok(CAPS.length > 0, "no capture to check the defaults on");
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// $05 high bits set (0xc0) so the &0x3f mask is observable; block cells pre-dirtied.
function seed(m) {
  m.mem8[STATUS_FLAGS] = 0xc5;   // low six bits 0x05 survive; high two (0xc0) get masked off
  m.mem8[ACTIVE_SLOT_COUNT] = 0x77;
  m.mem8[GAME_MODE_PENDING] = 0x77;
  m.mem8[GAME_MODE] = 0x77;
  m.mem8[MODE_DELAY_TIMER] = 0x77;
  m.mem8[MODE_DELAY_GUARD] = 0x77;
  m.mem8[MODE_DISPATCH_SEL] = 0x77;
}

test("CRAFTED: $05 masked + fixed block written == oracle (RAM -stack)", () => {
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); seedModeParamsFromMaskedFlags(c);
  assert.equal(ramDiff(o, c), null, "masked $05 + init block match oracle");
  // Independent confirmation of each field.
  assert.equal(c.mem8[STATUS_FLAGS], 0x05, "$05 masked to low six bits");
  assert.equal(c.mem8[ACTIVE_SLOT_COUNT], 0x00, "$3e = 0");
  assert.equal(c.mem8[GAME_MODE_PENDING], 0x1a, "$02 = 0x1a");
  assert.equal(c.mem8[GAME_MODE], 0x0a, "$00 = 0x0a");
  assert.equal(c.mem8[MODE_DELAY_TIMER], 0xa0, "$04 = 0xa0");
  assert.equal(c.mem8[MODE_DELAY_GUARD], 0x01, "$016b = 0x01");
  assert.equal(c.mem8[MODE_DISPATCH_SEL], 0x0a, "$01 = 0x0a");
});

test("TEETH: a rewrite that skips masking $05 diverges from the oracle", () => {
  const o = new Machine(ROM, OPTS); seed(o); // $05 seeded 0xc5 (non-default so the missing mask bites)
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o);
  const brokenSkipMask = (m) => { // BUG: writes the block but leaves $05 unmasked at 0xc5
    m.mem8[ACTIVE_SLOT_COUNT] = 0x00;
    m.mem8[GAME_MODE_PENDING] = 0x1a;
    m.mem8[GAME_MODE] = 0x0a;
    m.mem8[MODE_DELAY_TIMER] = 0xa0;
    m.mem8[MODE_DELAY_GUARD] = 0x01;
    m.mem8[MODE_DISPATCH_SEL] = 0x0a;
  };
  brokenSkipMask(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch a skipped $05 mask");
});
