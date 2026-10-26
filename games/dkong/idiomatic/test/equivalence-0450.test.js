// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_0450 (ROM 0x0450) — the per-frame colour-cascade dispatcher.
 * It reads the current board and splits three ways on its low two bits:
 *
 *   - bit 0 CLEAR (even boards 50m/100m) -> loc_0478 (shift the sprite-object X column, then
 *                                           the colour-cycle repaint).
 *   - bit 0 SET, bit 1 SET (75m)         -> straight into dispatchColorCyclePaint (no shift).
 *   - bit 0 SET, bit 1 CLEAR (25m)       -> nudge the sprite-object Y column up 4px (the rst-0x38
 *                                           vector addToSpriteObjectColumn, HL = 0x690b, C = −4),
 *                                           then dispatchColorCyclePaint.
 *
 * 0x0450 IS dispatched on 25m in attract (BOARD == 1), so a few real captures cover the 25m
 * Y-shift arm; the even arm (BOARD == 2 and 4 -> loc_0478) and the 75m direct arm (BOARD == 3)
 * are COLD in a 25m attract and are reached by CRAFTED entries reposed on a real attract base
 * (realistic work RAM), poking only the board (the oracle reads the board straight from RAM, so
 * — unlike loc_0478 — no incoming register byte has to be reproduced).
 *
 * The oracle's net stack effect down every path is exactly ONE return: the 25m arm push16s the
 * rst-0x38 link and the shared add-loop's `ret` pops it back (net zero, and the pushed bytes land
 * in STACK_SCRATCH, excluded by the memory-equivalence contract), then the colour tail chain rets
 * the caller's address (one net pop). The idiomatic routine models the Z80 stack as the JS call
 * stack (direct calls, no push16/ret of its own), so the harness performs ONE m.ret() on the
 * candidate to line pc + SP up with the oracle. Every case runs on a FRESH clone (the arms write
 * memory).
 *
 *   1. REALISM (captured) — hook 0x0450 in a real attract run and confirm loc_0450 == oracle over
 *      every natural dispatch (all 25m, the Y-shift arm).
 *
 *   2. EQUAL (crafted) — BOARD == 1 (25m Y-shift arm), 2 and 4 (even -> loc_0478), 3 (75m ->
 *      dispatchColorCyclePaint), each over the whole contract (RAM − the stack scratch below the entry SP + pc + SP) plus
 *      a path-discriminating non-vacuity check (25m: only the Y column moved by −4; even: only the
 *      X column moved; 75m: neither sprite column moved but colour RAM did).
 *
 *   3. TEETH — three deliberately-broken twins, each reusing the real idiomatic arms so the only
 *      divergence is the injected bug, each MUST be caught:
 *      (a) inverted even/odd dispatch — routes even boards to the odd path; caught on BOARD == 2
 *          (the sprite-object X column the oracle shifts stays put).
 *      (b) dropped 25m Y-shift — skips the rst-0x38 nudge; caught on BOARD == 1 (Y column).
 *      (c) wrong Y-shift delta — nudges +4 instead of −4; caught on BOARD == 1 (Y column).
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-0450.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0450 as oracle } from "../../translated/loc_0450.js";
import { dispatchColorCascadeByBoard as loc_0450 } from "../dispatchColorCascadeByBoard.js";
import { shiftEvenBoardSpriteColumn as loc_0478 } from "../shiftEvenBoardSpriteColumn.js";
import { addToSpriteObjectColumn } from "../addToSpriteObjectColumn.js";
import { dispatchColorCyclePaint } from "../dispatchColorCyclePaint.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH, BOARD, SPRITE_OBJ_BLOCK, SPRITE_Y } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x0450;
const RET_ADDR = 0x0429;            // a plausible caller-return for the one net pop (any value works)
const Y_SHIFT = 0xfc;              // the 25m arm's signed −4 nudge of the sprite-object Y column
const SPRITE_X_FIELD = 0x00;       // the sprite-object X-field offset (+0); SPRITE_Y (+3) from names.js
const SHIFT_DELTA_SOURCE = 0x63b7; // loc_0478's 50m X-shift delta source (0 in the attract base)

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const hb = (v) => "0x" + (v & 0xff).toString(16).padStart(2, "0");

// -- the memory-equivalence contract ------------------------------------------

/** First RAM byte that differs between two machines, skipping the stack scratch below the entry SP, or null. */
function firstRamDiff(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState(), db = b.dumpState();
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) continue;
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

/** Run the ORACLE on a fresh clone. Its colour tail chain performs the net `ret`, so pc/SP advance. */
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

/**
 * Run a candidate on a fresh clone, then model its single net return with one m.ret() so pc + SP
 * match the oracle's (the idiomatic routine replaces the Z80 stack with the JS call stack, so it
 * does not touch pc/SP itself — the harness supplies the one return).
 */
function runCandidate(entry, fn) {
  const c = entry.clone();
  fn(c);
  c.ret();
  return c;
}

/** Compare candidate vs oracle over the full contract: RAM − the stack scratch below the entry SP, pc, SP. */
function contractDiffs(entry, fn) {
  const o = runOracle(entry);
  const c = runCandidate(entry, fn);
  const diffs = [];
  const ram = firstRamDiff(o, c, entry.regs.sp);
  if (ram) diffs.push(`RAM@${hx(ram.addr)} oracle=${hb(ram.a)} cand=${hb(ram.b)}`);
  if (o.pc !== c.pc) diffs.push(`pc oracle=${hx(o.pc)} cand=${hx(c.pc)}`);
  if (o.regs.sp !== c.regs.sp) diffs.push(`SP oracle=${hx(o.regs.sp)} cand=${hx(c.regs.sp)}`);
  return diffs;
}

// A real, self-consistent machine: boot + a stretch of attract so work RAM holds realistic values.
function attractBase(frames = 180) {
  const m = new Machine(ROM);
  m.runFrames(frames);
  return m.clone(); // clone neutralises the frame machinery (nextNmi/nextBoundary = Infinity)
}

/**
 * Stamp a crafted 0x0450 entry onto a clone of the base: a clean stack with a plausible caller
 * return (so the net `ret` has a sane target) and the board being tested. The oracle reads the
 * board straight from RAM, so no register needs priming. On the even (50m) arm, loc_0478 reads
 * its X-shift delta from 0x63b7 — 0 in the attract base — so a nonzero `delta` is poked there to
 * make that shift observable (and the misroute teeth non-vacuous).
 */
function craft(base, board, delta) {
  const m = base.clone();
  m.regs.sp = 0x6c00;
  m.push16(RET_ADDR);
  m.mem.write8(BOARD, board & 0xff);
  if (delta !== undefined) m.mem.write8(SHIFT_DELTA_SOURCE, delta & 0xff);
  return m;
}

// The ten X/Y-field bytes of the sprite-object block (stride 4), read from a machine.
const column = (m, field) => Array.from({ length: 10 }, (_, k) => m.mem.read8(SPRITE_OBJ_BLOCK + field + 4 * k));

// -- 1. REALISM (captured) ----------------------------------------------------

test("REALISM: real captured 0x0450 dispatches (25m Y-shift arm) match the oracle", () => {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < 32) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(5000);
  assert.ok(caps.length >= 1, "expected at least one real 0x0450 dispatch during attract");

  for (const cap of caps) {
    // Attract plays 25m, so every real dispatch is the bit0-set/bit1-clear (Y-shift) arm.
    assert.equal(cap.mem.read8(BOARD), 1, "attract capture should be on 25m (BOARD == 1)");
    const diffs = contractDiffs(cap, loc_0450);
    assert.equal(diffs.length, 0, `real dispatch: ${diffs.join("; ")}`);
    // Non-vacuity: the oracle really nudged the whole Y column by −4.
    const before = column(cap, SPRITE_Y);
    const after = column(runOracle(cap), SPRITE_Y);
    for (let k = 0; k < 10; k++) {
      assert.equal(after[k], (before[k] + Y_SHIFT) & 0xff, `real dispatch: Y record ${k} not nudged by −4`);
    }
  }
  console.log(`  REALISM: ${caps.length} real 0x0450 dispatches (all 25m) identical to the oracle`);
});

// -- 2. EQUAL (crafted, all three paths) --------------------------------------

test("EQUAL (crafted): the 25m Y-shift, even -> loc_0478, and 75m direct arms all match the oracle", () => {
  const base = attractBase();

  const cases = [
    { name: "BOARD==1 (25m): Y-shift then colour cycle", board: 1, arm: "yshift" },
    { name: "BOARD==2 (50m): even -> loc_0478 (X shift from 0x63b7=0x50)", board: 2, delta: 0x50, arm: "even" },
    { name: "BOARD==4 (100m): even -> loc_0478 (default +0x44 X shift)", board: 4, arm: "even" },
    { name: "BOARD==3 (75m): straight to dispatchColorCyclePaint", board: 3, arm: "direct" },
  ];

  for (const { name, board, delta, arm } of cases) {
    const entry = craft(base, board, delta);

    const diffs = contractDiffs(entry, loc_0450);
    assert.equal(diffs.length, 0, `${name}: ${diffs.join("; ")}`);

    // Path-discriminating non-vacuity: check what each path did and did NOT move.
    const beforeX = column(entry, SPRITE_X_FIELD);
    const beforeY = column(entry, SPRITE_Y);
    const after = runOracle(entry);
    const afterX = column(after, SPRITE_X_FIELD);
    const afterY = column(after, SPRITE_Y);

    if (arm === "yshift") {
      // 25m: only the Y column moved, by exactly −4; the X column stayed put.
      for (let k = 0; k < 10; k++) {
        assert.equal(afterY[k], (beforeY[k] + Y_SHIFT) & 0xff, `${name}: Y record ${k} not nudged by −4`);
        assert.equal(afterX[k], beforeX[k], `${name}: X record ${k} should not move on the 25m arm`);
      }
    } else if (arm === "even") {
      // Even board: loc_0478 moved the X column; the Y column stayed put.
      assert.notDeepEqual(afterX, beforeX, `${name}: the even arm (loc_0478) did not shift the X column`);
      assert.deepEqual(afterY, beforeY, `${name}: the even arm should not move the Y column`);
    } else {
      // 75m direct arm: neither sprite column moved, but the colour cascade wrote SOMEWHERE.
      assert.deepEqual(afterX, beforeX, `${name}: the 75m arm should not move the X column`);
      assert.deepEqual(afterY, beforeY, `${name}: the 75m arm should not move the Y column`);
      assert.notEqual(firstRamDiff(entry, after, entry.regs.sp), null, `${name}: the colour cascade wrote no RAM`);
    }
  }
  console.log(`  EQUAL/crafted: ${cases.length} arms (25m Y-shift, 50m/100m even, 75m direct) identical to the oracle`);
});

// -- 3. TEETH -----------------------------------------------------------------

/** BUG (a): inverts the bit-0 dispatch — even boards go to the odd path (no loc_0478 X shift). */
function teethInvertedDispatch(m) {
  const { regs, mem } = m;
  const board = mem.read8(BOARD);
  if ((board & 0x01) !== 0) { loc_0478(m); return; } // BUG: should be `=== 0`
  if ((board & 0x02) === 0) {
    regs.hl = SPRITE_OBJ_BLOCK + SPRITE_Y;
    regs.c = Y_SHIFT;
    addToSpriteObjectColumn(m);
  }
  dispatchColorCyclePaint(m);
}

/** BUG (b): drops the 25m Y-shift entirely. */
function teethDroppedShift(m) {
  const { mem } = m;
  const board = mem.read8(BOARD);
  if ((board & 0x01) === 0) { loc_0478(m); return; }
  // BUG: no Y-shift on the 25m arm
  dispatchColorCyclePaint(m);
}

/** BUG (c): nudges the Y column +4 instead of −4. */
function teethWrongDelta(m) {
  const { regs, mem } = m;
  const board = mem.read8(BOARD);
  if ((board & 0x01) === 0) { loc_0478(m); return; }
  if ((board & 0x02) === 0) {
    regs.hl = SPRITE_OBJ_BLOCK + SPRITE_Y;
    regs.c = 0x04; // BUG: should be 0xfc (−4)
    addToSpriteObjectColumn(m);
  }
  dispatchColorCyclePaint(m);
}

test("TEETH: inverted-dispatch, dropped-shift, and wrong-delta twins are all CAUGHT", () => {
  const base = attractBase();

  // (a) inverted dispatch: BOARD==2 (even) with a nonzero 50m delta — the oracle shifts the X
  //     column via loc_0478, the twin takes the odd path and leaves it put.
  const invEntry = craft(base, 2, 0x50);
  const invDiffs = contractDiffs(invEntry, teethInvertedDispatch);
  assert.notEqual(invDiffs.length, 0, "the inverted-dispatch twin escaped — the gate is worthless");
  assert.ok(invDiffs[0].startsWith("RAM@"), `expected a RAM divergence, got ${invDiffs[0]}`);

  // (b) dropped shift: BOARD==1 — the oracle nudges the Y column −4, the twin leaves it put.
  const dropEntry = craft(base, 1);
  const dropDiffs = contractDiffs(dropEntry, teethDroppedShift);
  assert.notEqual(dropDiffs.length, 0, "the dropped-shift twin escaped — the gate is worthless");
  assert.ok(dropDiffs[0].startsWith("RAM@"), `expected a RAM divergence, got ${dropDiffs[0]}`);

  // (c) wrong delta: BOARD==1 — Y column moves +4 instead of −4.
  const wdEntry = craft(base, 1);
  const wdDiffs = contractDiffs(wdEntry, teethWrongDelta);
  assert.notEqual(wdDiffs.length, 0, "the wrong-delta twin escaped — the gate is worthless");
  assert.ok(wdDiffs[0].startsWith("RAM@"), `expected a RAM divergence, got ${wdDiffs[0]}`);

  console.log(`  TEETH: inverted-dispatch caught (${invDiffs[0]}); dropped-shift caught (${dropDiffs[0]}); wrong-delta caught (${wdDiffs[0]})`);
});
