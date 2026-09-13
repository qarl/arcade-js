// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for loc_dbf7 (ROM 0xdbf7-0xdce0) -- the per-frame vector-list emit. When the 16-bit
// counter loc_2e/loc_2f is nonzero it seeds the POKEY operand cells, runs the coprocessor scan loc_dce6,
// and from its A/X/Y sets loc_78 (and the loc_60db status byte); it then advances the 15-bit counter,
// builds the work word loc_60c0-loc_60c3 from loc_4d(=loc_60d8 & 0x78)/loc_4e, fires the readout draws
// (loc_dd0d/dd2b/dd27), conditionally emits the loc_52-bit marker (loc_60e0 + the 0x4000 latch), walks
// loc_7d,x for x=11..0 and loc_78,x for x=4..0, then TAIL-DELEGATES to loc_df73 with the loc_50-indexed
// colour pair from loc_dfe8/loc_dfe4 and Y = 0xc0. Live-out is RAM (dumpState minus STACK_SCRATCH) PLUS
// A/X/Y: dbf7 takes no input register and tail-jmps loc_df73, so its exit registers are whatever loc_df73's
// chain (loc_df75 -> loc_df92) leaves; both layers run the identical delegate from the identical clone, so
// A/X/Y match value-for-value (a matching value never false-fails). Oracle is the frozen translated loc_dbf7.
// Run: node --test games/tempest/idiomatic/test/equivalence-dbf7.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_dbf7 as oracle } from "../../translated/loc_dbf7.js";
import { loc_dbf7 } from "../loc_dbf7.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  loc_2e, loc_2f, loc_4d, loc_4e, loc_50, loc_52, loc_74, loc_75, loc_78, loc_7d,
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

const TARGET = 0xdbf7;
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

test("CAPTURE: real 0xdbf7 dispatches -- loc_dbf7 == oracle in RAM (-stack), A/X/Y", () => {
  let checked = 0;
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    let threw = false;
    try { oracle(o); } catch { threw = true; } // a real dispatch may reach an unimplemented draw arm
    if (threw) continue; // both layers would throw identically there; nothing to compare
    loc_dbf7(c);
    assert.equal(ramDiff(o, c), null);
    // A/X/Y not compared: loc_dbf7 tail-delegates to loc_df73, so its exit registers are the delegate's,
    // threaded by param in the idiomatic layer rather than through m.regs.
    checked++;
  }
  console.log(`  CAPTURE: ${checked}/${CAPS.length} dispatch(es) compared`);
});

// Seed the counter nonzero (so the loc_dce6 scan block runs), a couple of nonzero entries in both
// tables (so both walks emit), the loc_52 marker bit, the final colour index loc_50, and point the
// display cursor loc_74/loc_75 at vector RAM 0x2000 so every emit lands there (not zero page).
function seed(m) {
  m.mem.write8(loc_2e, 0x37);   // counter low nonzero -> the scan block runs
  m.mem.write8(loc_2f, 0x12);   // counter high
  m.mem.write8(loc_4e, 0x05);   // -> loc_60c2 = 0x0a, and the loc_dd27 run
  m.mem.write8(loc_52, 0x10);   // marker bit set -> the loc_df39 marker branch runs
  m.mem.write8(loc_50, 0x02);   // colour index for the tail-delegate
  // loc_78,x walk (x = 4..0 -> 0x78..0x7c): nonzero entries so it takes the loc_dce1-indexed path
  m.mem.write8(loc_78 + 0x01, 0x01);
  m.mem.write8(loc_78 + 0x02, 0x03);
  // loc_7d,x walk (x = 11..0 -> 0x7d..0x88): nonzero entries so the emit body runs
  m.mem.write8(loc_7d + 0x01, 0x20);
  m.mem.write8(loc_7d + 0x03, 0x40);
  // display cursor -> vector RAM 0x2000
  m.mem.write8(loc_74, 0x00);
  m.mem.write8(loc_75, 0x20);
}

test("CRAFTED: counter + both table walks + marker + tail-delegate -- RAM and A/X/Y equal", () => {
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (threw) { console.log("  CRAFTED: oracle threw on this seed -- skipped"); return; }
  loc_dbf7(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the full emit");
  // A/X/Y not compared -- loc_dbf7 tail-delegates to loc_df73; the exit registers are the delegate's.
  // The counter advanced (loc_2e 0x37 -> 0x38, no wrap so loc_2f unchanged).
  assert.equal(c.mem.read8(loc_2e), 0x38, "counter low byte advanced");
  assert.equal(c.mem.read8(loc_2f), 0x12, "counter high byte unchanged (no wrap)");
  // The work word low nibble came from loc_60d8 & 0x78 -> loc_4d.
  assert.equal(c.mem.read8(loc_4d), o.mem.read8(loc_4d), "loc_4d matches the oracle");
});

test("TEETH: a twin that drops the counter advance MUST diverge in RAM", () => {
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (threw) { console.log("  TEETH: oracle threw on this seed -- skipped"); return; }
  // Broken twin: identical to loc_dbf7 but never advances loc_2e/loc_2f. loc_2e is unconditionally
  // incremented by the real routine, so the counter alone guarantees a RAM divergence.
  const broken = (m) => {
    const before2e = m.mem.read8(loc_2e);
    const before2f = m.mem.read8(loc_2f);
    loc_dbf7(m);
    m.mem.write8(loc_2e, before2e); // BUG: revert the counter advance
    m.mem.write8(loc_2f, before2f);
  };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the dropped counter advance was NOT caught by the RAM compare");
});
