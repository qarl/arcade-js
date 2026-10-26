// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for dispatchLevelIntroElseMainLoop (Pooyan) — per-frame gate on ROUND_COUNTER bit 1.
 *
 * Bit 1 clear: delegate to the main-loop sub-state dispatcher (0x0fd5) and return. Bit 1
 * set: run the level-intro phase dispatcher (idiomatic here / translated oracle), then a code-window
 * integrity probe that latches INTEGRITY_FLAG_SCAN_BASE only when a fixed program cell fails its
 * bit tally. That cell lives in ROM (an intact 0x16 byte), so on a good ROM the strike write is
 * never taken and cannot be poked — its guard is exercised only by the TEETH corruption below.
 *
 * The routine takes no register inputs (memory-only). Compared on RAM (dumpState) minus
 * stack scratch below the entry SP; SP is parked inside STACK_SCRATCH so the delegated calls' stack traffic falls out.
 *
 * Jobs: 1. EQUAL across the delegate branch (over sub-state selectors) and the intro branch (over
 * all seven phases); 2. WRITE-SET (delegate branch mutates RAM; a clean intro run leaves the
 * integrity flag untouched); 3. TEETH (a corrupted integrity flag is caught; the branches differ).
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-1d9c.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1d9c as oracle } from "../../translated/loc_1d9c.js";
import { dispatchLevelIntroElseMainLoop } from "../dispatchLevelIntroElseMainLoop.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  ROUND_COUNTER,
  INTEGRITY_FLAG_SCAN_BASE,
  INTRO_PHASE_INDEX,
  MAINLOOP_SUBSTATE_SELECTOR,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const SP0 = 0x8ff0; // inside STACK_SCRATCH
const ROUND_BIT1 = 0x02;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Seat the branch selectors; the integrity flag is pre-cleared so a spurious strike is observable. */
function seat({ round = ROUND_BIT1, phase = 0x00, selector = 0x00 } = {}) {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.mem.write8(ROUND_COUNTER, round);
  m.mem.write8(INTRO_PHASE_INDEX, phase);
  m.mem.write8(MAINLOOP_SUBSTATE_SELECTOR, selector);
  m.mem.write8(INTEGRITY_FLAG_SCAN_BASE, 0x00);
  return m;
}

const CASES = [
  // bit 1 clear -> delegate to the main-loop sub-state dispatcher (selector picks the handler)
  { name: "delegate, sub-state 0", cfg: { round: 0x00, selector: 0 } },
  { name: "delegate, sub-state 1", cfg: { round: 0x00, selector: 1 } },
  { name: "delegate, sub-state 2", cfg: { round: 0x00, selector: 2 } },
  { name: "delegate, sub-state 3", cfg: { round: 0x00, selector: 3 } },
  { name: "delegate, sub-state 4", cfg: { round: 0x00, selector: 4 } },
  { name: "delegate, sub-state 5", cfg: { round: 0x00, selector: 5 } },
  // bit 1 set -> intro dispatcher (all seven phases) then the clean integrity probe
  { name: "intro phase 0", cfg: { round: ROUND_BIT1, phase: 0 } },
  { name: "intro phase 1", cfg: { round: ROUND_BIT1, phase: 1 } },
  { name: "intro phase 2", cfg: { round: ROUND_BIT1, phase: 2 } },
  { name: "intro phase 3", cfg: { round: ROUND_BIT1, phase: 3 } },
  { name: "intro phase 4", cfg: { round: ROUND_BIT1, phase: 4 } },
  { name: "intro phase 5", cfg: { round: ROUND_BIT1, phase: 5 } },
  { name: "intro phase 6", cfg: { round: ROUND_BIT1, phase: 6 } },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: dispatchLevelIntroElseMainLoop == oracle in RAM (−stack)", () => {
  for (const { name, cfg } of CASES) {
    const o = seat(cfg);
    const c = seat(cfg);
    oracle(o);
    dispatchLevelIntroElseMainLoop(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} branches identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: delegate branch mutates RAM; a clean intro run leaves the integrity flag clear", () => {
  // delegate branch: 0x0fd5 does real work -> RAM differs from a no-op baseline
  const before = seat({ round: 0x00, selector: 0 });
  const after = seat({ round: 0x00, selector: 0 });
  dispatchLevelIntroElseMainLoop(after);
  assert.notEqual(ramDiffMinusStack(before, after), null, "delegate branch must mutate RAM");

  // clean intro run: the probed cell is intact, so no strike is latched
  const intro = seat({ round: ROUND_BIT1, phase: 0 });
  dispatchLevelIntroElseMainLoop(intro);
  assert.equal(intro.mem.read8(INTEGRITY_FLAG_SCAN_BASE), 0x00, "clean ROM leaves the integrity flag clear");
  console.log("  WRITE-SET: delegate mutates RAM; clean probe leaves 0x89e7 == 0");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a corrupted integrity flag is CAUGHT; branches are load-bearing", () => {
  const o = seat({ round: ROUND_BIT1, phase: 0 });
  const c = seat({ round: ROUND_BIT1, phase: 0 });
  oracle(o);
  dispatchLevelIntroElseMainLoop(c);
  c.mem.write8(INTEGRITY_FLAG_SCAN_BASE, 0x01); // fake a spurious strike on the module side
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted integrity flag");
  assert.equal(d.addr, INTEGRITY_FLAG_SCAN_BASE, `teeth caught wrong address ${hx(d.addr ?? 0)}`);

  // the two branches (delegate vs intro) must produce different RAM, or the bit-1 guard is dead
  const del = seat({ round: 0x00, selector: 0 });
  const intro = seat({ round: ROUND_BIT1, phase: 0 });
  oracle(del);
  oracle(intro);
  assert.notEqual(ramDiffMinusStack(del, intro), null, "delegate and intro branches must differ");
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}; bit-1 guard load-bearing`);
});
