// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for seedModeParamsWithBounds (ROM 0xb0e7) -- loads a fixed init block: $00=0x0a, $02=0x00, $04=0xdf,
// $01=0x12, $014e=0x19, $014d=0x18. Live-out is RAM plus the entry X/Y it hands back as its exit pair (A at RTS
// is incidental), so each arm compares RAM (dumpState, minus stack scratch below the entry SP) and the CAPTURE arm the pair. No POKEY/clock coupling -> the crafted diff is deterministic.
// Run: node --test games/tempest/idiomatic/test/equivalence-b0e7.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_b0e7 } from "../../translated/loc_b0e7.js";
import { seedModeParamsWithBounds } from "../seedModeParamsWithBounds.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { GAME_MODE, MODE_DISPATCH_SEL, GAME_MODE_PENDING, MODE_DELAY_TIMER, loc_14d, loc_14e } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const opt = (name) => existsSync(new URL(name, ROM_DIR)) ? new Uint8Array(readFileSync(new URL(name, ROM_DIR))) : undefined;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xb0e7;
const oracle = atEntry(loc_b0e7);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

// Seed every target cell with a non-zero sentinel distinct from its written value so each write bites
// (including $02 = 0x00, which must overwrite a nonzero sentinel).
function seed(m) {
  m.mem.write8(GAME_MODE, 0x11);
  m.mem.write8(MODE_DISPATCH_SEL, 0x22);
  m.mem.write8(GAME_MODE_PENDING, 0x33);
  m.mem.write8(MODE_DELAY_TIMER, 0x44);
  m.mem.write8(loc_14d, 0x55);
  m.mem.write8(loc_14e, 0x66);
}

test("CAPTURE: real 0xb0e7 dispatches -- seedModeParamsWithBounds == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); { const ex = c.regs.x, ey = c.regs.y; c.regs.x ^= 0xff; c.regs.y ^= 0xff; // entry X/Y go in as arguments
      assert.deepEqual(seedModeParamsWithBounds(c, ey, ex), [o.regs.x, o.regs.y], "returned exit [X, Y] = the oracle's"); }
    assert.equal(ramDiff(o, c), null);
    // No-argument call on an unpoisoned clone: the parameter defaults must read Y and X from the right registers.
    assert.ok(cap.regs.x !== cap.regs.y && cap.regs.x !== 0 && cap.regs.y !== 0, "positive control: entry X/Y distinct and nonzero, so a zero or swapped default shows");
    assert.deepEqual(seedModeParamsWithBounds(cap.clone()), [o.regs.x, o.regs.y], "no-argument call: defaults read the entry Y/X");
  }
  assert.ok(CAPS.length > 0, "no capture to check the defaults on");
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: the fixed init block == oracle (RAM -stack)", () => {
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); seedModeParamsWithBounds(c);
  assert.equal(ramDiff(o, c), null);
  assert.equal(c.mem.read8(GAME_MODE), 0x0a, "$00");
  assert.equal(c.mem.read8(GAME_MODE_PENDING), 0x00, "$02");
  assert.equal(c.mem.read8(MODE_DELAY_TIMER), 0xdf, "$04");
  assert.equal(c.mem.read8(MODE_DISPATCH_SEL), 0x12, "$01");
  assert.equal(c.mem.read8(loc_14e), 0x19, "$014e");
  assert.equal(c.mem.read8(loc_14d), 0x18, "$014d");
});

test("TEETH: a twin that writes the wrong $04 constant diverges from the oracle", () => {
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o);
  // BUG: plant every constant except $04, which gets 0x00 instead of 0xdf.
  c.mem.write8(GAME_MODE, 0x0a); c.mem.write8(GAME_MODE_PENDING, 0x00); c.mem.write8(MODE_DELAY_TIMER, 0x00);
  c.mem.write8(MODE_DISPATCH_SEL, 0x12); c.mem.write8(loc_14e, 0x19); c.mem.write8(loc_14d, 0x18);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch a wrong $04 constant");
});
