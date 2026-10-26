// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for testKindF0TightOverlap (ROM 0x630f, Pooyan) — a tight bounding-box proximity test
 * for one dispatch kind. Both axis gaps between the flip-biased actor and the target must fall
 * inside a small box; out of range on either axis skips the record to the outer-scan epilogue, and
 * inside the box engages the hit.
 *
 * SEATING: TAIL-CALL. The oracle has no ret of its own — the miss and the hit are both `jp`s to
 * siblings; its effective seating is the delegatee's. (The task scoping guessed "balanced"; the
 * oracle body has no `ret`, so it is a tail-call.) The module returns the delegatee's boolean:
 * true = the scan continues, false = a caller-skip must unwind the caller's frame. Compared on RAM
 * (dumpState) minus stack scratch below the entry SP; the register file is not compared. HL/IX/IY/B are the bridge.
 *
 * Cases are CRAFTED: a plain boot does not seat this geometry.
 *
 * Jobs:
 *   1. EQUAL — a miss (gap outside the box), a hit reaching the finder main path (writes; boolean
 *      true), and a hit whose finder matches an enemy record (boolean false): oracle == module in
 *      RAM (−stack) + boolean.
 *   2. WRITE-SET — the hit marks the parity hit flag and seeds the record; the miss is inert.
 *   3. TEETH — a wrong seeded byte is caught by the RAM diff; a miss-returns-false twin and a
 *      match-returns-true twin are caught by the boolean check.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-630f.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_630f as oracle } from "../../translated/loc_630f.js";
import { testKindF0TightOverlap } from "../testKindF0TightOverlap.js";
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
const EAT = 0x8ae0;
const STRIDE = 0x18;
const TYPE = 0x8d44;
const FLAG_I0 = 0x8d1b;
const SOUND_RING_PTR = 0x8a40;
const OBJ = 0x8c50; //  record (HL); the hit seeds it directly (no back-up)
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

function seat(m, { iyX = 6 } = {}) {
  m.regs.hl = OBJ;
  m.regs.ix = IXA;
  m.regs.iy = IYA;
  m.regs.b = 0x01;
  m.regs.i = 0x00;
  m.regs.iff2 = false;
  m.regs.sp = SP0;
  m.mem.write8(FLIP, 0x01); //   +6 bias
  m.mem.write8(TYPE, 0x02);
  m.mem.write8(IXA + 0, 0);
  m.mem.write8(IXA + 2, 0);
  m.mem.write8(IYA + 0, iyX); //  iyX == 6 -> dx 0 (inside the box)
  m.mem.write8(IYA + 2, 0);
  for (const off of SEED_FIELDS) m.mem.write8(OBJ + off, 0xee);
  m.mem.write8(OBJ + 0x14, KEY); //   the finder key (read at OBJ+0x14)
  m.mem.write8(SOUND_RING_PTR, 0x43);
  for (let i = 0; i < 6; i++) {
    m.mem.write8(EAT + i * STRIDE + 0x14, (KEY ^ 0x5a) & 0xff);
    m.mem.write8(EAT + i * STRIDE + 0x16, 0x00);
  }
  return m;
}

const craftMiss = () => seat(BASE.clone(), { iyX: 0x40 }); // dx >= 5 -> miss
const craftHitMain = () => seat(BASE.clone(), {}); // in the box, no enemy match -> finder main
function craftHitMatch() {
  const m = seat(BASE.clone(), {});
  m.mem.write8(EAT + 3 * STRIDE + 0x14, KEY); // finder finds this -> the match handler aborts
  return m;
}

const CASES = [
  { name: "miss -> epilogue", craft: craftMiss, ret: true },
  { name: "hit -> finder main", craft: craftHitMain, ret: true },
  { name: "hit -> finder match (abort)", craft: craftHitMatch, ret: false },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: testKindF0TightOverlap == oracle in RAM (−stack) + boolean", () => {
  for (const cfg of CASES) {
    const o = cfg.craft();
    const c = cfg.craft();
    oracle(o);
    const ret = testKindF0TightOverlap(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${cfg.name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    assert.equal(ret, cfg.ret, `${cfg.name}: boolean must be ${cfg.ret}`);
  }
  console.log(`  EQUAL: ${CASES.length} outcomes identical (RAM −stack + boolean)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: a hit marks the parity hit flag + seeds the record; a miss is inert", () => {
  const hit = craftHitMain();
  oracle(hit);
  assert.equal(hit.mem.read8(FLAG_I0), 0x01, "hit marks the parity hit flag");
  assert.equal(hit.mem.read8(OBJ + 0x12), 0xff, "the hit path leaves the record's +0x12 marker at 0xff");

  const miss = craftMiss();
  const b0 = miss.dumpState();
  oracle(miss);
  assert.deepEqual([...miss.dumpState()], [...b0], "a miss must leave RAM untouched");
  console.log("  WRITE-SET: hit seeds + flags; miss inert");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong seeded byte is CAUGHT by the RAM diff", () => {
  const o = craftHitMain();
  const c = craftHitMain();
  oracle(o);
  testKindF0TightOverlap(c);
  c.mem.write8(OBJ + 0x16, (o.mem.read8(OBJ + 0x16) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted seed byte");
  assert.equal(d.addr, OBJ + 0x16, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}`);
});

test("TEETH: a miss-returns-false twin and a match-returns-true twin are CAUGHT by the boolean", () => {
  assert.throws(
    () => assert.equal(((m) => (testKindF0TightOverlap(m), false))(craftMiss()), true),
    "a miss must continue -> true",
  );
  assert.throws(
    () => assert.equal(((m) => (testKindF0TightOverlap(m), true))(craftHitMatch()), false),
    "a finder match must abort -> false",
  );
  console.log("  TEETH(boolean): miss-false and match-true twins caught");
});
