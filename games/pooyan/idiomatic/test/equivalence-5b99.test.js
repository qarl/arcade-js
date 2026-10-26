// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for testEnemyRecordHitAndRegister (ROM 0x5b99, Pooyan) — the proximity/collision test of one
 * actor record against the target pair, plus hit registration.
 *
 * SEATING: CALLER-SKIP. The ROM hit exits do `pop af; ret`, unwinding past the caller; the module
 * DISSOLVES that into a boolean — true = normal completion (guard fail or no hit; the caller keeps
 * sweeping), false = a hit fired and the caller must abort its frame. Compared on RAM (dumpState)
 * minus stack scratch below the entry SP plus the forwarded boolean; the register file is not compared.
 *
 * RECONCILE DEPENDENCY: the module imports the idiomatic fetchWordFromTableIndex (the animation-pointer lookup)
 * and the proposed names ANIM_SEQ_5C80/5C89/5CF9 and ANIM_SEQ_TABLE_5C92; the slot-found case runs
 * once fetchWordFromTableIndex lands and those names exist in names.js. fetchWordFromTableIndex reads ROM, so ROM must be built.
 *
 * Cases are CRAFTED: a plain boot does not seat this record/target geometry.
 *
 * Jobs:
 *   1. EQUAL — four guard fails, a no-hit sweep (all true), a hit with no matching slot and a hit
 *      with a matching slot (both false): oracle == module in RAM (−stack) + forwarded boolean.
 *   2. WRITE-SET — a guard fail leaves RAM untouched; a hit stamps the record's struck fields.
 *   3. TEETH — a wrong seeded byte is caught by the RAM diff; a hit-returns-true twin and a
 *      guard-returns-false twin are caught by the boolean check.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-5b99.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_5b99 as oracle } from "../../translated/loc_5b99.js";
import { testEnemyRecordHitAndRegister } from "../testEnemyRecordHitAndRegister.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { FLIP_SCREEN_FLAG, ROUND_COUNTER, ENEMY_TARGET_REC0, SPRITE_OBJECT_TABLE, STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = 0x8840; // IX record
const TARGET = ENEMY_TARGET_REC0; // 0x8c90, first of the target pair
const SLOT0 = SPRITE_OBJECT_TABLE; // 0x8b70, first sprite-object slot
const TAG = 0x42; // record/slot match tag
const SP0 = 0x8ff0;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0 - 4); // entry SP: the seat pushes two return words below SP0
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/**
 * Seat a full hit-with-matching-slot geometry, then apply overrides. recX=0x80, xBias=0x10 (FLIP
 * set) and target_x=0x90 give dx=0; recY=0x80, yBias=0x12 (round even) and target_y=0x6e give dy=0.
 */
function seat(m, over = {}) {
  const o = { armed: 1, active: 1, flagged: 1, mode: 0x05, present: 0x01, targetX: 0x90, targetY: 0x6e, slotMatch: true, ...over };
  m.regs.sp = SP0;
  m.push16(0xabcd); // dead-stack returns for the ROM ret / pop-af;ret
  m.push16(0xdcba);
  m.regs.ix = REC;
  m.mem.write8(FLIP_SCREEN_FLAG, 0x01); // xBias = 0x10
  m.mem.write8(ROUND_COUNTER, 0x00); //   yBias = 0x12 (bit0 clear)
  m.mem.write8(REC + 0x0b, o.armed);
  m.mem.write8(REC + 0x00, o.active);
  m.mem.write8(REC + 0x16, o.flagged);
  m.mem.write8(REC + 0x02, o.mode);
  m.mem.write8(REC + 0x05, 0x00);
  m.mem.write8(REC + 0x06, 0x10); // recX = 0x80
  m.mem.write8(REC + 0x03, 0x00);
  m.mem.write8(REC + 0x04, 0x10); // recY = 0x80
  m.mem.write8(REC + 0x07, 0x30); // bit1 clear -> anim A; class nibble = 3
  m.mem.write8(REC + 0x14, TAG);
  m.mem.write8(TARGET + 0x00, o.present);
  m.mem.write8(TARGET + 0x06, o.targetX);
  m.mem.write8(TARGET + 0x04, o.targetY);
  if (o.slotMatch) {
    m.mem.write8(SLOT0 + 0x14, TAG); // slot 0 carries the record's tag
    m.mem.write8(SLOT0 + 0x0b, 0x00); // no override -> keep the looked-up pointer
  }
  return m;
}

const CASES = [
  { name: "guard: not armed", craft: () => { const m = seat(BASE.clone(), { armed: 0x00 }); m.mem.write8(ROUND_COUNTER, 0x01); return m; }, ret: true },
  { name: "guard: inactive", craft: () => seat(BASE.clone(), { active: 0x00 }), ret: true },
  { name: "guard: flag clear", craft: () => seat(BASE.clone(), { flagged: 0x00 }), ret: true },
  { name: "guard: not mode 5", craft: () => seat(BASE.clone(), { mode: 0x04 }), ret: true },
  { name: "no hit (target out of range)", craft: () => seat(BASE.clone(), { targetX: 0x00 }), ret: true },
  { name: "hit, no matching slot", craft: () => seat(BASE.clone(), { slotMatch: false }), ret: false },
  { name: "hit, matching slot", craft: () => seat(BASE.clone()), ret: false },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: testEnemyRecordHitAndRegister == oracle in RAM (−stack) + forwarded boolean", () => {
  for (const cfg of CASES) {
    const o = cfg.craft();
    const c = cfg.craft();
    oracle(o);
    const ret = testEnemyRecordHitAndRegister(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${cfg.name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    assert.equal(ret, cfg.ret, `${cfg.name}: forwarded boolean must be ${cfg.ret}`);
  }
  console.log(`  EQUAL: ${CASES.length} outcomes identical (RAM −stack + boolean)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: a guard fail is inert; a hit stamps the record's struck fields", () => {
  const guard = seat(BASE.clone(), { active: 0x00 });
  const b0 = guard.dumpState();
  oracle(guard);
  assert.deepEqual([...guard.dumpState()], [...b0], "a guard fail must leave RAM untouched");

  const hit = seat(BASE.clone(), { slotMatch: false });
  oracle(hit);
  assert.equal(hit.mem.read8(REC + 0x12), 0x10, "a hit sets the record's struck timer");
  assert.equal(hit.mem.read8(REC + 0x16), 0x02, "a hit sets the record's struck state");
  console.log("  WRITE-SET: guard inert; hit stamps struck fields");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong seeded byte is CAUGHT by the RAM diff", () => {
  const o = seat(BASE.clone(), { slotMatch: false });
  const c = seat(BASE.clone(), { slotMatch: false });
  oracle(o);
  testEnemyRecordHitAndRegister(c);
  c.mem.write8(REC + 0x12, (o.mem.read8(REC + 0x12) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted struck byte");
  assert.equal(d.addr, REC + 0x12, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}`);
});

test("TEETH: a hit-returns-true twin and a guard-returns-false twin are CAUGHT by the boolean", () => {
  assert.throws(
    () => assert.equal(((m) => (testEnemyRecordHitAndRegister(m), true))(seat(BASE.clone(), { slotMatch: false })), false),
    "a hit must abort -> false",
  );
  assert.throws(
    () => assert.equal(((m) => (testEnemyRecordHitAndRegister(m), false))(seat(BASE.clone(), { active: 0x00 })), true),
    "a guard fail must continue -> true",
  );
  console.log("  TEETH(boolean): hit-true and guard-false twins caught");
});
