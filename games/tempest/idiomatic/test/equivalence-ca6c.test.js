// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for addBcdScoreAndAwardAtThreshold (ROM 0xca6c-0xcaf0) -- adds a three-byte BCD amount into the $40..$42+y
// score trio, range-checks the high byte against $0156, and on a qualifying result (with a per-slot $48,x
// counter under six) bumps the counter, fires sound requestScoreAwardSound, and sets $0124. The oracle runs the translated
// sound via m.call; the idiomatic dissolves it to requestSoundIfEnabled(A=0x4f) threading the slot x and y. Live-out is
// memory plus the exit [X,Y], which the routine returns because bumpLevelEnemyQuota hands it to the award sound's loader
// (loc_31/loc_32). Both sides run on a clone; the contract is RAM (-stack) plus the returned exit registers.
// Run: node --test games/tempest/idiomatic/test/equivalence-ca6c.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_ca6c as oracle } from "../../translated/loc_ca6c.js";
import { addBcdScoreAndAwardAtThreshold } from "../addBcdScoreAndAwardAtThreshold.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, STATUS_FLAGS, loc_29, loc_2a, loc_2b, loc_3d, loc_40, loc_41, loc_42, SLOT_COUNTDOWN, RIM_COLOR_ANIM, BONUS_LIFE_INTERVAL } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xca6c;
const inDeadStack = (a) => a != null && a >= STACK_SCRATCH.lo && a < STACK_SCRATCH.hi;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 4000) : [];

test("CAPTURE: real 0xca6c dispatches -- addBcdScoreAndAwardAtThreshold == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); const [x, y] = addBcdScoreAndAwardAtThreshold(c);
    assert.equal(ramDiff(o, c), null);
    assert.deepEqual([x, y ?? c.regs.y], [o.regs.x, o.regs.y], "returned exit [X, Y] = the oracle's (Y undefined = untouched)");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// Valid-BCD seed that runs the X>=8 operand-triplet add and reaches the award+sound path.
function seed(m) {
  m.mem.write8(STATUS_FLAGS, m.mem.read8(STATUS_FLAGS) | 0x80); // gate on
  m.mem.write8(loc_3d, 0x00);   // y = 0, award slot 0
  m.mem.write8(loc_29, 0x11);   // addend low
  m.mem.write8(loc_2a, 0x22);   // addend mid
  m.mem.write8(loc_2b, 0x50);   // addend high (nonzero)
  m.mem.write8(loc_40, 0x00); m.mem.write8(loc_41, 0x00); m.mem.write8(loc_42, 0x00);
  m.mem.write8(BONUS_LIFE_INTERVAL, 0x10);  // threshold, nonzero and <= $2b
  m.mem.write8(SLOT_COUNTDOWN, 0x00);   // counter under six
  m.mem.write8(RIM_COLOR_ANIM, 0x00);
  m.regs.x = 0x08;              // >= 8 operand path
}

test("CRAFTED: BCD add lands the score, then the award bumps the counter and sets $0124", () => {
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); { const [x, y] = addBcdScoreAndAwardAtThreshold(c); assert.deepEqual([x, y ?? c.regs.y], [o.regs.x, o.regs.y], "returned exit [X, Y]"); }
  assert.equal(ramDiff(o, c), null, "RAM equal after add + award");
  assert.equal(c.mem.read8(loc_40), 0x11, "$40 score low");
  assert.equal(c.mem.read8(loc_41), 0x22, "$41 score mid");
  assert.equal(c.mem.read8(loc_42), 0x50, "$42 score high");
  assert.equal(c.mem.read8(SLOT_COUNTDOWN), 0x01, "$48 counter bumped");
  assert.equal(c.mem.read8(RIM_COLOR_ANIM), 0x20, "$0124 flag raised");
});

test("GATED: with $05 bit7 clear the routine is a no-op vs the oracle", () => {
  // Distinctive entry X/Y so an unarmed exit that invents a Y (or loses the X) shows.
  const prep = (m) => { seed(m); m.mem.write8(STATUS_FLAGS, m.mem.read8(STATUS_FLAGS) & 0x7f); m.regs.x = 0x12; m.regs.y = 0x77; };
  const o = new Machine(ROM, OPTS); prep(o);
  const c = new Machine(ROM, OPTS); prep(c); c.regs.x = 0xa5; c.regs.y = 0xa5;
  oracle(o);
  assert.deepEqual([o.regs.x, o.regs.y], [0x12, 0x77], "positive control: the oracle leaves the entry pair");
  { const [x, y] = addBcdScoreAndAwardAtThreshold(c, 0x12);
    assert.equal(y, undefined, "unarmed exit leaves Y untouched (returns undefined)");
    assert.deepEqual([x, y ?? 0x77], [o.regs.x, o.regs.y], "returned exit [X, entry Y]"); }
  assert.equal(ramDiff(o, c), null, "RAM equal on the gated-off path");
  assert.equal(c.mem.read8(loc_40), 0x00, "score untouched when gated off");
});

test("TEETH: mutating an addend byte makes the idiomatic diverge from the oracle", () => {
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o);
  c.mem.write8(loc_29, 0x33); // non-default: different low addend
  addBcdScoreAndAwardAtThreshold(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the changed addend");
});

// Exit-register matrix: every armed exit of the routine (the unarmed exit is the GATED test), over loc_3d in {0,1}; loc_3d=1 makes y (3) differ from the slot (1).
// The oracle's m.step targets are traced so the award, counter-full, zSaved+carry, hi==0, hi==2-odd, loop-borrow and no-carry exits are proven reached (positive control).
test("EXIT-REGS MATRIX: returned [X, Y] == the oracle's on every exit path", () => {
  const base = new Machine(ROM, OPTS);
  const seen = { award: 0, cntFull: 0, zSavedCarry: 0, hiZero: 0, hiTwoOdd: 0, loopBorrow: 0, noCarry: 0 };
  for (const p of [0, 1]) for (const x0 of [0x03, 0x08, 0x38]) for (const b2b of [0x00, 0x49])
    for (const iv of [0x00, 0x01, 0x02, 0x03, 0x10]) for (const cnt of [0x02, 0x06]) for (const mid of [0x00, 0x99]) {
      const m = base.clone();
      m.mem.write8(STATUS_FLAGS, m.mem.read8(STATUS_FLAGS) | 0x80);
      m.mem.write8(loc_3d, p);
      m.mem.write8(loc_29, 0x11); m.mem.write8(loc_2a, 0x22); m.mem.write8(loc_2b, b2b);
      for (let k = 0; k < 6; k++) m.mem.write8(loc_40 + k, k % 3 === 1 ? mid : 0x00);
      m.mem.write8(BONUS_LIFE_INTERVAL, iv);
      m.mem.write8(SLOT_COUNTDOWN + p, cnt);
      m.regs.x = x0; m.regs.y = 0x77;
      const o = m.clone(), c = m.clone(), pcs = new Set();
      const step = o.step;
      o.step = function (pc, cy) { pcs.add(pc); return step.call(this, pc, cy); };
      oracle(o);
      const [x, y] = addBcdScoreAndAwardAtThreshold(c);
      const tag = `p=${p} x=${x0} $2b=${b2b} $0156=${iv} cnt=${cnt} mid=${mid}`;
      assert.equal(ramDiff(o, c), null, tag);
      assert.deepEqual([x, y ?? c.regs.y], [o.regs.x, o.regs.y], tag);
      if (pcs.has(0xcae4)) seen.award++;
      if (pcs.has(0xcae2) && !pcs.has(0xcae4)) seen.cntFull++;
      if (pcs.has(0xcabd) && !pcs.has(0xcab0)) seen.zSavedCarry++;
      if (pcs.has(0xcac0) && iv === 0) seen.hiZero++;
      if (pcs.has(0xcad9)) seen.hiTwoOdd++;
      if (pcs.has(0xcace)) seen.loopBorrow++;
      if (pcs.has(0xcabb) && !pcs.has(0xcabd)) seen.noCarry++;
    }
  for (const [k, n] of Object.entries(seen)) assert.ok(n > 0, `exit path ${k} never reached`);
  console.log(`  EXIT-REGS MATRIX: ${JSON.stringify(seen)}`);
});
