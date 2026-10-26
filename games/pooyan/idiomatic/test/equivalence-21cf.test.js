// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for advanceTargetActorState (ROM 0x21cf, Pooyan) — per-object state step on the IY record.
 *
 * SEATING: BALANCED (plain ret / tail-calls) -> WIRE. Void handler: stepActiveTargetActorRecords reads no register back
 * after its `call nz,0x21cf`, so LIVE-OUT is memory only and the comparison is RAM (dumpState) minus
 * stack scratch below the entry SP; the register file is not compared. SP parked in STACK_SCRATCH so nested pushes drop out.
 *
 * The two-axis-mover branch (bit1 of rec+0 -> advanceTargetActorAlongVelocityElseDespawn) is left to advanceTargetActorAlongVelocityElseDespawn's own gate: it is a pure
 * delegation whose carry-flag ABI would couple this gate to a sibling. All other decision paths are
 * crafted here: the launch sub-phase (seed / travel / clear-at-0xe8 / not-armed) and the timer body
 * (prime-once, hit-flag consume for both parity cells, countdown decrement, countdown underflow-clear).
 *
 * Jobs:
 *   1. EQUAL — every crafted path: oracle == module in RAM (−stack).
 *   2. WRITE-SET — a not-armed launch record is inert; a countdown decrement lands at rec+6.
 *   3. TEETH — a corrupted post-run byte is caught by the RAM diff; a twin that skips the clear diverges.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-21cf.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_21cf as oracle } from "../../translated/loc_21cf.js";
import { advanceTargetActorState } from "../advanceTargetActorState.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC0 = 0x8c90; // rec low byte 0x90 -> bit3 clear -> hit cell I0
const REC1 = 0x8c98; // rec low byte 0x98 -> bit3 set   -> hit cell I1
const HIT_I0 = 0x8d1b;
const HIT_I1 = 0x8d1c;
const GAME_ACTIVE = 0x8806;
const PLAY_LATCH = 0x8f50;
const PENDING = 0x8d20; // display-ring pending byte written by the prime
const SP0 = 0x8ff0;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Seat the IY record and the globals its non-mover paths touch. */
function seat(m, { rec = REC0, fields = {}, hit0 = 0, hit1 = 0 } = {}) {
  m.regs.sp = SP0;
  m.regs.i = 0x00;
  m.regs.iff2 = false;
  m.regs.iy = rec;
  for (let i = 0; i < 0x18; i++) m.mem.write8(rec + i, 0x55); // pre-dirty so a clear is observable
  m.mem.write8(rec + 0x00, 0x00); //  bit1 clear -> stay off the mover branch
  m.mem.write8(rec + 0x07, 0x00); //  bit0 clear -> timer body (overridden per case)
  m.mem.write8(rec + 0x12, 0x33); //  primed already (overridden per case)
  for (const [off, v] of Object.entries(fields)) m.mem.write8(rec + Number(off), v);
  m.mem.write8(HIT_I0, hit0);
  m.mem.write8(HIT_I1, hit1);
  m.mem.write8(GAME_ACTIVE, 0x00); // both gates closed: the prime only stamps PENDING
  m.mem.write8(PLAY_LATCH, 0x00);
  m.mem.write8(PENDING, 0x00);
  return m;
}

const CASES = {
  "launch: seed then travel": (m) => seat(m, { fields: { 0x07: 0x01, 0x01: 0x01, 0x04: 0x10 } }),
  "launch: skip-seed then travel": (m) => seat(m, { fields: { 0x07: 0x01, 0x01: 0x02, 0x04: 0x10 } }),
  "launch: reach 0xe8 -> clear": (m) => seat(m, { fields: { 0x07: 0x01, 0x01: 0x02, 0x04: 0xe4 } }),
  "launch: not armed -> inert": (m) => seat(m, { fields: { 0x07: 0x01, 0x01: 0x00 } }),
  "timer: prime-once + hit consume (I0)": (m) => seat(m, { fields: { 0x07: 0x00, 0x12: 0x00 }, hit0: 0x07 }),
  "timer: hit consume (I1)": (m) => seat(m, { rec: REC1, fields: { 0x07: 0x00 }, hit1: 0x09 }),
  "timer: countdown decrement": (m) => seat(m, { fields: { 0x07: 0x00, 0x06: 0x20 } }),
  "timer: countdown underflow -> clear": (m) => seat(m, { fields: { 0x07: 0x00, 0x06: 0x02 } }),
};

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: advanceTargetActorState == oracle in RAM (−stack)", () => {
  for (const [name, craft] of Object.entries(CASES)) {
    const o = craft(BASE.clone());
    const c = craft(BASE.clone());
    oracle(o);
    advanceTargetActorState(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${Object.keys(CASES).length} paths identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: a not-armed launch is inert; a countdown decrement lands at rec+6", () => {
  const inert = CASES["launch: not armed -> inert"](BASE.clone());
  const before = inert.dumpState();
  oracle(inert);
  assert.deepEqual([...inert.dumpState()], [...before], "a not-armed launch record must leave RAM untouched");

  const dec = CASES["timer: countdown decrement"](BASE.clone());
  oracle(dec);
  assert.equal(dec.mem.read8(REC0 + 0x06), 0x1c, "0x20 - 4 = 0x1c at rec+6");
  console.log("  WRITE-SET: not-armed inert; countdown -4");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a corrupted post-run byte is CAUGHT by the RAM diff", () => {
  const o = CASES["timer: countdown decrement"](BASE.clone());
  const c = CASES["timer: countdown decrement"](BASE.clone());
  oracle(o);
  advanceTargetActorState(c);
  c.mem.write8(REC0 + 0x06, (o.mem.read8(REC0 + 0x06) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted byte");
  assert.equal(d.addr, REC0 + 0x06, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}`);
});

test("TEETH: a twin that skips the record-clear diverges from the oracle", () => {
  const o = CASES["timer: countdown underflow -> clear"](BASE.clone());
  const c = CASES["timer: countdown underflow -> clear"](BASE.clone());
  oracle(o); // clears 0x18 bytes to 0
  // twin: skip the clear entirely (do nothing) -> the pre-dirty 0x55 filler survives
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "a skipped record-clear must be caught by the RAM diff");
  console.log(`  TEETH(clear): caught at ${hx(d.addr ?? 0)}`);
});
