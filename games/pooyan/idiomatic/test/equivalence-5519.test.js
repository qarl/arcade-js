// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for spawnShotTargetOnInterval (ROM 0x5519, Pooyan) — spawn scheduler B: gate on round /
 * difficulty, tick the per-type spawn countdown, and only on zero reload it from the interval table
 * (indexed by the low nibble of the spawn cursor), advance the cursor, and fall through into the
 * spawn loop seedFirstFreeSlotForScheduledSpawn.
 *
 * The module calls the idiomatic fetchByteFromTableIndex / seedFirstFreeSlotForScheduledSpawn directly; the oracle drives them through the
 * frozen registry. spawnShotTargetOnInterval declares no register live-out (seedFirstFreeSlotForScheduledSpawn is memory-only and the caller
 * reads only memory back), so the register file is not compared; equivalence is RAM (dumpState) minus
 * stack scratch below the entry SP (SP parked in dead stack so the loop's push/pop and initSpawnedActorRecordAndDeriveSpeed's caller-skip drop out).
 * The SEED case (a free spawn block) exercises seedFirstFreeSlotForScheduledSpawn's caller-skip through initSpawnedActorRecordAndDeriveSpeed; the ALL-LIVE
 * case makes the block live so the scan falls out with no seed. Both read ROM tables -> ROM required.
 *
 * Jobs:
 *   1. EQUAL — gate-fail / countdown-running / reload-no-seed / reload-seed: oracle == spawnShotTargetOnInterval.
 *   2. WRITE-SET — zero reloads the countdown from the table and advances the cursor; nonzero holds.
 *   3. TEETH — a wrong advanced cursor byte is CAUGHT by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-5519.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_5519 as oracle } from "../../translated/loc_5519.js";
import { spawnShotTargetOnInterval } from "../spawnShotTargetOnInterval.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const ROUND = 0x8907; //      round counter
const DIFF = 0x8820; //       difficulty DSW
const COUNTDOWN = 0x8d05; //  per-type spawn countdown
const TABLE = 0x55ff; //      interval reload table (ROM)
const SEQIDX = 0x8d13; //     spawn cursor
const REC = 0x8c48; //        spawn object table base
const SP0 = 0x8fe0; //        inside STACK_SCRATCH

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Fresh clone with the gate inputs, countdown, spawn cursor, and the first spawn block's liveness. */
function craft(round, diff, countdown, seqIdx, blockLive) {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.mem8[ROUND] = round & 0xff;
  m.mem8[DIFF] = diff & 0xff;
  m.mem8[COUNTDOWN] = countdown & 0xff;
  m.mem8[SEQIDX] = seqIdx & 0xff;
  m.mem8[REC] = blockLive & 0xff; // blk+0: nonzero -> live (skipped), 0 -> free (seeded)
  m.mem8[REC + 1] = 0x00;
  return m;
}

const reloadByte = (m) => m.mem.read8((TABLE + (m.mem8[SEQIDX] & 0x0f)) & 0xffff);

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: gate-fail / running / reload-no-seed / reload-seed — spawnShotTargetOnInterval == oracle in RAM (−stack)", () => {
  const cases = [
    { round: 0x00, diff: 0x00, cd: 0x05, idx: 0x03, live: 0x01, label: "gate fail (round<2, diff<2)" },
    { round: 0x02, diff: 0x00, cd: 0x05, idx: 0x03, live: 0x01, label: "countdown running -> return" },
    { round: 0x02, diff: 0x00, cd: 0x01, idx: 0x03, live: 0x01, label: "reload, block live -> no seed" },
    { round: 0x00, diff: 0x02, cd: 0x01, idx: 0x05, live: 0x00, label: "diff-gate pass, reload, seed" },
  ];
  for (const { round, diff, cd, idx, live, label } of cases) {
    const o = craft(round, diff, cd, idx, live);
    oracle(o);
    const c = craft(round, diff, cd, idx, live);
    spawnShotTargetOnInterval(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${label}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${cases.length} gate/countdown/spawn paths identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: countdown zero reloads from the table and advances the cursor", () => {
  const running = craft(0x02, 0x00, 0x05, 0x03, 0x01);
  oracle(running);
  assert.equal(running.mem8[COUNTDOWN], 0x04, "running -> countdown decremented, no reload");
  assert.equal(running.mem8[SEQIDX], 0x03, "running -> cursor held");

  const c = craft(0x02, 0x00, 0x01, 0x03, 0x01);
  const expected = reloadByte(c);
  oracle(c);
  assert.equal(c.mem8[COUNTDOWN], expected, "zero -> countdown reloaded from TABLE[cursor & 0x0f]");
  assert.equal(c.mem8[SEQIDX], 0x04, "zero -> cursor advanced by one");
  console.log(`  WRITE-SET: reload=${hx(expected)}, cursor 0x03 -> 0x04`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong advanced cursor byte is CAUGHT by the RAM diff", () => {
  const o = craft(0x02, 0x00, 0x01, 0x03, 0x01);
  const c = craft(0x02, 0x00, 0x01, 0x03, 0x01);
  oracle(o);
  spawnShotTargetOnInterval(c);
  c.mem8[SEQIDX] = 0x03; // BUG: the reload path must have advanced the cursor to 0x04
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a stale cursor — it is worthless");
  assert.equal(d.addr, SEQIDX, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: stale cursor caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
