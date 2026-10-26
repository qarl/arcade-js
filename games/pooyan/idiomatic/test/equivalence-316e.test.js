// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for advanceLeadHunterSwoopAndArmDive (ROM 0x316e, Pooyan) — the lead-hunter swoop step.
 *
 * The cycle-free / memory-equivalence gate (docs/decompiler-pipeline): a fresh clone per side, the
 * oracle on one and advanceLeadHunterSwoopAndArmDive on the other, compared on RAM (dumpState, minus stack scratch below the entry SP).
 * pc/SP/registers are deliberately not compared.
 *
 * The routine takes no register inputs; it reads everything from work RAM. A wave timer gates it: while
 * nonzero it counts down and returns; at zero it advances the hunter record (the FORMATION_SLOT_TABLE
 * word), driven by a movement-script byte (dwell vs sub-pixel step), then either arms the dive (player
 * crossing) or re-primes the timer (armed, past tile 0x1b), stamps three display records, and falls
 * into the four-slot scan scanDisplaySlotsAndTickBoardClear.
 *
 * LIVE-OUT: none — the tail scanDisplaySlotsAndTickBoardClear leaves an advanced IX / drained B, but no caller reads them
 * (dispatchFormationPhaseOrQueueLaunchSlots discards this routine's return), so they are not compared. Both sides run the SAME
 * scanDisplaySlotsAndTickBoardClear and queueSoundCommand0F (verified idiomatic modules), so the sub-calls agree by construction; the
 * gate's job is advanceLeadHunterSwoopAndArmDive's own branching and its display-record stamping.
 *
 * The display-record pointers (slot-table +2/+4/+6) carry a high byte 0x8b (not the 0x8c board-clear
 * tag), so scanDisplaySlotsAndTickBoardClear's scan skips tickHunterReturnCounterAndCheckBoardClear on every slot — it only advances IX and drains B here. The
 * board-clear tail is covered by scanDisplaySlotsAndTickBoardClear's own gate.
 *
 * The leaf is not reached in a plain boot, so every case is CRAFTED (identical pokes on both sides).
 *
 * Jobs:
 *   1. EQUAL — over crafted states covering every branch (early return; dwell +/- dive; sub-pixel step
 *      with armed re-prime, armed-no-reprime, and unarmed-no-dive) oracle == advanceLeadHunterSwoopAndArmDive in RAM (−stack).
 *   2. WRITE-SET — the dwell/no-dive case writes only inside the hunter record + the three display
 *      records, with the per-record byte2/byte4 (C vs C+2, B vs B+2) variation exact.
 *   3. TEETH — a wrong stamped display byte is CAUGHT by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-316e.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_316e as oracle } from "../../translated/loc_316e.js";
import { advanceLeadHunterSwoopAndArmDive } from "../advanceLeadHunterSwoopAndArmDive.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const SLOT = 0x8920; //        FORMATION_SLOT_TABLE (IY word at +0, display-record ptrs at +2/+4/+6)
const TIMER = 0x8928; //       wave timer
const SCRIPT_PTR = 0x8f4b; //  16-bit movement-script pointer (lo at +0, hi at +1)
const DIVE_FLAG = 0x8f4a; //   dive-armed flag (LAUNCH_SCRIPT_PTR)
const TEARDOWN = 0x8f24; //    WAVE_TEARDOWN_STATE
const FORMATION = 0x8f08; //   FORMATION_STATE
const PLAYER = 0x8a84; //      player position
const HUNTER = 0x8b80; //      hunter record base (IY target)
const SCRIPT = 0x8bf0; //      where the script bytes live (RAM)
const REC1 = 0x8b00; //        display record 1 pointer target
const REC2 = 0x8b20; //        display record 2 pointer target
const REC3 = 0x8b40; //        display record 3 pointer target

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);
function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** A fresh clone with the slot table, hunter record, script, timer and gate cells seated. */
function craft(pokes) {
  const m = BASE.clone();
  m.regs.sp = 0x8ffe; // the oracle's push/pop/call/ret only touch the stack inside STACK_SCRATCH
  // slot-table: IY word + three display-record pointers (high byte 0x8b != the 0x8c board-clear tag)
  m.mem8[SLOT + 0] = HUNTER & 0xff; m.mem8[SLOT + 1] = HUNTER >> 8;
  m.mem8[SLOT + 2] = REC1 & 0xff; m.mem8[SLOT + 3] = REC1 >> 8;
  m.mem8[SLOT + 4] = REC2 & 0xff; m.mem8[SLOT + 5] = REC2 >> 8;
  m.mem8[SLOT + 6] = REC3 & 0xff; m.mem8[SLOT + 7] = REC3 >> 8;
  // hunter record defaults
  m.mem8[HUNTER + 3] = 0x10; m.mem8[HUNTER + 4] = 0x00;
  m.mem8[HUNTER + 5] = 0x00; m.mem8[HUNTER + 6] = 0x00; m.mem8[HUNTER + 9] = 0x10;
  // script pointer -> SCRIPT, with a dwell (0) byte and a step second byte by default
  m.mem8[SCRIPT_PTR] = SCRIPT & 0xff; m.mem8[SCRIPT_PTR + 1] = SCRIPT >> 8;
  m.mem8[SCRIPT] = 0x00; m.mem8[SCRIPT + 1] = 0x02;
  // timer + gate cells
  m.mem8[TIMER] = 0x00; m.mem8[DIVE_FLAG] = 0x00; m.mem8[PLAYER] = 0x20;
  m.mem8[TEARDOWN] = 0x00; m.mem8[FORMATION] = 0x00;
  for (const [addr, val] of pokes) m.mem8[addr] = val & 0xff;
  return m;
}

const CASES = [
  { name: "early return (wave timer nonzero)", pokes: [[TIMER, 0x05]] },
  { name: "dwell, no dive", pokes: [] },
  { name: "dwell, dive arms (player crossed)", pokes: [[PLAYER, 0x10]] },
  { name: "step, dive-armed re-prime", pokes: [[DIVE_FLAG, 0x01], [SCRIPT, 0x05], [HUNTER + 4, 0x30], [HUNTER + 3, 0x00]] },
  { name: "step, dive-armed no re-prime", pokes: [[DIVE_FLAG, 0x01], [SCRIPT, 0x05], [HUNTER + 4, 0x10], [HUNTER + 3, 0x00]] },
  { name: "step, dive not armed, no dive", pokes: [[SCRIPT, 0x05], [PLAYER, 0xff], [HUNTER + 3, 0x00]] },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted branch coverage — advanceLeadHunterSwoopAndArmDive == oracle in RAM (−stack)", () => {
  for (const cse of CASES) {
    const o = craft(cse.pokes);
    const c = craft(cse.pokes);
    oracle(o);
    advanceLeadHunterSwoopAndArmDive(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${cse.name}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted branch cases identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the dwell/no-dive case writes only the hunter + three display records", () => {
  const footprint = new Set([
    HUNTER + 3, HUNTER + 9,
    REC1 + 3, REC1 + 4, REC1 + 5, REC1 + 6,
    REC2 + 3, REC2 + 4, REC2 + 5, REC2 + 6,
    REC3 + 3, REC3 + 4, REC3 + 5, REC3 + 6,
  ]);
  const before = craft([]);
  const after = craft([]);
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();

  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) {
      const addr = after.stateOffsetToAddr(off);
      if (inDeadStack(addr)) continue; // -stack: oracle call trampolines push there
      assert.ok(footprint.has(addr), `unexpected write at ${hx(addr)} (${b0[off]} -> ${a1[off]})`);
    }
  }
  const r = (a) => after.mem8[a];
  // hunter advance: rec+3 = 0x10 + (rec+9 stepped 0x10->0x11) = 0x21; rec+9 = 0x11
  assert.equal(r(HUNTER + 3), 0x21, "hunter X advanced");
  assert.equal(r(HUNTER + 9), 0x11, "dwell stepped");
  // per-record byte2 = C then C+2 then C+2 (C = rec+4 = 0); byte4 = B+2, B, B+2 (B = rec+6 = 0)
  assert.equal(r(REC1 + 4), 0x00, "record 1 byte2 = C");
  assert.equal(r(REC2 + 4), 0x02, "record 2 byte2 = C+2");
  assert.equal(r(REC3 + 4), 0x02, "record 3 byte2 = C+2");
  assert.equal(r(REC1 + 6), 0x02, "record 1 byte4 = B+2");
  assert.equal(r(REC2 + 6), 0x00, "record 2 byte4 = B");
  assert.equal(r(REC3 + 6), 0x02, "record 3 byte4 = B+2");
  // byte1 = hunter X (0x21), byte3 = sub-pixel low (0x00) on every record
  for (const rec of [REC1, REC2, REC3]) {
    assert.equal(r(rec + 3), 0x21, "record byte1 = hunter X");
    assert.equal(r(rec + 5), 0x00, "record byte3 = sub-pixel low");
  }
  console.log("  WRITE-SET: hunter rec+3/rec+9 + 3 display records (byte2 C/C+2/C+2, byte4 B+2/B/B+2)");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong stamped display byte is CAUGHT by the RAM diff", () => {
  const o = craft([]);
  const c = craft([]);
  oracle(o);
  advanceLeadHunterSwoopAndArmDive(c);
  c.mem8[REC2 + 4] = (c.mem8[REC2 + 4] + 1) & 0xff; // BUG: record 2 byte2 must be C+2, not C+3

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong stamped byte — it is worthless");
  assert.equal(d.addr, REC2 + 4, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong stamped byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
