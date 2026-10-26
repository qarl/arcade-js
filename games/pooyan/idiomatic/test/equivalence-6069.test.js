// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for classifyAndRouteObjectRecordByRound (ROM 0x6069, Pooyan) — the outer-scan head. It classifies
 * the current record: a zero lead byte or a non-live kind byte is skipped to the epilogue; a live
 * record on an odd round routes to the collision handler and on an even round to the proximity
 * gate.
 *
 * SEATING: TAIL-CALL. The oracle has no ret of its own — every branch tail-`jp`s or falls through
 * to a sibling; its effective seating is the delegatee's. The module returns the delegatee's
 * boolean: true = the scan continues to normal completion, false = a caller-skip must unwind the
 * caller's frame. Compared on RAM (dumpState) minus stack scratch below the entry SP; the register file is not
 * compared. Entry registers HL/IX/B are the param-default bridge (the loop threads them).
 *
 * Cases are CRAFTED: a plain boot does not seat this record/actor/target geometry.
 *
 * Jobs:
 *   1. EQUAL — empty record (skip), wrong-kind record (skip), live+even reaching the finder main
 *      path (writes), live+odd routing through the collision handler's no-match fallback into the
 *      same hit (writes), and a live+even reaching the skip path (boolean false): oracle == module
 *      in RAM (−stack) + forwarded boolean.
 *   2. WRITE-SET — an empty/skip record leaves RAM untouched; a live hit marks the parity hit flag.
 *   3. TEETH — a wrong seeded byte is caught by the RAM diff; a skip-returns-false twin and a
 *      hit-returns-false twin are caught by the boolean check.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-6069.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_6069 as oracle } from "../../translated/loc_6069.js";
import { classifyAndRouteObjectRecordByRound } from "../classifyAndRouteObjectRecordByRound.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const FLIP = 0x881f;
const ROUND = 0x8907; // ROUND_COUNTER; bit0 selects odd(collision)/even(proximity)
const EAT = 0x8ae0;
const STRIDE = 0x18;
const TYPE = 0x8d44;
const FLAG_I0 = 0x8d1b;
const SOUND_RING_PTR = 0x8a40;
const OBJ = 0x8c50;
const IXA = 0x8840;
const IYA = 0x8848;
const KEY = 0x42;
const SEED_FIELDS = [0x00, 0x01, 0x02, 0x12, 0x16, 0x17];
const SP0 = 0x8ff0;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Seat the entry interface + shared world; the record is live and the geometry is a hit by default. */
function seat(m, { round = 0x00, lead = 0x01, kind = 0x05, iyX = 0 } = {}) {
  m.regs.hl = OBJ;
  m.regs.ix = IXA;
  m.regs.iy = IYA;
  m.regs.b = 0x01;
  m.regs.i = 0x00;
  m.regs.iff2 = false;
  m.regs.sp = SP0;
  m.mem.write8(FLIP, 0x01);
  m.mem.write8(ROUND, round);
  m.mem.write8(TYPE, 0x02);
  m.mem.write8(IXA + 0, 0);
  m.mem.write8(IXA + 2, 0);
  m.mem.write8(IYA + 0, iyX);
  m.mem.write8(IYA + 2, 0);
  for (const off of SEED_FIELDS) m.mem.write8(OBJ + off, 0xee); // pre-dirty seed targets
  m.mem.write8(OBJ + 0x00, lead); //   lead byte (0 => empty record)
  m.mem.write8(OBJ + 0x02, kind); //   kind byte (!= 5 => skip)
  m.mem.write8(OBJ + 0x14, KEY); //    the tag the proximity hit reads
  m.mem.write8(SOUND_RING_PTR, 0x43);
  for (let i = 0; i < 6; i++) {
    m.mem.write8(EAT + i * STRIDE + 0x14, (KEY ^ 0x5a) & 0xff);
    m.mem.write8(EAT + i * STRIDE + 0x16, 0x00);
  }
  return m;
}

const craftEmpty = () => seat(BASE.clone(), { lead: 0x00 });
const craftWrongKind = () => seat(BASE.clone(), { kind: 0x07 });
const craftEvenHit = () => seat(BASE.clone(), { round: 0x00 });
const craftOddHit = () => seat(BASE.clone(), { round: 0x01 });
function craftEvenSkip() {
  const m = seat(BASE.clone(), { round: 0x00 });
  m.mem.write8(EAT + 2 * STRIDE + 0x14, KEY); // enemy match...
  m.mem.write8(EAT + 2 * STRIDE + 0x16, 0x02); // ...bit1 set -> skip path
  return m;
}

const CASES = [
  { name: "empty record -> epilogue", craft: craftEmpty, ret: true },
  { name: "wrong-kind record -> epilogue", craft: craftWrongKind, ret: true },
  { name: "live even -> proximity hit/main", craft: craftEvenHit, ret: true },
  { name: "live odd -> collision fallback hit", craft: craftOddHit, ret: true },
  { name: "live even -> skip path", craft: craftEvenSkip, ret: false },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: classifyAndRouteObjectRecordByRound == oracle in RAM (−stack) + forwarded boolean", () => {
  for (const cfg of CASES) {
    const o = cfg.craft();
    const c = cfg.craft();
    oracle(o);
    const ret = classifyAndRouteObjectRecordByRound(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${cfg.name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    assert.equal(ret, cfg.ret, `${cfg.name}: forwarded boolean must be ${cfg.ret}`);
  }
  console.log(`  EQUAL: ${CASES.length} outcomes identical (RAM −stack + boolean)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: an empty record is inert; a live hit marks the parity hit flag", () => {
  const empty = craftEmpty();
  const b0 = empty.dumpState();
  oracle(empty);
  assert.deepEqual([...empty.dumpState()], [...b0], "an empty record must leave RAM untouched");

  const hit = craftEvenHit();
  oracle(hit);
  assert.equal(hit.mem.read8(FLAG_I0), 0x01, "a live hit marks the even-parity hit flag");
  console.log("  WRITE-SET: empty inert; hit flags");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong seeded byte is CAUGHT by the RAM diff", () => {
  const o = craftEvenHit();
  const c = craftEvenHit();
  oracle(o);
  classifyAndRouteObjectRecordByRound(c);
  c.mem.write8(OBJ + 0x16, (o.mem.read8(OBJ + 0x16) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted seed byte");
  assert.equal(d.addr, OBJ + 0x16, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}`);
});

test("TEETH: a hit-returns-false twin and a skip-returns-true twin are CAUGHT by the boolean", () => {
  assert.throws(
    () => assert.equal(((m) => (classifyAndRouteObjectRecordByRound(m), false))(craftEvenHit()), true),
    "a finder-main hit must continue -> true",
  );
  assert.throws(
    () => assert.equal(((m) => (classifyAndRouteObjectRecordByRound(m), true))(craftEvenSkip()), false),
    "a skip must abort -> false",
  );
  console.log("  TEETH(boolean): hit-false and skip-true twins caught");
});
