// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_14f3 — memory-equivalent to the frozen oracle at ROM 0x14f3.
 * Gated prescaler cascade over three work-RAM bytes (0x4218 outer, 0x4219 inner, 0x421a the 0..7
 * counter, all in the state dump). No register or io live-out — the routine reads its inputs from RAM
 * and writes RAM — so a memory-only diff is the complete live-out. We exercise every branch:
 *   - GATE CLEAR: 0x4200 bit0 clear -> bail, nothing touched.
 *   - INHIBIT SET: 0x422b bit0 set -> bail, nothing touched.
 *   - OUTER NO-WRAP: outer decrements and stops.
 *   - INNER TICK: outer wraps -> reload 60, inner decrements.
 *   - STEP INC: both wrap, counter < 7 -> reloads + counter++.
 *   - STEP AT 7: both wrap, counter == 7 -> reloads, counter held.
 *   - STEP CLAMP: both wrap, counter > 7 -> reloads, counter pinned to 7.
 * EQUAL asserts ramDiff==null on all seven, each with a non-vacuous positive control. Teeth: a no-op
 * twin and a wrong-reload twin diverge. The return-stack window is masked by ramDiff.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { craft, ramDiff, romsPresent } from "./_bootSetup.js";
import { loc_14f3 as cand } from "../loc_14f3.js";
import { loc_14f3 as oracle } from "../../translated/loc_14f3.js";

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const GATE = 0x4200, INHIBIT = 0x422b, OUTER = 0x4218, INNER = 0x4219, STEP = 0x421a;

// Open the gate (bit0 set) and clear the inhibit; the caller sets the three counters.
const open = (mem, mm) => { mm.push16(0x9999); mem[GATE] = 0x01; mem[INHIBIT] = 0x00; };

const gateClear = () => craft((mem, mm) => { open(mem, mm); mem[GATE] = 0x00; mem[OUTER] = 0x05; });
const inhibitSet = () => craft((mem, mm) => { open(mem, mm); mem[INHIBIT] = 0x01; mem[OUTER] = 0x05; });
const outerRun = () => craft((mem, mm) => { open(mem, mm); mem[OUTER] = 0x05; });
const innerTick = () => craft((mem, mm) => { open(mem, mm); mem[OUTER] = 0x01; mem[INNER] = 0x05; });
const stepInc = () => craft((mem, mm) => { open(mem, mm); mem[OUTER] = 0x01; mem[INNER] = 0x01; mem[STEP] = 0x03; });
const stepAt7 = () => craft((mem, mm) => { open(mem, mm); mem[OUTER] = 0x01; mem[INNER] = 0x01; mem[STEP] = 0x07; });
const stepClamp = () => craft((mem, mm) => { open(mem, mm); mem[OUTER] = 0x01; mem[INNER] = 0x01; mem[STEP] = 0x40; });

const noOp = () => {};
// Ticks the outer correctly but reloads it with the wrong value on wrap.
const wrongReload = (m) => { const o = (m.mem8[OUTER] - 1) & 0xff; m.mem8[OUTER] = o; if (o !== 0) return; m.mem8[OUTER] = 59; };

test("EQUAL (crafted): loc_14f3 == oracle bails when gated off", { skip }, () => {
  assert.equal(ramDiff(oracle, cand, gateClear()), null, "loc_14f3 diverged on the closed gate");
  assert.equal(ramDiff(oracle, cand, inhibitSet()), null, "loc_14f3 diverged on the inhibit flag");
  let a = gateClear(); oracle(a);
  assert.equal(a.mem8[OUTER], 0x05, "positive control: gate clear -> outer untouched");
  a = inhibitSet(); oracle(a);
  assert.equal(a.mem8[OUTER], 0x05, "positive control: inhibit set -> outer untouched");
  console.log("  EQUAL: loc_14f3 == oracle (RAM), both gates bail without ticking");
});

test("EQUAL (crafted): loc_14f3 == oracle ticks the prescaler cascade", { skip }, () => {
  assert.equal(ramDiff(oracle, cand, outerRun()), null, "loc_14f3 diverged on the outer tick");
  assert.equal(ramDiff(oracle, cand, innerTick()), null, "loc_14f3 diverged on the inner tick");
  let a = outerRun(); oracle(a);
  assert.equal(a.mem8[OUTER], 0x04, "positive control: outer must decrement");
  a = innerTick(); oracle(a);
  assert.equal(a.mem8[OUTER], 60, "positive control: outer must reload on wrap");
  assert.equal(a.mem8[INNER], 0x04, "positive control: inner must decrement on outer wrap");
  console.log("  EQUAL: loc_14f3 == oracle (RAM), outer/inner prescalers cascade");
});

test("EQUAL (crafted): loc_14f3 == oracle steps and clamps the 0..7 counter", { skip }, () => {
  assert.equal(ramDiff(oracle, cand, stepInc()), null, "loc_14f3 diverged on the counter increment");
  assert.equal(ramDiff(oracle, cand, stepAt7()), null, "loc_14f3 diverged at the ceiling");
  assert.equal(ramDiff(oracle, cand, stepClamp()), null, "loc_14f3 diverged on the clamp");
  let a = stepInc(); oracle(a);
  assert.equal(a.mem8[STEP], 0x04, "positive control: counter must increment below the ceiling");
  a = stepAt7(); oracle(a);
  assert.equal(a.mem8[STEP], 0x07, "positive control: counter held at the ceiling");
  a = stepClamp(); oracle(a);
  assert.equal(a.mem8[STEP], 0x07, "positive control: over-ceiling counter pinned to 7");
  console.log("  EQUAL: loc_14f3 == oracle (RAM), counter steps up and clamps at 7");
});

test("TEETH: broken twins are caught", { skip }, () => {
  assert.ok(ramDiff(oracle, noOp, outerRun()), "the no-op twin escaped");
  assert.ok(ramDiff(oracle, wrongReload, innerTick()), "the wrong-reload twin escaped");
  console.log("  TEETH: no-op and wrong-reload caught (RAM)");
});
