// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for testRecordOverlapRetireOrFlagHit (ROM 0x5fa2, Pooyan) — one pass of the six-slot overlap scan.
 *
 * The record pointer (HL = 0x8ae0, stride 0x18) supplies each slot's lead + type bytes; the position
 * pointer (IX = 0x8850, stride 4) its box; the target box is IY; the hit type is C; the screen-flip
 * flag (0x881f) sets the X bias. An empty/non-type-5 slot or an out-of-window box tail-loops through
 * the advance latch (advanceOverlapScanToNextSlot); a type-3 overlap tails the retire handler (retireResetOrEngageObjectRecord) after tallying
 * 0x8d45; any other overlap flags the two struck cells (0x8c91/0x8ca9 + partner), sounds the hit
 * (queueSoundCommand09), and skip-returns. The whole subtree runs on both sides from an identical clone.
 *
 * SEATING: miss/hit exits TAIL to advanceOverlapScanToNextSlot/retireResetOrEngageObjectRecord; the general hit is a caller-skip dissolved to a
 * boolean. Protocol: true = the sweep exhausted with no hit, false = a hit. Compared on RAM
 * (dumpState) minus stack scratch below the entry SP plus the boolean; the register file is not compared. Cases are
 * CRAFTED — a plain boot does not seat this geometry. Green once the batch siblings (advanceOverlapScanToNextSlot/retireResetOrEngageObjectRecord
 * subtree, queueSoundCommand09) and the 0x8d45/0x8c91/0x8ca9 cells land.
 *
 * Jobs:
 *   1. EQUAL — an exhausted sweep, a window-miss then exhaust, two general hits (both cell branches),
 *      and a type-3 hit: oracle == module in RAM (−stack) and the boolean matches.
 *   2. WRITE-SET — a general hit flags exactly its struck cell + partner; a type-3 hit tallies 0x8d45.
 *   3. TEETH — a wrong flag/tally is caught by the RAM diff; a hit-returns-true and an
 *      exhausted-returns-false twin are caught by the boolean check.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-5fa2.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_5fa2 as oracle } from "../../translated/loc_5fa2.js";
import { testRecordOverlapRetireOrFlagHit } from "../testRecordOverlapRetireOrFlagHit.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const EAT = 0x8ae0; //     record pointer (HL), stride 0x18: +0 lead, +2 type
const BOX = 0x8850; //     position pointer (IX), stride 4: +0 x, +2 y
const TARGET_A = 0x8848; //  target box (low byte 0x48 -> cell A)
const TARGET_B = 0x8849; //  target box (low byte != 0x48 -> cell B)
const FLIP = 0x881f; //    screen-flip flag; nonzero -> +6 X bias
const CELL_A = 0x8c91; //    struck cell for the 0x48 target-low branch
const CELL_B = 0x8ca9; //    struck cell for the other branch
const PARTNER = 0x06; //    both hits also flag cell + 6
const MARK = 0x8d45; //     type-3 hit tally
const OBJTYPE = 0x8d44; //  active object type (zeroed by the type-3 retire path)
const REC_STRIDE = 0x18;
const BOX_STRIDE = 0x04;
const SP0 = 0x8fe0;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/**
 * Seat the scan cursor + world. `records`/`boxes` are per-slot overrides; unlisted slots are empty.
 * The default target sits at the origin so a zero box + the +6 flip bias is a hit.
 */
function seat(m, { type = 0x02, flip = 0x01, target = TARGET_A, records = {}, boxes = {} } = {}) {
  m.regs.hl = EAT;
  m.regs.ix = BOX;
  m.regs.b = 0x06;
  m.regs.c = type;
  m.regs.iy = target;
  m.regs.sp = SP0;
  m.mem.write8(FLIP, flip);
  m.mem.write8(target + 0, 0x00);
  m.mem.write8(target + 2, 0x00);
  m.mem.write8(MARK, 0x00);
  m.mem.write8(OBJTYPE, type);
  for (let i = 0; i < 6; i++) {
    const r = records[i] || { lead: 0x00, type: 0x00 };
    m.mem.write8(EAT + i * REC_STRIDE + 0, r.lead);
    m.mem.write8(EAT + i * REC_STRIDE + 2, r.type);
    const b = boxes[i] || { x: 0x00, y: 0x00 };
    m.mem.write8(BOX + i * BOX_STRIDE + 0, b.x);
    m.mem.write8(BOX + i * BOX_STRIDE + 2, b.y);
  }
  return m;
}

const HIT_REC = { 0: { lead: 0x01, type: 0x05 } };
const T3_REC = { 0: { lead: 0x02, type: 0x05 } }; // bit0 clear -> retireResetOrEngageObjectRecord retires via clearActiveObjectTypeAndAbortHandler
const FAR_BOX = { 0: { x: 0x40, y: 0x00 } }; //     posX=0x46 -> dx way outside the window

const craftExhaust = () => seat(BASE.clone(), { type: 0x02 }); //                    all slots empty
const craftWindowMiss = () => seat(BASE.clone(), { type: 0x02, records: HIT_REC, boxes: FAR_BOX });
const craftHitA = () => seat(BASE.clone(), { type: 0x02, target: TARGET_A, records: HIT_REC });
const craftHitB = () => seat(BASE.clone(), { type: 0x02, target: TARGET_B, records: HIT_REC });
const craftType3 = () => seat(BASE.clone(), { type: 0x03, target: TARGET_A, records: T3_REC });

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: every path — testRecordOverlapRetireOrFlagHit == oracle in RAM (−stack) and the boolean matches", () => {
  const cases = [
    ["exhaust", craftExhaust, true],
    ["window-miss", craftWindowMiss, true],
    ["hit-A", craftHitA, false],
    ["hit-B", craftHitB, false],
    ["type-3", craftType3, false],
  ];
  for (const [label, craft, wantBool] of cases) {
    const o = craft();
    const c = craft();
    const rc = testRecordOverlapRetireOrFlagHit(c);
    const ro = oracle(o);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${label}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    assert.equal(rc, wantBool, `${label}: module boolean`);
    // The frozen oracle dissolves the hit/no-hit outcome into pc/stack control flow and returns
    // undefined (its advanceOverlapScanToNextSlot/retireResetOrEngageObjectRecord tail-return chain, unlike climbHunterToLaunchRowThenPromoteGroup's explicit `return
    // true/false`); the boolean is a module-layer live-out, anchored here by the RAM diff above
    // and the module boolean, so the oracle's own JS return carries no boolean to compare.
    assert.equal(ro, undefined, `${label}: frozen oracle returns no JS boolean`);
  }
  console.log(`  EQUAL: ${cases.length} paths identical (RAM −stack) with matching boolean`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: a general hit flags exactly its struck cell + partner", () => {
  for (const [label, craft, cell] of [["A", craftHitA, CELL_A], ["B", craftHitB, CELL_B]]) {
    const m = craft();
    const b0 = m.dumpState();
    testRecordOverlapRetireOrFlagHit(m);
    const a1 = m.dumpState();
    for (let off = 0; off < b0.length; off++) {
      if (b0[off] === a1[off]) continue;
      const addr = m.stateOffsetToAddr(off);
      if (inDeadStack(addr)) continue; // sound-ring trampoline pushes are not game state
      const ok = addr === cell || addr === cell + PARTNER || (addr >= 0x8a00 && addr < 0x8c00);
      assert.ok(ok, `hit-${label}: unexpected write at ${hx(addr)}`); // ring writes live in the sound area
    }
    assert.equal(m.mem.read8(cell), 0x01, `hit-${label}: struck cell ${hx(cell)}`);
    assert.equal(m.mem.read8(cell + PARTNER), 0x01, `hit-${label}: partner ${hx(cell + PARTNER)}`);
    console.log(`  WRITE-SET(hit-${label}): ${hx(cell)} + ${hx(cell + PARTNER)} = 1`);
  }
});

test("WRITE-SET: a type-3 hit tallies 0x8d45 and clears the active type", () => {
  const m = craftType3();
  assert.equal(m.mem.read8(MARK), 0x00, "precondition: tally starts at 0");
  testRecordOverlapRetireOrFlagHit(m);
  assert.equal(m.mem.read8(MARK), 0x01, "type-3 hit must bump the 0x8d45 tally");
  assert.equal(m.mem.read8(OBJTYPE), 0x00, "the retire path clears the active object type");
  console.log(`  WRITE-SET(type-3): ${hx(MARK)} 0->1, ${hx(OBJTYPE)} cleared`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong struck-cell flag is CAUGHT by the RAM diff", () => {
  const o = craftHitA();
  const c = craftHitA();
  oracle(o);
  testRecordOverlapRetireOrFlagHit(c);
  c.mem.write8(CELL_A, 0x00); // BUG: the struck cell must latch to 1
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a cleared struck cell");
  assert.equal(d.addr, CELL_A, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(flag): caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong 0x8d45 tally is CAUGHT by the RAM diff", () => {
  const o = craftType3();
  const c = craftType3();
  oracle(o);
  testRecordOverlapRetireOrFlagHit(c);
  c.mem.write8(MARK, 0x05); // BUG: the tally must be exactly one more than it started
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong tally");
  assert.equal(d.addr, MARK, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(tally): caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong boolean is CAUGHT (hit->true, exhausted->false twins)", () => {
  assert.throws(() => assert.equal(((m) => (testRecordOverlapRetireOrFlagHit(m), true))(craftHitA()), false),
    "a hit must return false");
  assert.throws(() => assert.equal(((m) => (testRecordOverlapRetireOrFlagHit(m), false))(craftExhaust()), true),
    "an exhausted sweep must return true");
  console.log("  TEETH(boolean): hit-returns-true and exhausted-returns-false twins caught");
});
