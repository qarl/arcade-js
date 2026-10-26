// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for spawnEnemyFormation (ROM 0x540d) — the enemy-formation spawn driver.
 *
 * Gated on ROUND_COUNTER bit 0: an even round returns immediately, an odd round blanks two 6-byte
 * state rows and initialises the three formation records at FORMATION_TABLE (stride 0x18) via the
 * per-record initialiser, which reads and bumps the shared spawn index the blank just zeroed.
 *
 * The oracle drives the TRANSLATED subtree (fill helper + per-record init) through the routines map;
 * the idiomatic module composes the IDIOMATIC siblings directly. The two must land byte-identical in
 * RAM (dumpState) minus stack scratch below the entry SP. spawnEnemyFormation is a void driver — no register survives — so the
 * register file is NOT compared; the oracle's SP += 2 (its final ret) lives in dead stack.
 *
 * Jobs:
 *   1. EQUAL — gate open (odd) and gate closed (even): oracle == module in RAM (−stack).
 *   2. WRITE-SET — odd round activates all three records and bumps the spawn index 0 -> 3; even
 *      round leaves the records untouched.
 *   3. TEETH — a wrong seeded record byte is caught by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-540d.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_540d as oracle } from "../../translated/loc_540d.js";
import { spawnEnemyFormation } from "../spawnEnemyFormation.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const ROUND = 0x8907; //  ROUND_COUNTER — bit 0 gates the driver
const REC = 0x8c30; //    FORMATION_TABLE — first formation record base
const STRIDE = 0x18; //   record stride
const INDEX = 0x8d01; //  FORMATION_SPAWN_INDEX — blanked, then bumped once per record
const SP0 = 0x8fe0; //    inside STACK_SCRATCH; room for the nested call dips + the final ret

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Fresh clone: the round parity seated, all records free (BASE work RAM is zero). */
function craft(round) {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.mem8[ROUND] = round & 0xff;
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: gate open (odd) + gate closed (even) — spawnEnemyFormation == oracle in RAM (−stack)", () => {
  for (const [label, round] of [["gate open (odd)", 0x01], ["gate closed (even)", 0x02]]) {
    const o = craft(round);
    oracle(o);
    const c = craft(round);
    spawnEnemyFormation(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${label}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log("  EQUAL: gate open + gate closed identical (RAM −stack)");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: an odd round activates all three records and bumps the spawn index 0 -> 3", () => {
  const open = craft(0x01);
  oracle(open);
  assert.equal(open.mem8[REC + 0 * STRIDE], 0x01, "record 0 activated");
  assert.equal(open.mem8[REC + 1 * STRIDE], 0x01, "record 1 activated");
  assert.equal(open.mem8[REC + 2 * STRIDE], 0x01, "record 2 activated");
  assert.equal(open.mem8[INDEX], 0x03, "spawn index bumped once per record (0 -> 3)");

  const closed = craft(0x02);
  oracle(closed);
  assert.equal(closed.mem8[REC], 0x00, "gate closed -> no record touched");
  assert.equal(closed.mem8[INDEX], 0x00, "gate closed -> spawn index untouched");
  console.log("  WRITE-SET: odd activates 3 records + bumps index; even is a no-op");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong seeded record byte is CAUGHT by the RAM diff", () => {
  const o = craft(0x01);
  const c = craft(0x01);
  oracle(o);
  spawnEnemyFormation(c);
  c.mem8[REC + 0x03] = 0x99; // BUG: record 0 field +3 must be 0x60
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong seeded byte — it is worthless");
  assert.equal(d.addr, REC + 0x03, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong seeded byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
