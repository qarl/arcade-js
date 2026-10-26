// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for launchProjectileIntoFreeSlot (ROM 0x3a6c, Pooyan) — the projectile launcher. It bumps
 * the spawn counter, scans the 3-slot object table (stride 0x18) for a slot whose active bit is
 * clear, and — when one is free — seeds it from the launcher record at IX (coordinate pair,
 * hit-flash sequence, launcher back-pointer, state fields) while arming the launcher's animation,
 * nudging its step field, and storing a rotating display attribute back on the launcher.
 *
 * SEATING: BALANCED. Both the no-free-slot exit and the tail are plain rets; the module is a void
 * driver (LIVE-OUT none). Compared on RAM (dumpState) minus stack scratch below the entry SP; the register file is not
 * compared. SP is parked in STACK_SCRATCH so the oracle's pushes/pop and nested calls drop out.
 *
 * The module calls the idiomatic siblings (word-table lookup, set-animation, byte-table lookup)
 * directly; the oracle drives the translated siblings through the routines map. Cases are CRAFTED:
 * a plain boot does not seat a free slot with a launcher record.
 *
 * Jobs:
 *   1. EQUAL — a free-slot spawn (full seeding) and a no-free-slot bump-and-return: oracle == module
 *      in RAM (−stack).
 *   2. WRITE-SET — a spawn bumps the counter and marks the slot active; a no-free record leaves the
 *      slots' state bytes untouched but still bumps the counter.
 *   3. TEETH — a corrupted seed byte and a corrupted attribute byte are caught by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-3a6c.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_3a6c as oracle } from "../../translated/loc_3a6c.js";
import { launchProjectileIntoFreeSlot } from "../launchProjectileIntoFreeSlot.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const TABLE = 0x8be8; // PROJECTILE_TABLE
const STRIDE = 0x18;
const SPAWN = 0x8d42; // spawn counter
const ATTR_IDX = 0x8d6c; // rotating attribute index
const ROUND = 0x8907; // ROUND_COUNTER (bit0 selects tables, bit2 the flash variant)
const PLAYMODE = 0x8f50; // PLAY_MODE_LATCH (0 => default flash)
const IX = 0x8ae0; // launcher record (does not overlap the table)
const SP0 = 0x8ff0; // inside STACK_SCRATCH

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Seat the launcher + shared config; slot 0 is free by default. */
function seat(m, { slotsActive = false } = {}) {
  m.regs.ix = IX;
  m.regs.sp = SP0;
  m.mem.write8(ROUND, 0x00);
  m.mem.write8(PLAYMODE, 0x00);
  m.mem.write8(SPAWN, 0x00);
  m.mem.write8(ATTR_IDX, 0x00);
  m.mem.write8(IX + 0x06, 0x0a); // heading raw -> index 2
  m.mem.write8(IX + 0x07, 0x00);
  m.mem.write8(IX + 0x08, 0x50);
  m.mem.write8(IX + 0x16, 0x00);
  for (let i = 0; i < 3; i++) {
    const s = TABLE + i * STRIDE;
    m.mem.write8(s + 0x00, slotsActive ? 0x01 : 0x00); // active bit
    m.mem.write8(s + 0x01, 0x00);
    m.mem.write8(s + 0x02, 0x00);
  }
  return m;
}

const craftSpawn = () => seat(BASE.clone());
const craftNoFree = () => seat(BASE.clone(), { slotsActive: true });

// -- 1. EQUAL -----------------------------------------------------------------

for (const [label, craft] of [["free slot (full seeding)", craftSpawn], ["no free slot (bump only)", craftNoFree]]) {
  test(`EQUAL: ${label} — module == oracle in RAM (−stack)`, () => {
    const o = craft();
    const c = craft();
    oracle(o);
    launchProjectileIntoFreeSlot(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${label}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    console.log(`  EQUAL ${label}: RAM identical`);
  });
}

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: a spawn seeds the slot; a no-free record only bumps the counter", () => {
  const spawn = craftSpawn();
  launchProjectileIntoFreeSlot(spawn);
  assert.equal(spawn.mem.read8(SPAWN), 0x01, "spawn bumps the counter");
  assert.equal(spawn.mem.read8(TABLE + 0x00), 0x01, "slot marked active");
  assert.equal(spawn.mem.read8(TABLE + 0x08) & 0x01, 0x01, "slot seed bit set");

  const nofree = craftNoFree();
  launchProjectileIntoFreeSlot(nofree);
  assert.equal(nofree.mem.read8(SPAWN), 0x01, "no-free still bumps the counter");
  assert.equal(nofree.mem.read8(TABLE + 0x02), 0x00, "no-free leaves the slot state byte untouched");
  console.log("  WRITE-SET: spawn seeds; no-free only bumps");
});

// -- 3. TEETH -----------------------------------------------------------------

for (const [label, addr] of [["seed byte", TABLE + 0x12], ["launcher attribute", IX + 0x15]]) {
  test(`TEETH: a corrupted ${label} is CAUGHT by the RAM diff`, () => {
    const o = craftSpawn();
    const c = craftSpawn();
    oracle(o);
    launchProjectileIntoFreeSlot(c);
    c.mem.write8(addr, (o.mem.read8(addr) ^ 0xff) & 0xff);
    const d = ramDiffMinusStack(o, c);
    assert.notEqual(d, null, `the gate FAILED to catch a corrupted ${label}`);
    assert.equal(d.addr, addr, `teeth caught wrong address ${hx(d.addr ?? 0)} (expected ${hx(addr)})`);
    console.log(`  TEETH ${label}: caught at ${hx(d.addr)}`);
  });
}
