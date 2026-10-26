// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for advanceRisingActorThenSettleOrArmDrop (Pooyan) — advance one object record (based at IX).
 *
 * Steps the object's animation, walks the position field (+0x03) by the signed step (+0x0a) and
 * decrements the lap counter (+0x04) when the position ran below the step's negation, then gates on
 * the resulting lap count split by the active flag (+0x07): an active object with lap < 4 resets its
 * sub-state (+0x02 := 0) and idle anim (+0x11 := 0x20); an inactive object with lap < 2 points itself
 * at the drop animation (helper) and arms the drop state (+0x02 := 2, +0x11 := 0x28). Everything else
 * falls through with no state write.
 *
 * The routine takes IX as its record pointer; the oracle's returned A is dead (the reaching dispatcher
 * loop discards it), so there is no register live-out. Compared on RAM (dumpState) minus stack scratch below the entry SP;
 * SP is parked in STACK_SCRATCH so the oracle's call/ret drops fall out of the diff.
 *
 * Jobs: 1. EQUAL across the dec / no-dec, active-reset, drop-arm and fall-through branches; 2. WRITE-SET
 * (position walk, lap dec, sub-state + anim per branch); 3. TEETH (a corrupted anim byte is caught; the
 * active-reset and drop-arm branches differ).
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-1496.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1496 as oracle } from "../../translated/loc_1496.js";
import { advanceRisingActorThenSettleOrArmDrop } from "../advanceRisingActorThenSettleOrArmDrop.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, DROP_ANIM_DESCRIPTOR } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = 0x8ae0; // a valid object record, clear of STACK_SCRATCH and seated cells
const SUBSTATE = REC + 0x02;
const POS = REC + 0x03;
const LAP = REC + 0x04;
const ANIM = REC + 0x11;
const SP0 = 0x8ff0; // inside STACK_SCRATCH

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Seat IX and the record fields; sub-state and anim are pre-dirtied so a reset/arm is observable. */
function seat({ active, pos, lap, step = 0x02, hold = 0x05 }) {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.regs.ix = REC;
  m.mem.write8(SUBSTATE, 0xaa); // pre-dirty so a reset/arm write is visible
  m.mem.write8(POS, pos);
  m.mem.write8(LAP, lap);
  m.mem.write8(REC + 0x07, active);
  m.mem.write8(REC + 0x0a, step);
  m.mem.write8(REC + 0x0e, hold); // frame-hold nonzero -> anim helper just decrements
  m.mem.write8(ANIM, 0xbb); // pre-dirty so an arm write is visible
  return m;
}

const CASES = [
  { name: "active, dec -> lap<4 reset", cfg: { active: 0x01, pos: 0x10, lap: 0x03 } },
  { name: "active, no-dec, lap>=4 fall-through", cfg: { active: 0x01, pos: 0xff, lap: 0x05 } },
  { name: "inactive, dec -> lap<2 drop-arm", cfg: { active: 0x00, pos: 0x10, lap: 0x01 } },
  { name: "inactive, no-dec, lap>=2 fall-through", cfg: { active: 0x00, pos: 0xff, lap: 0x03 } },
  { name: "inactive, no-dec, lap<2 drop-arm", cfg: { active: 0x00, pos: 0xff, lap: 0x01, step: 0x01 } },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: advanceRisingActorThenSettleOrArmDrop == oracle in RAM (−stack)", () => {
  for (const { name, cfg } of CASES) {
    const o = seat(cfg);
    const c = seat(cfg);
    oracle(o);
    advanceRisingActorThenSettleOrArmDrop(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} branches identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: position walk, lap dec, sub-state + anim per branch", () => {
  // active, dec branch: pos advances by step, lap decremented, reset written
  const a = seat({ active: 0x01, pos: 0x10, lap: 0x03 });
  oracle(a);
  assert.equal(a.mem.read8(POS), (0x10 + 0x02) & 0xff, "position walked by step");
  assert.equal(a.mem.read8(LAP), 0x02, "lap decremented (pos below -step)");
  assert.equal(a.mem.read8(SUBSTATE), 0x00, "active lap<4 resets sub-state");
  assert.equal(a.mem.read8(ANIM), 0x20, "active lap<4 sets idle anim");

  // active fall-through: no dec, no state write
  const f = seat({ active: 0x01, pos: 0xff, lap: 0x05 });
  oracle(f);
  assert.equal(f.mem.read8(LAP), 0x05, "no dec when pos >= -step");
  assert.equal(f.mem.read8(SUBSTATE), 0xaa, "active lap>=4 leaves sub-state");
  assert.equal(f.mem.read8(ANIM), 0xbb, "active lap>=4 leaves anim");

  // inactive drop-arm: helper points anim pointer, drop state armed
  const d = seat({ active: 0x00, pos: 0x10, lap: 0x01 });
  oracle(d);
  assert.equal(d.mem.read8(REC + 0x0c), DROP_ANIM_DESCRIPTOR & 0xff, "drop anim pointer lo");
  assert.equal(d.mem.read8(REC + 0x0d), DROP_ANIM_DESCRIPTOR >> 8, "drop anim pointer hi");
  assert.equal(d.mem.read8(SUBSTATE), 0x02, "inactive lap<2 arms drop sub-state");
  assert.equal(d.mem.read8(ANIM), 0x28, "inactive lap<2 sets drop anim");
  console.log("  WRITE-SET: pos+=step; lap--; sub-state/anim = reset / (leave) / drop-arm");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a corrupted anim byte is CAUGHT; branches are load-bearing", () => {
  const o = seat({ active: 0x01, pos: 0x10, lap: 0x03 });
  const c = seat({ active: 0x01, pos: 0x10, lap: 0x03 });
  oracle(o);
  advanceRisingActorThenSettleOrArmDrop(c);
  c.mem.write8(ANIM, (o.mem.read8(ANIM) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted anim byte");
  assert.equal(d.addr, ANIM, `teeth caught wrong address ${hx(d.addr ?? 0)}`);

  // active-reset vs drop-arm branches must differ, or a guard is dead
  const reset = seat({ active: 0x01, pos: 0x10, lap: 0x03 });
  const drop = seat({ active: 0x00, pos: 0x10, lap: 0x01 });
  oracle(reset);
  oracle(drop);
  assert.notEqual(ramDiffMinusStack(reset, drop), null, "reset and drop-arm branches must differ");
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}; guard branch load-bearing`);
});
