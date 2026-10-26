// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for advanceObjectPhaseThenAuditChecksum (ROM 0x4103, Pooyan) — "per-object frame-advance step"
 * for the record based at IX. It advances the object's animation (advanceObjectAnimationFrame), decrements the
 * dwell countdown (IX+0x11) and returns while it is non-zero; on expiry it bumps the phase
 * (IX+0x02), clears (IX+0x13), and only on the FRAME_COUNTER (0x8a5f) zero crossing folds the
 * low nibbles of a fixed 56-byte block (0x557f) into a checksum, bumping TAMPER_STRIKES_SIG
 * (0x8a38) unless the running total hits the intact sentinel (low 0x67, one carry).
 *
 * Cycle-free memory-equivalence gate: a fresh clone per side, compared on RAM (dumpState,
 * minus stack scratch below the entry SP). No register/flag live-out is declared: advanceObjectPhaseThenAuditChecksum has no direct m.call
 * caller (it is reached by table dispatch on the object state), so no consuming site can be
 * read off the frozen layer; its exit A/flags/HL are treated as scratch. See the batch notes.
 *
 * advanceObjectAnimationFrame is kept to a simple hold decrement by seeding (IX+0x0e) non-zero, so the record's
 * animation stream is not walked (that stream-walk is covered by advanceObjectAnimationFrame's own gate). With
 * the ROM present and intact the checksum matches the sentinel, so the FRAME_COUNTER==0 path
 * does NOT bump the tamper counter (asserted below); the bump arm needs a corrupted, read-only
 * region and is not craftable here (batch notes).
 *
 * Jobs:
 *   1. EQUAL (crafted) — dwell still counting; dwell expiry with FRAME_COUNTER!=0; dwell expiry
 *      with FRAME_COUNTER==0 (full checksum): oracle == module in RAM (−stack).
 *   2. WRITE-SET — the expiry path writes exactly the hold, dwell, phase, and reset fields.
 *   3. CHECKSUM — the FRAME_COUNTER==0 path over the intact block leaves TAMPER_STRIKES_SIG
 *      unchanged (sentinel matched), identically on both sides.
 *   4. TEETH — a wrong dwell byte and a wrong phase byte are each CAUGHT by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-4103.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_4103 as oracle } from "../../translated/loc_4103.js";
import { advanceObjectPhaseThenAuditChecksum } from "../advanceObjectPhaseThenAuditChecksum.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = 0x8bc0; // isolated work-RAM record base
const HOLD = REC + 0x0e; // advanceObjectAnimationFrame's frame-hold counter
const PHASE = REC + 0x02;
const DWELL = REC + 0x11;
const RESET = REC + 0x13;
const FRAME_COUNTER = 0x8a5f;
const TAMPER_STRIKES_SIG = 0x8a38;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** A fresh clone with the object's record fields and the frame counter seated. */
function craft(dwell, frameCounter) {
  const m = BASE.clone();
  m.regs.ix = REC;
  m.mem.write8(HOLD, 0x05); //  non-zero: advanceObjectAnimationFrame just decrements it
  m.mem.write8(DWELL, dwell);
  m.mem.write8(PHASE, 0x02);
  m.mem.write8(RESET, 0x09); // non-zero so the clear-to-0 is observable
  m.mem.write8(FRAME_COUNTER, frameCounter);
  m.regs.sp = 0x8ffe; // advanceObjectAnimationFrame's call push/ret lands inside STACK_SCRATCH
  return m;
}

const CASES = [
  { name: "dwell still counting", dwell: 0x03, frame: 0x33 },
  { name: "dwell expiry, frame!=0", dwell: 0x01, frame: 0x33 },
  { name: "dwell expiry, frame==0 (checksum)", dwell: 0x01, frame: 0x00 },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted dwell/frame cases — advanceObjectPhaseThenAuditChecksum == oracle in RAM (−stack)", () => {
  for (const { name, dwell, frame } of CASES) {
    const o = craft(dwell, frame);
    const c = craft(dwell, frame);
    oracle(o);
    advanceObjectPhaseThenAuditChecksum(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${name}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted cases identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the expiry path writes the hold, dwell, phase, and reset fields", () => {
  const { dwell, frame } = CASES[1]; // frame != 0, so the checksum is not reached
  const footprint = new Set([HOLD, DWELL, PHASE, RESET]);

  const m = craft(dwell, frame);
  const b0 = m.dumpState();
  oracle(m);
  const a1 = m.dumpState();

  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) {
      const addr = m.stateOffsetToAddr(off);
      if (inDeadStack(addr)) continue; // advanceObjectAnimationFrame's call push/ret scratch, not game state
      changed.push(addr);
    }
  }
  assert.equal(changed.length, 4, `expected 4 writes, got ${changed.length}`);
  for (const addr of changed) assert.ok(footprint.has(addr), `unexpected write at ${hx(addr)}`);
  assert.equal(m.mem.read8(HOLD), 0x04, "hold decremented (0x05 -> 0x04)");
  assert.equal(m.mem.read8(DWELL), 0x00, "dwell decremented to 0");
  assert.equal(m.mem.read8(PHASE), 0x03, "phase bumped (0x02 -> 0x03)");
  assert.equal(m.mem.read8(RESET), 0x00, "reset field cleared");
  console.log("  WRITE-SET: hold/dwell/phase/reset (4 cells)");
});

// -- 3. CHECKSUM (intact block -> no tamper bump) -----------------------------

test("CHECKSUM: the frame==0 path over the intact block leaves TAMPER_STRIKES_SIG unchanged", () => {
  const { dwell, frame } = CASES[2]; // frame == 0 -> full checksum runs
  const before = craft(dwell, frame).mem.read8(TAMPER_STRIKES_SIG);

  const o = craft(dwell, frame);
  const c = craft(dwell, frame);
  oracle(o);
  advanceObjectPhaseThenAuditChecksum(c);

  assert.equal(o.mem.read8(TAMPER_STRIKES_SIG), before, "oracle: intact block matches the sentinel, no bump");
  assert.equal(c.mem.read8(TAMPER_STRIKES_SIG), before, "module: intact block matches the sentinel, no bump");
  console.log("  CHECKSUM: intact block -> sentinel match -> tamper counter untouched");
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: a wrong dwell byte is CAUGHT by the RAM diff", () => {
  const { dwell, frame } = CASES[0];
  const o = craft(dwell, frame);
  const c = craft(dwell, frame);
  oracle(o);
  advanceObjectPhaseThenAuditChecksum(c);
  c.mem.write8(DWELL, 0xee); // BUG: dwell must be 0x02 here
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong dwell byte — it is worthless");
  assert.equal(d.addr, DWELL, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(dwell): caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong phase byte is CAUGHT by the RAM diff", () => {
  const { dwell, frame } = CASES[2]; // checksum path
  const o = craft(dwell, frame);
  const c = craft(dwell, frame);
  oracle(o);
  advanceObjectPhaseThenAuditChecksum(c);
  c.mem.write8(PHASE, 0xee); // BUG: phase must be 0x03 here
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong phase byte — it is worthless");
  assert.equal(d.addr, PHASE, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(phase): caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
