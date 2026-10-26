// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for initFormationRecordAndDeriveSpawnSpeed (ROM 0x53b0, Pooyan) — one-shot spawn/init of the
 * formation record at 0x8c30, gated three ways: the incoming byte A != 0, the spawn latch
 * (0x8d59) == 0, and the frame counter (0x8a5f) == 0. When all hold it latches, fills the record
 * (a byte-table field at rec+0x09 and its negation at rec+0x0a, fixed opening bytes, a cleared
 * turn-column limit at 0x8d4b, an armed animation via rec+0x0c..0x0e), then derives a speed index
 * (round counter 0x8907 halved, +1, clamped to 6) into 0x8d5c and a second-table value into 0x8d5d.
 *
 * Cycle-free gate: a fresh clone per side, compared on RAM (dumpState) minus stack scratch below the entry SP. There
 * is NO register live-out — every exit register is dead, the caller reloads A — so only RAM is
 * compared. All inputs (A, the two gate cells, the round counter) are poked identically on both
 * sides (CRAFTED). The two byte-table lookups read ROM tables, so the test requires the ROM.
 *
 * Jobs:
 *   1. EQUAL — the three early-return gates plus the full spawn over several round counters
 *      (exercising the index clamp): oracle == module in RAM (−stack).
 *   2. WRITE-SET — the full-spawn footprint: the latch, the record fields, the turn-column limit,
 *      the animation fields, the speed index and value; each at its exact value.
 *   3. TEETH — a wrong negation field and a wrong latch are each CAUGHT by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-53b0.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_53b0 as oracle } from "../../translated/loc_53b0.js";
import { initFormationRecordAndDeriveSpawnSpeed } from "../initFormationRecordAndDeriveSpawnSpeed.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = 0x8c30; //          formation record base
const SPAWN_LATCH = 0x8d59;
const FRAME_COUNTER = 0x8a5f;
const ROUND_COUNTER = 0x8907;
const TURN_COLUMN_LIMIT = 0x8d4b;
const SPEED_INDEX = 0x8d5c;
const SPEED_VALUE = 0x8d5d;
const FIELD_TABLE = 0x5902; //  byte table; the spawn reads entry [1]
const SPEED_TABLE = 0x5407;
const ANIM_LO = 0x03; //        armed animation pointer is 0x4203
const ANIM_HI = 0x42;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const u8 = (v) => v & 0xff;
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;
const speedIndex = (round) => { const i = (round >> 1) + 1; return i >= 0x07 ? 0x06 : i; };

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Fresh clone with A and the three gate/round inputs seated. */
function craft(spawnIndex, { latch = 0, frame = 0, round = 0 } = {}) {
  const m = BASE.clone();
  m.regs.a = spawnIndex & 0xff;
  m.mem.write8(SPAWN_LATCH, latch);
  m.mem.write8(FRAME_COUNTER, frame);
  m.mem.write8(ROUND_COUNTER, round);
  m.regs.sp = 0x8ffe; // the two rst-0x20 lookups and the anim call trampoline land in STACK_SCRATCH
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: early-return gates — initFormationRecordAndDeriveSpawnSpeed == oracle in RAM (−stack)", () => {
  const gated = [
    craft(0x00, {}), //                 A == 0
    craft(0x05, { latch: 1 }), //       already spawned
    craft(0x05, { frame: 0x07 }), //    frame counter not at zero
  ];
  for (const g of gated) {
    const o = g;
    const c = craft(o.regs.a, { latch: o.mem.read8(SPAWN_LATCH), frame: o.mem.read8(FRAME_COUNTER) });
    oracle(o);
    initFormationRecordAndDeriveSpawnSpeed(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `gate case: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL(gates): 3 early-return cases identical (RAM −stack)`);
});

test("EQUAL: full spawn over round counters — initFormationRecordAndDeriveSpawnSpeed == oracle in RAM (−stack)", () => {
  const ROUNDS = [0x00, 0x08, 0x0c, 0xff];
  for (const round of ROUNDS) {
    const o = craft(0x05, { round });
    const c = craft(0x05, { round });
    oracle(o);
    initFormationRecordAndDeriveSpawnSpeed(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `round=${hx(round)}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL(spawn): ${ROUNDS.length} round counters identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the full-spawn footprint at its exact values", () => {
  const round = 0x08;
  const m = craft(0x05, { round });
  const field = m.mem.read8(FIELD_TABLE + 1); // table entry [1]
  const index = speedIndex(round);
  const speed = m.mem.read8(SPEED_TABLE + index);

  const expected = new Map([
    [SPAWN_LATCH, 1],
    [REC + 0x09, field],
    [REC + 0x0a, u8(-field)],
    [REC + 0x00, 0x01],
    [REC + 0x02, 0x0b],
    [REC + 0x03, 0x00],
    [REC + 0x04, 0x04],
    [REC + 0x05, 0x00],
    [REC + 0x06, 0x00],
    [TURN_COLUMN_LIMIT, 0xff],
    [REC + 0x0c, ANIM_LO],
    [REC + 0x0d, ANIM_HI],
    [REC + 0x0e, 0x00],
    [SPEED_INDEX, index],
    [SPEED_VALUE, speed],
  ]);

  const b0 = m.dumpState();
  oracle(m);
  const a1 = m.dumpState();
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) {
      const addr = m.stateOffsetToAddr(off);
      if (inDeadStack(addr)) continue; // the rst-0x20 lookups + anim call trampoline push into STACK_SCRATCH — not game state
      assert.ok(expected.has(addr), `unexpected write at ${hx(addr)}`);
    }
  }
  for (const [addr, val] of expected) {
    assert.equal(m.mem.read8(addr), val, `cell ${hx(addr)} expected ${hx(val)}`);
  }
  console.log(`  WRITE-SET: ${expected.size} cells at their exact values (field=${hx(field)}, speed=${hx(speed)})`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong negation field is CAUGHT by the RAM diff", () => {
  const o = craft(0x05, { round: 0x08 });
  const c = craft(0x05, { round: 0x08 });
  oracle(o);
  initFormationRecordAndDeriveSpawnSpeed(c);
  const correct = c.mem.read8(REC + 0x0a);
  c.mem.write8(REC + 0x0a, correct ^ 0xff); // BUG: rec+0x0a must be the two's-complement of the field
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong negation — it is worthless");
  assert.equal(d.addr, REC + 0x0a, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(neg): caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong (cleared) spawn latch is CAUGHT by the RAM diff", () => {
  const o = craft(0x05, { round: 0x08 });
  const c = craft(0x05, { round: 0x08 });
  oracle(o);
  initFormationRecordAndDeriveSpawnSpeed(c);
  c.mem.write8(SPAWN_LATCH, 0x00); // BUG: the spawn must latch to 1
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a cleared latch — it is worthless");
  assert.equal(d.addr, SPAWN_LATCH, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(latch): caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
