// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for loc_d8ca / loc_d8cd -- the power-on tone-and-delay. It stores its input byte at
// loc_79, then drives POKEY chip-0 (loc_60c0/loc_60c1/loc_60e0) through a descending run of tone bursts,
// each burst draining a fixed count while strobing the watchdog loc_5000, and TAIL-DELEGATES to the
// checksum/self-test at loc_da0a. Its only work-RAM write is loc_79 (the POKEY/LED/watchdog cells are I/O,
// not captured by dumpState); da0a's writes follow. The oracle's inner drains busy-wait on the 3kHz clock
// bit of loc_c00, which advances only as the oracle steps cycles, so the oracle terminates naturally; the
// idiomatic layer has no clock and drains by count. Contract: RAM (dumpState minus STACK_SCRATCH). No
// live-out register (the routine tail-delegates; the exit registers belong to da0a's chain). Because the
// tail (da0a -> da62) never returns in the oracle, the oracle is run under a cycle BUDGET so its terminal
// spin trips FramesComplete. Oracle is the frozen translated loc_d8ca.
// Run: node --test games/tempest/idiomatic/test/equivalence-d8ca.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_d8ca as oracle } from "../../translated/loc_d8ca.js";
import { loc_d8ca } from "../loc_d8ca.js";
import { Machine, FramesComplete, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  loc_79, loc_1c9, loc_2e, loc_2f, loc_78,
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

const TARGET = 0xd8ca;
const BUDGET = 40000000; // > the tone drains + the checksum walk + a single self-test frame; the spin then trips FramesComplete
const INPUT = 4; // -> passes = 2 (both the count!=0 and count==0 burst branches run); low nibble nonzero
const inDeadStack = (a) => a != null && a >= STACK_SCRATCH.lo && a < STACK_SCRATCH.hi;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);

// The oracle drains on the 3kHz clock and its tail (da0a -> da62) never returns, so run it under a cycle
// budget with the periodic IRQ quiesced. "done" = the tail reached its terminal spin; "notimpl" = a still-
// stubbed draw arm in the tail.
function runBoundedOracle(m) {
  m.regs.a = INPUT;
  m.nextIrqCycle = Infinity;
  m.maxCycles = m.cycles + BUDGET;
  try { oracle(m); return "returned"; }
  catch (e) {
    if (e instanceof FramesComplete) return "done";
    if (e && e.name === "NotImplemented") return "notimpl";
    throw e;
  }
}
function runIdiomatic(m) {
  try { loc_d8ca(m, INPUT); return "returned"; }
  catch (e) {
    if (e && e.name === "NotImplemented") return "notimpl";
    throw e;
  }
}

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* power-on tone: not reached in a normal boot; keep any caps */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(4, 3000) : [];

// The tail frame's per-frame emit counter (loc_2e/loc_2f) and a cleared request so da62 builds a real
// frame before its exit poll -- mirrors the tail seed da0a needs.
function seedTail(m) {
  m.mem.write8(loc_1c9, 0x00);
  m.mem.write8(loc_2e, 0x37);
  m.mem.write8(loc_2f, 0x12);
  m.mem.write8(loc_78 + 0x01, 0x01);
}

test("CAPTURE: real 0xd8ca dispatches -- loc_d8ca == oracle in RAM (-stack)", () => {
  // The power-on tone is not dispatched in a normal boot, so 0 captures is expected and tolerated.
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

test("CRAFTED: tone drains + tail checksum/frame -- RAM equal (-stack)", () => {
  const o = new Machine(ROM, OPTS); seedTail(o);
  const c = new Machine(ROM, OPTS); seedTail(c);
  const os = runBoundedOracle(o);
  if (os === "notimpl") { console.log("  CRAFTED: oracle hit a stubbed draw arm in the tail -- skipped"); return; }
  assert.equal(os, "done", "oracle reached its terminal spin (tone + checksum + frame completed)");
  if (runIdiomatic(c) === "notimpl") { console.log("  CRAFTED: idiomatic hit a stubbed draw arm in the tail -- skipped"); return; }
  assert.equal(ramDiff(o, c), null, "RAM equal after the tone drains, checksum walk, settle, and one tail frame");
  // The routine's own signature RAM write.
  assert.equal(c.mem.read8(loc_79), INPUT, "the input byte was stored at loc_79");
  assert.equal(c.mem.read8(loc_79), o.mem.read8(loc_79), "loc_79 matches the oracle");
});

test("TEETH: a twin that drops the loc_79 store MUST diverge in RAM", () => {
  const o = new Machine(ROM, OPTS); seedTail(o);
  const c = new Machine(ROM, OPTS); seedTail(c);
  const os = runBoundedOracle(o);
  if (os === "notimpl") { console.log("  TEETH: oracle hit a stubbed draw arm in the tail -- skipped"); return; }
  assert.equal(os, "done");
  // Broken twin: run the real routine, then revert loc_79 -- the one work-RAM byte the routine always
  // writes. The RAM compare MUST catch it; proves the test can fail.
  let tried = 0;
  const broken = (m) => {
    const before = m.mem.read8(loc_79);
    if (runIdiomatic(m) === "notimpl") return false;
    m.mem.write8(loc_79, before); // BUG: undo the loc_79 store
    tried++;
    return true;
  };
  if (!broken(c)) { console.log("  TEETH: idiomatic hit a stubbed draw arm in the tail -- skipped"); return; }
  assert.ok(tried > 0, "the broken twin actually ran");
  assert.notEqual(ramDiff(o, c), null, "the dropped loc_79 store was NOT caught by the RAM compare");
});

test("SP-TOOTH: the omitted-ret tail-delegator is seam-placeable", () => {
  // The oracle seats a return then tail-transfers to loc_da0a; the idiomatic form omits its ROM ret and
  // never touches the stack, so the seam must place it (SP unmoved). The tail chain (da0a -> da62) leaves its
  // per-frame loop when the self-test switch (loc_c00 bit4) reads set; that bit is ACTIVE-LOW and idle-high,
  // so the default readIn0 (0x3f) already carries it -- the idiomatic tail returns after one pass with no port
  // poke. loc_c00 is a READ-ONLY input port, so we must NOT mem.write8 it (that throws UnmappedAccess). Probe
  // first without the seam and skip if a stubbed draw arm throws downstream.
  const probe = new Machine(ROM, OPTS); seedTail(probe);
  let notimpl = false;
  try { loc_d8ca(probe.clone(), INPUT); }
  catch (e) { if (e && e.name === "NotImplemented") notimpl = true; else throw e; }
  if (notimpl) { console.log("  SP-TOOTH: idiomatic tail hit a stubbed draw arm -- skipped"); return; }

  const m = new Machine(ROM, OPTS); seedTail(m);
  m.regs.a = INPUT;
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12); // a real caller-return word for the seam
  const r = seamPlaceable(withOmittedRet, loc_d8ca, TARGET, m);
  assert.equal(r.placeable, true, `loc_d8ca must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret tail-delegator placeable");
});
