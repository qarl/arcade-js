// SPDX-License-Identifier: GPL-3.0-only
// also gates: 0x3907 buildObjectShadowEntry
// Memory-equivalence for the 0x3871 interrupt front, which has TWO entries the frozen oracle dispatches:
//   * 0x3871 -> serviceFrameIrq: pulse the coin sound latch, bump the frame + packed-decimal counters on
//     the 32V beat, read both trackball axes into their accumulators, normalize the current object, then
//     drop into the shadow builder.  <- the module's MAIN fn.
//   * 0x3907 -> buildObjectShadowEntry: one pass of the per-object shadow refresh (index in X).
// SP is RETIRED: the interrupt fires as a direct call, so the idiomatic chain neither pushes a register
// frame (serviceFrameIrq entry) nor pulls+RTIs (the tail) -- it leaves SP INERT, deliberately diverging
// from the oracle, which still runs the push/pull/RTI chain. So the arms assert SP is inert, not that it
// matches the oracle. CAPTURE replays every real dispatch of both entries; TEETH proves the RAM diff and
// the SP-inert invariant bite.
// Run: node --test games/centiped/idiomatic/test/equivalence-3871.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_3871 as oracleService, loc_3907 as oracleBuild } from "../../translated/loc_3871.js";
import { serviceFrameIrq, buildObjectShadowEntry } from "../serviceFrameIrq.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, loc_bb, SHADOW_SIGN_LATCH, loc_bd } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const SERVICE = 0x3871;
const BUILD = 0x3907;
const inDeadStack = (a) => a != null && a >= STACK_SCRATCH.lo && a < STACK_SCRATCH.hi;

// The interrupt tail (loc_396d) stores each axis's RAW $0c00,X sample into $bd,X for next frame's delta.
// $0c00 (IN0) bit6 is the screen VBLANK, which the Machine recomputes from m.cycles on every tick (see
// machine.js tick(): io.vblank = cycles%FRAME >= VBLANK_START). The full IRQ handler spans ~2525 cycles --
// wider than the 1575-cycle VBLANK window -- so on the 32V-beat dispatches the oracle ENTERS during vblank
// (bit6=1, running the frame-counter path) and EXITS after it (bit6=0), stamping $bd with bit6 clear. The
// clock-free idiomatic layer reads a frozen $0c00 (bit6 still 1), so $bd,x for x=0 ($bd) diverges ONLY in
// that one clock-derived vblank bit -- a dead bit (only the low nibble feeds the trackball delta). We
// neutralize exactly that engine-level clock variable on BOTH sides before the diff (the vblank analog of
// 28bf's pinRng holding the POKEY poly at origin); every other bit, and every other cell, is still compared.
function neutralizeVblankShadow(m) { m.mem8[loc_bd] &= ~0x40; return m; }
const ramDiff = (ma, mb) =>
  firstStateDiff(
    neutralizeVblankShadow(ma).dumpState(),
    neutralizeVblankShadow(mb).dumpState(),
    (off) => ma.stateOffsetToAddr(off),
    inDeadStack,
  );

function captureDispatches(TARGET, oracle, K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS_SERVICE = ROM_PRESENT ? captureDispatches(SERVICE, oracleService, 96, 4000) : [];
const CAPS_BUILD = ROM_PRESENT ? captureDispatches(BUILD, oracleBuild, 160, 4000) : [];

test("CAPTURE: real 0x3871 dispatches == serviceFrameIrq in RAM (-stack)", () => {
  for (const cap of CAPS_SERVICE) {
    const o = cap.clone(), c = cap.clone();
    oracleService(o); serviceFrameIrq(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(c.regs.s, cap.regs.s, "SP inert -- the rewrite never touches the stack");
  }
  console.log(`  CAPTURE(service): ${CAPS_SERVICE.length} dispatch(es) checked`);
});

test("CAPTURE: real 0x3907 dispatches == buildObjectShadowEntry in RAM (-stack), across object indices", () => {
  const seen = new Set();
  for (const cap of CAPS_BUILD) {
    seen.add(cap.regs.x & 0xff);
    const o = cap.clone(), c = cap.clone();
    oracleBuild(o); buildObjectShadowEntry(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(c.regs.s, cap.regs.s, "SP inert -- the rewrite never touches the stack");
  }
  // The loop walks X from 0x0f down, so both the high-slot (>=12) and low-slot arms are exercised.
  console.log(`  CAPTURE(build): ${CAPS_BUILD.length} dispatch(es), ${seen.size} distinct index(es)`);
});

test("TEETH: a skipped accumulator write is caught by the RAM diff (service entry)", () => {
  const cap = CAPS_SERVICE[0].clone();
  const o = cap.clone(), c = cap.clone();
  oracleService(o); serviceFrameIrq(c);
  assert.equal(ramDiff(o, c), null, "precondition: the rewrite matches");
  const broken = (m) => { serviceFrameIrq(m); m.mem8[loc_bb] = (m.mem8[loc_bb] + 1) & 0xff; };
  const c2 = cap.clone();
  broken(c2);
  const d = ramDiff(o, c2);
  assert.notEqual(d, null, "the RAM diff FAILED to catch a one-off in the accumulator");
  assert.equal(d.addr, loc_bb & 0xffff);
});

test("TEETH: a wrong sign latch is caught by the RAM diff (build entry)", () => {
  const cap = CAPS_BUILD[0].clone();
  const o = cap.clone(), c = cap.clone();
  oracleBuild(o); buildObjectShadowEntry(c);
  assert.equal(ramDiff(o, c), null, "precondition: the rewrite matches");
  const broken = (m) => { buildObjectShadowEntry(m); m.mem8[SHADOW_SIGN_LATCH] = (m.mem8[SHADOW_SIGN_LATCH] ^ 0x80) & 0xff; };
  const c2 = cap.clone();
  broken(c2);
  const d = ramDiff(o, c2);
  assert.notEqual(d, null, "the RAM diff FAILED to catch a wrong sign latch");
  assert.equal(d.addr, SHADOW_SIGN_LATCH & 0xffff);
});

test("TEETH(SP): both entries are SP-inert; a stray stack touch is caught", () => {
  for (const [cap, fn] of [
    [CAPS_SERVICE[0], serviceFrameIrq],
    [CAPS_BUILD[0], buildObjectShadowEntry],
  ]) {
    const base = cap.clone();
    const entrySP = base.regs.s;
    const c = base.clone();
    fn(c);
    assert.equal(c.regs.s, entrySP, "precondition: the rewrite leaves SP inert (fired as a direct call)");
    const leaky = (m) => { m.push8(0x00); return fn(m); };
    const c2 = base.clone();
    leaky(c2);
    assert.notEqual(c2.regs.s, entrySP, "the SP-inert tooth FAILED to catch a stray push");
  }
});
