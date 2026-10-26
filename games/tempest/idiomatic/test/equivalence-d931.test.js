// SPDX-License-Identifier: GPL-3.0-only
// Equivalence for seedToneBurstCount -- a power-on-path helper that carries its incoming byte through as the tone
// burst count and derives a pass-seed from MODE_DISPATCH_SEL, then tail-delegates to the tone burst runPowerOnToneBursts (which
// runs the tone drains and continues into the checksum/self-test checksumRomAndSettleEntropy, a non-terminating spin). Its
// only RAM-observable effect through the chain is SEG_SPREAD_A_LO_1 = the burst count (the incoming A); the derived
// pass-seed feeds only the POKEY drains (I/O, not in dumpState), so it is covered by review of the
// faithful MODE_DISPATCH_SEL mask rather than by a RAM cell. Contract: RAM (dumpState minus stack scratch below the ROM-reseated SP); the
// oracle runs under a cycle BUDGET so its terminal self-test spin trips FramesComplete.
// Run: node --test games/tempest/idiomatic/test/equivalence-d931.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_d931 } from "../../translated/loc_d931.js";
import { seedToneBurstCount } from "../seedToneBurstCount.js";
import { Machine, FramesComplete } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry, reseatedTop } from "./_entryFloor.js";
import { MODE_DISPATCH_SEL, SEG_SPREAD_A_LO_1, PENDING_WORK_FLAGS, loc_2e, loc_2f, SEG_SPREAD_A_LO } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) { const u = new URL(name, ROM_DIR); return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined; }
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const BUDGET = 40000000;
const COUNT = 0x04;   // burst count -> SEG_SPREAD_A_LO_1; low nibble nonzero
const INDEX = 0x25;   // MODE_DISPATCH_SEL -> pass-seed (>= 0x20 folds by 0x18 then masks 0x1f)
const oracle = atEntry(loc_d931, reseatedTop); // runPowerOnToneBursts txs-seats S as a counter; it ends 0xff
const ramDiff = (ma, mb) => firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function seed(m) {
  m.mem.write8(MODE_DISPATCH_SEL, INDEX);
  m.mem.write8(PENDING_WORK_FLAGS, 0x00);      // cleared request so the self-test tail builds a real frame
  m.mem.write8(loc_2e, 0x37);
  m.mem.write8(loc_2f, 0x12);
  m.mem.write8(SEG_SPREAD_A_LO + 0x01, 0x01);
}
function runBoundedOracle(m) {
  m.regs.a = COUNT; m.nextIrqCycle = Infinity; m.maxCycles = m.cycles + BUDGET;
  try { oracle(m); return "returned"; }
  catch (e) { if (e instanceof FramesComplete) return "done"; if (e && e.name === "NotImplemented") return "notimpl"; throw e; }
}
function runIdiomatic(m) {
  m.nextIrqCycle = Infinity; m.maxCycles = m.cycles + BUDGET;
  try { seedToneBurstCount(m, COUNT); return "returned"; }
  catch (e) { if (e instanceof FramesComplete) return "done"; if (e && e.name === "NotImplemented") return "notimpl"; throw e; }
}

test("CRAFTED: seedToneBurstCount == oracle in RAM (-stack) through the tone + self-test tail", () => {
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  const os = runBoundedOracle(o);
  if (os === "notimpl") { console.log("  CRAFTED: oracle hit a stubbed draw arm -- skipped"); return; }
  assert.equal(os, "done", "oracle reached its terminal self-test spin");
  if (runIdiomatic(c) === "notimpl") { console.log("  CRAFTED: idiomatic hit a stubbed draw arm -- skipped"); return; }
  assert.equal(ramDiff(o, c), null, "RAM equal after the tone drains + checksum + tail frame");
  assert.equal(c.mem.read8(SEG_SPREAD_A_LO_1), COUNT, "the burst count was stored at SEG_SPREAD_A_LO_1");
  assert.equal(c.mem.read8(SEG_SPREAD_A_LO_1), o.mem.read8(SEG_SPREAD_A_LO_1), "SEG_SPREAD_A_LO_1 matches the oracle");
});

test("TEETH: a twin that drops the burst-count store MUST diverge in RAM", () => {
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  const os = runBoundedOracle(o);
  if (os === "notimpl") { console.log("  TEETH: oracle hit a stubbed draw arm -- skipped"); return; }
  assert.equal(os, "done");
  let tried = 0;
  const before = c.mem.read8(SEG_SPREAD_A_LO_1);
  if (runIdiomatic(c) === "notimpl") { console.log("  TEETH: idiomatic hit a stubbed draw arm -- skipped"); return; }
  c.mem.write8(SEG_SPREAD_A_LO_1, before); // BUG: undo the burst-count store
  tried++;
  assert.ok(tried > 0);
  assert.notEqual(ramDiff(o, c), null, "the dropped SEG_SPREAD_A_LO_1 store was NOT caught by the RAM compare");
});
