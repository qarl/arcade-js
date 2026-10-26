// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for markHitFlagSeedActorAndScanEnemyRecords (ROM 0x60d9, Pooyan) — mark hit-flag slot, seed the
 * actor record, then run the enemy-record scan.
 *
 * markHitFlagSeedActorAndScanEnemyRecords marks the interrupt-parity hit-flag slot active (odd-parity slot 0x8d1c, or the
 * even slot 0x8d1b when the interrupt register is zero), stamps the opening state into the
 * fresh actor record at HL, backs HL up to the record's +0x14 tag, and enters the record
 * finder. The finder resets/retires the matching enemy record and aborts (false), or with
 * no match enqueues a sound (unless type 3) and returns normally (true). The idiomatic
 * module composes the real idiomatic seed/scan/handler chain; the oracle drives translated.
 *
 * Cycle-free memory-equivalence gate: compared on RAM (dumpState, minus stack scratch below the entry SP). No
 * register survives the terminating skip, so the register file is not compared — the
 * module's forwarded boolean is the contract alongside RAM. SP is parked in STACK_SCRATCH
 * so the seed call's push, the chain's pushes, and the skip's pop-af+ret drop out of the
 * diff. The interrupt register is seated per case to drive the parity slot choice; the key
 * the scan reads is the record's +0x14 byte (seeded, and left untouched by the seed step).
 *
 * Jobs:
 *   1. EQUAL — parity high with a match (abort), parity low with a match (checks the slot
 *      choice), and two no-match returns (silent / sound): oracle == module in RAM (−stack)
 *      and the module forwards the right boolean.
 *   2. WRITE-SET — the marked hit-flag slot and the six seeded record bytes appear in the
 *      no-match footprint; the opposite-parity slot is never written.
 *   3. TEETH — a wrong seeded record byte is caught, and a wrong hit-flag slot byte is caught.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-60d9.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_60d9 as oracle } from "../../translated/loc_60d9.js";
import { markHitFlagSeedActorAndScanEnemyRecords } from "../markHitFlagSeedActorAndScanEnemyRecords.js";
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
const HIT_FLAG_I0 = 0x8d1b; // interrupt register == 0
const HIT_FLAG_I1 = 0x8d1c; // interrupt register != 0
const REC = 0x8c50; // fresh actor record base (HL); clear of the scan region and the flag slots
const TAG_OFF = 0x14;
const STRIDE = 0x18;
const COUNT = 6;
const KEY = 0x42;
const SEED_FIELDS = [0x00, 0x01, 0x02, 0x12, 0x16, 0x17]; // the bytes initActorRecord stamps (not +0x14)
const SP_SCRATCH = 0x8ff0;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP_SCRATCH);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** A fresh clone: HL = record base with its +0x14 tag = the scan key; interrupt register set
 *  to drive the parity slot; six records with +0 bit0 set and tags so record `matchIndex`
 *  matches (-1 = none); odd round so a match resets the matched record. */
function craft({ ireg, matchIndex, objType }) {
  const m = BASE.clone();
  m.regs.hl = REC;
  m.regs.i = ireg & 0xff;
  m.regs.iff2 = false;
  for (const off of SEED_FIELDS) m.mem.write8((REC + off) & 0xffff, 0xee); // pre-dirty so each seed write is a change
  m.mem.write8((REC + TAG_OFF) & 0xffff, KEY); // the finder reads its key from here (seed step skips +0x14)
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
  { name: "I != 0, match -> slot 0x8d1c, abort", ireg: 0x0a, matchIndex: 2, objType: 0x02, ret: false },
  { name: "I == 0, match -> slot 0x8d1b, abort", ireg: 0x00, matchIndex: 2, objType: 0x02, ret: false },
  { name: "I != 0, no match, type 3 -> silent return", ireg: 0x0a, matchIndex: -1, objType: 0x03, ret: true },
  { name: "I != 0, no match, type != 3 -> sound + return", ireg: 0x0a, matchIndex: -1, objType: 0x02, ret: true },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: markHitFlagSeedActorAndScanEnemyRecords == oracle in RAM (−stack) + forwarded boolean", () => {
  for (const cfg of CASES) {
    const o = craft(cfg);
    const c = craft(cfg);
    oracle(o);
    const ret = markHitFlagSeedActorAndScanEnemyRecords(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${cfg.name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    assert.equal(ret, cfg.ret, `${cfg.name}: forwarded boolean must be ${cfg.ret}`);
  }
  console.log(`  EQUAL: ${CASES.length} outcomes identical (RAM −stack + boolean)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: no-match footprint marks the parity slot + seeds the record, not the twin slot", () => {
  const m = craft({ ireg: 0x0a, matchIndex: -1, objType: 0x03 });
  const b0 = m.dumpState();
  oracle(m);
  const a1 = m.dumpState();
  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) changed.push(m.stateOffsetToAddr(off));
  }
  const addrs = new Set(changed.filter((addr) => !inDeadStack(addr)));
  assert.ok(addrs.has(HIT_FLAG_I1), "I != 0 must mark slot 0x8d1c");
  assert.ok(!addrs.has(HIT_FLAG_I0), "the opposite-parity slot 0x8d1b must NOT be marked");
  for (const off of SEED_FIELDS) {
    assert.ok(addrs.has((REC + off) & 0xffff), `seed must write record byte +${hx(off)}`);
  }
  console.log(`  WRITE-SET: slot ${hx(HIT_FLAG_I1)} + record seed present; ${hx(HIT_FLAG_I0)} absent`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong seeded record byte is CAUGHT by the RAM diff", () => {
  const cfg = CASES[0];
  const o = craft(cfg);
  const c = craft(cfg);
  oracle(o);
  markHitFlagSeedActorAndScanEnemyRecords(c);
  const victim = (REC + 0x16) & 0xffff; // seed writes 0x04 here
  c.mem.write8(victim, 0x00); // BUG: corrupt a seeded record byte
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong seeded byte");
  assert.equal(d.addr, victim, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong hit-flag slot byte is CAUGHT by the RAM diff", () => {
  const cfg = CASES[0]; // I != 0 -> slot 0x8d1c
  const o = craft(cfg);
  const c = craft(cfg);
  oracle(o);
  markHitFlagSeedActorAndScanEnemyRecords(c);
  c.mem.write8(HIT_FLAG_I1, 0x00); // BUG: the parity slot must be marked 1
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch an unmarked hit-flag slot");
  assert.equal(d.addr, HIT_FLAG_I1, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(slot): caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
