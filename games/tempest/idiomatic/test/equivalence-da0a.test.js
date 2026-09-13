// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for loc_da0a -- the power-on ROM-checksum + POKEY entropy settle. It walks 12 ROM
// banks (8 pages each), XORing every byte into a per-bank checksum seeded with the bank index, strobing
// the watchdog (loc_5000) each page; the 12 checksums land at loc_7d..loc_88 and a nonzero bank-0 checksum
// arms the error tone (loc_60c4/loc_60c5). It then settles each POKEY random register (loc_60ca->loc_7a,
// loc_60da->loc_7b): sample once, store only if six consecutive re-reads all match. Control TAIL-DELEGATES
// to loc_da62 (the self-test session loop), which never returns in the oracle -- with the switch idle it
// runs one frame then spins, so the oracle is run under a CYCLE BUDGET and its spin trips FramesComplete,
// leaving RAM at its post-frame rest. The idiomatic layer has no clock, so its tail returns after one pass.
// Contract: RAM (dumpState minus STACK_SCRATCH). No live-out register (the routine tail-delegates; the exit
// registers belong to loc_da62's chain). Oracle is the frozen translated loc_da0a.
// Run: node --test games/tempest/idiomatic/test/equivalence-da0a.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_da0a as oracle } from "../../translated/loc_da0a.js";
import { loc_da0a } from "../loc_da0a.js";
import { Machine, FramesComplete, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  loc_2e, loc_2f, loc_78, loc_7a, loc_7b, loc_7d, loc_1c9,
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

const TARGET = 0xda0a;
const BUDGET = 3000000; // > the checksum walk + a single self-test frame; the terminal spin then trips FramesComplete
const inDeadStack = (a) => a != null && a >= STACK_SCRATCH.lo && a < STACK_SCRATCH.hi;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);

// The oracle tail-falls into loc_da62, which never returns; run it under a cycle budget so its terminal
// spin trips FramesComplete. "done" = the checksum + frame completed and the spin was reached; "notimpl"
// = a still-stubbed draw arm in the tail.
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
  try { loc_da0a(m); return "returned"; }
  catch (e) {
    if (e && e.name === "NotImplemented") return "notimpl";
    throw e;
  }
}

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* self-test off: da0a is not reached; keep any caps */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(4, 3000) : [];

test("CAPTURE: real 0xda0a dispatches -- loc_da0a == oracle in RAM (-stack)", () => {
  // Self-test is off in a normal boot, so da0a is typically never dispatched (0 captures tolerated).
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

// da0a initializes its own pointer/counter cells, so a fresh machine already exercises the full checksum
// walk. Seed the tail's per-frame emit counter (loc_2e/loc_2f) and clear any pending request so loc_da62
// builds a real frame before its exit poll.
function seed(m) {
  m.mem.write8(loc_1c9, 0x00);
  m.mem.write8(loc_2e, 0x37);
  m.mem.write8(loc_2f, 0x12);
  m.mem.write8(loc_78 + 0x01, 0x01);
}

test("CRAFTED: full checksum walk + settle + tail frame -- RAM equal (-stack)", () => {
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  const os = runBoundedOracle(o);
  if (os === "notimpl") { console.log("  CRAFTED: oracle hit a stubbed draw arm in the tail -- skipped"); return; }
  assert.equal(os, "done", "oracle reached its terminal spin (checksum + frame completed)");
  if (runIdiomatic(c) === "notimpl") { console.log("  CRAFTED: idiomatic hit a stubbed draw arm in the tail -- skipped"); return; }
  assert.equal(ramDiff(o, c), null, "RAM equal after the checksum walk, settle, and one tail frame");
  // Checksum + settle signatures the routine always produces.
  assert.equal(c.mem.read8(loc_7d), o.mem.read8(loc_7d), "bank-0 checksum matches the oracle");
  assert.equal(c.mem.read8(loc_7a), o.mem.read8(loc_7a), "loc_60ca settle result matches the oracle");
  assert.equal(c.mem.read8(loc_7b), o.mem.read8(loc_7b), "loc_60da settle result matches the oracle");
});

test("TEETH: a twin that corrupts the bank-0 checksum MUST diverge in RAM", () => {
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  const os = runBoundedOracle(o);
  if (os === "notimpl") { console.log("  TEETH: oracle hit a stubbed draw arm in the tail -- skipped"); return; }
  assert.equal(os, "done");
  // Broken twin: run the real routine, then flip the bank-0 checksum at loc_7d -- a byte the routine
  // ALWAYS writes. The RAM compare MUST catch the flip; proves the test can fail.
  let tried = 0;
  const broken = (m) => {
    if (runIdiomatic(m) === "notimpl") return false;
    m.mem.write8(loc_7d, m.mem.read8(loc_7d) ^ 0xff); // BUG: corrupt the stored checksum
    tried++;
    return true;
  };
  if (!broken(c)) { console.log("  TEETH: idiomatic hit a stubbed draw arm in the tail -- skipped"); return; }
  assert.ok(tried > 0, "the broken twin actually ran");
  assert.notEqual(ramDiff(o, c), null, "the corrupted checksum was NOT caught by the RAM compare");
});

test("SP-TOOTH: the omitted-ret tail-delegator is seam-placeable", () => {
  // The oracle seats a return then tail-falls into loc_da62; the idiomatic form omits its ROM ret and never
  // touches the stack, so the seam must place it (SP unmoved). The tail (loc_da62) leaves its per-frame loop
  // when the self-test switch (loc_c00 bit4) reads set; that bit is ACTIVE-LOW and idle-high, so the default
  // readIn0 (0x3f) already carries it -- the idiomatic da62 returns after one pass with no port poke. loc_c00
  // is a READ-ONLY input port, so we must NOT mem.write8 it (that throws UnmappedAccess). Probe first without
  // the seam: if the tail hits a stubbed draw the seam cannot be probed cleanly, so skip rather than mis-read
  // a downstream throw as SP drift.
  const probe = new Machine(ROM, OPTS); seed(probe);
  let notimpl = false;
  try { loc_da0a(probe.clone()); }
  catch (e) { if (e && e.name === "NotImplemented") notimpl = true; else throw e; }
  if (notimpl) { console.log("  SP-TOOTH: idiomatic tail hit a stubbed draw arm -- skipped"); return; }

  const m = new Machine(ROM, OPTS); seed(m);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12); // a real caller-return word for the seam
  const r = seamPlaceable(withOmittedRet, loc_da0a, TARGET, m);
  assert.equal(r.placeable, true, `loc_da0a must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret tail-delegator placeable");
});
