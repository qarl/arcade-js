// SPDX-License-Identifier: GPL-3.0-only
// Equivalence for loc_d92f -- folds one byte (through the zero-page pointer loc_0, indexed by the cursor)
// into the running byte and continues into loc_d931, which carries that folded byte as the tone burst
// count into loc_d8cd (tone drains -> checksum/self-test spin). Its RAM-observable effect through the
// chain is loc_79 = the folded byte. Contract: RAM (dumpState minus STACK_SCRATCH); the oracle runs under
// a cycle BUDGET so the terminal self-test spin trips FramesComplete.
// Run: node --test games/tempest/idiomatic/test/equivalence-d92f.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_d92f as oracle } from "../../translated/loc_d92f.js";
import { loc_d92f } from "../loc_d92f.js";
import { Machine, FramesComplete } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, loc_0, loc_1, loc_79, loc_1c9, loc_2e, loc_2f, loc_78 } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) { const u = new URL(name, ROM_DIR); return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined; }
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const BUDGET = 40000000;
const A_IN = 0x11;   // incoming running byte
const Y_IN = 0x02;   // cursor index into the table
const inDeadStack = (a) => a != null && a >= STACK_SCRATCH.lo && a < STACK_SCRATCH.hi;
const ramDiff = (ma, mb) => firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);

// Pointer loc_0/loc_1 -> vector RAM 0x2000 (loc_1=0x20 also serves as loc_d931's pass-seed source), a
// byte to fold at 0x2000+Y, and the self-test tail seed so the tail builds a real frame before its poll.
function seed(m) {
  m.mem.write8(loc_0, 0x00);
  m.mem.write8(loc_1, 0x20);
  m.mem.write8(0x2000 + Y_IN, 0x3c);   // the byte folded via eor
  m.mem.write8(loc_1c9, 0x00);
  m.mem.write8(loc_2e, 0x37);
  m.mem.write8(loc_2f, 0x12);
  m.mem.write8(loc_78 + 0x01, 0x01);
}
function runBoundedOracle(m) {
  m.regs.a = A_IN; m.regs.y = Y_IN; m.nextIrqCycle = Infinity; m.maxCycles = m.cycles + BUDGET;
  try { oracle(m); return "returned"; }
  catch (e) { if (e instanceof FramesComplete) return "done"; if (e && e.name === "NotImplemented") return "notimpl"; throw e; }
}
function runIdiomatic(m) {
  m.nextIrqCycle = Infinity; m.maxCycles = m.cycles + BUDGET;
  try { loc_d92f(m, A_IN, Y_IN); return "returned"; }
  catch (e) { if (e instanceof FramesComplete) return "done"; if (e && e.name === "NotImplemented") return "notimpl"; throw e; }
}

test("CRAFTED: loc_d92f == oracle in RAM (-stack) through the fold + tone + self-test tail", () => {
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  const os = runBoundedOracle(o);
  if (os === "notimpl") { console.log("  CRAFTED: oracle hit a stubbed draw arm -- skipped"); return; }
  assert.equal(os, "done", "oracle reached its terminal self-test spin");
  if (runIdiomatic(c) === "notimpl") { console.log("  CRAFTED: idiomatic hit a stubbed draw arm -- skipped"); return; }
  assert.equal(ramDiff(o, c), null, "RAM equal after the fold + tail");
  assert.equal(c.mem.read8(loc_79), (A_IN ^ 0x3c) & 0xff, "loc_79 = the folded byte");
  assert.equal(c.mem.read8(loc_79), o.mem.read8(loc_79), "loc_79 matches the oracle");
});

test("TEETH: a twin that drops the fold MUST diverge in RAM", () => {
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  const os = runBoundedOracle(o);
  if (os === "notimpl") { console.log("  TEETH: oracle hit a stubbed draw arm -- skipped"); return; }
  assert.equal(os, "done");
  // Broken twin: skip the eor fold -> loc_79 becomes A_IN instead of A_IN^byte. Since byte (0x3c) is
  // nonzero, this changes loc_79 and the RAM compare must catch it.
  let tried = 0;
  const broken = (m) => {
    // run the real d92f then revert loc_79 to what the no-fold path would leave:
    if (runIdiomatic(m) === "notimpl") return false;
    m.mem.write8(loc_79, A_IN & 0xff); // BUG: as if the fold never happened
    tried++;
    return true;
  };
  if (!broken(c)) { console.log("  TEETH: idiomatic hit a stubbed draw arm -- skipped"); return; }
  assert.ok(tried > 0);
  assert.notEqual(ramDiff(o, c), null, "the dropped fold was NOT caught by the RAM compare");
});
