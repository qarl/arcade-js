// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for selectRoundDisplayListAndAdvancePhase (ROM 0x16b7, Pooyan) — the idx1 phase-timer state handler.
 *
 * SEATING: BALANCED (plain ret / call+ret) -> WIRE. Void handler: no caller reads a register back,
 * so LIVE-OUT is memory only and the comparison is RAM (dumpState) minus stack scratch below the entry SP; nested
 * sub-routine pushes park in the dead stack (SP in STACK_SCRATCH) and drop out of the diff.
 *
 * Paths crafted: timer-not-expired early ret; attract branch (latch bit0 -> force sub-state 0x10);
 * and three decision-tree pointer selections (in-progress alt, round-parity primary, latched
 * branch). Body cases seat the display buffer to the ROM pattern so the trailing clearDisplayMsgBufOnRoundInitMatch clears
 * and returns rather than re-entering this handler.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-16b7.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_16b7 as oracle } from "../../translated/loc_16b7.js";
import { selectRoundDisplayListAndAdvancePhase } from "../selectRoundDisplayListAndAdvancePhase.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  DISPLAY_MSG_BUF,
  PHASE_TIMER,
  PLAY_MODE_LATCH,
  PLAY_STATE_INDEX,
  ROUND_IN_PROGRESS,
  GAME_ACTIVE_FLAG,
  ROUND_COUNTER,
  DISPLAY_LIST_SRC_PTR,
  DISPLAY_LIST_SRC_PTR_ALT,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const PATTERN_ROM = 0x16ae;
const SP0 = 0x8ff0;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

function copyPattern(m) {
  for (let i = 0; ; i++) {
    const b = m.mem.read8(PATTERN_ROM + i);
    m.mem.write8(DISPLAY_MSG_BUF + i, b);
    if (b === 0xff) break;
  }
}

/** Seat SP/interrupt state, the display buffer (so clearDisplayMsgBufOnRoundInitMatch clears), and the decision cells. */
function seat(m, { timer = 0x01, latch = 0x00, inProg = 0x00, active = 0x01, round = 0x00 } = {}) {
  m.regs.sp = SP0;
  m.regs.i = 0x00;
  m.regs.iff2 = false;
  copyPattern(m);
  m.mem.write8(PHASE_TIMER, timer);
  m.mem.write8(PLAY_MODE_LATCH, latch);
  m.mem.write8(ROUND_IN_PROGRESS, inProg);
  m.mem.write8(GAME_ACTIVE_FLAG, active);
  m.mem.write8(ROUND_COUNTER, round);
  return m;
}

const CASES = {
  "timer not expired -> ret": (m) => seat(m, { timer: 0x03 }),
  "attract: latch bit0 -> sub-state 0x10": (m) => seat(m, { timer: 0x01, latch: 0x01 }),
  "tree: in-progress -> alt pointers (round even -> ALT_EVEN)": (m) => seat(m, { latch: 0x00, inProg: 0x01, round: 0x02 }),
  "tree: round bit0 -> primary pointers (ROUND_ODD)": (m) => seat(m, { latch: 0x00, inProg: 0x00, active: 0x01, round: 0x01 }),
  "tree: latched branch bit1 set (LATCH_B1)": (m) => seat(m, { latch: 0x02, round: 0x02 }),
  // --- three formerly-unexercised (gfx,layout) branches (ROUND0 / LATCH / ALT_ODD) ---
  // latch==0, not in-progress, game active, round==0 -> round-zero primary pointers (DLIST_*_ROUND0)
  "tree: round==0 -> ROUND0 pointers": (m) => seat(m, { latch: 0x00, inProg: 0x00, active: 0x01, round: 0x00 }),
  // latch!=0 (bit0 clear so not attract), round bit1 clear -> plain latched pointers (DLIST_*_LATCH)
  "tree: latched branch bit1 clear (LATCH)": (m) => seat(m, { latch: 0x02, round: 0x00 }),
  // useAlt (in-progress) with round ODD -> odd alternate pointers (DLIST_*_ALT_ODD)
  "tree: in-progress -> alt pointers (round odd -> ALT_ODD)": (m) => seat(m, { latch: 0x00, inProg: 0x01, round: 0x03 }),
};

test("EQUAL: selectRoundDisplayListAndAdvancePhase == oracle in RAM (−stack)", () => {
  for (const [name, craft] of Object.entries(CASES)) {
    const o = craft(BASE.clone());
    const c = craft(BASE.clone());
    oracle(o);
    selectRoundDisplayListAndAdvancePhase(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${Object.keys(CASES).length} paths identical (RAM −stack)`);
});

test("WRITE-SET: timer-not-expired decrements only; attract forces sub-state 0x10", () => {
  const t = CASES["timer not expired -> ret"](BASE.clone());
  oracle(t);
  assert.equal(t.mem.read8(PHASE_TIMER), 0x02, "0x03 - 1 = 0x02 at the phase timer");

  const a = CASES["attract: latch bit0 -> sub-state 0x10"](BASE.clone());
  oracle(a);
  assert.equal(a.mem.read8(PLAY_STATE_INDEX), 0x10, "attract path forces sub-state 0x10");
  console.log("  WRITE-SET: timer -1; attract sub-state 0x10");
});

test("WRITE-SET: the 3 formerly-unexercised (gfx,layout) branches commit the oracle's pointer pair", () => {
  // Each branch selects a distinct (gfx@DISPLAY_LIST_SRC_PTR_ALT, layout@DISPLAY_LIST_SRC_PTR) pair.
  // Expected values are DERIVED FROM THE ORACLE, then the module must match — so mutating any of the
  // ROUND0 / LATCH / ALT_ODD DLIST_ constants (which the oracle carries as its own literals) diverges.
  for (const name of [
    "tree: round==0 -> ROUND0 pointers",
    "tree: latched branch bit1 clear (LATCH)",
    "tree: in-progress -> alt pointers (round odd -> ALT_ODD)",
  ]) {
    const o = CASES[name](BASE.clone());
    const c = CASES[name](BASE.clone());
    oracle(o);
    selectRoundDisplayListAndAdvancePhase(c);
    const gfxO = o.mem.read16(DISPLAY_LIST_SRC_PTR_ALT);
    const layoutO = o.mem.read16(DISPLAY_LIST_SRC_PTR);
    assert.equal(
      c.mem.read16(DISPLAY_LIST_SRC_PTR_ALT),
      gfxO,
      `${name}: gfx ptr @${hx(DISPLAY_LIST_SRC_PTR_ALT)} must equal oracle ${hx(gfxO)}`,
    );
    assert.equal(
      c.mem.read16(DISPLAY_LIST_SRC_PTR),
      layoutO,
      `${name}: layout ptr @${hx(DISPLAY_LIST_SRC_PTR)} must equal oracle ${hx(layoutO)}`,
    );
  }
  console.log("  WRITE-SET: ROUND0 / LATCH / ALT_ODD pointer pairs match the oracle");
});

test("TEETH: a corrupted post-run byte is CAUGHT by the RAM diff", () => {
  const o = CASES["tree: round bit0 -> primary pointers (ROUND_ODD)"](BASE.clone());
  const c = CASES["tree: round bit0 -> primary pointers (ROUND_ODD)"](BASE.clone());
  oracle(o);
  selectRoundDisplayListAndAdvancePhase(c);
  c.mem.write8(PLAY_STATE_INDEX, (o.mem.read8(PLAY_STATE_INDEX) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted byte");
  console.log(`  TEETH(RAM): caught at ${hx(d.addr ?? 0)}`);
});

test("TEETH: a twin that skips the phase-timer decrement diverges", () => {
  const o = CASES["timer not expired -> ret"](BASE.clone());
  const c = CASES["timer not expired -> ret"](BASE.clone());
  oracle(o); // decrements the phase timer
  // twin: do nothing -> the seated 0x03 survives
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "a skipped decrement must be caught by the RAM diff");
  console.log(`  TEETH(dec): caught at ${hx(d.addr ?? 0)}`);
});
