// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for seedModeParamsMinimal (ROM 0xc97b) -- seeds $00=0x0a, $01=0x00, $02=0x04, $04=0x14 ($03 left
// untouched). Live-out is RAM plus the entry X/Y it hands back as its exit pair (A at RTS is incidental), so each
// arm compares RAM (dumpState, minus stack scratch below the entry SP) and the CAPTURE arm the pair. No POKEY/clock coupling -> the crafted diff is deterministic.
// Run: node --test games/tempest/idiomatic/test/equivalence-c97b.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_c97b } from "../../translated/loc_c97b.js";
import { seedModeParamsMinimal } from "../seedModeParamsMinimal.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { GAME_MODE, MODE_DISPATCH_SEL, GAME_MODE_PENDING, FRAME_COUNTER, MODE_DELAY_TIMER } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const opt = (name) => existsSync(new URL(name, ROM_DIR)) ? new Uint8Array(readFileSync(new URL(name, ROM_DIR))) : undefined;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xc97b;
const oracle = atEntry(loc_c97b);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

// Seed all five cells with non-zero, non-target sentinels so every store (including $01=0x00) bites and a
// missed $03 store would show up.
function seed(m) {
  for (let a = 0; a <= 4; a++) m.mem.write8(a, (0x50 + a) & 0xff);
}

test("CAPTURE: real 0xc97b dispatches -- seedModeParamsMinimal == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); { const ex = c.regs.x, ey = c.regs.y; c.regs.x ^= 0xff; c.regs.y ^= 0xff; // entry X/Y go in as arguments
      assert.deepEqual(seedModeParamsMinimal(c, ey, ex), [o.regs.x, o.regs.y], "returned exit [X, Y] = the oracle's"); }
    assert.equal(ramDiff(o, c), null);
    // No-argument call on an unpoisoned clone: the parameter defaults must read Y and X from the right registers.
    assert.ok(cap.regs.x !== cap.regs.y && cap.regs.x !== 0 && cap.regs.y !== 0, "positive control: entry X/Y distinct and nonzero, so a zero or swapped default shows");
    assert.deepEqual(seedModeParamsMinimal(cap.clone()), [o.regs.x, o.regs.y], "no-argument call: defaults read the entry Y/X");
  }
  assert.ok(CAPS.length > 0, "no capture to check the defaults on");
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: $00/$01/$02/$04 seeded, $03 untouched == oracle (RAM -stack)", () => {
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); seedModeParamsMinimal(c);
  assert.equal(ramDiff(o, c), null);
  assert.equal(c.mem.read8(GAME_MODE), 0x0a, "$00 = 0x0a");
  assert.equal(c.mem.read8(MODE_DISPATCH_SEL), 0x00, "$01 = 0x00");
  assert.equal(c.mem.read8(GAME_MODE_PENDING), 0x04, "$02 = 0x04");
  assert.equal(c.mem.read8(MODE_DELAY_TIMER), 0x14, "$04 = 0x14");
  assert.equal(c.mem.read8(FRAME_COUNTER), 0x53, "$03 left at its sentinel (untouched)");
});

test("TEETH: a twin that forgets the $01 = 0x00 store diverges from the oracle", () => {
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o);
  // BUG: write $00/$02/$04 but leave $01 at its non-zero sentinel -- the RAM diff must catch it.
  c.mem.write8(GAME_MODE, 0x0a); c.mem.write8(GAME_MODE_PENDING, 0x04); c.mem.write8(MODE_DELAY_TIMER, 0x14);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch a missing $01 store");
});
