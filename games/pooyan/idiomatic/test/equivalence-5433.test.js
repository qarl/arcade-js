// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for initEnemyFormationRecord (ROM 0x5433) — the per-record enemy-formation initialiser.
 *
 * A live record (either of its first two bytes set) takes the early `ret nz` and changes nothing. A
 * free record is seeded: fixed state constants, a motion byte and a two's-complement speed partner
 * from the two byte tables keyed by FORMATION_SPAWN_INDEX, an animation script byte and its sequence
 * pointer from the two word tables, a frame-hold, one animation tick, then the spawn index is bumped.
 *
 * The oracle drives the TRANSLATED subtree (two rst-0x20 lookups, two word lookups, the anim tick)
 * through the routines map; the idiomatic module composes the IDIOMATIC siblings directly. The two
 * must land byte-identical in RAM (dumpState) minus stack scratch below the entry SP. initEnemyFormationRecord is a void routine — its
 * caller reads no register back — so the register file is NOT compared; the oracle's SP += 2 (its
 * final ret) lives in dead stack.
 *
 * Cases are CRAFTED: a plain boot does not seat this routine's IX record input directly.
 *
 * Jobs:
 *   1. EQUAL — free (seed) and live (no-op): oracle == module in RAM (−stack).
 *   2. WRITE-SET — a free record is activated, its fixed fields seeded, and the spawn index bumped.
 *   3. TEETH — a wrong seeded field byte is caught by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-5433.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_5433 as oracle } from "../../translated/loc_5433.js";
import { initEnemyFormationRecord } from "../initEnemyFormationRecord.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const IX = 0x8c30; //     FORMATION_TABLE — a formation record base
const INDEX = 0x8d01; //  FORMATION_SPAWN_INDEX — the shared table cursor initEnemyFormationRecord reads and bumps
const SP0 = 0x8fe0; //    inside STACK_SCRATCH; room for the nested lookup/tick dips + the final ret

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Fresh clone with IX seated and the spawn index at 2; live controls the first record byte. */
function craft(live) {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.regs.ix = IX;
  m.mem8[INDEX] = 0x02;
  m.mem8[IX + 0] = live ? 0x01 : 0x00;
  m.mem8[IX + 1] = 0x00;
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: free (seed) + live (no-op) — initEnemyFormationRecord == oracle in RAM (−stack)", () => {
  for (const [label, live] of [["free record", false], ["live record", true]]) {
    const o = craft(live);
    oracle(o);
    const c = craft(live);
    initEnemyFormationRecord(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${label}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log("  EQUAL: free seed + live no-op identical (RAM −stack, composed subtree)");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: a free record is activated, fixed fields seeded, spawn index bumped", () => {
  const after = craft(false);
  oracle(after);
  assert.equal(after.mem8[IX + 0x00], 0x01, "record activated");
  assert.equal(after.mem8[IX + 0x03], 0x60, "field +3 seeded");
  assert.equal(after.mem8[IX + 0x04], 0x1b, "field +4 seeded");
  assert.equal(after.mem8[IX + 0x11], 0x40, "frame-hold seeded");
  assert.equal(after.mem8[INDEX], 0x03, "spawn index bumped 2 -> 3");

  const live = craft(true);
  const before = live.mem8[IX + 0x03];
  oracle(live);
  assert.equal(live.mem8[IX + 0x03], before, "live record -> field +3 untouched");
  assert.equal(live.mem8[INDEX], 0x02, "live record -> spawn index held");
  console.log("  WRITE-SET: free seeds + bumps index; live is a no-op");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong seeded field byte is CAUGHT by the RAM diff", () => {
  const o = craft(false);
  const c = craft(false);
  oracle(o);
  initEnemyFormationRecord(c);
  c.mem8[IX + 0x04] = 0x99; // BUG: field +4 must be 0x1b
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong seeded byte — it is worthless");
  assert.equal(d.addr, IX + 0x04, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong seeded byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
