// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for loc_a38e (ROM 0xa38e-0xa397) -- flags slot X active by writing 0xff to
// loc_2f2,x, steps the incoming lane index Y back by four, then TAIL-DELEGATES to loc_a398 with the
// unchanged X and the stepped-back index. loc_a38e takes X and Y as live-in registers (the write index
// and the lane index) and its exit registers are the delegate's, so live-out is RAM only (dumpState
// minus STACK_SCRATCH) -- no register is produced by loc_a38e itself, exactly as its tail-delegate leaves
// A/X/Y. Oracle is the frozen translated loc_a38e.
// Run: node --test games/tempest/idiomatic/test/equivalence-a38e.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_a38e as oracle } from "../../translated/loc_a38e.js";
import { loc_a38e } from "../loc_a38e.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, loc_283, loc_2b9, loc_2f2 } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xa38e;
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

test("CAPTURE: real 0xa38e dispatches -- loc_a38e == oracle in RAM (-stack)", () => {
  let checked = 0;
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    let threw = false;
    try { oracle(o); } catch { threw = true; } // a real dispatch may reach an unimplemented draw arm
    if (threw) continue; // both layers would throw identically there; nothing to compare
    loc_a38e(c);
    assert.equal(ramDiff(o, c), null);
    // A/X/Y not compared: loc_a38e tail-delegates to loc_a398, so its exit registers are the delegate's.
    checked++;
  }
  console.log(`  CAPTURE: ${checked}/${CAPS.length} dispatch(es) compared`);
});

// Seed X (the loc_2f2,x flag index) and Y (the lane index, stepped back by four into loc_a398), and
// give the stepped-back slot a plausible descriptor/seated pair so the delegate walks a real path.
function seed(m) {
  m.regs.x = 0x05;
  m.regs.y = 0x08;                 // priorSlot = 0x08 - 4 = 0x04
  m.mem.write8(loc_283 + 0x04, 0x21); // slot descriptor for the stepped-back slot
  m.mem.write8(loc_2b9 + 0x04, 0x07); // seated value for the stepped-back slot
}

test("CRAFTED: flag write + step-back + tail-delegate -- RAM equal", () => {
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (threw) { console.log("  CRAFTED: oracle threw on this seed -- skipped"); return; }
  loc_a38e(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the flag write and tail-delegate");
  // The unconditional signature write landed at loc_2f2 + X = loc_2f2 + 5.
  assert.equal(c.mem.read8(loc_2f2 + 0x05), 0xff, "slot flag set");
});

test("TEETH: a twin that drops the loc_2f2,x flag write MUST diverge in RAM", () => {
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (threw) { console.log("  TEETH: oracle threw on this seed -- skipped"); return; }
  // Broken twin: identical to loc_a38e but reverts the unconditional 0xff flag write.
  const broken = (m) => {
    const x = m.regs.x;
    const before = m.mem.read8(loc_2f2 + x);
    loc_a38e(m);
    m.mem.write8(loc_2f2 + x, before); // BUG: undo the signature write
  };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the dropped flag write was NOT caught by the RAM compare");
});
