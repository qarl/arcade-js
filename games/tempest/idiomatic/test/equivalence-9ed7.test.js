// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for lookupRingHeading (ROM 0x9ed7-0x9ef0) -- ring-table direction lookup with bit7 forced on;
// bit6 of the caller's A selects a half-turn (index-1 mod 16, value+8 mod 16). It writes NO memory, so the
// RAM diff is vacuously null; the contract is the register live-out A. Y is incidental scratch (only used to
// index in the half-turn) and is dropped by the idiomatic routine, so it is NOT compared. A leaf: the module
// omits the ROM ret and the seam completes it. No POKEY/clock read.
// Run: node --test games/tempest/idiomatic/test/equivalence-9ed7.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_9ed7 } from "../../translated/loc_9ed7.js";
import { lookupRingHeading } from "../lookupRingHeading.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { SEG_DIRECTION } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x9ed7;
const oracle = atEntry(loc_9ed7);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

// Seed the 16-entry ring table $03ee..$03fd with distinct low-nibble values so the +8 half-turn bites.
const seedRing = (m) => { for (let i = 0; i < 16; i++) m.mem.write8((SEG_DIRECTION + i) & 0xffff, i); return m; };

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0x9ed7 dispatches -- lookupRingHeading == oracle in A and RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); const r = lookupRingHeading(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(c.regs.a, o.regs.a, "register A (the direction byte) diverged");
    assert.equal(r, o.regs.a, "return value tracks A");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: plain lookup (bit6=0) and half-turn (bit6=1) == oracle in A", () => {
  const ys = [0x00, 0x01, 0x07, 0x0f, 0x10, 0xff];
  const as = [0x00, 0x3f, 0x40, 0xc0]; // bit6 clear then set
  for (const y of ys) {
    for (const a of as) {
      const o = seedRing(new Machine(ROM, OPTS)); o.regs.a = a; o.regs.y = y;
      const c = seedRing(new Machine(ROM, OPTS)); c.regs.a = a; c.regs.y = y;
      oracle(o); const r = lookupRingHeading(c);
      assert.equal(ramDiff(o, c), null, `no RAM write: a=0x${a.toString(16)} y=0x${y.toString(16)}`);
      assert.equal(c.regs.a, o.regs.a, `A matches oracle: a=0x${a.toString(16)} y=0x${y.toString(16)}`);
      assert.equal(r, o.regs.a, `return == A: a=0x${a.toString(16)} y=0x${y.toString(16)}`);
      assert.equal(c.regs.a & 0x80, 0x80, "bit7 forced on");
    }
  }
});

test("TEETH: a twin that skips the half-turn (+8) diverges from the oracle when bit6 is set", () => {
  const y = 0x05, a = 0x40; // bit6 set -> oracle takes the half-turn
  const o = seedRing(new Machine(ROM, OPTS)); o.regs.a = a; o.regs.y = y;
  oracle(o);
  // BUG: plain lookup at (y-1)&0x0f without the +8, then ora 0x80
  const broken = (seedRing(new Machine(ROM, OPTS)).mem.read8((SEG_DIRECTION + ((y - 1) & 0x0f)) & 0xffff) & 0x0f) | 0x80;
  assert.notEqual(broken, o.regs.a, "the A compare FAILED to catch the skipped half-turn");
});

test("SP-TOOTH: the omitted-ret leaf (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12); // a real caller-return word for the seam
  const r = seamPlaceable(withOmittedRet, lookupRingHeading, TARGET, m);
  assert.equal(r.placeable, true, `lookupRingHeading must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret leaf (moved 0) placeable");
});
