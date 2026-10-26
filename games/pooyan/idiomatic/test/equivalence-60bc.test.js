// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for resolveShotHitEngageOrSeedRecord (ROM 0x60bc, Pooyan) — tail of the hit handler: match an
 * enemy record by tag, then either engage the struck target pair or seed a fresh actor and scan.
 *
 * The routine scans the enemy-actor table (stride 0x18, six records) for a record whose +0x14
 * tag equals the key (A). On a match whose state byte +0x16 has bit1 set while ACTIVE_OBJECT_TYPE
 * is not 3, it flags the interrupt-parity target-record pair active (+0x01/+0x07), enqueues the
 * fixed sound command, and takes the pop-af/ret skip that aborts the caller's frame (boolean
 * false). Every other outcome — no match, bit1 clear, or type 3 — backs the pointer up 0x14 to
 * the record base, marks the interrupt-parity hit-flag slot active, seeds a fresh actor record,
 * and tail-enters the record finder, whose boolean it forwards (false = matched/abort,
 * true = normal continuation).
 *
 * The idiomatic module composes the real idiomatic seed/finder/sound chain; the oracle drives the
 * translated subtree through the routines map. Compared on RAM (dumpState, minus stack scratch below the entry SP).
 * No register survives the terminating skip, so the register file is not compared — the module's
 * forwarded boolean is the contract alongside RAM. SP is parked in STACK_SCRATCH so the finder's
 * pushes and the skip's pop-af+ret drop out of the diff. IY/DE/C are seated for the oracle's
 * register-driven scan; the module reads its scan base/stride/count from names + constants.
 *
 * Cases are CRAFTED: a plain boot does not seat this record/parity state directly.
 *
 * Jobs:
 *   1. EQUAL — skip path (both parities), no-match main (sound + silent), and matched-but-not-
 *      engaged main (bit1 clear, type 3): oracle == module in RAM (−stack) + forwarded boolean.
 *   2. WRITE-SET — the skip path flags the parity target pair (+0x01/+0x07); the main path marks
 *      the parity hit-flag slot and seeds the record base; the opposite-parity cells stay clear.
 *   3. TEETH — a wrong flagged target byte is caught by the RAM diff; a skip-returns-true twin
 *      and a main-returns-false twin are caught by the boolean check.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-60bc.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_60bc as oracle } from "../../translated/loc_60bc.js";
import { resolveShotHitEngageOrSeedRecord } from "../resolveShotHitEngageOrSeedRecord.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const EAT = 0x8ae0; // ENEMY_ACTOR_TABLE (scan base)
const STRIDE = 0x18;
const TYPE = 0x8d44; // ACTIVE_OBJECT_TYPE
const REC0 = 0x8c90; // ENEMY_TARGET_REC0 (I == 0)
const REC1 = 0x8ca8; // ENEMY_TARGET_REC1 (I != 0)
const FLAG_I0 = 0x8d1b; // OBJ_HIT_FLAG_I0 (I == 0)
const FLAG_I1 = 0x8d1c; // OBJ_HIT_FLAG_I1 (I != 0)
const SOUND_RING_PTR = 0x8a40;
const REC_BASE = 0x8c50; // fresh actor record base, clear of the scan region and flag/target cells
const HL = REC_BASE + 0x14; // caller-advanced pointer (gateEvenRoundOverlapAndRouteHit adds 0x14 before falling in)
const KEY = 0x42;
const SEED_FIELDS = [0x00, 0x01, 0x02, 0x12, 0x16, 0x17]; // bytes the seed step stamps (not +0x14)
const SP0 = 0x8ff0; // inside STACK_SCRATCH

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Seat the register interface gateEvenRoundOverlapAndRouteHit hands in, plus the main-path key at mem[HL]. */
function seat(m, ireg) {
  m.regs.hl = HL;
  m.regs.a = KEY;
  m.regs.i = ireg & 0xff;
  m.regs.iff2 = false;
  m.regs.iy = EAT; // oracle scan base
  m.regs.de = STRIDE; // oracle scan stride
  m.regs.c = 0x06; // oracle scan count
  m.regs.sp = SP0;
  for (const off of SEED_FIELDS) m.mem.write8((REC_BASE + off) & 0xffff, 0xee); // pre-dirty so each seed write is a change
  m.mem.write8(HL, KEY); // the finder's key is read from mem[HL] on the main path
  m.mem.write8(SOUND_RING_PTR, 0x43); // sane sound-ring write pointer
  return m;
}

/** Clear the six scan tags to a non-key so no accidental match; state bytes idle. */
function clearScan(m) {
  for (let i = 0; i < 6; i++) {
    m.mem.write8(EAT + i * STRIDE + 0x14, (KEY ^ 0x5a) & 0xff);
    m.mem.write8(EAT + i * STRIDE + 0x16, 0x00);
  }
}

/** Put a matching record at index idx with the given +0x16 state byte. */
function putMatch(m, idx, state) {
  m.mem.write8(EAT + idx * STRIDE + 0x14, KEY);
  m.mem.write8(EAT + idx * STRIDE + 0x16, state);
}

function craftSkip(ireg) {
  const m = seat(BASE.clone(), ireg);
  clearScan(m);
  putMatch(m, 2, 0x02); // bit1 set
  m.mem.write8(TYPE, 0x02); // type != 3 -> skip path
  return m;
}
function craftMainSound(ireg) {
  const m = seat(BASE.clone(), ireg);
  clearScan(m); // no match
  m.mem.write8(TYPE, 0x02); // finder: type != 3 -> enqueue sound on no match
  return m;
}
function craftMainSilent(ireg) {
  const m = seat(BASE.clone(), ireg);
  clearScan(m); // no match
  m.mem.write8(TYPE, 0x03); // finder: type 3 -> silent return
  return m;
}
function craftMatchBit1Clear(ireg) {
  const m = seat(BASE.clone(), ireg);
  clearScan(m);
  putMatch(m, 1, 0x00); // matched, bit1 clear -> main path
  m.mem.write8(TYPE, 0x02);
  return m;
}
function craftMatchType3(ireg) {
  const m = seat(BASE.clone(), ireg);
  clearScan(m);
  putMatch(m, 1, 0x02); // matched, bit1 set, but type 3 -> main path
  m.mem.write8(TYPE, 0x03);
  return m;
}

const CASES = [
  { name: "skip I==0 (target 0x8c90)", craft: () => craftSkip(0x00), ret: false },
  { name: "skip I!=0 (target 0x8ca8)", craft: () => craftSkip(0x0a), ret: false },
  { name: "main no-match, sound (type!=3)", craft: () => craftMainSound(0x0a), ret: true },
  { name: "main no-match, silent (type 3)", craft: () => craftMainSilent(0x00), ret: true },
  { name: "main matched, bit1 clear -> finder", craft: () => craftMatchBit1Clear(0x0a), ret: false },
  { name: "main matched, type 3 -> finder", craft: () => craftMatchType3(0x00), ret: false },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: resolveShotHitEngageOrSeedRecord == oracle in RAM (−stack) + forwarded boolean", () => {
  for (const cfg of CASES) {
    const o = cfg.craft();
    const c = cfg.craft();
    oracle(o);
    const ret = resolveShotHitEngageOrSeedRecord(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${cfg.name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    assert.equal(ret, cfg.ret, `${cfg.name}: forwarded boolean must be ${cfg.ret}`);
  }
  console.log(`  EQUAL: ${CASES.length} outcomes identical (RAM −stack + boolean)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: skip path flags the parity target pair, not the opposite-parity pair", () => {
  const m = craftSkip(0x0a); // I != 0 -> REC1
  oracle(m);
  assert.equal(m.mem.read8(REC1 + 0x01), 0x01, "REC1 +0x01 flagged");
  assert.equal(m.mem.read8(REC1 + 0x07), 0x01, "REC1 +0x07 flagged");
  assert.equal(m.mem.read8(REC0 + 0x01), 0x00, "opposite-parity REC0 +0x01 untouched");
  assert.equal(m.mem.read8(REC0 + 0x07), 0x00, "opposite-parity REC0 +0x07 untouched");
  console.log(`  WRITE-SET: ${hx(REC1)} pair flagged; ${hx(REC0)} clear`);
});

test("WRITE-SET: main path marks the parity hit-flag slot + seeds the record base", () => {
  const m = craftMainSilent(0x0a); // I != 0 -> slot 0x8d1c; silent so no finder side effects
  const b0 = m.dumpState();
  oracle(m);
  const a1 = m.dumpState();
  const changed = new Set();
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) {
      const addr = m.stateOffsetToAddr(off);
      if (!inDeadStack(addr)) changed.add(addr);
    }
  }
  assert.ok(changed.has(FLAG_I1), "I != 0 must mark slot 0x8d1c");
  assert.ok(!changed.has(FLAG_I0), "the opposite-parity slot 0x8d1b must NOT be marked");
  for (const off of SEED_FIELDS) {
    assert.ok(changed.has((REC_BASE + off) & 0xffff), `seed must write record byte +${hx(off)}`);
  }
  console.log(`  WRITE-SET: slot ${hx(FLAG_I1)} + record seed present; ${hx(FLAG_I0)} absent`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong flagged target byte is CAUGHT by the RAM diff", () => {
  const o = craftSkip(0x0a);
  const c = craftSkip(0x0a);
  oracle(o);
  resolveShotHitEngageOrSeedRecord(c);
  c.mem.write8(REC1 + 0x07, 0x00); // BUG: the skip path must flag REC1 +0x07 = 1
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch an unflagged target byte");
  assert.equal(d.addr, REC1 + 0x07, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a skip-returns-true twin is CAUGHT by the boolean check", () => {
  function brokenSkip(m) {
    resolveShotHitEngageOrSeedRecord(m); // real memory effect
    return true; // BUG: the skip path must abort the caller -> false
  }
  const c = craftSkip(0x00);
  assert.throws(
    () => assert.equal(brokenSkip(c), false),
    "the boolean contract must reject a skip reported as 'continue'",
  );
  console.log("  TEETH(boolean): a skip-returns-true twin is caught");
});

test("TEETH: a main-returns-false twin (no-match) is CAUGHT by the boolean check", () => {
  function brokenMain(m) {
    resolveShotHitEngageOrSeedRecord(m);
    return false; // BUG: a no-match main path must continue -> true
  }
  const c = craftMainSound(0x0a);
  assert.throws(
    () => assert.equal(brokenMain(c), true),
    "the boolean contract must reject a no-match continuation reported as 'abort'",
  );
  console.log("  TEETH(boolean): a main-returns-false twin is caught");
});
