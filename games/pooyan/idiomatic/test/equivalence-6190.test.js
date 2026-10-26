// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for engageMatchedSpriteObjectAndResetActor (ROM 0x6190, Pooyan) — "engage the matched target".
 *
 * The routine seats two "engaged" fields on the record IX points at (+8 := 0x01, +0xa := 0xd0)
 * and then tail-continues into the actor-record reset chain (0x6166), which resets the record
 * IY points at, enqueues one of two fixed sound commands chosen by ACTIVE_OBJECT_TYPE, and ends
 * in the caller-skip (0x618a) that clears the type and aborts the frame. So a full run exercises
 * engageMatchedSpriteObjectAndResetActor -> resetActorRecordQueueSoundAndAbortFrame -> the sound helper -> clearActiveObjectTypeAndAbortHandler.
 *
 * Cycle-free memory-equivalence gate composed over the REAL idiomatic chain: the oracle drives
 * the translated chain (its own sound helper + pop-af skip) and the module drives the idiomatic
 * chain; both are compared on RAM (dumpState, minus stack scratch below the entry SP). No register survives the
 * terminating skip (its dropped pop-af clobbers A/flags), so the register file is not compared;
 * the module returns false (the chain always aborts).
 *
 * SP is parked in STACK_SCRATCH so the oracle's pushes (the inner sound call) and the skip's
 * pop-af+ret all land in the dead-stack region and drop out of the RAM diff.
 *
 * Jobs:
 *   1. EQUAL — both object-type branches (!= 3 enqueues the sound-command ring; == 3 the text
 *      ring, gated shut on an unbooted machine): oracle == module in RAM (−stack).
 *   2. WRITE-SET — engageMatchedSpriteObjectAndResetActor's OWN writes are +8 := 0x01 and +0xa := 0xd0 (the chain's further
 *      writes are covered by EQUAL).
 *   3. TEETH — a wrong engaged byte is caught by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-6190.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_6190 as oracle } from "../../translated/loc_6190.js";
import { engageMatchedSpriteObjectAndResetActor } from "../engageMatchedSpriteObjectAndResetActor.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const ACTIVE_OBJECT_TYPE = 0x8d44;
const SOUND_RING_PTR = 0x8a40; // ring write cursor, seeded to a realistic slot
const REC_FIELDS = [0x00, 0x01, 0x02, 0x13, 0x14, 0x16, 0x17]; // the reset chain's record fields
const SP_SCRATCH = 0x8ff0;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP_SCRATCH);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** A fresh clone with IX (engaged record), IY (reset record), object type, and ring cursor seated. */
function craft(ix, iy, objType) {
  const m = BASE.clone();
  m.regs.ix = ix & 0xffff;
  m.regs.iy = iy & 0xffff;
  for (const off of REC_FIELDS) m.mem.write8((iy + off) & 0xffff, 0xee); // pre-dirty reset fields
  m.mem.write8(ACTIVE_OBJECT_TYPE, objType & 0xff);
  m.mem.write8(SOUND_RING_PTR, 0x43);
  m.regs.sp = SP_SCRATCH;
  return m;
}

const CASES = [
  { ix: 0x8b70, iy: 0x8c50, objType: 0x00 }, // != 3 -> sound-command ring path
  { ix: 0x8ba0, iy: 0x8c50, objType: 0x03 }, // == 3 -> text-ring path
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: engageMatchedSpriteObjectAndResetActor == oracle in RAM (−stack) over both object-type branches", () => {
  for (const { ix, iy, objType } of CASES) {
    const o = craft(ix, iy, objType);
    const c = craft(ix, iy, objType);
    oracle(o);
    const ret = engageMatchedSpriteObjectAndResetActor(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `objType=${hx(objType)}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    assert.equal(ret, false, `the chain ends in the caller-skip -> false (objType=${hx(objType)})`);
  }
  console.log(`  EQUAL: ${CASES.length} branches identical (RAM −stack), chain returns false`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: engageMatchedSpriteObjectAndResetActor's own writes are +8 := 0x01 and +0xa := 0xd0", () => {
  const { ix, iy, objType } = CASES[0];
  const c = craft(ix, iy, objType);
  engageMatchedSpriteObjectAndResetActor(c);
  assert.equal(c.mem.read8((ix + 0x08) & 0xffff), 0x01, "engaged state (+8)");
  assert.equal(c.mem.read8((ix + 0x0a) & 0xffff), 0xd0, "engaged parameter (+0xa)");

  const o = craft(ix, iy, objType);
  oracle(o);
  assert.equal(o.mem.read8((ix + 0x08) & 0xffff), 0x01, "oracle agrees on +8");
  assert.equal(o.mem.read8((ix + 0x0a) & 0xffff), 0xd0, "oracle agrees on +0xa");
  console.log(`  WRITE-SET: ${hx((ix + 8) & 0xffff)} := 0x01, ${hx((ix + 0xa) & 0xffff)} := 0xd0`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong engaged byte is CAUGHT by the RAM diff", () => {
  const { ix, iy, objType } = CASES[0];
  const o = craft(ix, iy, objType);
  const c = craft(ix, iy, objType);
  oracle(o);
  engageMatchedSpriteObjectAndResetActor(c);
  const victim = (ix + 0x08) & 0xffff;
  c.mem.write8(victim, 0x00); // BUG: engaged state must be 0x01
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong engaged byte — it is worthless");
  assert.equal(d.addr, victim, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
