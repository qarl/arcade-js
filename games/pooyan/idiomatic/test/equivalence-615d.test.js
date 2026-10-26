// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for scanRecordsForTagEngageElseReset (ROM 0x615d, Pooyan) — the record-scan loop.
 *
 * Starting from IX, the routine compares A against each record's +0x14 tag, advancing IX by DE
 * up to B records. The first match hands that record to the "engage" step (0x6190, which seats
 * +8 := 0x01 and +0xa := 0xd0) then into the actor-record reset (0x6166); if no record matches
 * within B, it goes straight to the reset. Both continuations enqueue a sound command and end in
 * the caller-skip (0x618a) that clears ACTIVE_OBJECT_TYPE and aborts the frame. The idiomatic
 * module composes the real idiomatic 0x6190/0x6166/sound/0x618a chain.
 *
 * Cycle-free memory-equivalence gate: the oracle drives the translated chain, the module the
 * idiomatic chain; compared on RAM (dumpState, minus stack scratch below the entry SP). No register survives the
 * terminating skip, so the register file is not compared; the module returns false. SP is parked
 * in STACK_SCRATCH so the inner call's pushes and the skip's pop-af+ret drop out of the diff.
 *
 * The scan region (from IX, stride DE) and the reset record (IY) are placed apart so an engage
 * write cannot alias a scan tag or a reset field, keeping each footprint observable.
 *
 * Jobs:
 *   1. EQUAL — match on the first record, match on a later record, and no-match-exhaust:
 *      oracle == module in RAM (−stack); the module returns false.
 *   2. CRAFTED — on a match the engaged record carries +8 := 0x01 / +0xa := 0xd0 and the reset
 *      record is cleared.
 *   3. TEETH — a wrong engaged byte is caught, and taking the reset branch on a match (the wrong
 *      continuation) diverges from the oracle.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-615d.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_615d as oracle } from "../../translated/loc_615d.js";
import { scanRecordsForTagEngageElseReset } from "../scanRecordsForTagEngageElseReset.js";
import { resetActorRecordQueueSoundAndAbortFrame } from "../resetActorRecordQueueSoundAndAbortFrame.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const ACTIVE_OBJECT_TYPE = 0x8d44;
const SOUND_RING_PTR = 0x8a40;
const TAG_OFF = 0x14;
const REC_FIELDS = [0x00, 0x01, 0x02, 0x13, 0x14, 0x16, 0x17];
const SP_SCRATCH = 0x8ff0;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP_SCRATCH);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const A_TAG = 0x42;
const IX = 0x8b70; // scan base
const DE = 0x18; // record stride
const COUNT = 6; // records to scan
const IY = 0x8c50; // reset record, clear of the scan region

/** A fresh clone: scan inputs in A/IX/DE/B, tags seeded so record `matchIndex` matches (-1 none). */
function craft(objType, matchIndex) {
  const m = BASE.clone();
  m.regs.a = A_TAG;
  m.regs.ix = IX;
  m.regs.de = DE;
  m.regs.b = COUNT;
  m.regs.iy = IY;
  for (const off of REC_FIELDS) m.mem.write8((IY + off) & 0xffff, 0xee);
  for (let i = 0; i < COUNT; i++) {
    const tag = i === matchIndex ? A_TAG : (A_TAG ^ 0x5a) & 0xff; // distinct non-match value
    m.mem.write8((IX + i * DE + TAG_OFF) & 0xffff, tag);
  }
  m.mem.write8(ACTIVE_OBJECT_TYPE, objType & 0xff);
  m.mem.write8(SOUND_RING_PTR, 0x43);
  m.regs.sp = SP_SCRATCH;
  return m;
}

const CASES = [
  { name: "match first", matchIndex: 0, objType: 0x00 },
  { name: "match third", matchIndex: 2, objType: 0x03 },
  { name: "no match (exhaust)", matchIndex: -1, objType: 0x00 },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: scanRecordsForTagEngageElseReset == oracle in RAM (−stack) over match / no-match", () => {
  for (const { name, matchIndex, objType } of CASES) {
    const o = craft(objType, matchIndex);
    const c = craft(objType, matchIndex);
    oracle(o);
    const ret = scanRecordsForTagEngageElseReset(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    assert.equal(ret, false, `chain ends in the caller-skip -> false (${name})`);
  }
  console.log(`  EQUAL: ${CASES.length} scan outcomes identical (RAM −stack)`);
});

// -- 2. CRAFTED ---------------------------------------------------------------

test("CRAFTED: a match engages that record (+8 := 0x01, +0xa := 0xd0)", () => {
  const matchIndex = 2;
  const c = craft(0x03, matchIndex);
  scanRecordsForTagEngageElseReset(c);
  const rec = (IX + matchIndex * DE) & 0xffff;
  assert.equal(c.mem.read8((rec + 0x08) & 0xffff), 0x01, "engaged state on the matched record");
  assert.equal(c.mem.read8((rec + 0x0a) & 0xffff), 0xd0, "engaged parameter on the matched record");
  const o = craft(0x03, matchIndex);
  oracle(o);
  assert.equal(o.mem.read8((rec + 0x08) & 0xffff), 0x01, "oracle agrees");
  console.log(`  CRAFTED: matched record ${hx(rec)} engaged (+8/+0xa)`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong engaged byte is CAUGHT by the RAM diff", () => {
  const matchIndex = 0;
  const o = craft(0x00, matchIndex);
  const c = craft(0x00, matchIndex);
  oracle(o);
  scanRecordsForTagEngageElseReset(c);
  const victim = (IX + 0x08) & 0xffff; // matched record 0, +8
  c.mem.write8(victim, 0x00); // BUG: engaged state must be 0x01
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong engaged byte");
  assert.equal(d.addr, victim, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: taking the reset branch on a match diverges from the oracle", () => {
  // On a match the oracle engages the record (+8 := 0x01); a twin that skipped the scan and
  // went straight to the reset would not write +8, so the RAM diff must flag it.
  const matchIndex = 0;
  const o = craft(0x00, matchIndex);
  oracle(o);
  const c = craft(0x00, matchIndex);
  resetActorRecordQueueSoundAndAbortFrame(c); // the wrong continuation (reset only, no engage)
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate must catch a module that reset instead of engaging on a match");
  console.log(`  TEETH(branch): reset-on-match diverges at ${hx(d.addr ?? 0)}`);
});
