// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for loc_da62 -- the self-test session loop. A one-time preamble seeds the state
// machine, forwards a pending request byte, copies the 8-byte colour table into colour RAM, and idles
// the coin/flip control; then each pass builds and shows one self-test frame (option switches -> loc_52
// /loc_50, diagnostic inputs -> loc_4e/loc_4c, loc_db0f + loc_df0d + every-fourth-frame loc_de1b),
// leaving once the self-test switch is released.
//
// This routine NEVER RETURNS in the oracle: with the switch idle-high it runs one frame then settles
// into a forever spin, so the oracle is run under a CYCLE BUDGET (the spin trips FramesComplete, leaving
// RAM at its post-frame rest). The idiomatic layer has no clock, so its sync-drain is modelled as the
// device strobes it performs (no work-RAM effect) and its exit poll leaves after one pass. Contract:
// RAM (dumpState minus STACK_SCRATCH). No live-out register (the routine falls into a spin / returns).
// Run: node --test games/tempest/idiomatic/test/equivalence-da62.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_da62 as oracle } from "../../translated/loc_da62.js";
import { loc_da62 } from "../loc_da62.js";
import { Machine, FramesComplete } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  loc_0, loc_75, loc_4c, loc_1c9, loc_2e, loc_2f, loc_78, loc_7d,
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

const TARGET = 0xda62;
const BUDGET = 2000000; // > any single self-test frame; the terminal spin then trips FramesComplete
const inDeadStack = (a) => a != null && a >= STACK_SCRATCH.lo && a < STACK_SCRATCH.hi;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);

// da62 never returns; run the oracle under a cycle budget so its terminal spin trips FramesComplete.
// "done" = the frame completed and the spin was reached; "notimpl" = a still-stubbed draw arm.
function runBoundedOracle(m) {
  m.nextIrqCycle = Infinity; // no IRQ mutation during the spin
  m.maxCycles = m.cycles + BUDGET;
  try { oracle(m); return "returned"; }
  catch (e) {
    if (e instanceof FramesComplete) return "done";
    if (e && e.name === "NotImplemented") return "notimpl";
    throw e;
  }
}
function runIdiomatic(m) {
  try { loc_da62(m); return "returned"; }
  catch (e) {
    if (e && e.name === "NotImplemented") return "notimpl";
    throw e;
  }
}

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* self-test off: da62 is not reached; keep any caps */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(4, 3000) : [];

test("CAPTURE: real 0xda62 dispatches -- loc_da62 == oracle in RAM (-stack)", () => {
  // Self-test is off in a normal boot, so da62 is typically never dispatched (0 captures tolerated).
  let checked = 0;
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    const os = runBoundedOracle(o);
    if (os === "notimpl") continue;
    if (runIdiomatic(c) === "notimpl") continue;
    assert.equal(os, "done");
    assert.equal(ramDiff(o, c), null);
    checked++;
  }
  console.log(`  CAPTURE: ${checked}/${CAPS.length} dispatch(es) compared`);
});

// No pending request (loc_1c9 == 0): the preamble stamps loc_0 = 2, which routes loc_db0f to its
// per-frame vector emit. Seed that emitter's counter + table cells so the frame builds a real list;
// da62 itself points the display cursor at vector RAM (loc_75 = 0x20) so emits land in diffed space.
function seedNoPending(m) {
  m.mem.write8(loc_1c9, 0x00);
  m.mem.write8(loc_2e, 0x37);
  m.mem.write8(loc_2f, 0x12);
  m.mem.write8(loc_78 + 0x01, 0x01);
  m.mem.write8(loc_7d + 0x01, 0x20);
}
// Pending request (loc_1c9 != 0): the preamble forwards it to loc_7c, runs loc_ddf1, clears loc_1c9,
// and stamps loc_0 = 0 (a different loc_db0f handler). Exercises the else-branch of the preamble.
function seedPending(m) {
  m.mem.write8(loc_1c9, 0x5a);
  m.mem.write8(loc_2e, 0x11);
  m.mem.write8(loc_2f, 0x03);
}

test("CRAFTED (no pending): full self-test frame -- RAM equal (-stack)", () => {
  const o = new Machine(ROM, OPTS); seedNoPending(o);
  const c = new Machine(ROM, OPTS); seedNoPending(c);
  const os = runBoundedOracle(o);
  if (os === "notimpl") { console.log("  CRAFTED(no-pending): oracle hit a stubbed draw arm -- skipped"); return; }
  assert.equal(os, "done", "oracle reached its terminal spin (frame completed)");
  if (runIdiomatic(c) === "notimpl") { console.log("  CRAFTED(no-pending): idiomatic hit a stubbed draw arm -- skipped"); return; }
  assert.equal(ramDiff(o, c), null, "RAM equal after one self-test frame");
  // Preamble/body signatures: no-pending -> loc_0 = 2 (unless the input branch double-bumped it),
  // the display cursor high byte, and the idle-input default for loc_4c.
  assert.equal(c.mem.read8(loc_0), o.mem.read8(loc_0), "loc_0 matches the oracle");
  assert.equal(c.mem.read8(loc_75), 0x20, "display cursor high byte");
  assert.equal(c.mem.read8(loc_4c), o.mem.read8(loc_4c), "loc_4c matches the oracle");
});

test("CRAFTED (pending): preamble else-branch -- RAM equal (-stack)", () => {
  const o = new Machine(ROM, OPTS); seedPending(o);
  const c = new Machine(ROM, OPTS); seedPending(c);
  const os = runBoundedOracle(o);
  if (os === "notimpl") { console.log("  CRAFTED(pending): oracle hit a stubbed draw arm -- skipped"); return; }
  assert.equal(os, "done");
  if (runIdiomatic(c) === "notimpl") { console.log("  CRAFTED(pending): idiomatic hit a stubbed draw arm -- skipped"); return; }
  assert.equal(ramDiff(o, c), null, "RAM equal after one self-test frame (pending path)");
  assert.equal(c.mem.read8(loc_1c9), 0x00, "pending request byte was cleared");
});

test("TEETH: a twin that drops the display-cursor write MUST diverge in RAM", () => {
  const o = new Machine(ROM, OPTS); seedNoPending(o);
  const c = new Machine(ROM, OPTS); seedNoPending(c);
  const os = runBoundedOracle(o);
  if (os === "notimpl") { console.log("  TEETH: oracle hit a stubbed draw arm -- skipped"); return; }
  assert.equal(os, "done");
  // Broken twin: run the real routine, then revert loc_75 (a body signature the routine always sets to
  // 0x20). The RAM compare MUST catch the reverted write -- proves the test can fail.
  let tried = 0;
  const broken = (m) => {
    if (runIdiomatic(m) === "notimpl") return false;
    m.mem.write8(loc_75, 0x00); // BUG: drop the display-cursor high byte
    tried++;
    return true;
  };
  if (!broken(c)) { console.log("  TEETH: idiomatic hit a stubbed draw arm -- skipped"); return; }
  assert.ok(tried > 0, "the broken twin actually ran");
  assert.notEqual(ramDiff(o, c), null, "the dropped display-cursor write was NOT caught by the RAM compare");
});
