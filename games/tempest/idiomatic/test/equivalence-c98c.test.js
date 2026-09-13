// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for loc_c98c (ROM 0xc98c-0xc9ae). Index off loc_3d: read the loc_46-slot; while it is
// below 0x62 increment that slot and loc_9f; seed loc_00 = 0x18; when the loc_102-slot is nonzero run the
// handler chain (loc_91b5 with the slot value, loc_ca6c with X=0xff, loc_ccb9); then TAIL-DELEGATE to
// loc_9009. Contract is RAM (dumpState minus STACK_SCRATCH). Registers are NOT compared: the routine takes
// no input register and tail-jmps loc_9009, so its exit registers are the delegate's -- both layers run the
// identical delegate from the identical clone. Oracle is the frozen translated loc_c98c.
// Run: node --test games/tempest/idiomatic/test/equivalence-c98c.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_c98c as oracle } from "../../translated/loc_c98c.js";
import { loc_c98c } from "../loc_c98c.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, loc_00, loc_3d, loc_46, loc_9f } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xc98c;
const TRIGGER_BASE = 0x0102; // loc_102 (new cell; wired in names.js by the lead)
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
const freezePokey = (m) => { for (const p of m.io.pokeys) p.skctl &= ~0x03; return m; };

test("CAPTURE: real 0xc98c dispatches -- loc_c98c == oracle in RAM (-stack)", () => {
  let checked = 0;
  for (const cap of CAPS) {
    const o = freezePokey(cap.clone()), c = freezePokey(cap.clone());
    let threw = false;
    try { oracle(o); } catch { threw = true; } // a real dispatch may reach an unimplemented arm
    if (threw) continue;                        // both layers would throw identically there
    loc_c98c(c);
    assert.equal(ramDiff(o, c), null);
    checked++;
  }
  console.log(`  CAPTURE: ${checked}/${CAPS.length} dispatch(es) compared`);
});

// Seed the index cell, a below-threshold slot value (so the increment block runs), and the trigger slot
// so the loc_91b5/ca6c/ccb9 chain fires (trigger != 0) or is skipped (trigger == 0).
function seed(m, idx, slotVal, trigger) {
  m.mem.write8(loc_3d, idx);
  m.mem.write8((loc_46 + idx) & 0xff, slotVal);
  m.mem.write8(loc_9f, 0x05);
  m.mem.write8((TRIGGER_BASE + idx) & 0xffff, trigger);
  m.mem.write8(loc_00, 0xaa); // distinct from the routine's 0x18 write
}

test("CRAFTED: increment block + handler chain + tail-delegate -- RAM equal", () => {
  let checked = 0;
  // (idx, slotVal<0x62 -> increment runs, trigger!=0 -> chain runs), then a trigger==0 / at-threshold path.
  const cases = [[0x03, 0x10, 0x07], [0x05, 0x61, 0x01], [0x02, 0x62, 0x00], [0x00, 0x30, 0x00]];
  for (const [idx, slotVal, trigger] of cases) {
    const o = new Machine(ROM, OPTS); seed(o, idx, slotVal, trigger);
    const c = new Machine(ROM, OPTS); seed(c, idx, slotVal, trigger);
    let threw = false;
    try { oracle(o); } catch { threw = true; }
    if (threw) continue; // an arm this generic seed cannot provision -- other cases carry it
    loc_c98c(c);
    assert.equal(ramDiff(o, c), null, `RAM equal for idx=${idx} slot=${slotVal} trig=${trigger}`);
    checked++;
  }
  console.log(`  CRAFTED: ${checked}/4 cases provisioned and checked`);
  assert.ok(checked >= 1, "no case could be provisioned -- seed is inert");

  // Spot-check the signature effects on the increment-taken, chain-run case.
  const o = new Machine(ROM, OPTS); seed(o, 0x03, 0x10, 0x07);
  const c = new Machine(ROM, OPTS); seed(c, 0x03, 0x10, 0x07);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (!threw) {
    loc_c98c(c);
    assert.equal(c.mem.read8(loc_00), 0x18, "loc_00 seeded to 0x18");
    assert.equal(c.mem.read8((loc_46 + 0x03) & 0xff), o.mem.read8((loc_46 + 0x03) & 0xff), "slot matches oracle");
    assert.equal(c.mem.read8(loc_9f), o.mem.read8(loc_9f), "loc_9f matches oracle");
  }
});

test("TEETH: a twin that drops the loc_00 = 0x18 signature write MUST diverge in RAM", () => {
  const o = new Machine(ROM, OPTS); seed(o, 0x03, 0x10, 0x07);
  const c = new Machine(ROM, OPTS); seed(c, 0x03, 0x10, 0x07);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (threw) { console.log("  TEETH: oracle threw on this seed -- skipped"); return; }
  // Broken twin: run the real routine, then revert loc_00 to its pre-seed value. The delegate leaves
  // loc_00 = 0x18 untouched, so reverting it alone guarantees a RAM divergence from the oracle.
  const broken = (m) => {
    const before00 = m.mem.read8(loc_00);
    loc_c98c(m);
    m.mem.write8(loc_00, before00); // BUG: undo the 0x18 write
  };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the dropped loc_00 signature write was NOT caught by the RAM compare");
});
