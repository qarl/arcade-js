// SPDX-License-Identifier: GPL-3.0-only
// Equivalence for loc_9b1e -- when loc_201>=0, walks slots loc_37=loc_11c..0 running a per-entry motion
// pass through loc_9b98 (loc_a0f7-indexed) and storing loc_10b back to loc_291,x; then signed-accumulates
// loc_147 into loc_148 (cd06/cd02 on a sign flip) and negates loc_147 when loc_148 leaves [0x0f,0xc0].
// Contract: RAM (dumpState minus STACK_SCRATCH). Oracle = frozen translated/loc_9b1e.js.
// Run: node --test games/tempest/idiomatic/test/equivalence-9b1e.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_9b1e as oracle } from "../../translated/loc_9b1e.js";
import { loc_9b1e } from "../loc_9b1e.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { u16 } from "../../../../core/int.js";
import {
  STACK_SCRATCH, loc_37, loc_10a, loc_10b, loc_11c, loc_143, loc_147, loc_148, loc_201, loc_291, loc_2df, loc_a0f7,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) { const u = new URL(name, ROM_DIR); return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined; }
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x9b1e;
const inDeadStack = (a) => a != null && a >= STACK_SCRATCH.lo && a < STACK_SCRATCH.hi;
const ramDiff = (ma, mb) => firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 3000) : [];

test("CAPTURE: real 0x9b1e dispatches -- loc_9b1e == oracle in RAM (-stack)", () => {
  let checked = 0;
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    let threw = false;
    try { oracle(o); } catch { threw = true; }
    if (threw) continue; // a real dispatch may reach an unimplemented arm inside loc_9b98
    loc_9b1e(c);
    assert.equal(ramDiff(o, c), null);
    checked++;
  }
  console.log(`  CAPTURE: ${checked}/${CAPS.length} dispatch(es) compared`);
});

// loc_201 negative -> the outer walk is skipped, isolating the tail accumulate + clamp (no loc_9b98).
test("CRAFTED (tail): accumulate loc_147 into loc_148 + negate in-band -- RAM equal", () => {
  const seed = (m) => {
    m.mem.write8(loc_201, 0x80);  // negative -> skip the walk
    m.mem.write8(loc_148, 0x10);
    m.mem.write8(loc_147, 0x05);  // sum 0x15, both positive -> no sign flip; 0x15 in [0x0f,0xc0] -> negate
    m.mem.write8(loc_143, 0x00);
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); loc_9b1e(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the tail");
  assert.equal(c.mem.read8(loc_148), 0x15, "loc_148 = 0x10 + 0x05");
  assert.equal(c.mem.read8(loc_147), 0xfb, "loc_147 negated (0x05 -> 0xfb) since loc_148 is in-band");
});

// loc_148 out of band (< 0x0f) -> no negate.
test("CRAFTED (tail, out-of-band): loc_148 < 0x0f leaves loc_147 unchanged -- RAM equal", () => {
  const seed = (m) => {
    m.mem.write8(loc_201, 0x80);
    m.mem.write8(loc_148, 0x02);
    m.mem.write8(loc_147, 0x05);  // sum 0x07 < 0x0f -> no negate
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); loc_9b1e(c);
  assert.equal(ramDiff(o, c), null, "RAM equal");
  assert.equal(c.mem.read8(loc_147), 0x05, "loc_147 unchanged (loc_148 0x07 below the band)");
});

// The outer walk: one slot with loc_2df,x nonzero drives loc_9b98 via the loc_a0f7 table. Skip-on-throw
// if loc_9b98 reaches an unimplemented arm on this seed.
test("CRAFTED (walk): one active slot runs the loc_9b98 pass -- RAM equal (skip on oracle throw)", () => {
  const seed = (m) => {
    m.mem.write8(loc_201, 0x00);                 // >= 0 -> walk runs
    m.mem.write8(loc_11c, 0x00);                 // one slot (loc_37 = 0)
    m.mem.write8(u16(loc_2df + 0x00), 0x40);     // slot 0 active
    m.mem.write8(u16(loc_291 + 0x00), 0x00);     // cursor start
    m.mem.write8(u16(loc_a0f7 + 0x00), 0x00);    // table entry -> loc_9b98 index 0 (a benign handler)
    m.mem.write8(loc_147, 0x00);                 // no accumulate delta
    m.mem.write8(loc_148, 0x20);
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (threw) { console.log("  CRAFTED (walk): oracle hit an unimplemented loc_9b98 arm -- skipped"); return; }
  loc_9b1e(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the walk + tail");
});

test("TEETH: a twin that skips the loc_148 accumulate MUST diverge in RAM", () => {
  const seed = (m) => { m.mem.write8(loc_201, 0x80); m.mem.write8(loc_148, 0x10); m.mem.write8(loc_147, 0x05); };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o);
  // Broken twin: everything except it leaves loc_148 unchanged (never adds loc_147).
  const before148 = c.mem.read8(loc_148);
  loc_9b1e(c);
  c.mem.write8(loc_148, before148); // BUG: revert the accumulate
  assert.notEqual(ramDiff(o, c), null, "the dropped loc_148 accumulate was NOT caught");
});
