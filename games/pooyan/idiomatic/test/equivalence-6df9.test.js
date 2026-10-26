// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for paintAttractColumnWithTamperChecksum — the anti-tamper clone of typeAttractTextColumn (attract sub-state 5).
 *
 * paintAttractColumnWithTamperChecksum ticks the animation frame counter (advanceAttractAnimationAndRepaint on wrap), advances the scripted sprite step
 * (advanceFourObjectAnimsAndRebuildList), and on each SCRIPT_FRAME_TIMER expiry copies one script byte through the write cursor,
 * backing that cursor up one 0x20 row; every SCRIPT_STEP_COUNTDOWN expiry reseeds the timers, bumps
 * ATTRACT_SUBSTATE, and rolls a 14-row (stride 0x20) checksum verified against the two bytes at the
 * INTRO_DELAY_CKSUM_WORD pointer. The module dissolves advanceAttractAnimationAndRepaint/advanceFourObjectAnimsAndRebuildList/runObjectAndEnemyActorUpdate to direct calls and
 * keeps the frozen 0x7442 tamper dispatcher; the oracle drives the frozen subtree. Both are compared in
 * RAM (dumpState, minus stack scratch below the entry SP). paintAttractColumnWithTamperChecksum is void — no register survives — so only RAM is compared.
 *
 * Reachable arms are seated: timer-counting (advanceAttractAnimationAndRepaint wrap + advanceFourObjectAnimsAndRebuildList + tick), byte-copy (timer expires,
 * step still counting), and the full checksum on a CLEAN-PASS (source byte 0 into a zeroed 14-row region,
 * so the sum is 0 and the two stored bytes are 0 -> the check-pointer advances, no tamper branch). The
 * tamper arms (jp 0x7442 / runObjectAndEnemyActorUpdate) run frozen handlers in isolation, so they are not seated here; the
 * module keeps/dissolves them identically to the oracle.
 *
 * Jobs:
 *   1. EQUAL — timer-counting, byte-copy, checksum-clean-pass: oracle == module in RAM (−stack).
 *   2. WRITE-SET — the SCRIPT_FRAME_TIMER expiry gates the byte copy (source cursor advances only then).
 *   3. TEETH — a wrong placed byte is caught by the RAM diff.
 *   4. SP-TOOTH (R36) — the routine tail-dispatches (return m.call(0x7442) / return runObjectAndEnemyActorUpdate); assert it
 *      seats SP for the withOmittedRet seam on a real caller-return word (moved-0 arm -> placeable).
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-6df9.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_6df9 as oracle } from "../../translated/loc_6df9.js";
import { paintAttractColumnWithTamperChecksum } from "../paintAttractColumnWithTamperChecksum.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { deadStackBelow, firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const ANIM_FC = 0x8d41; //  ANIM_FRAME_COUNTER
const FTIMER = 0x8e50; //   SCRIPT_FRAME_TIMER
const SUBSTATE = 0x8e51; // ATTRACT_SUBSTATE
const STEPCD = 0x8e52; //   SCRIPT_STEP_COUNTDOWN
const SRC = 0x8e54; //      SCRIPT_READ_PTR (16-bit)
const WPTR = 0x8e56; //     SCRIPT_WRITE_PTR (16-bit)
const CKWORD = 0x8f48; //   INTRO_DELAY_CKSUM_WORD (16-bit)
const SRC_TARGET = 0x8fa8; //   quiet scratch the source cursor points at
const CK_TARGET = 0x8fac; //    quiet scratch the check pointer points at
const CKSUM_BASE = 0x8c00; //   14-row checksum region base (above every cell advanceFourObjectAnimsAndRebuildList writes)
const DST = 0x8c20; //          byte-copy destination = write cursor before the 0x20 back-up
const SP0 = 0x8ff0; //          inside STACK_SCRATCH
const CALLER_RET = 0xfffc; //   caller's return word the seam completes on the moved-0 arm
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

function base() {
  const m = BASE.clone();
  m.regs.sp = SP0;
  return m;
}

/** Timer-counting arm: ANIM_FRAME_COUNTER wraps (advanceAttractAnimationAndRepaint), then the frame timer just ticks down. */
function craftTick() {
  const m = base();
  m.mem.write8(ANIM_FC, 0x01); // dec -> 0 -> advanceAttractAnimationAndRepaint fires
  m.mem.write8(FTIMER, 0x03); // dec -> 2 (nonzero) -> early ret
  return m;
}

/** Byte-copy arm: frame timer expires (copy runs), step countdown still counting -> ret before checksum. */
function craftCopy() {
  const m = base();
  m.mem.write8(ANIM_FC, 0x05); // dec -> 4 -> skip advanceAttractAnimationAndRepaint
  m.mem.write8(FTIMER, 0x01); // dec -> 0 -> copy
  m.mem.write8(STEPCD, 0x03); // dec -> 2 -> ret before checksum
  m.mem.write16(SRC, SRC_TARGET);
  m.mem.write8(SRC_TARGET, 0x37); // the byte to place
  m.mem.write16(WPTR, DST);
  return m;
}

/** Checksum arm: both timers expire; source byte 0 into a zeroed 14-row region + zero stored bytes
 *  -> sum 0 matches -> the clean-pass advances the check pointer (no tamper branch). */
function craftChecksum() {
  const m = base();
  m.mem.write8(ANIM_FC, 0x05); // skip advanceAttractAnimationAndRepaint
  m.mem.write8(FTIMER, 0x01); // expire -> copy
  m.mem.write8(STEPCD, 0x01); // expire -> checksum
  m.mem.write16(SRC, SRC_TARGET);
  m.mem.write8(SRC_TARGET, 0x00); // placed byte 0 -> DST stays 0
  m.mem.write16(WPTR, DST); // after copy WPTR = DST - 0x20 = CKSUM_BASE
  for (let r = 0; r < 14; r++) m.mem.write8(CKSUM_BASE + r * 0x20, 0x00); // zero the summed rows
  m.mem.write16(CKWORD, CK_TARGET);
  m.mem.write8(CK_TARGET, 0x00); // stored low byte
  m.mem.write8(CK_TARGET + 1, 0x00); // stored high byte
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: tick, byte-copy, checksum-clean-pass — module == oracle in RAM (−stack)", () => {
  for (const [label, craft] of [
    ["timer counting (advanceAttractAnimationAndRepaint wrap)", craftTick],
    ["byte copy", craftCopy],
    ["checksum clean pass", craftChecksum],
  ]) {
    const o = craft();
    const c = craft();
    oracle(o);
    paintAttractColumnWithTamperChecksum(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${label}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log("  EQUAL: 3 arms identical (RAM −stack), composed idiomatic advanceAttractAnimationAndRepaint/advanceFourObjectAnimsAndRebuildList");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the frame-timer expiry gates the byte copy", () => {
  const tick = craftCopy();
  tick.mem.write8(FTIMER, 0x03); // timer still counting -> no copy
  oracle(tick);
  assert.equal(tick.mem.read16(SRC), SRC_TARGET, "timer counting -> source cursor NOT advanced");
  assert.equal(tick.mem.read8(DST), 0x00, "timer counting -> nothing placed");

  const copy = craftCopy();
  oracle(copy);
  assert.equal(copy.mem.read16(SRC), (SRC_TARGET + 1) & 0xffff, "timer expired -> source cursor advanced");
  assert.equal(copy.mem.read8(DST), 0x37, "timer expired -> byte placed through the write cursor");
  console.log("  WRITE-SET: expiry advances the source cursor and places the byte");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong placed byte is caught by the RAM diff", () => {
  const o = craftCopy();
  const c = craftCopy();
  oracle(o);
  paintAttractColumnWithTamperChecksum(c);
  c.mem.write8(DST, 0x99); // BUG: the copy must have placed 0x37
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong placed byte — it is worthless");
  assert.equal(d.addr, DST, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(DST)})`);
  console.log(`  TEETH/RAM: wrong placed byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

// -- 4. SP-TOOTH (R36) --------------------------------------------------------

test("SP-TOOTH: paintAttractColumnWithTamperChecksum (tail-dispatches to 0x7442 / runObjectAndEnemyActorUpdate) seats SP for the seam", () => {
  const m = craftTick();
  m.mem.write8(ANIM_FC, 0x05); // skip advanceAttractAnimationAndRepaint -> minimal sub-calls on this arm
  m.mem.write16(SP0, CALLER_RET); // the caller's return word the seam completes (moved-0 arm)
  const r = seamPlaceable(withOmittedRet, paintAttractColumnWithTamperChecksum, 0x6df9, m);
  assert.equal(r.placeable, true, `paintAttractColumnWithTamperChecksum must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: paintAttractColumnWithTamperChecksum seam-placeable (moved 0, seam completes the ret)");
});
