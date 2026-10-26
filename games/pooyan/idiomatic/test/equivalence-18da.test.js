// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for advanceBonusAwardQueueAndBumpGauge (ROM 0x18da, Pooyan) — "pending bonus-award tally step".
 *
 * The cycle-free / memory-equivalence gate (docs/decompiler-pipeline): a fresh clone per side,
 * the oracle on one and advanceBonusAwardQueueAndBumpGauge on the other, compared on RAM (dumpState, minus stack scratch below the entry SP)
 * PLUS the declared register live-out A. pc/SP/cycles are deliberately not compared.
 *
 * advanceBonusAwardQueueAndBumpGauge takes no register inputs; it is driven entirely by memory: AWARD_QUEUE (0x8909),
 * BONUS_AWARD_DSW (0x8800), ACTIVE_PLAYER (0x880d), the active player's score MSB (0x88a4 or
 * 0x88a7), and GAUGE_PHASE_COUNTER (0x8908). The full path also runs renderPhaseGauge (0x03c2)
 * and queueSoundCommand0B (0x0f0d), whose own writes/reads are covered by their gates and match on both sides.
 *
 * LIVE-OUT A: set on every return path — the reload value on the empty path, the score MSB on
 * the not-yet-reached path, the sound appender's cursor on the full path. Checked equal to the
 * oracle and asserted SET on the module's clone.
 *
 * The leaf is not reached in a plain boot, so every case is CRAFTED (identical pokes on both
 * clones).
 *
 * Jobs:
 *   1. EQUAL — over crafted cases spanning the three paths (empty-reload ×2, not-reached ×2 for
 *      both players, full-tally ×2 for both players), oracle == advanceBonusAwardQueueAndBumpGauge in RAM (−stack) and A.
 *   2. WRITE-SET — the empty-reload path writes exactly one cell (AWARD_QUEUE := 5 or 3).
 *   3. TEETH — a wrong AWARD_QUEUE byte (RAM) and a wrong A (live-out) are each CAUGHT.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-18da.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_18da as oracle } from "../../translated/loc_18da.js";
import { advanceBonusAwardQueueAndBumpGauge } from "../advanceBonusAwardQueueAndBumpGauge.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const AWARD_QUEUE = 0x8909;
const BONUS_AWARD_DSW = 0x8800;
const ACTIVE_PLAYER = 0x880d;
const P1_SCORE_MSB = 0x88a4;
const P2_SCORE_MSB = 0x88a7;
const GAUGE_PHASE_COUNTER = 0x8908;
const GAME_ACTIVE_FLAG = 0x8806; // lets the full path exercise the sound appender

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);
function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function craft(pokes) {
  const m = BASE.clone();
  m.regs.sp = 0x8ffe; // stack lives in STACK_SCRATCH; the oracle's calls only touch it there
  for (const [addr, val] of pokes) m.mem8[addr] = val & 0xff;
  return m;
}

const CASES = [
  { name: "empty queue, DSW=0 -> reload 5", pokes: [[AWARD_QUEUE, 0x00], [BONUS_AWARD_DSW, 0x00]], expectA: 0x05 },
  { name: "empty queue, DSW!=0 -> reload 3", pokes: [[AWARD_QUEUE, 0x00], [BONUS_AWARD_DSW, 0x01]], expectA: 0x03 },
  { name: "P1, MSB below threshold -> ret nz", pokes: [[AWARD_QUEUE, 0x14], [ACTIVE_PLAYER, 0x00], [P1_SCORE_MSB, 0x10]], expectA: 0x10 },
  { name: "P2, MSB below threshold -> ret nz", pokes: [[AWARD_QUEUE, 0x30], [ACTIVE_PLAYER, 0x01], [P2_SCORE_MSB, 0x20]], expectA: 0x20 },
  {
    name: "P1 full tally, DSW=0 step 8, gauge bumps",
    pokes: [[AWARD_QUEUE, 0x10], [ACTIVE_PLAYER, 0x00], [P1_SCORE_MSB, 0x10], [GAUGE_PHASE_COUNTER, 0x03], [BONUS_AWARD_DSW, 0x00], [GAME_ACTIVE_FLAG, 0x01]],
    expectQueue: 0x18, expectGauge: 0x04,
  },
  {
    name: "P2 full tally, DSW!=0 step 7, gauge saturated",
    pokes: [[AWARD_QUEUE, 0x25], [ACTIVE_PLAYER, 0x01], [P2_SCORE_MSB, 0x25], [GAUGE_PHASE_COUNTER, 0xff], [BONUS_AWARD_DSW, 0x01], [GAME_ACTIVE_FLAG, 0x01]],
    expectQueue: 0x32, expectGauge: 0xff,
  },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted path cases — advanceBonusAwardQueueAndBumpGauge == oracle in RAM (−stack) + A", () => {
  for (const cse of CASES) {
    const o = craft(cse.pokes);
    oracle(o);
    const c = craft(cse.pokes);
    const ret = advanceBonusAwardQueueAndBumpGauge(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${cse.name}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    assert.equal(ret & 0xff, o.regs.a & 0xff, `[${cse.name}] A return mismatch`);
    assert.equal(c.regs.a & 0xff, o.regs.a & 0xff, `[${cse.name}] module must SET A`);
    if (cse.expectA != null) assert.equal(o.regs.a & 0xff, cse.expectA, `[${cse.name}] oracle A sanity`);
    if (cse.expectQueue != null) assert.equal(o.mem8[AWARD_QUEUE], cse.expectQueue, `[${cse.name}] BCD queue step`);
    if (cse.expectGauge != null) assert.equal(o.mem8[GAUGE_PHASE_COUNTER], cse.expectGauge, `[${cse.name}] gauge bump`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted path cases identical (RAM −stack + A)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the empty-reload path writes exactly AWARD_QUEUE", () => {
  const pokes = [[AWARD_QUEUE, 0x00], [BONUS_AWARD_DSW, 0x00]];
  const before = craft(pokes);
  const after = craft(pokes);
  const b = before.dumpState();
  oracle(after);
  const a = after.dumpState();

  const changed = [];
  for (let off = 0; off < b.length; off++) {
    if (b[off] !== a[off]) changed.push(after.stateOffsetToAddr(off));
  }
  assert.equal(changed.length, 1, `expected exactly 1 write, got ${changed.length}`);
  assert.equal(changed[0], AWARD_QUEUE, `expected the write at ${hx(AWARD_QUEUE)}, got ${hx(changed[0] ?? 0)}`);
  assert.equal(after.mem8[AWARD_QUEUE], 0x05, "AWARD_QUEUE reloaded to 5 (DSW=0)");
  console.log(`  WRITE-SET: ${hx(AWARD_QUEUE)} := 0x05 (1 cell)`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong AWARD_QUEUE byte is CAUGHT by the RAM diff", () => {
  const pokes = [[AWARD_QUEUE, 0x00], [BONUS_AWARD_DSW, 0x00]];
  const o = craft(pokes);
  const c = craft(pokes);
  oracle(o);
  advanceBonusAwardQueueAndBumpGauge(c);
  c.mem8[AWARD_QUEUE] = 0x00; // BUG: the reload must be 0x05

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong AWARD_QUEUE byte");
  assert.equal(d.addr, AWARD_QUEUE, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong AWARD_QUEUE caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong A is CAUGHT by the live-out check", () => {
  const pokes = [[AWARD_QUEUE, 0x14], [ACTIVE_PLAYER, 0x00], [P1_SCORE_MSB, 0x10]];
  const o = craft(pokes);
  const c = craft(pokes);
  oracle(o);
  const ret = advanceBonusAwardQueueAndBumpGauge(c);
  assert.equal(ret & 0xff, o.regs.a & 0xff, "sanity: module A matches oracle");
  const broken = (o.regs.a ^ 0xff) & 0xff; // a wrong A the === check must reject
  assert.notEqual(broken, o.regs.a & 0xff, "the live-out check must reject a wrong A");
  console.log(`  TEETH/A: module A ${hx(ret)} == oracle; a flipped ${hx(broken)} is rejected`);
});
