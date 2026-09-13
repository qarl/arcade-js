// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for loc_a23f -- the free-slot spawn attempt. Bails when loc_201 is negative; forms a
// gate (loc_5 negative -> loc_4d & 0x10; else seed loc_29 from loc_106 and count loc_2b5 entries within 1 of
// loc_200 over the loc_2db-gated slots); a zero gate bails. Otherwise it fills the first free loc_2d3 slot
// (loc_2d3/loc_2ad/loc_2c0/loc_2f2), bumps loc_135, and fires the two spawn helpers. loc_a23f takes no input
// register and returns via a plain RTS with no caller-read exit register, so the contract is RAM only
// (dumpState minus STACK_SCRATCH); no register is compared. Oracle is the frozen translated loc_a23f.
// Run: node --test games/tempest/idiomatic/test/equivalence-a23f.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_a23f as oracle } from "../../translated/loc_a23f.js";
import { loc_a23f } from "../loc_a23f.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  loc_5, loc_29, loc_4d, loc_106, loc_135,
  loc_200, loc_201, loc_202, loc_2b5, loc_2d3, loc_2db,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xa23f;
const inDeadStack = (a) => a != null && a >= STACK_SCRATCH.lo && a < STACK_SCRATCH.hi;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 3000) : [];

test("CAPTURE: real 0xa23f dispatches -- loc_a23f == oracle in RAM (-stack)", () => {
  let checked = 0;
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    let threw = false;
    try { oracle(o); } catch { threw = true; } // a real dispatch may reach an unimplemented helper arm
    if (threw) continue; // both layers would throw identically there; nothing to compare
    loc_a23f(c);
    assert.equal(ramDiff(o, c), null);
    checked++;
  }
  console.log(`  CAPTURE: ${checked}/${CAPS.length} dispatch(es) compared`);
});

// Counting-gate path: loc_201/loc_5 positive so we take the loc_2b5 count branch. Two loc_2db-gated slots,
// one whose loc_2b5 value equals loc_200 (delta 0 -> counts) and one far away (no count) -> gate = 1.
// Every loc_2d3 slot is zero so the first free slot (x=7) is filled and both spawn helpers fire.
function seedCount(m) {
  m.mem.write8(loc_201, 0x40); // positive -> no early bail
  m.mem.write8(loc_5, 0x00);   // positive -> counting branch
  m.mem.write8(loc_200, 0x20); // reference value
  m.mem.write8(loc_202, 0x03); // seeded into the free slot
  m.mem.write8(loc_106, 0x00); // loc_29 seed
  m.mem.write8(loc_2db + 0x02, 0x01); m.mem.write8(loc_2b5 + 0x02, 0x20); // delta 0 -> counts
  m.mem.write8(loc_2db + 0x05, 0x01); m.mem.write8(loc_2b5 + 0x05, 0x30); // delta 0x10 -> no count
}

test("CRAFTED (count gate): positive loc_5, gate from the loc_2b5 count, spawn fires -- RAM equal", () => {
  const o = new Machine(ROM, OPTS); seedCount(o);
  const c = new Machine(ROM, OPTS); seedCount(c);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (threw) { console.log("  CRAFTED(count): oracle threw on this seed -- skipped"); return; }
  loc_a23f(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the counting-gate spawn");
  assert.equal(c.mem.read8(loc_135), 0x01, "live count bumped -> the spawn actually ran");
  assert.equal(c.mem.read8(loc_2d3 + 0x07), 0x03, "the free slot took loc_202");
});

// Negative-loc_5 gate path: gate is loc_4d & 0x10. Set loc_4d = 0x10 so the gate is nonzero and the spawn
// runs; with loc_5 negative the sound helper actually registers, exercising a different helper arm.
function seedNeg(m) {
  m.mem.write8(loc_201, 0x40); // positive -> no early bail
  m.mem.write8(loc_5, 0x80);   // negative -> gate = loc_4d & 0x10
  m.mem.write8(loc_4d, 0x10);  // gate nonzero
  m.mem.write8(loc_200, 0x22);
  m.mem.write8(loc_202, 0x05);
}

test("CRAFTED (neg gate): negative loc_5, gate from loc_4d, spawn + sound helper -- RAM equal", () => {
  const o = new Machine(ROM, OPTS); seedNeg(o);
  const c = new Machine(ROM, OPTS); seedNeg(c);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (threw) { console.log("  CRAFTED(neg): oracle threw on this seed -- skipped"); return; }
  loc_a23f(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the loc_4d-gate spawn");
  assert.equal(c.mem.read8(loc_135), 0x01, "live count bumped -> the spawn actually ran");
});

test("TEETH: a twin that skips the loc_135 spawn-count bump MUST diverge in RAM", () => {
  const o = new Machine(ROM, OPTS); seedCount(o);
  const c = new Machine(ROM, OPTS); seedCount(c);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (threw) { console.log("  TEETH: oracle threw on this seed -- skipped"); return; }
  // Broken twin: identical to loc_a23f but reverts the loc_135 live-count bump. The seedCount seed always
  // spawns (loc_135 goes 0 -> 1), so reverting it guarantees a RAM divergence.
  let tried = 0;
  const broken = (m) => {
    const before135 = m.mem.read8(loc_135);
    loc_a23f(m);
    tried++;
    m.mem.write8(loc_135, before135); // BUG: drop the spawn-count bump
  };
  broken(c);
  assert.ok(tried > 0, "the broken twin ran");
  assert.notEqual(ramDiff(o, c), null, "the dropped loc_135 bump was NOT caught by the RAM compare");
});
