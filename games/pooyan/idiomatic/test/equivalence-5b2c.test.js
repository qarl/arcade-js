// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for fireArmedEnemyProjectilesAndDisarm (ROM 0x5b2c, Pooyan) — end-of-wave object-table cleanup:
 * gated by the launch-arm latch 0x8d75 and active-lane count 0x8d79; when the pending flag 0x8d77 is
 * clear it scans six enemy records' +4 field for the wave-end key (0x13 even / 0x0b odd round) and
 * returns on a miss; on a hit (or 0x8d77 set) it sweeps six records through the fire gate launchProjectileIfRecordInFireWindow
 * and clears 0x8d75 / 0x8f20.
 *
 * The module calls the idiomatic launchProjectileIfRecordInFireWindow directly (the oracle's exx only parks the loop counter, a
 * JS local here, so it dissolves); the oracle drives launchProjectileIfRecordInFireWindow through the frozen registry. fireArmedEnemyProjectilesAndDisarm
 * declares no register live-out (the caller rets straight after), so the register file is not
 * compared; equivalence is RAM (dumpState) minus stack scratch below the entry SP. The swept records are left inert
 * (rec+2 != 5) so launchProjectileIfRecordInFireWindow no-ops, isolating fireArmedEnemyProjectilesAndDisarm's own scan/gate/clear behaviour.
 *
 * Jobs:
 *   1. EQUAL — latch-clear / lane-busy / scan-miss / scan-hit / pending-set: oracle == fireArmedEnemyProjectilesAndDisarm.
 *   2. WRITE-SET — the sweep clears 0x8d75 and 0x8f20; a gated-off entry leaves them untouched.
 *   3. TEETH — a non-cleared launch-arm latch is CAUGHT by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-5b2c.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_5b2c as oracle } from "../../translated/loc_5b2c.js";
import { fireArmedEnemyProjectilesAndDisarm } from "../fireArmedEnemyProjectilesAndDisarm.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const LANE = 0x8d75; //     launch-arm latch (gate + cleared on sweep)
const LANECNT = 0x8d79; //  active-lane count
const PENDING = 0x8d77; //  pending flag: set -> skip the scan
const ENEMY = 0x8ae0; //    enemy-record table base
const KEY_FIELD = 0x04; //  record+4 = wave-end key
const STRIDE = 0x18;
const ROUND = 0x8907; //    round counter (bit0 selects the key)
const LATCH = 0x8f20; //    launch latch (cleared on sweep)
const SP0 = 0x8fe0; //      inside STACK_SCRATCH

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Fresh clone with the gates, round, and the first record's +4 key seated. */
function craft(lane, laneCnt, pending, round, firstKey) {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.mem8[LANE] = lane & 0xff;
  m.mem8[LANECNT] = laneCnt & 0xff;
  m.mem8[PENDING] = pending & 0xff;
  m.mem8[ROUND] = round & 0xff;
  m.mem8[LATCH] = 0x55; // a nonzero launch latch, cleared only on the sweep
  m.mem8[ENEMY + KEY_FIELD] = firstKey & 0xff; // record 0's +4 field
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: latch-clear / lane-busy / miss / hit / pending — fireArmedEnemyProjectilesAndDisarm == oracle in RAM (−stack)", () => {
  const cases = [
    { lane: 0x00, cnt: 0x00, pend: 0x00, round: 0x00, key: 0x00, label: "latch clear -> return" },
    { lane: 0x01, cnt: 0x03, pend: 0x00, round: 0x00, key: 0x00, label: "lane still busy -> return" },
    { lane: 0x01, cnt: 0x00, pend: 0x00, round: 0x00, key: 0x00, label: "scan miss (key absent) -> return" },
    { lane: 0x01, cnt: 0x00, pend: 0x00, round: 0x00, key: 0x13, label: "scan hit (even key 0x13) -> sweep" },
    { lane: 0x01, cnt: 0x00, pend: 0x00, round: 0x01, key: 0x0b, label: "scan hit (odd key 0x0b) -> sweep" },
    { lane: 0x01, cnt: 0x00, pend: 0x01, round: 0x00, key: 0x00, label: "pending set -> skip scan, sweep" },
  ];
  for (const { lane, cnt, pend, round, key, label } of cases) {
    const o = craft(lane, cnt, pend, round, key);
    oracle(o);
    const c = craft(lane, cnt, pend, round, key);
    fireArmedEnemyProjectilesAndDisarm(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${label}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${cases.length} gate/scan/sweep paths identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the sweep clears the launch latches; a gated-off entry leaves them", () => {
  const swept = craft(0x01, 0x00, 0x01, 0x00, 0x00); // pending -> sweep
  oracle(swept);
  assert.equal(swept.mem8[LANE], 0x00, "sweep clears 0x8d75");
  assert.equal(swept.mem8[LATCH], 0x00, "sweep clears 0x8f20");

  const gated = craft(0x01, 0x03, 0x00, 0x00, 0x00); // lane busy -> return early
  oracle(gated);
  assert.equal(gated.mem8[LANE], 0x01, "gated off -> 0x8d75 untouched");
  assert.equal(gated.mem8[LATCH], 0x55, "gated off -> 0x8f20 untouched");
  console.log("  WRITE-SET: sweep clears both latches; gated-off leaves them");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a non-cleared launch-arm latch is CAUGHT by the RAM diff", () => {
  const o = craft(0x01, 0x00, 0x01, 0x00, 0x00);
  const c = craft(0x01, 0x00, 0x01, 0x00, 0x00);
  oracle(o);
  fireArmedEnemyProjectilesAndDisarm(c);
  c.mem8[LANE] = 0x01; // BUG: the sweep must have cleared 0x8d75 to 0
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a non-cleared latch — it is worthless");
  assert.equal(d.addr, LANE, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: non-cleared latch caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
