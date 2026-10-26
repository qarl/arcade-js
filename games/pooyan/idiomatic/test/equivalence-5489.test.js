// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for initSpawnedActorRecordAndDeriveSpeed (ROM 0x5489, Pooyan) — initialise an actor record at IX.
 *
 * Seeds the opening field bytes, looks up the record's animation sequence from the pointer table at
 * 0x5657 by its kind byte (rec+0x17) and installs it (rec+0x0c..0x0e), seats the dwell countdown
 * (rec+0x11), and derives a signed speed for rec+0x0a — the kind indexes a speed-table row at 0x55d7,
 * then 3x the low round-counter bits (0x8907) index into that row, and the byte is negated.
 *
 * SEATING: caller-skip (pop af; ret) dissolved to a boolean; it always skips, so it always returns
 * false. LIVE-OUT: none (memory only). Compared on RAM (dumpState) minus stack scratch below the entry SP; the register
 * file is not compared. The kind byte, round counter, and rec+0x06 seed are all crafted identically on
 * both sides. The lookups read ROM tables, so the test requires the ROM; it is green once the batch
 * sibling fetchWordFromTableIndex and the 0x5657/0x55d7 table cells land.
 *
 * Jobs:
 *   1. EQUAL — several (kind, round, seed) combinations: oracle == module in RAM (−stack).
 *   2. WRITE-SET — the full init footprint at its exact values (fixed bytes, the animation word, the
 *      countdown, the negated speed).
 *   3. TEETH — a wrong negated-speed byte and a cleared active flag are each caught by the RAM diff;
 *      a returns-true twin is caught by the boolean check.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-5489.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_5489 as oracle } from "../../translated/loc_5489.js";
import { initSpawnedActorRecordAndDeriveSpeed } from "../initSpawnedActorRecordAndDeriveSpeed.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = 0x8c30; //        actor record base
const KIND_FIELD = 0x17; //   rec+0x17 = kind index
const ROUND_COUNTER = 0x8907;
const ANIM_TABLE = 0x5657; // word table (fetchWordFromTableIndex), indexed 2*kind
const SPEED_TABLE = 0x55d7; // speed table, indexed kind then 3*(round & 7)
const SP0 = 0x8fe0;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const u8 = (v) => v & 0xff;
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Fresh clone with the kind byte, round counter, and rec+0x06 seed (B) seated. */
function craft(kind, round, seed) {
  const m = BASE.clone();
  m.regs.ix = REC;
  m.regs.b = seed & 0xff;
  m.regs.sp = SP0;
  m.mem.write8(REC + KIND_FIELD, kind & 0xff);
  m.mem.write8(ROUND_COUNTER, round & 0xff);
  return m;
}

const expectedSpeed = (m, kind, round) => u8(-m.mem.read8(SPEED_TABLE + kind + 3 * (round & 0x07)));
const animLo = (m, kind) => m.mem.read8(ANIM_TABLE + 2 * kind);
const animHi = (m, kind) => m.mem.read8(ANIM_TABLE + 2 * kind + 1);

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: init over (kind, round, seed) combinations — initSpawnedActorRecordAndDeriveSpeed == oracle in RAM (−stack)", () => {
  const cases = [
    [0x00, 0x00, 0x00],
    [0x01, 0x02, 0x11],
    [0x02, 0x05, 0x7f],
    [0x03, 0x07, 0xa0],
    [0x00, 0x0e, 0x40], // round & 7 == 6 exercises the top of the speed row
  ];
  for (const [kind, round, seed] of cases) {
    const o = craft(kind, round, seed);
    const c = craft(kind, round, seed);
    oracle(o);
    initSpawnedActorRecordAndDeriveSpeed(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null,
      d && `kind=${hx(kind)} round=${hx(round)}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${cases.length} init combinations identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the full init footprint at its exact values", () => {
  const [kind, round, seed] = [0x02, 0x05, 0x33];
  const m = craft(kind, round, seed);
  const expected = new Map([
    [REC + 0x00, 0x01],
    [REC + 0x02, 0x00],
    [REC + 0x03, 0x60],
    [REC + 0x04, 0x1b],
    [REC + 0x05, 0x00],
    [REC + 0x06, seed],
    [REC + 0x0a, expectedSpeed(m, kind, round)],
    [REC + 0x0c, animLo(m, kind)],
    [REC + 0x0d, animHi(m, kind)],
    [REC + 0x0e, 0x00],
    [REC + 0x11, 0x40],
  ]);

  const b0 = m.dumpState();
  oracle(m);
  const a1 = m.dumpState();
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] === a1[off]) continue;
    const addr = m.stateOffsetToAddr(off);
    if (inDeadStack(addr)) continue; // call trampolines push into STACK_SCRATCH — not game state
    if (addr === REC + KIND_FIELD) continue; // the crafted input byte
    assert.ok(expected.has(addr), `unexpected write at ${hx(addr)}`);
  }
  for (const [addr, val] of expected) {
    assert.equal(m.mem.read8(addr), val, `cell ${hx(addr)} expected ${hx(val)}`);
  }
  console.log(`  WRITE-SET: ${expected.size} cells (anim=${hx(animHi(m, kind))}${hx(animLo(m, kind)).slice(2)}, speed=${hx(expected.get(REC + 0x0a))})`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong negated-speed byte is CAUGHT by the RAM diff", () => {
  const o = craft(0x02, 0x05, 0x33);
  const c = craft(0x02, 0x05, 0x33);
  oracle(o);
  initSpawnedActorRecordAndDeriveSpeed(c);
  const correct = c.mem.read8(REC + 0x0a);
  c.mem.write8(REC + 0x0a, correct ^ 0xff); // BUG: rec+0x0a must be the two's-complement speed
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong speed byte");
  assert.equal(d.addr, REC + 0x0a, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(speed): caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a cleared active flag is CAUGHT by the RAM diff", () => {
  const o = craft(0x01, 0x02, 0x11);
  const c = craft(0x01, 0x02, 0x11);
  oracle(o);
  initSpawnedActorRecordAndDeriveSpeed(c);
  c.mem.write8(REC + 0x00, 0x00); // BUG: the init must set the active flag to 1
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a cleared active flag");
  assert.equal(d.addr, REC + 0x00, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(active): caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a returns-true twin is CAUGHT by the boolean check", () => {
  assert.throws(() => assert.equal(((m) => (initSpawnedActorRecordAndDeriveSpeed(m), true))(craft(0x00, 0x00, 0x00)), false),
    "the caller-skip must always return false");
  console.log("  TEETH(boolean): returns-true twin caught");
});
