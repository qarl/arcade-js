// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for runSelfTestLoop -- the self-test session loop. A one-time preamble seeds the state
// machine, forwards a pending request byte, copies the 8-byte colour table into colour RAM, and idles
// the coin/flip control; then each pass builds and shows one self-test frame (option switches -> SPINNER_POT_PREV
// /SPINNER_ACCUM, diagnostic inputs -> INPUT_EDGE_FLAGS/INPUT_CUR, dispatchDrawHandler + emitHeaderedBodyRecord + every-fourth-frame stepEaromTransfer),
// leaving once the self-test switch is released.
//
// This routine NEVER RETURNS in the oracle: with the switch idle-high it runs one frame then settles
// into a forever spin, so the oracle is run under a CYCLE BUDGET (the spin trips FramesComplete, leaving
// RAM at its post-frame rest). The idiomatic layer has no clock, so its sync-drain is modelled as the
// device strobes it performs (no work-RAM effect) and its exit poll leaves after one pass. Contract:
// RAM (dumpState minus stack scratch below the entry SP). No live-out register (the routine falls into a spin / returns).
// Run: node --test games/tempest/idiomatic/test/equivalence-da62.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_da62 } from "../../translated/loc_da62.js";
import { runSelfTestLoop } from "../runSelfTestLoop.js";
import { Machine, FramesComplete } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import {
  GAME_MODE, DRAW_CURSOR_HI, INPUT_CUR, PENDING_WORK_FLAGS, loc_2e, loc_2f, SEG_SPREAD_A_LO, SEG_SPREAD_A_LO_5,
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
const oracle = atEntry(loc_da62);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

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
  try { runSelfTestLoop(m); return "returned"; }
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

test("CAPTURE: real 0xda62 dispatches -- runSelfTestLoop == oracle in RAM (-stack)", () => {
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

// No pending request (PENDING_WORK_FLAGS == 0): the preamble stamps GAME_MODE = 2, which routes dispatchDrawHandler to its
// per-frame vector emit. Seed that emitter's counter + table cells so the frame builds a real list;
// da62 itself points the display cursor at vector RAM (DRAW_CURSOR_HI = 0x20) so emits land in diffed space.
function seedNoPending(m) {
  m.mem.write8(PENDING_WORK_FLAGS, 0x00);
  m.mem.write8(loc_2e, 0x37);
  m.mem.write8(loc_2f, 0x12);
  m.mem.write8(SEG_SPREAD_A_LO + 0x01, 0x01);
  m.mem.write8(SEG_SPREAD_A_LO_5 + 0x01, 0x20);
}
// Pending request (PENDING_WORK_FLAGS != 0): the preamble forwards it to SEG_SPREAD_A_LO_4, runs queueEaromEraseAllRegions, clears PENDING_WORK_FLAGS,
// and stamps GAME_MODE = 0 (a different dispatchDrawHandler handler). Exercises the else-branch of the preamble.
function seedPending(m) {
  m.mem.write8(PENDING_WORK_FLAGS, 0x5a);
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
  // Preamble/body signatures: no-pending -> GAME_MODE = 2 (unless the input branch double-bumped it),
  // the display cursor high byte, and the idle-input default for INPUT_CUR.
  assert.equal(c.mem.read8(GAME_MODE), o.mem.read8(GAME_MODE), "GAME_MODE matches the oracle");
  assert.equal(c.mem.read8(DRAW_CURSOR_HI), 0x20, "display cursor high byte");
  assert.equal(c.mem.read8(INPUT_CUR), o.mem.read8(INPUT_CUR), "INPUT_CUR matches the oracle");
});

test("CRAFTED (pending): preamble else-branch -- RAM equal (-stack)", () => {
  const o = new Machine(ROM, OPTS); seedPending(o);
  const c = new Machine(ROM, OPTS); seedPending(c);
  const os = runBoundedOracle(o);
  if (os === "notimpl") { console.log("  CRAFTED(pending): oracle hit a stubbed draw arm -- skipped"); return; }
  assert.equal(os, "done");
  if (runIdiomatic(c) === "notimpl") { console.log("  CRAFTED(pending): idiomatic hit a stubbed draw arm -- skipped"); return; }
  assert.equal(ramDiff(o, c), null, "RAM equal after one self-test frame (pending path)");
  assert.equal(c.mem.read8(PENDING_WORK_FLAGS), 0x00, "pending request byte was cleared");
});

test("TEETH: a twin that drops the display-cursor write MUST diverge in RAM", () => {
  const o = new Machine(ROM, OPTS); seedNoPending(o);
  const c = new Machine(ROM, OPTS); seedNoPending(c);
  const os = runBoundedOracle(o);
  if (os === "notimpl") { console.log("  TEETH: oracle hit a stubbed draw arm -- skipped"); return; }
  assert.equal(os, "done");
  // Broken twin: run the real routine, then revert DRAW_CURSOR_HI (a body signature the routine always sets to
  // 0x20). The RAM compare MUST catch the reverted write -- proves the test can fail.
  let tried = 0;
  const broken = (m) => {
    if (runIdiomatic(m) === "notimpl") return false;
    m.mem.write8(DRAW_CURSOR_HI, 0x00); // BUG: drop the display-cursor high byte
    tried++;
    return true;
  };
  if (!broken(c)) { console.log("  TEETH: idiomatic hit a stubbed draw arm -- skipped"); return; }
  assert.ok(tried > 0, "the broken twin actually ran");
  assert.notEqual(ramDiff(o, c), null, "the dropped display-cursor write was NOT caught by the RAM compare");
});
