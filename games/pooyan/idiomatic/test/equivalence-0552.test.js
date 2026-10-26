// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for resetBcdCounterAndRepaintColumn (Pooyan ROM 0x0552) — reset one of three 3-byte BCD counters
 * to zero and repaint it in its HUD column. A selects the counter (0 = player 1, 1 = player 2, else
 * high score): its three bytes are zeroed, then rendered most-significant byte first down the column,
 * each byte split into a high then a low BCD digit through the leading-zero-blanking digit painter
 * (blank budget 4, one row up per digit). Since the bytes were just zeroed, the six digits paint as
 * four blank tiles (0x10) followed by two zero tiles (0x00).
 *
 * Cycle-free / memory-equivalence gate. Compared on RAM (dumpState) MINUS stack scratch below the entry SP. pc/SP/cycles
 * and the register file are NOT compared — this is a memory-only routine (its selector is the sole
 * input register; nothing is read back). The sole input A is poked identically on both sides.
 *
 * Jobs:
 *   1. EQUAL — every selector arm (0, 1, >=2, and a high value) identical in RAM.
 *   2. WRITE-SET — the writes are exactly the three counter bytes and the six HUD-column cells.
 *   3. CRAFTED — the player-2 and high-score arms clear the right counter and paint the right column.
 *   4. TEETH — a wrong HUD tile and a non-zeroed counter byte are both caught.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-0552.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0552 as oracle } from "../../translated/loc_0552.js";
import { resetBcdCounterAndRepaintColumn } from "../resetBcdCounterAndRepaintColumn.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  P1_SCORE_BCD,
  P2_SCORE_BCD,
  HIGH_SCORE_BCD,
  P1_SCORE_VRAM,
  P2_SCORE_VRAM,
  HIGH_SCORE_VRAM,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const TARGET = 0x0552;
const STRIDE = 0x20; // one tilemap row (the render steps one row UP per digit)
const DIGITS = 6;
const EXPECTED_HUD = [0x10, 0x10, 0x10, 0x10, 0x00, 0x00]; // 4 blanks then 2 zeros
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);

function ramDiffMinusStack(ma, mb, dead = inDeadStack) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), dead);
}

/** {base, dest, counterCells, hudCells} for a selector, matching the routine's own mapping. */
function target(sel) {
  const base = sel === 0 ? P1_SCORE_BCD : sel === 1 ? P2_SCORE_BCD : HIGH_SCORE_BCD;
  const dest = sel === 0 ? P1_SCORE_VRAM : sel === 1 ? P2_SCORE_VRAM : HIGH_SCORE_VRAM;
  const counterCells = [base, base + 1, base + 2];
  const hudCells = [];
  for (let i = 0; i < DIGITS; i++) hudCells.push((dest - i * STRIDE) & 0xffff);
  return { base, dest, counterCells, hudCells };
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** Fresh clone with A = selector and every target cell pre-dirtied to 0xAA. */
function craft(sel) {
  const m = BASE.clone();
  m.regs.a = sel & 0xff;
  const { counterCells, hudCells } = target(sel);
  for (const cell of [...counterCells, ...hudCells]) m.mem.write8(cell, 0xaa);
  m.regs.sp = 0x8ffe; // in STACK_SCRATCH; the af push/pop + ret touch dead RAM only
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: every selector arm — resetBcdCounterAndRepaintColumn == oracle in RAM (−stack)", () => {
  for (const sel of [0, 1, 2, 0xff]) {
    const o = craft(sel);
    const c = craft(sel);
    oracle(o);
    resetBcdCounterAndRepaintColumn(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `sel=${hx(sel)}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log("  EQUAL: selectors 0/1/2/0xff identical (RAM −stack)");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: writes are exactly the 3 counter bytes + 6 HUD cells (sel 0)", () => {
  const sel = 0;
  const { counterCells, hudCells } = target(sel);
  const expected = new Set([...counterCells, ...hudCells]);

  const before = craft(sel);
  const after = craft(sel);
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();

  const changed = new Set();
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] === a1[off]) continue;
    const addr = after.stateOffsetToAddr(off);
    if (inDeadStack(addr)) continue; // the oracle's af push/pop + call scratch is not game state
    changed.add(addr);
  }
  for (const addr of changed) assert.ok(expected.has(addr), `oracle wrote unexpected addr ${hx(addr)}`);
  for (const addr of expected) assert.ok(changed.has(addr), `expected a change at ${hx(addr)}`);
  for (const cell of counterCells) assert.equal(after.mem.read8(cell), 0x00, `counter ${hx(cell)} must be zeroed`);
  hudCells.forEach((cell, i) => assert.equal(after.mem.read8(cell), EXPECTED_HUD[i], `HUD ${hx(cell)} tile`));
  console.log(`  WRITE-SET: ${counterCells.length} counter + ${hudCells.length} HUD cells`);
});

// -- 3. CRAFTED ---------------------------------------------------------------

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  try {
    const host = new Machine(ROM, { overrides: snap });
    host.runFrames(maxFrames);
  } catch {
    /* keep whatever we captured */
  }
  return caps;
}

test("CAPTURE: real 0x0552 dispatches replay identically (if reached)", () => {
  const caps = ROM_PRESENT ? captureDispatches(8, 1500) : [];
  for (const cap of caps) {
    const o = cap.clone();
    const c = cap.clone();
    oracle(o);
    resetBcdCounterAndRepaintColumn(c);
    const d = ramDiffMinusStack(o, c, deadStackBelow(STACK_SCRATCH, cap.regs.sp));
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  CAPTURE: ${caps.length} real dispatch(es) replayed`);
});

test("CRAFTED: the player-2 and high-score arms clear + paint the right cells", () => {
  for (const sel of [1, 5]) {
    const { counterCells, hudCells } = target(sel);
    const o = craft(sel);
    const c = craft(sel);
    oracle(o);
    resetBcdCounterAndRepaintColumn(c);
    assert.equal(ramDiffMinusStack(o, c), null, `sel=${sel}: RAM must match`);
    for (const cell of counterCells) assert.equal(c.mem.read8(cell), 0x00, `sel=${sel}: counter ${hx(cell)} zeroed`);
    hudCells.forEach((cell, i) => assert.equal(c.mem.read8(cell), EXPECTED_HUD[i], `sel=${sel}: HUD ${hx(cell)}`));
  }
  console.log("  CRAFTED: player-2 (0x88a5/0x8521) + high-score (0x88a8/0x8641) arms verified");
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: a wrong HUD tile is CAUGHT by the RAM diff", () => {
  const sel = 0;
  const { hudCells } = target(sel);
  const o = craft(sel);
  const c = craft(sel);
  oracle(o);
  resetBcdCounterAndRepaintColumn(c);
  c.mem.write8(hudCells[0], EXPECTED_HUD[0] ^ 0x01); // BUG: wrong tile in the top digit cell
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong HUD tile — it is worthless");
  assert.equal(d.addr, hudCells[0], `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/HUD: wrong tile caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a non-zeroed counter byte is CAUGHT by the RAM diff", () => {
  const sel = 0;
  const { counterCells } = target(sel);
  const o = craft(sel);
  const c = craft(sel);
  oracle(o);
  resetBcdCounterAndRepaintColumn(c);
  c.mem.write8(counterCells[1], 0x99); // BUG: counter byte not cleared
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a non-zeroed counter — it is worthless");
  assert.equal(d.addr, counterCells[1], `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/counter: non-zeroed byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
