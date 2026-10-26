// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for clampActorYAndAdvanceRenderPhase (ROM 0x2334, Pooyan) — the actor-Y clamp + integrity-flag
 * scan + gated phase-advance (the tamper handler tail-jumped from clearAndReseedObjectSlot).
 *
 * The module dissolves the render tail (wrapRenderPhaseAndPaintTileTriplet) into a direct call and keeps the two frozen
 * plain-ret helpers (loc_23d7, loc_23ec) as m.call. clampActorYAndAdvanceRenderPhase is a void handler (no register
 * survives), so equivalence is RAM (dumpState) minus stack scratch below the entry SP, SP parked in dead stack.
 *
 * The no-work arm pins the tile-anim cursor low byte to 0xe6, its target byte below 0x35, and the 7
 * integrity flags clear, so the scan finds nothing and the routine returns after the sprite-Y trio.
 * The work arm holds the cursor low byte off 0xe6 (work found) with the render ring at 7, so the
 * ring wraps and the phase paint (wrapRenderPhaseAndPaintTileTriplet) runs — the maximal footprint.
 *
 * Jobs:
 *   1. EQUAL — no-work and work: oracle == clampActorYAndAdvanceRenderPhase in RAM (−stack).
 *   2. WRITE-SET — work steps the render ring (7 -> 0); no-work holds it, so they differ.
 *   3. TEETH — a wrong render-phase byte is CAUGHT by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-2334.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2334 as oracle } from "../../translated/loc_2334.js";
import { clampActorYAndAdvanceRenderPhase } from "../clampActorYAndAdvanceRenderPhase.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { deadStackBelow, firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = 0x8a80; //     actor record (ACTOR_TABLE); base-Y clamp target (+4), also loc_23d7's own base
const CURSOR = 0x88be; //  tile-anim cursor (16-bit); low byte 0xe6 opens the deref+scan branch
const RING = 0x88bd; //    render ring (mod 8); wraps 7 -> 0
const PHASE = 0x88bc; //   render phase, bumped on the ring wrap
const SCAN = 0x89e7; //    base of the 7-flag integrity block (INTEGRITY_FLAG_SCAN_BASE)
const FRAME = 0x8f37; //   loc_23ec odd-frame gate counter
const SP0 = 0x8ff0; //     inside STACK_SCRATCH
const CALLER_RET = 0xfffc; // caller's return word the seam completes on the moved-0 arm

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Fresh clone: base-Y below 0x41 (clamp active), render ring at 7, loc_23ec on its odd-frame arm. */
function craft(work) {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.regs.a = 0x20; // base-Y < 0x41 -> clamp writes (rec+4) = 0x41
  m.regs.ix = REC;
  m.mem8[RING] = 0x07; // ring at 7 -> the work arm wraps to 0
  m.mem8[FRAME] = 0x00; // inc -> 1, bit0 set -> loc_23ec takes its odd-frame early return
  if (work) {
    m.mem8[CURSOR] = 0x00; // low byte != 0xe6 -> work found immediately
    m.mem8[CURSOR + 1] = 0x89;
  } else {
    m.mem8[CURSOR] = 0xe6; // low byte 0xe6 -> deref + flag scan
    m.mem8[CURSOR + 1] = 0x89; // cursor = 0x89e6
    m.mem8[0x89e6] = 0x00; // deref target < 0x35
    for (let i = 0; i < 7; i++) m.mem8[SCAN + i] = 0x00; // all integrity flags clear -> no work
  }
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: work + no-work states — clampActorYAndAdvanceRenderPhase == oracle in RAM (−stack)", () => {
  for (const [label, work] of [["work found", true], ["no work", false]]) {
    const o = craft(work);
    oracle(o);
    const c = craft(work);
    clampActorYAndAdvanceRenderPhase(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${label}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log("  EQUAL: work + no-work identical (RAM −stack)");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: pending work gates the phase-advance (render ring step)", () => {
  const work = craft(true);
  oracle(work);
  assert.equal(work.mem8[RING], 0x00, "work found -> ring stepped 7 -> 0 (wrap)");

  const idle = craft(false);
  oracle(idle);
  assert.equal(idle.mem8[RING], 0x07, "no work -> ring held");

  assert.notEqual(work.mem8[RING], idle.mem8[RING], "pending work must gate the phase-advance");
  console.log("  WRITE-SET: work steps the ring, no-work holds it");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong render-phase byte is CAUGHT by the RAM diff", () => {
  const o = craft(true);
  const c = craft(true);
  oracle(o);
  clampActorYAndAdvanceRenderPhase(c);
  c.mem8[PHASE] = (c.mem8[PHASE] + 1) & 0xff; // BUG: perturb the phase the wrap should have set
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong phase byte — it is worthless");
  assert.equal(d.addr, PHASE, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong phase byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

// -- 4. SP-TOOTH (R36) --------------------------------------------------------

test("SP-TOOTH: clampActorYAndAdvanceRenderPhase (wired override) is seam-placeable", () => {
  const m = craft(true); // work arm: all sub-calls direct -> SP nets 0
  m.mem8[SP0] = CALLER_RET & 0xff;
  m.mem8[SP0 + 1] = CALLER_RET >> 8; // seat the caller's return word the seam completes
  const r = seamPlaceable(withOmittedRet, clampActorYAndAdvanceRenderPhase, 0x2334, m);
  assert.equal(r.placeable, true, `clampActorYAndAdvanceRenderPhase must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: clampActorYAndAdvanceRenderPhase seam-placeable (moved 0, seam completes the ret)");
});
