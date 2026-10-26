// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for resolveKind50AndD0CollisionAward (ROM 0x6287, Pooyan) — proximity test and award for one
 * dispatch kind. Too wide a gap on either axis skips the record to the outer-scan epilogue. One
 * kind engages the target directly; the other latches the actor onto the record, installs its
 * animation, adds the round-indexed position delta, then hands off to the record re-arm.
 *
 * SEATING: TAIL-CALL. The oracle has no ret of its own — the miss and the direct kind `jp` to
 * siblings and the award kind falls through into the re-arm; its effective seating is the
 * delegatee's. The module returns the delegatee's boolean: true = the scan continues, false = a
 * caller-skip must unwind the caller's frame (the re-arm always aborts). Compared on RAM
 * (dumpState) minus stack scratch below the entry SP; the register file is not compared. The dispatch kind (A) and
 * HL/IX/IY/B are the param-default bridge.
 *
 * Cases are CRAFTED: a plain boot does not seat this geometry.
 *
 * Jobs:
 *   1. EQUAL — a miss (epilogue), the direct kind reaching the finder main path (writes, true), and
 *      the award kind (latches, steps deltas, re-arms; false): oracle == module RAM (−stack) + bool.
 *   2. WRITE-SET — the award kind installs the animation pointer at the record and steps its delta.
 *   3. TEETH — a wrong animation byte is caught by the RAM diff; a miss-returns-false twin and an
 *      award-returns-true twin are caught by the boolean check.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-6287.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_6287 as oracle } from "../../translated/loc_6287.js";
import { resolveKind50AndD0CollisionAward } from "../resolveKind50AndD0CollisionAward.js";
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
const ROUND = 0x8907;
const EAT = 0x8ae0;
const STRIDE = 0x18;
const TYPE = 0x8d44;
const FLAG_I0 = 0x8d1b;
const SOUND_RING_PTR = 0x8a40;
const OBJ = 0x8c50;
const IXA = 0x8840;
const IYA = 0x8848;
const KEY = 0x42;
const KIND_DIRECT = 0x50;
const KIND_AWARD = 0xd0;
const SEED_FIELDS = [0x00, 0x01, 0x02, 0x12, 0x16, 0x17];
const SP0 = 0x8ff0;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

function seat(m, { kind = KIND_AWARD, iyX = 6 } = {}) {
  m.regs.a = kind; //   the dispatch kind (C on entry) — via the default bridge
  m.regs.hl = OBJ;
  m.regs.ix = IXA;
  m.regs.iy = IYA;
  m.regs.b = 0x01;
  m.regs.i = 0x00;
  m.regs.iff2 = false;
  m.regs.sp = SP0;
  m.mem.write8(FLIP, 0x01); //   +6 bias
  m.mem.write8(ROUND, 0x00); //  delta index 0
  m.mem.write8(TYPE, 0x02);
  m.mem.write8(IXA + 0, 0);
  m.mem.write8(IXA + 2, 0);
  m.mem.write8(IYA + 0, iyX); //  iyX 6 -> dx 0 (in range)
  m.mem.write8(IYA + 2, 0);
  for (const off of SEED_FIELDS) m.mem.write8(OBJ + off, 0xee);
  m.mem.write8(OBJ + 0x0a, 0x10); //   delta field seed (award adds into it)
  m.mem.write8(OBJ + 0x14, KEY);
  m.mem.write8(SOUND_RING_PTR, 0x43);
  for (let i = 0; i < 6; i++) {
    m.mem.write8(EAT + i * STRIDE + 0x14, (KEY ^ 0x5a) & 0xff);
    m.mem.write8(EAT + i * STRIDE + 0x16, 0x00);
  }
  m.mem.write8(EAT + 2 * STRIDE + 0x14, KEY); // the award re-arm re-finds this slot
  return m;
}

const craftMiss = () => seat(BASE.clone(), { iyX: 0x40 });
function craftDirect() {
  const m = seat(BASE.clone(), { kind: KIND_DIRECT });
  for (let i = 0; i < 6; i++) m.mem.write8(EAT + i * STRIDE + 0x14, (KEY ^ 0x5a) & 0xff); // no match -> finder main
  return m;
}
const craftAward = () => seat(BASE.clone(), { kind: KIND_AWARD });

const CASES = [
  { name: "miss -> epilogue", craft: craftMiss, ret: true },
  { name: "direct kind -> finder main", craft: craftDirect, ret: true },
  { name: "award kind -> re-arm (abort)", craft: craftAward, ret: false },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: resolveKind50AndD0CollisionAward == oracle in RAM (−stack) + boolean", () => {
  for (const cfg of CASES) {
    const o = cfg.craft();
    const c = cfg.craft();
    oracle(o);
    const ret = resolveKind50AndD0CollisionAward(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${cfg.name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    assert.equal(ret, cfg.ret, `${cfg.name}: boolean must be ${cfg.ret}`);
  }
  console.log(`  EQUAL: ${CASES.length} outcomes identical (RAM −stack + boolean)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the award kind installs the animation pointer + steps the record's delta", () => {
  const seedDelta = 0x10;
  const award = craftAward();
  oracle(award);
  assert.equal(award.mem.read8(OBJ + 0x0e), 0x00, "award resets the record's frame index");
  assert.notEqual(award.mem.read8(OBJ + 0x0a), seedDelta, "award steps the record's delta field");

  const miss = craftMiss();
  const b0 = miss.dumpState();
  oracle(miss);
  assert.deepEqual([...miss.dumpState()], [...b0], "a miss must leave RAM untouched");
  console.log("  WRITE-SET: award installs anim + steps delta; miss inert");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong animation byte is CAUGHT by the RAM diff", () => {
  const o = craftAward();
  const c = craftAward();
  oracle(o);
  resolveKind50AndD0CollisionAward(c);
  c.mem.write8(OBJ + 0x0c, (o.mem.read8(OBJ + 0x0c) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted animation byte");
  assert.equal(d.addr, OBJ + 0x0c, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}`);
});

test("TEETH: a miss-returns-false twin and an award-returns-true twin are CAUGHT by the boolean", () => {
  assert.throws(
    () => assert.equal(((m) => (resolveKind50AndD0CollisionAward(m), false))(craftMiss()), true),
    "a miss must continue -> true",
  );
  assert.throws(
    () => assert.equal(((m) => (resolveKind50AndD0CollisionAward(m), true))(craftAward()), false),
    "the award re-arm must abort -> false",
  );
  console.log("  TEETH(boolean): miss-false and award-true twins caught");
});
