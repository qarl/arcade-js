// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for advanceLevelIntroFromPhase5 (ROM 0x7032) — "level-intro phase 5": while the
 * target-group count (0x8f47) is nonzero, tick it via tickTargetGroupCounterAndQueueDisplay (which queues sound 0x0315);
 * then count the intro delay word (0x8f48) down — when already zero, reseed it to 0x20 and
 * advance the intro phase (0x8f51); otherwise decrement it and, only on a 16-frame boundary
 * (low nibble now zero), toggle 0x8f54 and queue one of two display commands (0x06a7/0x0627)
 * chosen by the new bit0, via rst 0x38.
 *
 * Cycle-free memory-equivalence gate: fresh clone per side, compared on RAM (dumpState, minus
 * stack scratch below the entry SP) only. The routine has NO register live-out — the intro dispatcher (dispatchLevelIntroPhase)
 * tail-dispatches here and its caller reads nothing back — so pc and the whole register file
 * are deliberately NOT compared. The page-0x88 display ring is seated so the enqueues land.
 *
 * Jobs:
 *   1. EQUAL (crafted) — tick-only, delay-elapsed, both 16-frame-boundary parities, a combined
 *      tick+boundary, and a non-boundary tick: oracle == advanceLevelIntroFromPhase5 in RAM (−stack).
 *   2. WRITE-SET — the delay-elapsed path writes exactly the delay reseed and the phase bump.
 *   3. TEETH — a wrong phase byte on the elapsed path is caught by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-7032.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_7032 as oracle } from "../../translated/loc_7032.js";
import { advanceLevelIntroFromPhase5 } from "../advanceLevelIntroFromPhase5.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  TARGET_GROUP_COUNT,
  INTRO_DELAY_CKSUM_WORD,
  INTRO_PHASE_INDEX,
  DISPLAY_CMD_RING_WRITE_PTR,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const INTRO_TOGGLE = 0x8f54; // the phase-5 toggle byte whose bit0 picks the display command
const RING_PAGE = DISPLAY_CMD_RING_WRITE_PTR & 0xff00; // page-0x88 ring base
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** A fresh clone seating the phase-5 cells and a couple of free display-ring slots. */
function craft({ group, delay, phase, toggle }) {
  const m = BASE.clone();
  m.regs.sp = 0x8ffe;
  m.mem.write8(TARGET_GROUP_COUNT, group);
  m.mem.write8(INTRO_DELAY_CKSUM_WORD, delay);
  m.mem.write8(INTRO_PHASE_INDEX, phase);
  m.mem.write8(INTRO_TOGGLE, toggle);
  m.mem.write8(DISPLAY_CMD_RING_WRITE_PTR, 0xc0);
  m.mem.write8(RING_PAGE + 0xc0, 0x80); // free slot for the first enqueue
  m.mem.write8(RING_PAGE + 0xc2, 0x80); // free slot for a second enqueue
  return m;
}

const CASES = [
  { group: 0x05, delay: 0x20, phase: 0x02, toggle: 0x00 }, // tick the group, delay not elapsed
  { group: 0x00, delay: 0x00, phase: 0x02, toggle: 0x00 }, // delay elapsed -> reseed + advance phase
  { group: 0x00, delay: 0x11, phase: 0x02, toggle: 0x00 }, // 16-frame boundary, new bit0=1 -> cmd B
  { group: 0x00, delay: 0x11, phase: 0x02, toggle: 0x01 }, // 16-frame boundary, new bit0=0 -> cmd A
  { group: 0x03, delay: 0x11, phase: 0x02, toggle: 0x00 }, // tick + boundary (two enqueues)
  { group: 0x00, delay: 0x08, phase: 0x02, toggle: 0x00 }, // non-boundary decrement -> plain return
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted cases — advanceLevelIntroFromPhase5 == oracle in RAM (−stack)", () => {
  for (const cs of CASES) {
    const o = craft(cs);
    oracle(o);
    const c = craft(cs);
    advanceLevelIntroFromPhase5(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b} (${JSON.stringify(cs)})`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted cases identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the delay-elapsed path reseeds the delay and bumps the phase (exactly two cells)", () => {
  const cs = CASES[1]; // group=0, delay=0 -> elapsed
  const m = craft(cs);
  const b0 = m.dumpState();
  oracle(m);
  const a1 = m.dumpState();
  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off] && !inDeadStack(m.stateOffsetToAddr(off))) changed.push(m.stateOffsetToAddr(off));
  }
  changed.sort((x, y) => x - y);
  assert.deepEqual(changed, [INTRO_DELAY_CKSUM_WORD, INTRO_PHASE_INDEX], "elapsed path writes only the delay + phase");
  assert.equal(m.mem.read8(INTRO_DELAY_CKSUM_WORD), 0x20, "delay reseeded to 0x20");
  assert.equal(m.mem.read8(INTRO_PHASE_INDEX), 0x03, "phase advanced 0x02 -> 0x03");
  console.log("  WRITE-SET: delay-elapsed = 2 cells (0x8f48 := 0x20, 0x8f51 bumped)");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong phase byte is CAUGHT by the RAM diff", () => {
  const cs = CASES[1];
  const o = craft(cs);
  const c = craft(cs);
  oracle(o);
  advanceLevelIntroFromPhase5(c);
  c.mem.write8(INTRO_PHASE_INDEX, 0x02); // BUG: phase must advance to 0x03, not stay 0x02
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong phase byte — it is worthless");
  assert.equal(d.addr, INTRO_PHASE_INDEX, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH: wrong phase byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
