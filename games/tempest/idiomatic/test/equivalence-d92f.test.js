// SPDX-License-Identifier: GPL-3.0-only
// Equivalence for foldToneTableByte -- folds one byte (through the zero-page pointer GAME_MODE, indexed by the cursor)
// into the running byte and continues into seedToneBurstCount, which carries that folded byte as the tone burst
// count into runPowerOnToneBursts (tone drains -> checksum/self-test spin). Its RAM-observable effect through the
// chain is SEG_SPREAD_A_LO_1 = the folded byte. Contract: RAM (dumpState minus stack scratch below the ROM-reseated SP); the oracle runs under
// a cycle BUDGET so the terminal self-test spin trips FramesComplete.
// Run: node --test games/tempest/idiomatic/test/equivalence-d92f.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_d92f } from "../../translated/loc_d92f.js";
import { foldToneTableByte } from "../foldToneTableByte.js";
import { Machine, FramesComplete } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry, reseatedTop } from "./_entryFloor.js";
import { GAME_MODE, MODE_DISPATCH_SEL, SEG_SPREAD_A_LO_1, PENDING_WORK_FLAGS, loc_2e, loc_2f, SEG_SPREAD_A_LO } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) { const u = new URL(name, ROM_DIR); return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined; }
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const BUDGET = 40000000;
const A_IN = 0x11;   // incoming running byte
const Y_IN = 0x02;   // cursor index into the table
const oracle = atEntry(loc_d92f, reseatedTop); // runPowerOnToneBursts txs-seats S as a counter; it ends 0xff
const ramDiff = (ma, mb) => firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

// Pointer GAME_MODE/MODE_DISPATCH_SEL -> vector RAM 0x2000 (MODE_DISPATCH_SEL=0x20 also serves as seedToneBurstCount's pass-seed source), a
// byte to fold at 0x2000+Y, and the self-test tail seed so the tail builds a real frame before its poll.
function seed(m) {
  m.mem.write8(GAME_MODE, 0x00);
  m.mem.write8(MODE_DISPATCH_SEL, 0x20);
  m.mem.write8(0x2000 + Y_IN, 0x3c);   // the byte folded via eor
  m.mem.write8(PENDING_WORK_FLAGS, 0x00);
  m.mem.write8(loc_2e, 0x37);
  m.mem.write8(loc_2f, 0x12);
  m.mem.write8(SEG_SPREAD_A_LO + 0x01, 0x01);
}
function runBoundedOracle(m) {
  m.regs.a = A_IN; m.regs.y = Y_IN; m.nextIrqCycle = Infinity; m.maxCycles = m.cycles + BUDGET;
  try { oracle(m); return "returned"; }
  catch (e) { if (e instanceof FramesComplete) return "done"; if (e && e.name === "NotImplemented") return "notimpl"; throw e; }
}
function runIdiomatic(m) {
  m.nextIrqCycle = Infinity; m.maxCycles = m.cycles + BUDGET;
  try { foldToneTableByte(m, A_IN, Y_IN); return "returned"; }
  catch (e) { if (e instanceof FramesComplete) return "done"; if (e && e.name === "NotImplemented") return "notimpl"; throw e; }
}

test("CRAFTED: foldToneTableByte == oracle in RAM (-stack) through the fold + tone + self-test tail", () => {
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  const os = runBoundedOracle(o);
  if (os === "notimpl") { console.log("  CRAFTED: oracle hit a stubbed draw arm -- skipped"); return; }
  assert.equal(os, "done", "oracle reached its terminal self-test spin");
  if (runIdiomatic(c) === "notimpl") { console.log("  CRAFTED: idiomatic hit a stubbed draw arm -- skipped"); return; }
  assert.equal(ramDiff(o, c), null, "RAM equal after the fold + tail");
  assert.equal(c.mem.read8(SEG_SPREAD_A_LO_1), (A_IN ^ 0x3c) & 0xff, "SEG_SPREAD_A_LO_1 = the folded byte");
  assert.equal(c.mem.read8(SEG_SPREAD_A_LO_1), o.mem.read8(SEG_SPREAD_A_LO_1), "SEG_SPREAD_A_LO_1 matches the oracle");
});

test("TEETH: a twin that drops the fold MUST diverge in RAM", () => {
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  const os = runBoundedOracle(o);
  if (os === "notimpl") { console.log("  TEETH: oracle hit a stubbed draw arm -- skipped"); return; }
  assert.equal(os, "done");
  // Broken twin: skip the eor fold -> SEG_SPREAD_A_LO_1 becomes A_IN instead of A_IN^byte. Since byte (0x3c) is
  // nonzero, this changes SEG_SPREAD_A_LO_1 and the RAM compare must catch it.
  let tried = 0;
  const broken = (m) => {
    // run the real d92f then revert SEG_SPREAD_A_LO_1 to what the no-fold path would leave:
    if (runIdiomatic(m) === "notimpl") return false;
    m.mem.write8(SEG_SPREAD_A_LO_1, A_IN & 0xff); // BUG: as if the fold never happened
    tried++;
    return true;
  };
  if (!broken(c)) { console.log("  TEETH: idiomatic hit a stubbed draw arm -- skipped"); return; }
  assert.ok(tried > 0);
  assert.notEqual(ramDiff(o, c), null, "the dropped fold was NOT caught by the RAM compare");
});
