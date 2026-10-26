// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for launchProjectileIfRecordInFireWindow (ROM 0x5b71, Pooyan) — fire gate for one actor record based
 * at IX. It launches only when the record is in mode 5 (rec+2), its fire flag is set (bit 2 of
 * rec+7) and its timer (rec+6) is below 0x11; any guard failing returns without acting.
 *
 * The module reads the record through the IX param-default bridge and delegates the launch to its
 * frozen sibling; the oracle drives the same translated sibling through the routines map. launchProjectileIfRecordInFireWindow
 * is a void gate — no register survives — so equivalence is RAM (dumpState) minus stack scratch below the entry SP,
 * with SP parked in STACK_SCRATCH so the launch's nested pushes drop out of the diff.
 *
 * The launch's own record-scan is seated to its no-free-slot branch (all three target records
 * occupied), whose whole footprint is the spawn counter at 0x8d42 — an isolated, deterministic
 * marker for "the gate fired".
 *
 * Jobs:
 *   1. EQUAL — launch + three blocked branches (wrong mode, fire clear, timer past window):
 *      module == oracle in RAM (−stack) for every case.
 *   2. WRITE-SET — a firing gate bumps the spawn counter; every blocked branch leaves RAM inert.
 *   3. TEETH — a wrong-byte RAM twin is caught by the diff; a guard-dropping twin that fires on a
 *      wrong-mode record diverges at the spawn counter.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-5b71.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_5b71 as oracle } from "../../translated/loc_5b71.js";
import { launchProjectileIfRecordInFireWindow } from "../launchProjectileIfRecordInFireWindow.js";
import { loc_3a6c } from "../../translated/loc_3a6c.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { bridgeReseatEquivalent } from "../../../../core/bridge-reseat.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = 0x8ae0; //          the actor record used as IX
const SPAWN_COUNTER = 0x8d42; // the launch's only footprint on its no-free-slot branch
const SLOT_TABLE = 0x8be8; //   launch's target record table
const SLOT_STRIDE = 0x18;
const SP0 = 0x8ff0; //          inside STACK_SCRATCH

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Seat the record + occupy all three launch target slots so a fire lands on the no-free branch. */
function seat(m, { mode = 0x05, fire = 0x04, timer = 0x00 } = {}) {
  m.regs.ix = REC;
  m.regs.sp = SP0;
  m.mem.write8(REC + 0x02, mode);
  m.mem.write8(REC + 0x07, fire);
  m.mem.write8(REC + 0x06, timer);
  for (let k = 0; k < 3; k++) m.mem.write8(SLOT_TABLE + k * SLOT_STRIDE + 0, 0x01); // all occupied
  return m;
}

const craftLaunch = () => seat(BASE.clone());
const craftWrongMode = () => seat(BASE.clone(), { mode: 0x04 });
const craftFireClear = () => seat(BASE.clone(), { fire: 0x00 });
const craftTimerHigh = () => seat(BASE.clone(), { timer: 0x11 });

const CASES = [
  { name: "mode 5 + fire + timer low -> launch", craft: craftLaunch, fires: true },
  { name: "wrong mode -> blocked", craft: craftWrongMode, fires: false },
  { name: "fire flag clear -> blocked", craft: craftFireClear, fires: false },
  { name: "timer past window -> blocked", craft: craftTimerHigh, fires: false },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: launchProjectileIfRecordInFireWindow == oracle in RAM (−stack)", () => {
  for (const cfg of CASES) {
    const o = cfg.craft();
    const c = cfg.craft();
    oracle(o);
    launchProjectileIfRecordInFireWindow(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${cfg.name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} branches identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: a fire bumps the spawn counter; every blocked branch is inert", () => {
  const fired = craftLaunch();
  const before = fired.mem.read8(SPAWN_COUNTER);
  launchProjectileIfRecordInFireWindow(fired);
  assert.equal(fired.mem.read8(SPAWN_COUNTER), (before + 1) & 0xff, "a firing gate must bump the spawn counter");

  for (const cfg of CASES.filter((c) => !c.fires)) {
    const m = cfg.craft();
    const b0 = m.dumpState();
    launchProjectileIfRecordInFireWindow(m);
    assert.deepEqual([...m.dumpState()], [...b0], `${cfg.name}: a blocked gate must leave RAM untouched`);
  }
  console.log("  WRITE-SET: fire bumps counter; blocked branches inert");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong seeded byte is CAUGHT by the RAM diff", () => {
  const o = craftLaunch();
  const c = craftLaunch();
  oracle(o);
  launchProjectileIfRecordInFireWindow(c);
  c.mem.write8(SPAWN_COUNTER, (o.mem.read8(SPAWN_COUNTER) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted byte");
  assert.equal(d.addr, SPAWN_COUNTER, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}`);
});

test("TEETH: a guard-dropping twin that fires on a wrong-mode record diverges at the spawn counter", () => {
  const o = craftWrongMode();
  const twin = craftWrongMode();
  oracle(o); // wrong mode -> inert
  loc_3a6c(twin); // a gate that skipped its mode guard would launch anyway
  const d = ramDiffMinusStack(o, twin);
  assert.notEqual(d, null, "the gate FAILED to catch a dropped mode guard");
  assert.equal(d.addr, SPAWN_COUNTER, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(guard): caught at ${hx(d.addr)}`);
});

// -- R37: the launcher record must reach loc_3a6c through the param, not a stale IX bridge -----------
// The cases above seat m.regs.ix == the record AND occupy every launch slot (loc_3a6c's no-free branch),
// so a stale-register read is masked twice over. Here a FREE slot lets loc_3a6c do its record-specific
// launch writes, and the register is POISONED with the record handed in as the param: a re-seat/thread
// recovers, a stale m.regs.ix read leaks. Invisible to the base tape (wave-end fire cleanup is unreached).
test("R37: launchProjectileIfRecordInFireWindow threads the launcher record to loc_3a6c, not a stale IX bridge", () => {
  const craft = () => {
    const m = BASE.clone();
    m.regs.sp = SP0;
    m.mem.write8(REC + 0x02, 0x05); // FIRE_MODE
    m.mem.write8(REC + 0x07, 0x04); // FIRE_FLAG set
    m.mem.write8(REC + 0x06, 0x08); // timer in window (also loc_3a6c's heading source)
    return m; // slot 0 left FREE -> loc_3a6c performs its record-specific launch writes
  };
  const r = bridgeReseatEquivalent(craft(), oracle, launchProjectileIfRecordInFireWindow, {
    live: { ix: REC }, poison: { ix: 0x8b40 }, args: [REC], excludeAddr: inDeadStack,
  });
  assert.equal(r.equal, true, r.ram && `launchProjectileIfRecordInFireWindow launched off a stale IX; RAM diff at ${hx(r.ram.addr ?? 0)}`);
  console.log("  R37: launcher record threaded to loc_3a6c (poison-IX bridge tooth clean)");
});
