// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for advanceOverlapScanToNextSlot — the advance-and-loop latch of the six-slot overlap scan.
 *
 * advanceOverlapScanToNextSlot writes NO RAM: it steps the record-index pointer (IX) by one record (+4) and the geometry
 * pointer (HL) by one stride (+0x18), decrements the slot counter (B), and either re-enters the scan
 * pass (B != 0) or completes the exhausted no-hit sweep (B == 0). Because there is no memory effect,
 * a RAM-only gate would pass a wholly wrong stride — so the REGISTER file (the advanced IX/HL, the
 * counter B, the scratch DE) is the contract here, plus the forwarded boolean.
 *
 * SEATING: TAIL-CALL. On B != 0 the oracle tail-jumps the scan pass (testRecordOverlapRetireOrFlagHit), whose effective
 * seating is a boolean caller-skip (false = a hit must unwind the caller's frame); on B == 0 it rets.
 * The module returns true for the exhausted sweep and forwards testRecordOverlapRetireOrFlagHit's boolean otherwise. This
 * gate exercises the SELF-CONTAINED exhausted path (B == 1 -> 0), which never enters testRecordOverlapRetireOrFlagHit; the
 * continue branch is the {testRecordOverlapRetireOrFlagHit, advanceOverlapScanToNextSlot} cluster's whole-unit responsibility.
 *
 * Jobs:
 *   1. REGISTER — the exhausted path advances IX/HL, zeroes B, leaves DE = 0x18: module == oracle.
 *   2. RAM — the routine touches no RAM (dumpState minus stack scratch below the entry SP identical); and the module
 *      forwards true on the exhausted sweep.
 *   3. TEETH — a wrong advance is caught by the register compare; a wrong boolean is caught.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-6018.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_6018 as oracle } from "../../translated/loc_6018.js";
import { advanceOverlapScanToNextSlot } from "../advanceOverlapScanToNextSlot.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const IX0 = 0x8850;          // record-index pointer (arbitrary; advanceOverlapScanToNextSlot touches no RAM)
const HL0 = 0x8ae0;          // geometry pointer
const INDEX_STRIDE = 4;
const GEOM_STRIDE = 0x18;
const SP_SCRATCH = 0x8ff0;   // parked in STACK_SCRATCH; the oracle's ret only pops (reads)

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP_SCRATCH);

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** Seat the scan cursor with B == 1 so the single decrement exhausts the sweep (no testRecordOverlapRetireOrFlagHit entry). */
function craft() {
  const m = BASE.clone();
  m.regs.ix = IX0;
  m.regs.hl = HL0;
  m.regs.b = 0x01;
  m.regs.sp = SP_SCRATCH;
  return m;
}

const REGS = (m) => ({
  ix: m.regs.ix & 0xffff,
  hl: m.regs.hl & 0xffff,
  b: m.regs.b & 0xff,
  de: m.regs.de & 0xffff,
});

// -- 1. REGISTER --------------------------------------------------------------

test("REGISTER: exhausted path — advanceOverlapScanToNextSlot advances IX/HL, zeroes B (== oracle)", () => {
  const o = craft();
  const c = craft();
  oracle(o);
  const ret = advanceOverlapScanToNextSlot(c);

  assert.deepEqual(REGS(c), REGS(o), "advanced register file must equal the oracle");
  assert.deepEqual(
    REGS(o),
    { ix: (IX0 + INDEX_STRIDE) & 0xffff, hl: (HL0 + GEOM_STRIDE) & 0xffff, b: 0x00, de: GEOM_STRIDE },
    "oracle sanity: IX += 4, HL += 0x18, B -> 0, DE = 0x18",
  );
  assert.equal(ret, true, "the exhausted no-hit sweep must forward true");
  console.log(`  REGISTER: IX=${hx(c.regs.ix)} HL=${hx(c.regs.hl)} B=${hx(c.regs.b & 0xff)} DE=${hx(c.regs.de)}`);
});

// -- 2. RAM -------------------------------------------------------------------

test("RAM: the latch touches no RAM (module == oracle, −stack)", () => {
  const o = craft();
  const c = craft();
  oracle(o);
  advanceOverlapScanToNextSlot(c);
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);

  const before = craft().dumpState();
  const after = ((m) => (advanceOverlapScanToNextSlot(m), m.dumpState()))(craft());
  assert.deepEqual([...after], [...before], "advanceOverlapScanToNextSlot must not write RAM");
  console.log("  RAM: no writes (−stack)");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong advance is CAUGHT by the register compare", () => {
  const o = craft();
  const c = craft();
  oracle(o);
  advanceOverlapScanToNextSlot(c);
  c.regs.ix = (c.regs.ix + 1) & 0xffff; // BUG: index pointer off by one

  assert.notEqual(c.regs.ix & 0xffff, o.regs.ix & 0xffff, "the register compare FAILED to catch a wrong advance");
  console.log("  TEETH/register: off-by-one IX advance caught");
});

test("TEETH: a wrong forwarded boolean is CAUGHT", () => {
  assert.throws(
    () => assert.equal(((m) => (advanceOverlapScanToNextSlot(m), false))(craft()), true),
    "an exhausted no-hit sweep must forward true",
  );
  console.log("  TEETH/boolean: exhausted-sweep-returns-false twin caught");
});
