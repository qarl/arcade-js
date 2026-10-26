// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for returnConstantTwo (ROM 0xb955-0xb966) -- reads $57, counts leading right-shifts into Y,
// then THROWS THAT COUNT AWAY: the loop leaves A==0, `clc; adc #2` forces A=2, and a final `ldy #0` clears
// Y. So the routine returns the constant pair A=2, Y=0 for ANY $57 and touches no memory. It writes no
// RAM (RAM diff is vacuously null); the live-out is the registers A and Y, which the idiomatic form
// RETURNS as [a, y]. Each arm asserts the returned pair equals the oracle's resulting regs (and, for
// completeness, that RAM is unchanged on both sides). No POKEY read; fully deterministic.
// Run: node --test games/tempest/idiomatic/test/equivalence-b955.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_b955 } from "../../translated/loc_b955.js";
import { returnConstantTwo } from "../returnConstantTwo.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const opt = (name) => {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
};
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xb955;
const oracle = atEntry(loc_b955);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0xb955 dispatches -- returned [A,Y] == oracle regs, RAM unchanged", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o);
    const [a, y] = returnConstantTwo(c);
    assert.equal(a, o.regs.a, "returned A matches oracle's regs.a");
    assert.equal(y, o.regs.y, "returned Y matches oracle's regs.y");
    assert.equal(ramDiff(o, c), null, "no RAM change on either side");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: A=2, Y=0 for every $57 (count is discarded) == oracle", () => {
  // Non-default $57 values exercise the (discarded) shift-count loop; output must stay constant.
  for (const s57 of [0x00, 0x01, 0x0f, 0x80, 0xf0, 0xff, 0x5a]) {
    const o = new Machine(ROM, OPTS); o.mem8[0x57] = s57;
    const c = new Machine(ROM, OPTS); c.mem8[0x57] = s57;
    oracle(o);
    const [a, y] = returnConstantTwo(c);
    assert.equal(a, o.regs.a, `$57=0x${s57.toString(16)}: returned A matches oracle`);
    assert.equal(y, o.regs.y, `$57=0x${s57.toString(16)}: returned Y matches oracle`);
    assert.equal(a, 0x02, `$57=0x${s57.toString(16)}: A is the constant 2`);
    assert.equal(y, 0x00, `$57=0x${s57.toString(16)}: Y is the constant 0`);
    assert.equal(ramDiff(o, c), null, `$57=0x${s57.toString(16)}: RAM unchanged`);
  }
});

test("TEETH: a twin that returns the (discarded) shift-count instead of 2 diverges from the oracle", () => {
  const s57 = 0xf0; // non-default: the shift count (leading-bit position) is > 0, so returning it != 2
  const o = new Machine(ROM, OPTS); o.mem8[0x57] = s57;
  oracle(o);
  // BUG: a rewrite that returned Y = count of shifts (here 4 for 0xf0>>4 = 0x0f) instead of clearing it,
  // and A = that count, would not match the oracle's forced constants.
  let a = s57 >> 4, count = 0;
  do { count++; a >>= 1; } while (a !== 0);
  const brokenA = count; // != 2
  assert.notEqual(brokenA, o.regs.a, "the A compare FAILED to catch a routine returning the shift-count");
  assert.notEqual(count, o.regs.y, "the Y compare FAILED to catch a non-zero returned count");
});
