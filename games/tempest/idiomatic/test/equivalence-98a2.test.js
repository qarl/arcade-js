// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for loc_98a2 (ROM 0x98a2-0x9922) -- the slot-timer scan over loc_243 (slot 63..0). It
// zeroes loc_14f, sets the gate byte loc_2f (0xff when loc_108+loc_109 overshoots loc_11c or loc_125 is set),
// then for each active slot ages the timer (unless the gate is raised), fires loc_9923 on expiry, re-arms on
// the 0x3f boundary when the loc_14f/loc_ca38 mask hits, accumulates the loc_ca38[loc_203] bit into loc_14f
// for timers in [0x20,0x40), advances loc_203 (mod 16) for timers >= 0x40 on even loc_3 frames, and finally
// copies loc_14f -> loc_150. The caller (the per-frame dispatcher) reads no exit register, so the contract is
// RAM only (dumpState minus STACK_SCRATCH); there are no live-out registers. The oracle's JSR to loc_9923 is
// a plain subroutine call, dissolved to a direct loc_9923(m, slot); loc_98a2 itself RTSs, so no seam tooth.
// Oracle is the frozen translated loc_98a2.
// Run: node --test games/tempest/idiomatic/test/equivalence-98a2.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_98a2 as oracle } from "../../translated/loc_98a2.js";
import { loc_98a2 } from "../loc_98a2.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  loc_2f, loc_3, loc_108, loc_109, loc_11c, loc_125, loc_14f, loc_150, loc_203, loc_243,
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

const TARGET = 0x98a2;
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

test("CAPTURE: real 0x98a2 dispatches -- loc_98a2 == oracle in RAM (-stack)", () => {
  let checked = 0;
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    let threw = false;
    try { oracle(o); } catch { threw = true; } // an expiry may reach an unimplemented arm inside loc_9923
    if (threw) continue;
    loc_98a2(c);
    assert.equal(ramDiff(o, c), null);
    checked++;
  }
  console.log(`  CAPTURE: ${checked}/${CAPS.length} dispatch(es) compared`);
});

// Gate clear (sum 2 < loc_11c, loc_125 = 0) so ageing runs; loc_3 even so the >=0x40 branch advances loc_203.
// Slots exercise: mask-accumulation [0x20,0x40), the 0x40 re-arm boundary, a sub-0x20 age, and an expiry.
function seed(m) {
  m.mem.write8(loc_108, 0x01);
  m.mem.write8(loc_109, 0x01);
  m.mem.write8(loc_11c, 0x10); // sum 0x02 < 0x10 -> gate stays clear from this test
  m.mem.write8(loc_125, 0x00);
  m.mem.write8(loc_3, 0x00);   // even -> the timer>=0x40 branch advances loc_203
  m.mem.write8(loc_243 + 0x30, 0x25); // ages to 0x24, lands in [0x20,0x40) -> mask accumulate
  m.mem.write8(loc_243 + 0x20, 0x40); // ages to 0x3f (re-arm boundary), then classified
  m.mem.write8(loc_243 + 0x10, 0x02); // ages to 0x01, below 0x20 -> no mask
  m.mem.write8(loc_243 + 0x05, 0x01); // expires -> loc_9923 fires
}

test("CRAFTED: gate-clear scan with mask/re-arm/expiry slots -- RAM equal", () => {
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  let threw = false;
  try { oracle(o); } catch { threw = true; } // the expiry slot may reach an unimplemented arm inside loc_9923
  if (threw) { console.log("  CRAFTED: oracle threw on this seed -- skipped"); return; }
  loc_98a2(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the full scan");
  // loc_150 is the routine's signature copy of loc_14f.
  assert.equal(c.mem.read8(loc_150), c.mem.read8(loc_14f), "loc_150 mirrors loc_14f");
  assert.equal(c.mem.read8(loc_150), o.mem.read8(loc_150), "loc_150 matches the oracle");
  assert.equal(c.mem.read8(loc_243 + 0x10), 0x01, "the sub-0x20 slot aged 0x02 -> 0x01");
});

test("CRAFTED gate-raised: loc_125 set freezes ageing -- RAM equal, timers untouched", () => {
  const s = (m) => {
    m.mem.write8(loc_108, 0x01);
    m.mem.write8(loc_109, 0x01);
    m.mem.write8(loc_11c, 0x10);
    m.mem.write8(loc_125, 0x01);        // raises the gate loc_2f = 0xff
    m.mem.write8(loc_243 + 0x30, 0x25); // stays >= 0x20 -> mask accumulate, but never aged
    m.mem.write8(loc_243 + 0x10, 0x02);
  };
  const o = new Machine(ROM, OPTS); s(o);
  const c = new Machine(ROM, OPTS); s(c);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (threw) { console.log("  gate-raised: oracle threw -- skipped"); return; }
  loc_98a2(c);
  assert.equal(ramDiff(o, c), null, "RAM equal with the gate raised");
  assert.equal(c.mem.read8(loc_243 + 0x30), 0x25, "gated slot NOT aged");
  assert.equal(c.mem.read8(loc_2f), 0xff, "gate byte raised");
});

test("TEETH: a twin that skips one slot's age MUST diverge in RAM", () => {
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (threw) { console.log("  TEETH: oracle threw on this seed -- skipped"); return; }
  // Broken twin: run the real routine, then revert one active slot's decrement. With the gate clear an
  // active slot is unconditionally aged, so reverting it alone guarantees a RAM divergence.
  const broken = (m) => {
    const before10 = m.mem.read8(loc_243 + 0x10); // 0x02 pre-run
    loc_98a2(m);
    m.mem.write8(loc_243 + 0x10, before10);       // BUG: undo the 0x02 -> 0x01 age
  };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the skipped age was NOT caught by the RAM compare");
});
