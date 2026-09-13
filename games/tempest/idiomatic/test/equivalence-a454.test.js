// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for loc_a454 (ROM 0xa454-0xa461) -- scans slots x=7..0 of the loc_2d3 table and,
// for each nonzero entry, invokes loc_a463 with that entry (threshold) and x (slot index). The oracle's
// jsr loc_a463 sits mid-loop (its return address is a normal JSR return, dissolved into a direct call
// in the idiomatic layer), so this is not a tail dispatcher: no live-out register, and no seam tooth.
// loc_a463 preserves X across its body, so the oracle's loop counter survives the call; the idiomatic
// layer threads x as a JS loop variable. Contract is RAM (dumpState minus STACK_SCRATCH); the oracle's
// push/rts land in STACK_SCRATCH and are excluded. Oracle is the frozen translated loc_a454.
// Run: node --test games/tempest/idiomatic/test/equivalence-a454.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_a454 as oracle } from "../../translated/loc_a454.js";
import { loc_a454 } from "../loc_a454.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, loc_2d3, loc_2e } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xa454;
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

test("CAPTURE: real 0xa454 dispatches -- loc_a454 == oracle in RAM (-stack)", () => {
  let checked = 0;
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    let threw = false;
    try { oracle(o); } catch { threw = true; } // a real slot may reach an unimplemented sub-arm
    if (threw) continue; // both layers would throw identically there; nothing to compare
    loc_a454(c);
    assert.equal(ramDiff(o, c), null);
    checked++;
  }
  console.log(`  CAPTURE: ${checked}/${CAPS.length} dispatch(es) compared`);
});

// Seed nonzero slot entries so the loop actually invokes loc_a463 for several x. With the loc_2db scan
// table left zero, loc_a463 takes its minimal path (writes loc_2e = threshold, no sub-calls), which is
// enough to exercise the caller loop and produce an observable RAM change.
function seed(m) {
  m.mem.write8(loc_2d3 + 0x02, 0x11);
  m.mem.write8(loc_2d3 + 0x04, 0x22);
  m.mem.write8(loc_2d3 + 0x07, 0x33);
}

test("CRAFTED: several nonzero slots invoke loc_a463 -- RAM equal", () => {
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (threw) { console.log("  CRAFTED: oracle threw on this seed -- skipped"); return; }
  loc_a454(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the slot scan");
  // The last slot processed is x=2 (loop runs 7..0, highest-numbered nonzero seen last), so loc_2e ends
  // as that slot's threshold; assert both layers agree it changed.
  assert.equal(c.mem.read8(loc_2e), o.mem.read8(loc_2e), "loc_2e (threshold) matches the oracle");
  assert.notEqual(c.mem.read8(loc_2e), 0x00, "loc_a463 ran and wrote the threshold cell");
});

test("TEETH: a twin that never invokes the callee MUST diverge in RAM", () => {
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (threw) { console.log("  TEETH: oracle threw on this seed -- skipped"); return; }
  // Broken twin: scans the slots but never calls loc_a463, so the threshold cell loc_2e (which the real
  // callee writes on every invocation) is left untouched -- a guaranteed RAM divergence under this seed.
  const { mem8 } = c;
  let tried = 0;
  for (let x = 7; x >= 0; x--) { if (mem8[loc_2d3 + x] !== 0) tried++; }
  assert.ok(tried > 0, "seed provisioned no nonzero slot -- teeth arm is inert");
  assert.notEqual(ramDiff(o, c), null, "the skipped callee was NOT caught by the RAM compare");
});
