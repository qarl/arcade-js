// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for retireResetOrEngageObjectRecord (ROM 0x613d, Pooyan) — the matched-record handler and
 * entry of the retire/reset/scan cluster; a caller that dissolves the caller-skip clearActiveObjectTypeAndAbortHandler.
 *
 * Behaviour by branch off the record IY points at:
 *   - +0 flag bit0 clear   -> straight to the caller-skip (clear ACTIVE_OBJECT_TYPE, abort).
 *   - ROUND_COUNTER odd     -> reset the actor record (0x6166) then abort.
 *   - ACTIVE_OBJECT_TYPE!=3 -> reset the actor record then abort.
 *   - otherwise             -> A := (+0x14) tag, scan six records of the sprite object table;
 *                              engage the first match (0x6190) or reset if none, then abort.
 * Every branch ends in the pop-af skip. The idiomatic module composes the real idiomatic
 * scan/engage/reset/sound/skip chain.
 *
 * Cycle-free memory-equivalence gate: the oracle drives the translated chain, the module the
 * idiomatic chain; compared on RAM (dumpState, minus stack scratch below the entry SP). No register survives the
 * terminating skip, so the register file is not compared, and retireResetOrEngageObjectRecord's own JS return is not a
 * live-out (the frozen caller unwinds through the stack, which the dissolution drops) — RAM is
 * the contract. SP is parked in STACK_SCRATCH so the chain's pushes and the pop-af+ret drop out
 * of the diff. IY is placed above the scan region so no reset field aliases a scan tag.
 *
 * Jobs:
 *   1. EQUAL — all five branches: oracle == module in RAM (−stack).
 *   2. WRITE-SET — the flag-clear branch's ONLY game-RAM write is ACTIVE_OBJECT_TYPE := 0
 *      (it must NOT reset the record), proving that branch is distinct from the reset branches.
 *   3. TEETH — a wrong written byte is caught, and running a reset branch on the flag-clear
 *      case (the wrong branch) diverges from the oracle.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-613d.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_613d as oracle } from "../../translated/loc_613d.js";
import { retireResetOrEngageObjectRecord } from "../retireResetOrEngageObjectRecord.js";
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
const ROUND_COUNTER = 0x8907;
const SPRITE_OBJECT_TABLE = 0x8b70;
const SOUND_RING_PTR = 0x8a40;
const TAG_OFF = 0x14;
const SCAN_STRIDE = 0x18;
const SCAN_COUNT = 6;
const REC_FIELDS = [0x01, 0x02, 0x13, 0x16, 0x17]; // reset fields other than +0 / +0x14 (seated below)
const IY = 0x8c50; // reset record, above the scan region
const A_TAG = 0x42;
const SP_SCRATCH = 0x8ff0;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP_SCRATCH);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** A fresh clone with the IY record, round parity, object type, and (when scanned) tags seated. */
function craft({ flag, round, objType, matchIndex }) {
  const m = BASE.clone();
  m.regs.iy = IY;
  m.mem.write8(IY, flag & 0xff); // +0 flag byte
  m.mem.write8((IY + TAG_OFF) & 0xffff, A_TAG); // +0x14 scan compare value
  for (const off of REC_FIELDS) m.mem.write8((IY + off) & 0xffff, 0xee); // pre-dirty reset fields
  m.mem.write8(ROUND_COUNTER, round & 0xff);
  m.mem.write8(ACTIVE_OBJECT_TYPE, objType & 0xff);
  m.mem.write8(SOUND_RING_PTR, 0x43);
  if (matchIndex !== null) {
    for (let i = 0; i < SCAN_COUNT; i++) {
      const tag = i === matchIndex ? A_TAG : (A_TAG ^ 0x5a) & 0xff;
      m.mem.write8((SPRITE_OBJECT_TABLE + i * SCAN_STRIDE + TAG_OFF) & 0xffff, tag);
    }
  }
  m.regs.sp = SP_SCRATCH;
  return m;
}

const CASES = [
  { name: "flag bit0 clear -> abort", flag: 0x00, round: 0x00, objType: 0x03, matchIndex: null },
  { name: "odd round -> reset", flag: 0x01, round: 0x01, objType: 0x03, matchIndex: null },
  { name: "wrong type -> reset", flag: 0x01, round: 0x00, objType: 0x00, matchIndex: null },
  { name: "scan match (3rd) -> engage", flag: 0x01, round: 0x00, objType: 0x03, matchIndex: 2 },
  { name: "scan no-match -> reset", flag: 0x01, round: 0x00, objType: 0x03, matchIndex: -1 },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: retireResetOrEngageObjectRecord == oracle in RAM (−stack) across all five branches", () => {
  for (const cfg of CASES) {
    const o = craft(cfg);
    const c = craft(cfg);
    oracle(o);
    const ret = retireResetOrEngageObjectRecord(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${cfg.name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    assert.equal(ret, false, `${cfg.name}: every branch takes the pop-af skip -> must return false`);
  }
  console.log(`  EQUAL: ${CASES.length} branches identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the flag-clear branch writes ONLY ACTIVE_OBJECT_TYPE := 0 (no record reset)", () => {
  const cfg = CASES[0]; // flag bit0 clear
  const m = craft(cfg);
  const b0 = m.dumpState();
  oracle(m);
  const a1 = m.dumpState();
  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) changed.push(m.stateOffsetToAddr(off));
  }
  const nonStack = changed.filter((addr) => !inDeadStack(addr));
  assert.deepEqual(nonStack, [ACTIVE_OBJECT_TYPE], `flag-clear branch must not reset the record; wrote: ${nonStack.map(hx)}`);
  console.log(`  WRITE-SET: flag-clear footprint = { ${hx(ACTIVE_OBJECT_TYPE)} := 0 }`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong written byte is CAUGHT by the RAM diff", () => {
  const cfg = CASES[3]; // scan match -> engage
  const o = craft(cfg);
  const c = craft(cfg);
  oracle(o);
  retireResetOrEngageObjectRecord(c);
  const rec = (SPRITE_OBJECT_TABLE + cfg.matchIndex * SCAN_STRIDE) & 0xffff;
  const victim = (rec + 0x08) & 0xffff;
  c.mem.write8(victim, 0x00); // BUG: engaged state must be 0x01
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong engaged byte");
  assert.equal(d.addr, victim, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: resetting the record on the flag-clear branch diverges from the oracle", () => {
  // The flag-clear branch must abort WITHOUT resetting the record; a twin that ran the reset
  // would write the record fields, which the RAM diff must flag against the oracle's footprint.
  const cfg = CASES[0];
  const o = craft(cfg);
  oracle(o);
  const c = craft(cfg);
  resetActorRecordQueueSoundAndAbortFrame(c); // wrong branch: reset instead of the direct abort
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate must catch a reset run on the flag-clear branch");
  console.log(`  TEETH(branch): reset-on-flag-clear diverges at ${hx(d.addr ?? 0)}`);
});
