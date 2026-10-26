// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for countStepsToThreshold (ROM 0x1554) -- the scale/count helper. Count in C the 0x10 steps
// that lift A to/above threshold H; a negative A is pre-normalized via the dissolved 0x1590. Live-out:
// A (residual) AND C (step count), both read back by the callers scaleXToBlock/scaleYToBlock. No RAM write, so
// the contract is the (A, C) live-out (RAM diff stays null, minus the oracle's transient cnc push).
// Run: node --test games/invaders/idiomatic/test/equivalence-1554.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1554 as oracleBody } from "../../translated/loc_1554.js";
import { countStepsToThreshold } from "../countStepsToThreshold.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { entered, ramDiff } from "./_liveStack.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x1554;

// Reference: mirror the oracle -- pre-normalize a negative A (>= H) via the 0x1590 do-while, then step
// 0x10 at a time while A is below H, counting every step in C.
const expect = (a, h) => {
  let c = 0;
  if (a >= h) { do { c = (c + 1) & 0xff; a = (a + 0x10) & 0xff; } while (a & 0x80); }
  while (a < h) { a = (a + 0x10) & 0xff; c = (c + 1) & 0xff; }
  return [a, c];
};

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x1554 dispatches -- countStepsToThreshold == oracle in RAM (-stack) and A/C", () => {
  for (const cap of CAPS) {
    // The oracle's `cnc 0x1590` pushes a return word just below the ENTRY SP; the module never touches
    // the stack, so exclude relative to that SP, not the fixed window.
    const sp = cap.regs.sp;
    const capDiff = (ma, mb) => firstStateDiff(ma.dumpState(), mb.dumpState(),
      (off) => ma.stateOffsetToAddr(off), (a) => a != null && a >= sp - 0x10 && a < sp);
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); countStepsToThreshold(c);
    assert.equal(capDiff(o, c), null);
    assert.equal(c.regs.a, o.regs.a, "A live-out matches the oracle");
    assert.equal(c.regs.c, o.regs.c, "C live-out matches the oracle");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: C counts the steps and A lands >= H, across cnc-skip / cnc-fire paths", () => {
  const cases = [
    { a: 0x00, h: 0x30 }, // A < H: pure loop, 3 steps
    { a: 0x30, h: 0x30 }, // A == H at entry: cnc fires, 0x1590 bumps once
    { a: 0x40, h: 0x20 }, // A >= H non-negative: cnc fires, one 0x1590 step, loop exits
    { a: 0x80, h: 0x10 }, // A negative: 0x1590 normalizes up, then the loop tops it off
    { a: 0xf0, h: 0x08 }, // deep negative
    { a: 0x00, h: 0x00 }, // A == H == 0: cnc fires (NC), 0x1590 runs once
  ];
  for (const { a, h } of cases) {
    // Set the ENTRY carry on both sides: the oracle exits carry CLEAR (via rnc), and a carry-DROPPING
    // rewrite would leak this 1 -- so this arm catches the missing carry live-out (SBI 0x10 in callers).
    const o = new Machine(ROM); o.regs.a = a; o.regs.h = h; o.regs.sp = 0x2400; o.regs.fC = true;
    const cc = new Machine(ROM); cc.regs.a = a; cc.regs.h = h; cc.regs.sp = 0x2400; cc.regs.fC = true;
    oracle(o);
    const ret = countStepsToThreshold(cc);
    const [ea, ec] = expect(a, h);
    const tag = `A=0x${a.toString(16)} H=0x${h.toString(16)}`;
    assert.equal(ramDiff(o, cc), null, tag);
    assert.equal(cc.regs.a, ea, `A residual: ${tag}`);
    assert.equal(cc.regs.c, ec, `C step count: ${tag}`);
    assert.deepEqual(ret, [ea, ec, false], `tuple return (incl. carry-clear): ${tag}`);
    assert.equal(cc.regs.a, o.regs.a, `A matches oracle: ${tag}`);
    assert.equal(cc.regs.c, o.regs.c, `C matches oracle: ${tag}`);
    assert.equal(cc.regs.fC, o.regs.fC, `carry-out matches oracle: ${tag}`);
    assert.equal(cc.regs.fC, false, `carry cleared on exit (live-out to sbi callers): ${tag}`);
  }
});

test("TEETH: a broken twin (0x08 step instead of 0x10) diverges in A/C", () => {
  const a = 0x00, h = 0x30;
  const o = new Machine(ROM); o.regs.a = a; o.regs.h = h; o.regs.sp = 0x2400;
  oracle(o);
  // broken twin of countStepsToThreshold: wrong step size
  let ba = a, bc = 0;
  if (ba >= h) { do { bc = (bc + 1) & 0xff; ba = (ba + 0x08) & 0xff; } while (ba & 0x80); }
  while (ba < h) { ba = (ba + 0x08) & 0xff; bc = (bc + 1) & 0xff; }
  assert.ok(ba !== o.regs.a || bc !== o.regs.c,
    "the A/C live-out check FAILED to catch the wrong step size");
});
