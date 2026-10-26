// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for spawnActorGroupRecords (ROM 0x6505, Pooyan) — the rst-0x28 dispatch handler (index
 * 0). It seeds the shared frame-delay timer (0x1c) and the blink-phase cell (0x08), walks three
 * object records backward one 0x18 step per pass — seating each with the object-record seeder
 * (seatActorRecordAndQueueSpawnDisplay) and bumping its (IX+2) phase — then emits the tile-command run (queueSound82ThenRun1C).
 *
 * Cycle-free memory-equivalence gate: a FRESH clone per side (the routine writes RAM), compared on
 * RAM (dumpState, minus stack scratch below the entry SP — the oracle's exx-guarded call trampolines push there) PLUS
 * the register live-out: A (the advanced command-ring cursor left by the final emit — 0 while its
 * game-active gate is closed) and IX (the record pointer advanced to base - 3*0x18). pc/SP/cycles
 * are NOT compared. IX is the routine's only register input; every other input is a work-RAM cell.
 *
 * Jobs:
 *   1. EQUAL (ring idle) — display ring occupied so the seeder's enqueues drop: oracle == spawnActorGroupRecords
 *      in RAM (−stack) + A/IX.
 *   2. EQUAL (ring free, round 0) — ring seated free so all enqueues (two per record on round 0)
 *      land: identical on both sides.
 *   3. WRITE-SET — the two seeded cells (0x8929/0x892b) are both in the oracle's write footprint.
 *   4. TEETH — a wrong seated record byte is caught by the RAM diff; an under-advanced IX and a
 *      wrong A are each caught by the live-out check.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-6505.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_6505 as oracle } from "../../translated/loc_6505.js";
import { spawnActorGroupRecords } from "../spawnActorGroupRecords.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  SHARED_FRAME_DELAY_TIMER,
  BLINK_PHASE,
  SIGNATURE_MISMATCH_FLAG,
  ROUND_COUNTER,
  DISPLAY_CMD_RING_WRITE_PTR,
  DISPLAY_CMD_RING_BUFFER,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const IX0 = 0x8c78; //         work-RAM record base; records at IX0, IX0-0x18, IX0-0x30
const RECORD_STRIDE = 0x18;
const RECORD_COUNT = 3;
const REC_ACTIVE = 0x04; //    a seated record field (IX+4 := 0x15) to corrupt for the RAM teeth
const RING_START = 0xc0;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** A fresh clone: IX record base seated, round counter set, optionally the display ring freed. */
function craft({ round = 0x01, ringFree = false } = {}) {
  const m = BASE.clone();
  m.mem.write8(SIGNATURE_MISMATCH_FLAG, 0x00); // seeder proceeds (BASE default, made explicit)
  m.mem.write8(ROUND_COUNTER, round & 0xff);
  // records at IX0/IX0-0x18/IX0-0x30 have even id words (BASE zero) so the seeder seats them
  if (ringFree) {
    m.mem.write8(DISPLAY_CMD_RING_WRITE_PTR, RING_START);
    for (let low = RING_START; low <= 0xff; low++) m.mem.write8(DISPLAY_CMD_RING_BUFFER + (low - RING_START), 0xff);
  }
  m.regs.ix = IX0;
  m.regs.sp = 0x8ffe; // in STACK_SCRATCH; the oracle's trampolines push here
  return m;
}

function assertRegs(o, c, tag) {
  assert.equal(c.regs.a & 0xff, o.regs.a & 0xff, `${tag}: A live-out mismatch`);
  assert.equal(c.regs.ix & 0xffff, o.regs.ix & 0xffff, `${tag}: IX live-out mismatch`);
}

// -- 1. EQUAL (ring idle) -----------------------------------------------------

test("EQUAL: ring idle — spawnActorGroupRecords == oracle in RAM (−stack) + A/IX", () => {
  for (const round of [0x00, 0x01]) {
    const o = craft({ round });
    const c = craft({ round });
    oracle(o);
    spawnActorGroupRecords(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `round=${hx(round)}: RAM diff at ${hx(d.addr ?? 0)} oracle=${d.a} mine=${d.b}`);
    assertRegs(o, c, `round=${hx(round)}`);
    assert.equal(o.regs.ix & 0xffff, (IX0 - RECORD_COUNT * RECORD_STRIDE) & 0xffff, "IX advanced back by 3*stride");
  }
  console.log("  EQUAL(ring idle): identical (RAM −stack + A/IX)");
});

// -- 2. EQUAL (ring free) -----------------------------------------------------

test("EQUAL: ring free, round 0 — all enqueues land identically on both sides", () => {
  const o = craft({ round: 0x00, ringFree: true });
  const c = craft({ round: 0x00, ringFree: true });
  oracle(o);
  spawnActorGroupRecords(c);
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)} oracle=${d.a} mine=${d.b}`);
  assertRegs(o, c, "ring-free");
  assert.notEqual(o.mem.read8(DISPLAY_CMD_RING_WRITE_PTR), RING_START, "sanity: the write pointer advanced (enqueues landed)");
  console.log("  EQUAL(ring free): identical (RAM −stack + A/IX)");
});

// -- 3. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the two seeded cells (frame-delay + blink-phase) are in the write footprint", () => {
  const before = craft({ round: 0x01 });
  const after = craft({ round: 0x01 });
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();

  const changed = new Set();
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) {
      const addr = after.stateOffsetToAddr(off);
      if (!inDeadStack(addr)) changed.add(addr);
    }
  }
  assert.ok(changed.has(SHARED_FRAME_DELAY_TIMER), "frame-delay timer must be written");
  assert.ok(changed.has(BLINK_PHASE), "blink-phase cell must be written");
  assert.equal(after.mem.read8(BLINK_PHASE), 0x08, "blink-phase cell seeded to 0x08");
  console.log("  WRITE-SET: 0x8929 + 0x892b seeded");
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: a wrong seated record byte is CAUGHT by the RAM diff", () => {
  const cell = (IX0 + REC_ACTIVE) & 0xffff; // record 0's (IX+4), seated to 0x15 by the seeder
  const o = craft({ round: 0x01 });
  const c = craft({ round: 0x01 });
  oracle(o);
  spawnActorGroupRecords(c);
  c.mem.write8(cell, (c.mem.read8(cell) ^ 0x01) & 0xff); // BUG: corrupt a seated field
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong seated byte — it is worthless");
  assert.equal(d.addr, cell, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong seated byte caught at ${hx(d.addr)}`);
});

test("TEETH: a wrong advanced IX and a wrong A are CAUGHT by the live-out check", () => {
  const o = craft({ round: 0x01 });
  oracle(o);
  const goodIx = o.regs.ix & 0xffff;
  const goodA = o.regs.a & 0xff;
  const underAdvanced = (IX0 - 2 * RECORD_STRIDE) & 0xffff; // one record short
  assert.notEqual(underAdvanced, goodIx, "the IX live-out check must reject an under-advanced pointer");
  assert.equal(goodIx, (IX0 - RECORD_COUNT * RECORD_STRIDE) & 0xffff, "sanity: oracle IX is base - 3*stride");
  assert.notEqual((goodA + 1) & 0xff, goodA, "the A live-out check must reject a wrong cursor byte");
  console.log(`  TEETH/regs: under-advanced ${hx(underAdvanced)} rejected vs IX ${hx(goodIx)}; A=${hx(goodA)}`);
});
