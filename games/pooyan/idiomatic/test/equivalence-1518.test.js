// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for tickEnemyHoldThenTurnOrBlank (Pooyan) — per-frame object update with a phase-advance step.
 *
 * The routine steps the object's animation and counts down the record's frame timer (IX+0x11);
 * while it is still running it returns. On expiry it optionally redraws a HUD field — a nonzero
 * doubled selector ((0x8f60)<<1) is packed to BCD and drawn as stacked digits, with the hundreds
 * tally stored only when nonzero — then advances the phase: at the final phase (IX+0x16 == 7) it
 * tail-delegates to the turn-animation arm; otherwise it writes the next phase (IX+0x13), reloads
 * the timer, bumps the state byte (IX+0x02), re-steps, and tail-delegates to the sprite-band blank.
 *
 * The only input is IX (seated identically on both sides). Compared on RAM (dumpState) minus
 * stack scratch below the entry SP — the oracle drives SP/stack through the dropped call/rst ABI, so its framing lands
 * in the dead stack and falls out of the diff. LIVE-OUT is memory only.
 *
 * Jobs: 1. EQUAL across timer-running / selector-zero / hundreds-zero / hundreds-nonzero /
 * final-phase / phase-advance branches; 2. WRITE-SET (per-branch cells); 3. TEETH (a corrupted HUD
 * cell is caught; the branches differ).
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-1518.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1518 as oracle } from "../../translated/loc_1518.js";
import { tickEnemyHoldThenTurnOrBlank } from "../tickEnemyHoldThenTurnOrBlank.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  SUBSTATE_FIELD3_VALUE,
  SUBSTATE_FIELD3_VRAM_ALT,
  SUBSTATE_FIELD3_HUNDREDS_VRAM_ALT,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const IX = 0x8a80; // record base, clear of STACK_SCRATCH and the HUD cells
const FRAME_TIMER = IX + 0x11;
const ANIM_HOLD = IX + 0x0e;
const PHASE = IX + 0x16;
const NEXT_PHASE = IX + 0x13;
const STATE_FIELD = IX + 0x02;
const DIGITS_CELL = SUBSTATE_FIELD3_VRAM_ALT; //     0x85c9 tens digit
const UNITS_CELL = SUBSTATE_FIELD3_VRAM_ALT - 0x20; // one row up
const HUNDREDS_CELL = SUBSTATE_FIELD3_HUNDREDS_VRAM_ALT;
const DIRT = 0xaa;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, STACK_SCRATCH.hi - 0x10);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/**
 * Seat the record and selector. ANIM_HOLD is nonzero so the animation step just decrements (no
 * stream walk); timer/selector/phase pick the branch; HUD cells are pre-dirtied so a draw shows.
 */
function seat({ timer = 0x01, selector = 0x00, phase = 0x03 } = {}) {
  const m = BASE.clone();
  m.regs.ix = IX;
  m.regs.sp = STACK_SCRATCH.hi - 0x10; // dead stack: the oracle's push/pop + rst framing land here
  m.mem.write8(ANIM_HOLD, 0x05);
  m.mem.write8(FRAME_TIMER, timer);
  m.mem.write8(PHASE, phase);
  m.mem.write8(NEXT_PHASE, DIRT);
  m.mem.write8(STATE_FIELD, 0x00);
  m.mem.write8(SUBSTATE_FIELD3_VALUE, selector);
  m.mem.write8(DIGITS_CELL, DIRT);
  m.mem.write8(UNITS_CELL, DIRT);
  m.mem.write8(HUNDREDS_CELL, DIRT);
  return m;
}

const CASES = [
  { name: "timer still running -> early return", cfg: { timer: 0x02 } },
  { name: "selector zero -> skip HUD, advance", cfg: { timer: 0x01, selector: 0x80, phase: 0x03 } },
  { name: "selector nonzero, hundreds zero", cfg: { timer: 0x01, selector: 0x0a, phase: 0x02 } },
  { name: "selector nonzero, hundreds nonzero", cfg: { timer: 0x01, selector: 0x50, phase: 0x02 } },
  { name: "final phase -> turn-anim arm", cfg: { timer: 0x01, selector: 0x80, phase: 0x07 } },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: tickEnemyHoldThenTurnOrBlank == oracle in RAM (−stack)", () => {
  for (const { name, cfg } of CASES) {
    const o = seat(cfg);
    const c = seat(cfg);
    oracle(o);
    tickEnemyHoldThenTurnOrBlank(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} branches identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: per-branch cells match the oracle", () => {
  // timer still running: only the animation dec + the timer dec persist.
  const run = seat({ timer: 0x02 });
  oracle(run);
  assert.equal(run.mem.read8(FRAME_TIMER), 0x01, "timer decremented");
  assert.equal(run.mem.read8(ANIM_HOLD), 0x04, "animation hold decremented");
  assert.equal(run.mem.read8(DIGITS_CELL), DIRT, "no HUD draw while the timer runs");

  // hundreds path: HUD cells drawn (0x50 -> selector 0xa0=160 -> tens 6, units 0, hundreds 1),
  // and the trailing band blank zeroes the record cells.
  const hun = seat({ timer: 0x01, selector: 0x50, phase: 0x02 });
  oracle(hun);
  assert.equal(hun.mem.read8(DIGITS_CELL), 0x06, "tens digit drawn");
  assert.equal(hun.mem.read8(UNITS_CELL), 0x00, "units digit drawn");
  assert.equal(hun.mem.read8(HUNDREDS_CELL), 0x01, "hundreds tally stored");
  assert.equal(hun.mem.read8(IX + 0x00), 0x00, "band blank zeroes the record");

  // selector zero: the HUD draw is skipped entirely.
  const zero = seat({ timer: 0x01, selector: 0x80, phase: 0x03 });
  oracle(zero);
  assert.equal(zero.mem.read8(DIGITS_CELL), DIRT, "selector zero skips the draw");
  assert.equal(zero.mem.read8(HUNDREDS_CELL), DIRT, "selector zero skips the hundreds store");

  // hundreds-zero path: digits drawn but no hundreds store (0x0a -> selector 0x14=20).
  const noh = seat({ timer: 0x01, selector: 0x0a, phase: 0x02 });
  oracle(noh);
  assert.equal(noh.mem.read8(DIGITS_CELL), 0x02, "tens digit drawn (20)");
  assert.equal(noh.mem.read8(HUNDREDS_CELL), DIRT, "hundreds zero skips the store");
  console.log("  WRITE-SET: timer dec / HUD draw / hundreds store / skips verified");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a corrupted HUD cell is CAUGHT; branches are load-bearing", () => {
  const o = seat({ timer: 0x01, selector: 0x50, phase: 0x02 });
  const c = seat({ timer: 0x01, selector: 0x50, phase: 0x02 });
  oracle(o);
  tickEnemyHoldThenTurnOrBlank(c);
  assert.equal(ramDiffMinusStack(o, c), null, "module agrees before the injected bug");
  c.mem.write8(DIGITS_CELL, (o.mem.read8(DIGITS_CELL) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted HUD digit");
  assert.equal(d.addr, DIGITS_CELL, `teeth caught wrong address ${hx(d.addr ?? 0)}`);

  // Distinct branches must produce distinct RAM, or a guard is dead.
  const zero = seat({ timer: 0x01, selector: 0x80, phase: 0x03 });
  const hun = seat({ timer: 0x01, selector: 0x50, phase: 0x02 });
  oracle(zero);
  oracle(hun);
  assert.notEqual(ramDiffMinusStack(zero, hun), null, "selector-zero and hundreds branches must differ");

  const advance = seat({ timer: 0x01, selector: 0x80, phase: 0x03 });
  const final = seat({ timer: 0x01, selector: 0x80, phase: 0x07 });
  oracle(advance);
  oracle(final);
  assert.notEqual(ramDiffMinusStack(advance, final), null, "phase-advance and final-phase branches must differ");
  console.log(`  TEETH: caught at ${hx(d.addr)}; selector + phase guards load-bearing`);
});
