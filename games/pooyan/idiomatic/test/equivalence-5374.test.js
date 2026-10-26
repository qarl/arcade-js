// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for activateLaneActorSlot (ROM 0x5374, Pooyan) — the one-shot lane-actor activator,
 * dissolved from a caller-skip into a boolean.
 *
 * The idiomatic module runs the spawn body through seedSpawnColumnAndRunBody (forwarding the computed kind byte) and
 * dissolves the rst-0x20 lookup; the oracle drives the same frozen spawn chain. activateLaneActorSlot's live-out is
 * memory PLUS the boolean caller-skip signal — true when the slot is already live (keep sweeping),
 * false when it activated one (abort the sweep) — so the boolean is asserted on every arm.
 *
 * Jobs:
 *   1. EQUAL — live slot + fresh slot: oracle == activateLaneActorSlot in RAM (−stack).
 *   2. BOOLEAN — the caller-skip signal: live -> true, fresh -> false.
 *   3. WRITE-SET — activation bumps ACTIVE_LANE_COUNT + marks the slot; the live arm holds them.
 *   4. TEETH — a wrong ACTIVE_LANE_COUNT is CAUGHT by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-5374.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_5374 as oracle } from "../../translated/loc_5374.js";
import { activateLaneActorSlot } from "../activateLaneActorSlot.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, ENEMY_ACTOR_TABLE, ACTIVE_LANE_COUNT, ROUND_COUNTER, SCRIPT_VALUE_BYTE } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = ENEMY_ACTOR_TABLE; //  the record the activator works on
const SP0 = 0x8fe0; //             inside STACK_SCRATCH

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** live=true seats a live slot (head word non-zero); live=false a fresh slot to be activated. */
function craft(live) {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.regs.ix = REC;
  m.mem8[REC + 0x00] = live ? 0x01 : 0x00; // head word: non-zero => already live
  m.mem8[REC + 0x01] = 0x00;
  m.mem8[REC + 0x07] = 0x00;
  m.mem8[ROUND_COUNTER] = 0x03; // odd round -> kind 0x1d, odd spawn tables
  m.mem8[SCRIPT_VALUE_BYTE] = 0x02; // flag-table index for the (ix+7) OR
  m.mem8[ACTIVE_LANE_COUNT] = 0x02;
  return m;
}

// -- 1. EQUAL + 2. BOOLEAN ----------------------------------------------------

test("EQUAL + BOOLEAN: live slot + fresh slot — activateLaneActorSlot == oracle in RAM (−stack), boolean matches", () => {
  for (const [label, live, want] of [["live slot", true, true], ["fresh slot", false, false]]) {
    const o = craft(live);
    oracle(o);
    const c = craft(live);
    const got = activateLaneActorSlot(c);
    assert.equal(got, want, `[${label}] boolean caller-skip signal`);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${label}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log("  EQUAL+BOOLEAN: live->true (no change), fresh->false (activated) — RAM identical");
});

// -- 3. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: activation bumps the lane tally + marks the slot; the live arm holds them", () => {
  const fresh = craft(false);
  oracle(fresh);
  assert.equal(fresh.mem8[ACTIVE_LANE_COUNT], 0x03, "fresh slot -> lane tally incremented");
  assert.equal(fresh.mem8[REC + 0x00], 0x01, "fresh slot -> marked active");

  const live = craft(true);
  oracle(live);
  assert.equal(live.mem8[ACTIVE_LANE_COUNT], 0x02, "live slot -> tally held");
  console.log("  WRITE-SET: fresh activates (tally 2->3), live holds (tally 2)");
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: a wrong ACTIVE_LANE_COUNT is CAUGHT by the RAM diff", () => {
  const o = craft(false);
  const c = craft(false);
  oracle(o);
  activateLaneActorSlot(c);
  c.mem8[ACTIVE_LANE_COUNT] = 0x02; // BUG: activation must have bumped it to 0x03
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong lane tally — it is worthless");
  assert.equal(d.addr, ACTIVE_LANE_COUNT, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong lane tally caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
