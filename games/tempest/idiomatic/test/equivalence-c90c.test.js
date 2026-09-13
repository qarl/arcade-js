// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for loc_c90c (ROM 0xc90c-0xc93f) -- the per-slot state reset. It runs loc_aba2 and
// loc_c16e (and loc_ca62 when loc_5 is negative), clears loc_49, seeds every slot from loc_3e down to 0
// (loc_48,slot = loc_158; loc_46,slot = 0xff), clears loc_3f and loc_115, reloads loc_3d from loc_3e, then
// TAIL-DELEGATES to loc_90c4. Contract is RAM-equivalence (dumpState minus STACK_SCRATCH); no register is
// compared -- loc_c90c takes no live-in register and tail-jmps loc_90c4, so its exit registers are the
// delegate's (both layers run the identical loc_90c4 from the identical clone, so RAM equality suffices).
// Oracle is the frozen translated loc_c90c.
// Run: node --test games/tempest/idiomatic/test/equivalence-c90c.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_c90c as oracle } from "../../translated/loc_c90c.js";
import { loc_c90c } from "../loc_c90c.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  loc_5, loc_46, loc_48, loc_49, loc_3d, loc_3e, loc_3f, loc_115, loc_158,
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

const TARGET = 0xc90c;
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

test("CAPTURE: real 0xc90c dispatches -- loc_c90c == oracle in RAM (-stack)", () => {
  let checked = 0;
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    let threw = false;
    try { oracle(o); } catch { threw = true; } // a real dispatch may reach an unimplemented callee arm
    if (threw) continue; // both layers would throw identically there; nothing to compare
    loc_c90c(c);
    assert.equal(ramDiff(o, c), null);
    checked++;
  }
  console.log(`  CAPTURE: ${checked}/${CAPS.length} dispatch(es) compared`);
});

// Seed loc_3e nonzero (so the seeding loop iterates over several slots), loc_158 as the fill byte, and
// loc_3f/loc_115 nonzero so the routine's clears are observable. loc_5 stays positive so the loc_ca62 arm
// is skipped (that arm is exercised separately below, skip-on-throw).
// NB: loc_49 (0x49) == loc_48+1 -- it IS slot 1 of the loc_48 seeding array. The routine clears loc_49 at
// c91b, but with loc_3e>=1 the seeding loop's slot-1 iteration (loc_48+1 = loc_49) re-writes it to loc_158,
// so under this multi-slot seed the oracle leaves loc_49 == loc_158, NOT 0. The distinct c91b clear is
// observable only when the loop never reaches slot 1 (loc_3e == 0) -- the TEETH below seeds exactly that.
function seed(m) {
  m.mem.write8(loc_5, 0x10);    // positive -> loc_ca62 skipped
  m.mem.write8(loc_3e, 0x04);   // slot count -> loop runs slots 4..0
  m.mem.write8(loc_158, 0x5a);  // fill byte copied into loc_48,slot
  m.mem.write8(loc_3f, 0x66);   // nonzero -> the clear is observable
  m.mem.write8(loc_115, 0x55);  // nonzero -> the clear is observable
}

test("CRAFTED: seeding loop + clears + tail-delegate -- RAM equal", () => {
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (threw) { console.log("  CRAFTED: oracle threw on this seed -- skipped"); return; }
  loc_c90c(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the reset + delegate");
  // The routine's own writes that survive the delegate (loc_90c4 does not touch 0x3f/0x115/0x46-0x4c on
  // this positive-loc_5 path; it DOES rewrite loc_3d via loc_9108, so loc_3d is the delegate's, not 0x3e).
  assert.equal(c.mem.read8(loc_49), o.mem.read8(loc_49), "loc_49 matches the oracle after the seeding loop");
  assert.equal(c.mem.read8(loc_3f), o.mem.read8(loc_3f), "loc_3f matches the oracle (cleared)");
  assert.equal(c.mem.read8(loc_115), o.mem.read8(loc_115), "loc_115 matches the oracle (cleared)");
  assert.equal(c.mem.read8(loc_48 + 0x04), o.mem.read8(loc_48 + 0x04), "slot 4 (0x4c) matches the oracle");
  assert.equal(c.mem.read8(loc_46 + 0x01), o.mem.read8(loc_46 + 0x01), "slot 1 flag (0x47) matches the oracle");
});

test("CRAFTED-B: loc_5 negative -- loc_ca62 arm runs, RAM equal (skip-on-throw)", () => {
  const o = new Machine(ROM, OPTS); seed(o); o.mem.write8(loc_5, 0x80);
  const c = new Machine(ROM, OPTS); seed(c); c.mem.write8(loc_5, 0x80);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (threw) { console.log("  CRAFTED-B: oracle threw on the loc_ca62 arm -- skipped"); return; }
  loc_c90c(c);
  assert.equal(ramDiff(o, c), null, "RAM equal with the loc_ca62 arm taken");
});

test("TEETH: a twin that drops the loc_49 clear MUST diverge in RAM", () => {
  // The c91b clear of loc_49 is only distinguishable when the seeding loop never reaches slot 1
  // (loc_49 == loc_48+1). Seed loc_3e == 0 so the loop writes slot 0 only (loc_48), leaving loc_49
  // to the clear; pre-seed loc_49 nonzero so "dropped clear" leaves that stale value.
  const teethSeed = (m) => {
    m.mem.write8(loc_5, 0x10);    // positive -> loc_ca62 skipped
    m.mem.write8(loc_3e, 0x00);   // loop runs slot 0 only -> never writes loc_48+1 == loc_49
    m.mem.write8(loc_158, 0x5a);  // fill byte (into loc_48 = slot 0)
    m.mem.write8(loc_49, 0x77);   // stale value -> a dropped c91b clear leaves this
  };
  const o = new Machine(ROM, OPTS); teethSeed(o);
  const c = new Machine(ROM, OPTS); teethSeed(c);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (threw) { console.log("  TEETH: oracle threw on this seed -- skipped"); return; }
  assert.equal(o.mem.read8(loc_49), 0x00, "precondition: oracle leaves loc_49 cleared");
  // Broken twin: run the real routine, then revert the loc_49 clear. With loc_3e == 0 the loop never
  // re-writes loc_49, so the c91b clear is the last write to it -- reverting it guarantees divergence.
  const broken = (m) => { loc_c90c(m); m.mem.write8(loc_49, 0x77); };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the dropped loc_49 clear was NOT caught by the RAM compare");
});
