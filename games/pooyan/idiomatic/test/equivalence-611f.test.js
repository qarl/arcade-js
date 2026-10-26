// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for dispatchHitToEnemyRecordElseQueueSound (ROM 0x611f, Pooyan) — the enemy-record finder.
 *
 * HL+DE points at a key byte; the routine scans six enemy actor records (stride 0x18) for
 * the first whose +0x14 tag equals the key. On a match it hands that record to the
 * matched-record handler, which resets/retires it and aborts the caller frame (returns
 * false). With no match it enqueues a fixed sound command unless ACTIVE_OBJECT_TYPE is
 * already 3, then returns normally (true). The idiomatic module composes the real
 * idiomatic handler/reset/sound chain; the oracle drives the translated chain.
 *
 * Cycle-free memory-equivalence gate: compared on RAM (dumpState, minus stack scratch below the entry SP).
 * On the abort path no register survives the terminating skip, so the register file is not
 * compared — the module's boolean is the contract alongside RAM. SP is parked in
 * STACK_SCRATCH so the chain's pushes and the skip's pop-af+ret drop out of the diff. The
 * match cases seat every record's +0 flag bit0 and an odd round so the handler resets the
 * matched record — a footprint that moves if the wrong record were handed on.
 *
 * Jobs:
 *   1. EQUAL — match at record 0, match at a later record, no-match with type 3 (silent
 *      return), no-match with type != 3 (sound then return): oracle == module in RAM
 *      (−stack) and the module returns the right boolean (false on match, true on no-match).
 *   2. WRITE-SET — the silent no-match branch writes nothing outside the stack.
 *   3. TEETH — a wrong written byte on the match branch is caught, and handing the wrong
 *      record to the handler (resetting the wrong record) diverges from the oracle.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-611f.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_611f as oracle } from "../../translated/loc_611f.js";
import { dispatchHitToEnemyRecordElseQueueSound } from "../dispatchHitToEnemyRecordElseQueueSound.js";
import { retireResetOrEngageObjectRecord } from "../retireResetOrEngageObjectRecord.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const ENEMY_ACTOR_TABLE = 0x8ae0;
const ACTIVE_OBJECT_TYPE = 0x8d44;
const ROUND_COUNTER = 0x8907;
const SOUND_RING_PTR = 0x8a40;
const TAG_OFF = 0x14;
const STRIDE = 0x18;
const COUNT = 6;
const KEY = 0x42;
const KEY_SRC = 0x8e80; // scratch work-RAM cell holding the scan key (HL, DE = 0)
const SP_SCRATCH = 0x8ff0;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP_SCRATCH);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** A fresh clone: key at KEY_SRC (HL, DE=0); six records with +0 bit0 set and tags so
 *  record `matchIndex` matches (-1 = none); odd round so a match resets the matched record. */
function craft(matchIndex, objType) {
  const m = BASE.clone();
  m.regs.hl = KEY_SRC;
  m.regs.de = 0x0000;
  m.mem.write8(KEY_SRC, KEY);
  for (let i = 0; i < COUNT; i++) {
    m.mem.write8((ENEMY_ACTOR_TABLE + i * STRIDE) & 0xffff, 0x01); // +0 flag bit0 set
    const tag = i === matchIndex ? KEY : (KEY ^ 0x5a) & 0xff;
    m.mem.write8((ENEMY_ACTOR_TABLE + i * STRIDE + TAG_OFF) & 0xffff, tag);
  }
  m.mem.write8(ROUND_COUNTER, 0x01); // odd -> handler takes the reset branch
  m.mem.write8(ACTIVE_OBJECT_TYPE, objType & 0xff);
  m.mem.write8(SOUND_RING_PTR, 0x43);
  m.regs.sp = SP_SCRATCH;
  return m;
}

const CASES = [
  { name: "match record 0 -> abort", matchIndex: 0, objType: 0x02, ret: false },
  { name: "match record 3 -> abort", matchIndex: 3, objType: 0x02, ret: false },
  { name: "no match, type 3 -> silent return", matchIndex: -1, objType: 0x03, ret: true },
  { name: "no match, type != 3 -> sound + return", matchIndex: -1, objType: 0x02, ret: true },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: dispatchHitToEnemyRecordElseQueueSound == oracle in RAM (−stack) + boolean across match / no-match", () => {
  for (const { name, matchIndex, objType, ret: want } of CASES) {
    const o = craft(matchIndex, objType);
    const c = craft(matchIndex, objType);
    oracle(o);
    const ret = dispatchHitToEnemyRecordElseQueueSound(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    assert.equal(ret, want, `${name}: boolean must be ${want}`);
  }
  console.log(`  EQUAL: ${CASES.length} outcomes identical (RAM −stack + boolean)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the silent no-match branch (type 3) writes nothing outside the stack", () => {
  const m = craft(-1, 0x03);
  const b0 = m.dumpState();
  const ret = dispatchHitToEnemyRecordElseQueueSound(m);
  const a1 = m.dumpState();
  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) changed.push(m.stateOffsetToAddr(off));
  }
  const nonStack = changed.filter((addr) => !inDeadStack(addr));
  assert.deepEqual(nonStack, [], `silent branch must not write game RAM; wrote: ${nonStack.map(hx)}`);
  assert.equal(ret, true, "silent no-match returns true");
  console.log("  WRITE-SET: silent no-match footprint = {} (RAM −stack)");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong written byte on the match branch is CAUGHT by the RAM diff", () => {
  const matchIndex = 3;
  const o = craft(matchIndex, 0x02);
  const c = craft(matchIndex, 0x02);
  oracle(o);
  dispatchHitToEnemyRecordElseQueueSound(c);
  const victim = (ENEMY_ACTOR_TABLE + matchIndex * STRIDE + 0x16) & 0xffff; // reset writes 0x07 here
  c.mem.write8(victim, 0x00); // BUG: corrupt a reset field on the matched record
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong reset byte");
  assert.equal(d.addr, victim, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: handing the wrong record to the handler diverges from the oracle", () => {
  // On a match the oracle resets the MATCHED record; a twin that handed record 0 to the
  // handler would reset record 0 instead, a footprint the RAM diff must flag.
  const matchIndex = 3;
  const o = craft(matchIndex, 0x02);
  oracle(o);
  const c = craft(matchIndex, 0x02);
  retireResetOrEngageObjectRecord(c, ENEMY_ACTOR_TABLE); // wrong record handed on (base, not the matched record)
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate must catch the wrong record being handed to the handler");
  console.log(`  TEETH(branch): wrong-record handoff diverges at ${hx(d.addr ?? 0)}`);
});
