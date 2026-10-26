// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for armEnemySpawnScript (ROM 0x5150, Pooyan) — the attract/board script advancer:
 * gated by SCRIPT_ADVANCE_GUARD, pick the round's script row, scan it for the stage's threshold, and
 * on a match latch the guard + row value and resolve two data pointers into the live-script slots.
 *
 * The module dissolves all three fetchWordFromTableIndex word lookups to direct calls; the oracle drives the frozen
 * fetchWordFromTableIndex through the register seam. armEnemySpawnScript is a void routine, so equivalence is RAM (dumpState)
 * minus stack scratch below the entry SP, SP parked in dead stack.
 *
 * The match arm uses round 0 / stage 0x20 — the first record of that ROM row has threshold 0x20, so
 * the scan matches on entry and drives the full write path.
 *
 * Jobs:
 *   1. EQUAL — three reachable arms (guard busy, stage below floor, threshold match) are
 *      RAM-identical between oracle and module.
 *   2. WRITE-SET — a match latches SCRIPT_ADVANCE_GUARD to the matched threshold (0 -> 0x20).
 *   3. TEETH — a wrong latched-guard byte is CAUGHT by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-5150.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_5150 as oracle } from "../../translated/loc_5150.js";
import { armEnemySpawnScript } from "../armEnemySpawnScript.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const GUARD = 0x8d6d; //  script-advance guard (nonzero -> busy)
const ROUND = 0x8907; //  round counter (& 0x0f -> row index)
const STAGE = 0x8901; //  stage countdown (scanned against the row thresholds)
const SP0 = 0x8ff0; //    inside STACK_SCRATCH
const CALLER_RET = 0xfffc; // return word the frozen fetchWordFromTableIndex calls consume

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

function craft({ guard, round, stage }) {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.mem.write16(SP0, CALLER_RET);
  m.mem8[GUARD] = guard;
  m.mem8[ROUND] = round;
  m.mem8[STAGE] = stage;
  return m;
}

const ARMS = [
  ["guard busy", { guard: 0x01, round: 0x00, stage: 0x20 }],
  ["stage below floor", { guard: 0x00, round: 0x00, stage: 0x03 }],
  ["threshold match", { guard: 0x00, round: 0x00, stage: 0x20 }],
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: three reachable arms — armEnemySpawnScript == oracle in RAM (−stack)", () => {
  for (const [label, opts] of ARMS) {
    const o = craft(opts);
    oracle(o);
    const c = craft(opts);
    armEnemySpawnScript(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${label}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log("  EQUAL: busy + below-floor + match arms identical (RAM −stack)");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: a threshold match latches the guard", () => {
  const match = craft({ guard: 0x00, round: 0x00, stage: 0x20 });
  oracle(match);
  assert.equal(match.mem8[GUARD], 0x20, "match -> guard latched at the matched threshold");

  const busy = craft({ guard: 0x01, round: 0x00, stage: 0x20 });
  oracle(busy);
  assert.equal(busy.mem8[GUARD], 0x01, "busy -> guard untouched");

  assert.notEqual(match.mem8[GUARD], busy.mem8[GUARD], "a match must latch the guard");
  console.log("  WRITE-SET: a match latches the guard to the matched threshold");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong latched-guard byte is CAUGHT by the RAM diff", () => {
  const opts = { guard: 0x00, round: 0x00, stage: 0x20 };
  const o = craft(opts);
  const c = craft(opts);
  oracle(o);
  armEnemySpawnScript(c);
  c.mem8[GUARD] = 0x00; // BUG: the match must have latched the guard to 0x20
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong guard byte — it is worthless");
  assert.equal(d.addr, GUARD, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong guard byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
