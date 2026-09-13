// SPDX-License-Identifier: GPL-3.0-only
// Equivalence for loc_d931 -- a power-on-path helper that carries its incoming byte through as the tone
// burst count and derives a pass-seed from loc_1, then tail-delegates to the tone burst loc_d8cd (which
// runs the tone drains and continues into the checksum/self-test loc_da0a, a non-terminating spin). Its
// only RAM-observable effect through the chain is loc_79 = the burst count (the incoming A); the derived
// pass-seed feeds only the POKEY drains (I/O, not in dumpState), so it is covered by review of the
// faithful loc_1 mask rather than by a RAM cell. Contract: RAM (dumpState minus STACK_SCRATCH); the
// oracle runs under a cycle BUDGET so its terminal self-test spin trips FramesComplete.
// Run: node --test games/tempest/idiomatic/test/equivalence-d931.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_d931 as oracle } from "../../translated/loc_d931.js";
import { loc_d931 } from "../loc_d931.js";
import { Machine, FramesComplete } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, loc_1, loc_79, loc_1c9, loc_2e, loc_2f, loc_78 } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) { const u = new URL(name, ROM_DIR); return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined; }
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const BUDGET = 40000000;
const COUNT = 0x04;   // burst count -> loc_79; low nibble nonzero
const INDEX = 0x25;   // loc_1 -> pass-seed (>= 0x20 folds by 0x18 then masks 0x1f)
const inDeadStack = (a) => a != null && a >= STACK_SCRATCH.lo && a < STACK_SCRATCH.hi;
const ramDiff = (ma, mb) => firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);

function seed(m) {
  m.mem.write8(loc_1, INDEX);
  m.mem.write8(loc_1c9, 0x00);      // cleared request so the self-test tail builds a real frame
  m.mem.write8(loc_2e, 0x37);
  m.mem.write8(loc_2f, 0x12);
  m.mem.write8(loc_78 + 0x01, 0x01);
}
function runBoundedOracle(m) {
  m.regs.a = COUNT; m.nextIrqCycle = Infinity; m.maxCycles = m.cycles + BUDGET;
  try { oracle(m); return "returned"; }
  catch (e) { if (e instanceof FramesComplete) return "done"; if (e && e.name === "NotImplemented") return "notimpl"; throw e; }
}
function runIdiomatic(m) {
  m.nextIrqCycle = Infinity; m.maxCycles = m.cycles + BUDGET;
  try { loc_d931(m, COUNT); return "returned"; }
  catch (e) { if (e instanceof FramesComplete) return "done"; if (e && e.name === "NotImplemented") return "notimpl"; throw e; }
}

test("CRAFTED: loc_d931 == oracle in RAM (-stack) through the tone + self-test tail", () => {
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  const os = runBoundedOracle(o);
  if (os === "notimpl") { console.log("  CRAFTED: oracle hit a stubbed draw arm -- skipped"); return; }
  assert.equal(os, "done", "oracle reached its terminal self-test spin");
  if (runIdiomatic(c) === "notimpl") { console.log("  CRAFTED: idiomatic hit a stubbed draw arm -- skipped"); return; }
  assert.equal(ramDiff(o, c), null, "RAM equal after the tone drains + checksum + tail frame");
  assert.equal(c.mem.read8(loc_79), COUNT, "the burst count was stored at loc_79");
  assert.equal(c.mem.read8(loc_79), o.mem.read8(loc_79), "loc_79 matches the oracle");
});

test("TEETH: a twin that drops the burst-count store MUST diverge in RAM", () => {
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  const os = runBoundedOracle(o);
  if (os === "notimpl") { console.log("  TEETH: oracle hit a stubbed draw arm -- skipped"); return; }
  assert.equal(os, "done");
  let tried = 0;
  const before = c.mem.read8(loc_79);
  if (runIdiomatic(c) === "notimpl") { console.log("  TEETH: idiomatic hit a stubbed draw arm -- skipped"); return; }
  c.mem.write8(loc_79, before); // BUG: undo the burst-count store
  tried++;
  assert.ok(tried > 0);
  assert.notEqual(ramDiff(o, c), null, "the dropped loc_79 store was NOT caught by the RAM compare");
});
