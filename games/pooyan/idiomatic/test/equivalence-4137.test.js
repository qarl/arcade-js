// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for descendObjectToLanding (ROM 0x4137, Pooyan) — a per-object descent step for the
 * record at IX: animate (advanceObjectAnimationFrame), advance the position by the signed step with a sub-position
 * borrow, and while still travelling return; on landing latch the sound id, reset the object, and
 * tail (via the dissolved fetchWordFromTableIndex + setActorAnimation) into its landing animation.
 *
 * descendObjectToLanding is void — no register survives — so the register file is not compared; equivalence is
 * RAM (dumpState) minus stack scratch below the entry SP via firstStateDiff, SP parked in dead stack. IX is passed
 * through the param bridge. advanceObjectAnimationFrame is held on its frame-hold arm (+0x0e nonzero) so the diff
 * isolates the descent step; the dissolved fetchWordFromTableIndex / setActorAnimation read/write identical bytes.
 *
 * Jobs:
 *   1. EQUAL — the LAND path (lands, latches, re-animates) and the TRAVEL path (still moving,
 *      early return): oracle == descendObjectToLanding in RAM (−stack).
 *   2. WRITE-SET — landing latches the sound id at SOUND_ID_LATCH; travelling does not.
 *   3. TEETH — a wrong sound-id latch is CAUGHT by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-4137.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_4137 as oracle } from "../../translated/loc_4137.js";
import { descendObjectToLanding } from "../descendObjectToLanding.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = 0x8b00; //       object record base (work RAM, so its fields are diffed)
const SOUND_LATCH = 0x8d1d; // SOUND_ID_LATCH_8D1D: (+0x17)+1 on landing
const SP0 = 0x8ff0; //       inside STACK_SCRATCH

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** A record with advanceObjectAnimationFrame on its frame-hold arm; `land` picks the landing vs travelling descent. */
function craft(land) {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.regs.ix = REC;
  m.mem8[REC + 0x0e] = 0x05; // advanceObjectAnimationFrame: frame-hold running -> dec + return
  if (land) {
    m.mem8[REC + 0x0a] = 0xfe; // step -2
    m.mem8[REC + 0x03] = 0x05; // position 5 >= 2 -> no borrow
    m.mem8[REC + 0x04] = 0x02; // sub-position 2; < 3 -> landed
    m.mem8[REC + 0x17] = 0x04; // sound id -> latch 0x05
  } else {
    m.mem8[REC + 0x0a] = 0x02; // step +2
    m.mem8[REC + 0x03] = 0x10; // position < -(step) -> borrow
    m.mem8[REC + 0x04] = 0x05; // sub-position 5 -> dec to 4; >= 3 -> still travelling
  }
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: land + travel paths — descendObjectToLanding == oracle in RAM (−stack)", () => {
  for (const [label, land] of [["land", true], ["travel", false]]) {
    const o = craft(land);
    oracle(o);
    const c = craft(land);
    descendObjectToLanding(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${label}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log("  EQUAL: land + travel identical (RAM −stack)");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: landing latches the sound id, travelling does not", () => {
  const land = craft(true);
  oracle(land);
  assert.equal(land.mem8[SOUND_LATCH], 0x05, "landed -> (ix+17h)+1 latched");
  assert.equal(land.mem8[REC + 0x02], 0x02, "landed -> object reset to phase 2");

  const travel = craft(false);
  oracle(travel);
  assert.equal(travel.mem8[SOUND_LATCH], 0x00, "travelling -> no sound latch");
  assert.equal(travel.mem8[REC + 0x03], 0x12, "travelling -> position advanced 0x10 + 2");

  assert.notEqual(land.mem8[SOUND_LATCH], travel.mem8[SOUND_LATCH], "landing must gate the latch");
  console.log("  WRITE-SET: land latches 0x05, travel holds 0x00");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong sound-id latch is CAUGHT by the RAM diff", () => {
  const o = craft(true);
  const c = craft(true);
  oracle(o);
  descendObjectToLanding(c);
  c.mem8[SOUND_LATCH] = 0x00; // BUG: landing must latch 0x05
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong sound latch — it is worthless");
  assert.equal(d.addr, SOUND_LATCH, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong sound latch caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
