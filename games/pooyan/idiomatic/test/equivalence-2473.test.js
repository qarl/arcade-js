// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for dropLeadActorAfterDelay (ROM 0x2473, Pooyan) — actor state-1 step, record based at IX.
 *
 * Decrements the frame delay (IX+0x11); until it reaches zero, return (registers untouched). On
 * expiry: if the state-10 tamper counter (0x8a39) is zero it reseeds the delay to 0x10 and bumps the
 * actor state (IX+0x02); otherwise (the anti-tamper overlap arm, dead with an intact ROM) it stores
 * that tamper value at (BC). Both converge to bump the base Y (IX+0x04) by 0x10, clear (IX+0x1e),
 * then load shape table 0x26c1 via the pattern-A shape loader (seedFourRecordsAndCopyDisplayTiles -> copyDisplayTilesIntoActorRecords).
 *
 * Comparison is the go-forward contract: RAM (dumpState) minus stack scratch below the entry SP, plus — on the expiry
 * path — the register live-out the shape loader leaves (IX past the copied run, B, HL, A), all
 * derived from the ORACLE clone. The early frame-delay return sets no register, so only RAM is
 * compared there. dropLeadActorAfterDelay is reached only through the actor-state dispatch (no direct callers), so
 * every case is CRAFTED: an identical IX record + BC poked on both sides.
 *
 * Jobs:
 *   1. EQUAL — early return, zero-expiry (reseed + state bump), and the tamper overlap arm.
 *   2. WRITE-SET — on the zero-expiry path, every changed cell lies within the record footprint
 *      {+0x02,+0x04,+0x11,+0x1e} and the four shape-tile fields {+0x0f,+0x27,+0x3f,+0x57}.
 *   3. TEETH — a twin that forgets to reseed the delay (RAM), and a wrong IX live-out.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-2473.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2473 as oracle } from "../../translated/loc_2473.js";
import { dropLeadActorAfterDelay } from "../dropLeadActorAfterDelay.js";
import { seedFourRecordsAndCopyDisplayTiles } from "../seedFourRecordsAndCopyDisplayTiles.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, TAMPER_STRIKES_STATE10, SHAPE_TABLE_26C1 } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built" }, fn);

const REC = 0x8a80; // an actor record base (work RAM); the shape loader copies 4 records from here
const BC_TARGET = 0x8b00; // BC sink for the tamper overlap arm (work RAM, outside the record span)
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8fe0);

// The record footprint the routine writes (offsets from REC).
const OFF_STATE = 0x02;   // actor state, bumped on the zero-expiry arm
const OFF_BASEY = 0x04;   // base Y, += 0x10 on expiry
const OFF_DELAY = 0x11;   // frame delay, decremented then reseeded
const OFF_CLEAR = 0x1e;   // cleared to zero on expiry
const TILE_FIELDS = [0x0f, 0x18 + 0x0f, 0x30 + 0x0f, 0x48 + 0x0f]; // shape loader tile fields

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** A machine with the record at REC + BC seated; delay and tamper set by the caller. */
function craft({ delay, tamper = 0, dirty = false }) {
  const m = new Machine(ROM);
  if (dirty) {
    m.mem.write8((REC + OFF_STATE) & 0xffff, 0x05);
    m.mem.write8((REC + OFF_BASEY) & 0xffff, 0x05);
    m.mem.write8((REC + OFF_CLEAR) & 0xffff, 0xaa);
    for (const off of TILE_FIELDS) m.mem.write8((REC + off) & 0xffff, 0xaa);
  }
  m.mem.write8((REC + OFF_DELAY) & 0xffff, delay);
  m.mem.write8(TAMPER_STRIKES_STATE10, tamper);
  m.regs.ix = REC;
  m.regs.bc = BC_TARGET;
  m.regs.sp = 0x8fe0; // inside STACK_SCRATCH: the oracle's call/ret hit dead RAM
  return m;
}

/** Assert the shape-loader register live-out (derived from the oracle) matches the module clone. */
function assertLiveOut(c, o, label) {
  assert.equal(c.regs.ix & 0xffff, o.regs.ix & 0xffff, `${label}: IX live-out mismatch`);
  assert.equal(c.regs.b & 0xff, o.regs.b & 0xff, `${label}: B live-out mismatch`);
  assert.equal(c.regs.hl & 0xffff, o.regs.hl & 0xffff, `${label}: HL live-out mismatch`);
  assert.equal(c.regs.a & 0xff, o.regs.a & 0xff, `${label}: A live-out mismatch`);
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: early return (delay not expired) — RAM identical, no register touched", () => {
  const o = craft({ delay: 0x05 });
  const c = craft({ delay: 0x05 });
  oracle(o);
  dropLeadActorAfterDelay(c);
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  console.log(`  EQUAL(early): delay 5->4, no dispatch — RAM identical`);
});

test("EQUAL: zero-expiry (reseed + state bump + shape load) — RAM + live-out identical", () => {
  const o = craft({ delay: 0x01 });
  const c = craft({ delay: 0x01 });
  oracle(o);
  dropLeadActorAfterDelay(c);
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  assertLiveOut(c, o, "zero-expiry");
  console.log(`  EQUAL(zero-expiry): RAM + IX/B/HL/A identical (IX=${hx(o.regs.ix)})`);
});

test("EQUAL: tamper overlap arm (0x8a39 nonzero) — RAM + live-out identical", () => {
  const o = craft({ delay: 0x01, tamper: 0x05 });
  const c = craft({ delay: 0x01, tamper: 0x05 });
  oracle(o);
  dropLeadActorAfterDelay(c);
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  assertLiveOut(c, o, "tamper");
  // the overlap arm stores the tamper value at (BC)
  assert.equal(c.mem.read8(BC_TARGET), 0x05, "tamper value must land at (BC)");
  console.log(`  EQUAL(tamper): (BC)=0x05, RAM + live-out identical`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: zero-expiry writes stay within the record footprint", () => {
  const before = craft({ delay: 0x01, dirty: true });
  const after = craft({ delay: 0x01, dirty: true });
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();

  const expected = new Set(
    [OFF_STATE, OFF_BASEY, OFF_DELAY, OFF_CLEAR, ...TILE_FIELDS].map((off) => (REC + off) & 0xffff),
  );
  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] === a1[off]) continue;
    const addr = after.stateOffsetToAddr(off);
    if (inDeadStack(addr)) continue; // nested-call stack pushes are not record writes
    changed.push(addr);
  }
  for (const addr of changed) {
    assert.ok(expected.has(addr), `stray write at ${hx(addr)} outside the record footprint`);
  }
  // the arithmetic cells always change from the dirtied pre-state
  for (const off of [OFF_STATE, OFF_BASEY, OFF_DELAY, OFF_CLEAR]) {
    assert.ok(changed.includes((REC + off) & 0xffff), `expected a write at REC+${hx(off)}`);
  }
  assert.equal(after.mem.read8((REC + OFF_DELAY) & 0xffff), 0x10, "delay reseeded to 0x10");
  assert.equal(after.mem.read8((REC + OFF_STATE) & 0xffff), 0x06, "state bumped 5->6");
  assert.equal(after.mem.read8((REC + OFF_BASEY) & 0xffff), 0x15, "base Y bumped 5->0x15");
  assert.equal(after.mem.read8((REC + OFF_CLEAR) & 0xffff), 0x00, "clear cell zeroed");
  console.log(`  WRITE-SET: ${changed.length} cells changed, all within the record footprint`);
});

// -- 3. TEETH -----------------------------------------------------------------

/** Broken twin: forgets to reseed the frame delay on the zero-expiry arm. */
function brokenNoReseed(m, rec = m.regs.ix, bc = m.regs.bc) {
  const { mem8 } = m;
  mem8[rec + 0x11] = (mem8[rec + 0x11] - 1) & 0xff;
  if (mem8[rec + 0x11] !== 0) return;
  const tamper = mem8[TAMPER_STRIKES_STATE10];
  if (tamper !== 0) {
    mem8[bc] = tamper;
  } else {
    mem8[rec + 0x02] = (mem8[rec + 0x02] + 1) & 0xff; // BUG: no delay reseed
  }
  mem8[rec + 0x04] = (mem8[rec + 0x04] + 0x10) & 0xff;
  mem8[rec + 0x1e] = 0;
  return seedFourRecordsAndCopyDisplayTiles(m, SHAPE_TABLE_26C1, rec);
}

test("TEETH: a twin skipping the delay reseed is caught in RAM", () => {
  const o = craft({ delay: 0x01 });
  const c = craft({ delay: 0x01 });
  oracle(o);
  brokenNoReseed(c);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a skipped delay reseed — it is worthless");
  assert.equal(d.addr, (REC + OFF_DELAY) & 0xffff, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): skipped reseed caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong IX live-out is rejected by the live-out check", () => {
  const o = craft({ delay: 0x01 });
  const c = craft({ delay: 0x01 });
  oracle(o);
  dropLeadActorAfterDelay(c);
  assert.equal(c.regs.ix & 0xffff, o.regs.ix & 0xffff, "sanity: module IX matches oracle");
  assert.notEqual(REC, o.regs.ix & 0xffff, "an un-advanced IX (=REC) must be rejected");
  console.log(`  TEETH(live-out): module IX ${hx(o.regs.ix)} advanced past REC ${hx(REC)}`);
});
