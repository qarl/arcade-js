// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for dispatchAllEnemyActorStates (ROM 0x3377, Pooyan) — the per-record state sweep. Walks
 * the 14 enemy actor records at 0x8ae0 (stride 0x18) in order, running the per-record state
 * dispatcher (dispatchActiveEnemyActorState) on each.
 *
 * SEATING: BALANCED-WIRE. The oracle ends with a plain `ret` (net SP 0); each per-record
 * dispatch is a plain call that returns to the sweep — the sweep seats no return slot.
 * A void driver — no register is read back — so the register file is not compared; equivalence
 * is RAM (dumpState) minus stack scratch below the entry SP, SP parked in scratch so the dispatch's nested pushes
 * drop out of the diff.
 *
 * The states are CRAFTED: records 0 and 13 are seated to pass the dispatcher gate and route to
 * the frame-hold state handler (index 2) with their hold fields kept high, so each dispatch just
 * ticks two record-local counters and returns — a contained, observable footprint. The other 12
 * records are gate-inert. That isolates dispatchAllEnemyActorStates's own job — the base, stride, order, and count
 * of the walk — from the handlers' internals, which their own gates cover.
 *
 * Jobs:
 *   1. EQUAL — inert (all records gate-fail) and rich (records 0 and 13 dispatch): module ==
 *      oracle in RAM (−stack).
 *   2. WRITE-SET — an all-inert sweep leaves RAM untouched; a dispatching record's hold fields tick.
 *   3. TEETH — a wrong record byte is caught by the RAM diff; a short sweep (13 records, last
 *      dropped) diverges at the missed record's footprint.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-3377.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_3377 as oracle } from "../../translated/loc_3377.js";
import { dispatchAllEnemyActorStates } from "../dispatchAllEnemyActorStates.js";
import { dispatchActiveEnemyActorState } from "../dispatchActiveEnemyActorState.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, ENEMY_ACTOR_TABLE } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const EAT = ENEMY_ACTOR_TABLE; // 0x8ae0
const STRIDE = 0x18;
const COUNT = 0x0e; // 14 records
const ACTIVE = 0x00; // record active-flag byte (bit0 set -> dispatch)
const STATE = 0x02; //  record state byte; &0x1f is the handler index
const ANIM_HOLD = 0x0e; // frame-hold field the animation stepper decrements
const HOLD = 0x11; //     frame-hold field the state handler decrements
const IDX_FRAME_HOLD = 0x02; // handler index 2 = the frame-hold tick
const SP0 = 0x8ff0; // inside STACK_SCRATCH

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Clear all 14 records to gate-inert (active byte 0). */
function clearTable(m) {
  m.regs.sp = SP0;
  for (let i = 0; i < COUNT; i++) for (let b = 0; b < STRIDE; b++) m.mem.write8(EAT + i * STRIDE + b, 0x00);
  return m;
}

/** Seat one record so it passes the dispatcher gate and routes to the frame-hold handler. */
function dispatchRecord(m, i) {
  const rec = EAT + i * STRIDE;
  m.mem.write8(rec + ACTIVE, 0x01); //     bit0 set -> active
  m.mem.write8(rec + STATE, IDX_FRAME_HOLD); // handler index 2
  m.mem.write8(rec + ANIM_HOLD, 0x05); //  anim stepper just decrements (stays > 0)
  m.mem.write8(rec + HOLD, 0x05); //       state handler just decrements (stays > 0)
}

const craftInert = () => clearTable(BASE.clone());
function craftRich() {
  const m = clearTable(BASE.clone());
  dispatchRecord(m, 0);
  dispatchRecord(m, 13);
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

for (const [label, craft] of [["inert (all gate-fail)", craftInert], ["rich (records 0 and 13 dispatch)", craftRich]]) {
  test(`EQUAL: ${label} — module == oracle in RAM (−stack)`, () => {
    const o = craft();
    const c = craft();
    oracle(o);
    dispatchAllEnemyActorStates(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${label}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    console.log(`  EQUAL ${label}: RAM identical`);
  });
}

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: an inert sweep is untouched; a dispatching record ticks its hold fields", () => {
  const inertBefore = craftInert();
  const inertAfter = craftInert();
  oracle(inertAfter); // per-record pushes land only in STACK_SCRATCH (excluded)
  const di = ramDiffMinusStack(inertBefore, inertAfter);
  assert.equal(di, null, di && `an all-inert sweep must leave RAM untouched: diff at ${hx(di.addr ?? 0)}`);

  const rich = craftRich();
  oracle(rich);
  assert.equal(rich.mem.read8(EAT + 0 * STRIDE + HOLD), 0x04, "record 0 hold must tick");
  assert.equal(rich.mem.read8(EAT + 13 * STRIDE + HOLD), 0x04, "record 13 hold must tick");
  console.log("  WRITE-SET: inert untouched; dispatching records tick");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong record byte is CAUGHT by the RAM diff", () => {
  const o = craftRich();
  const c = craftRich();
  oracle(o);
  dispatchAllEnemyActorStates(c);
  const addr = EAT + 13 * STRIDE + HOLD;
  c.mem.write8(addr, (o.mem.read8(addr) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted record byte");
  assert.equal(d.addr, addr, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}`);
});

test("TEETH: a short sweep (13 records, last dropped) diverges at the missed record", () => {
  const o = craftRich();
  const twin = craftRich();
  oracle(o);
  let rec = EAT;
  // mirror dispatchAllEnemyActorStates's per-record IX bridge (the dispatched handlers read the record through IX)
  for (let i = 0; i < COUNT - 1; i++) { twin.regs.ix = rec; dispatchActiveEnemyActorState(twin, rec); rec += STRIDE; } // drops record 13
  const d = ramDiffMinusStack(o, twin);
  assert.notEqual(d, null, "a dropped record must be caught");
  assert.ok(d.addr >= EAT + 13 * STRIDE && d.addr < EAT + 14 * STRIDE,
    `short-sweep teeth caught outside record 13: ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(short-sweep): caught at ${hx(d.addr)}`);
});
