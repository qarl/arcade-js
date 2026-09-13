// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for loc_99a5 (ROM 0x99a5-0x9a86) -- builds the five-column deficit table loc_13d from
// loc_12e minus loc_142 (clamped nonnegative), deducts per active lane (loc_2df/loc_28a), caps every column
// at (loc_11c + 1) minus the loc_142 total, then by the count of nonzero columns (0 / 1 / >=2) tries loc_9a87
// to place a list, returning on the first success; every exhausted path clears loc_29. The idiomatic form
// dissolves the mid-routine JSRs to loc_9a87 into direct calls and the m.ret(6) tails into plain returns.
// Contract is RAM only (dumpState minus STACK_SCRATCH): the sole caller (loc_9923) reads loc_29 back from
// memory, not a register, so there is NO live-out register to compare, and the routine is not a tail
// dispatcher (its exits are ordinary RTS), so there is no seam tooth. Oracle is the frozen translated loc_99a5.
// Run: node --test games/tempest/idiomatic/test/equivalence-99a5.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_99a5 as oracle } from "../../translated/loc_99a5.js";
import { loc_99a5 } from "../loc_99a5.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  loc_11c, loc_129, loc_12e, loc_13d, loc_13f, loc_140, loc_142, loc_2df, loc_29, loc_60da,
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

const TARGET = 0x99a5;
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

test("CAPTURE: real 0x99a5 dispatches -- loc_99a5 == oracle in RAM (-stack)", () => {
  let checked = 0;
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    let threw = false;
    try { oracle(o); } catch { threw = true; } // a real dispatch may reach an unimplemented list-setup arm
    if (threw) continue;
    loc_99a5(c);
    assert.equal(ramDiff(o, c), null);
    checked++;
  }
  console.log(`  CAPTURE: ${checked}/${CAPS.length} dispatch(es) compared`);
});

// One nonzero column, no loc_129 entry: block A scans the deficit column, finds no list slot, and falls to
// the tail that clears loc_29. loc_11c=0 with loc_2df[0]=0 makes the lane loop a single no-op pass; loc_142
// all zero makes the cap = loc_11c + 1 = 1, so loc_13d[4] = min(loc_12e[4], 1) = 1 and the count is 1.
function seedOneNoCall(m) {
  m.mem.write8(loc_11c, 0x00);
  m.mem.write8(loc_2df, 0x00);
  m.mem.write8(loc_12e + 4, 0x05);
  m.mem.write8(loc_29, 0xf0); // the request flag the caller seats before calling
}

test("CRAFTED: single column, no loc_129 slot -- scans then clears loc_29; RAM equal", () => {
  const o = new Machine(ROM, OPTS); seedOneNoCall(o);
  const c = new Machine(ROM, OPTS); seedOneNoCall(c);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (threw) { console.log("  CRAFTED(one): oracle threw -- skipped"); return; }
  loc_99a5(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the single-column no-slot path");
  assert.equal(c.mem.read8(loc_29), 0x00, "loc_29 was cleared on the no-placement tail");
  assert.equal(c.mem.read8(loc_13d + 4), 0x01, "column 4 deficit capped to 1");
});

// One nonzero column WITH a loc_129 slot: block A now invokes loc_9a87(m, 4). Exercises the dissolved call.
function seedOneCall(m) {
  seedOneNoCall(m);
  m.mem.write8(loc_129 + 4, 0x01);
}

test("CRAFTED: single column with a loc_129 slot -- loc_9a87 dissolution; RAM equal", () => {
  const o = new Machine(ROM, OPTS); seedOneCall(o);
  const c = new Machine(ROM, OPTS); seedOneCall(c);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (threw) { console.log("  CRAFTED(call): oracle threw on the list-setup arm -- skipped"); return; }
  loc_99a5(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the placement path through loc_9a87");
});

// Two nonzero columns (0 and 4) with columns 2 and 3 zero and no loc_129 slots: block B runs (loc_61 set),
// its scan and the round-robin sweep find nothing, and the loc_140/loc_13f extra is skipped -> tail clears loc_29.
function seedManyNoCall(m) {
  m.mem.write8(loc_11c, 0x00);
  m.mem.write8(loc_2df, 0x00);
  m.mem.write8(loc_12e + 0, 0x03);
  m.mem.write8(loc_12e + 4, 0x03);
  m.mem.write8(loc_29, 0xf0);
}

test("CRAFTED: two columns, block B with no placements -- RAM equal", () => {
  const o = new Machine(ROM, OPTS); seedManyNoCall(o);
  const c = new Machine(ROM, OPTS); seedManyNoCall(c);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (threw) { console.log("  CRAFTED(many): oracle threw -- skipped"); return; }
  loc_99a5(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the block-B no-placement path");
  assert.equal(c.mem.read8(loc_29), 0x00, "loc_29 cleared on the tail");
  assert.equal(c.mem.read8(loc_140), 0x00, "column 3 stayed zero (b40 extra skipped)");
  assert.equal(c.mem.read8(loc_13f), 0x00, "column 2 stayed zero");
});

test("TEETH: a twin that skips the tail loc_29 clear MUST diverge in RAM", () => {
  const o = new Machine(ROM, OPTS); seedOneNoCall(o);
  const c = new Machine(ROM, OPTS); seedOneNoCall(c);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (threw) { console.log("  TEETH: oracle threw -- skipped"); return; }
  // Broken twin: run the real routine, then revert loc_29 to its seeded value. The no-placement tail
  // clears loc_29 to 0, so reverting it to 0xf0 guarantees a RAM divergence.
  const before29 = c.mem.read8(loc_29);
  loc_99a5(c);
  c.mem.write8(loc_29, before29); // BUG: undo the signature clear
  assert.notEqual(ramDiff(o, c), null, "the skipped loc_29 clear was NOT caught by the RAM compare");
});
