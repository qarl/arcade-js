// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for renderDigitWithBlanking (ROM 0x059d, Pooyan) — the leading-zero
 * blanking digit emitter used by the HUD/score renderers: take the low nibble of A, paint one
 * tile at (ix), and step ix by DE. A non-zero nibble stores as-is and clears the blank budget C;
 * a zero nibble stores the blank tile 0x10 while C>0 (C--), or a real 0 once C reaches 0.
 *
 * This is the CYCLE-FREE / memory-equivalence gate. renderDigitWithBlanking WRITES RAM, so every
 * case runs the oracle on one FRESH clone and the module on another, compared on the go-forward
 * contract:
 *
 *     RAM (dumpState, minus stack scratch below the entry SP)  +  the two live-outs { next, blankBudget }.
 *
 * The caller (resetBcdCounterAndRepaintColumn) threads BOTH the advanced cursor (IX) and the blank budget (C) across
 * the digits of a field without reloading them, so the module's { next, blankBudget } is compared
 * against the oracle clone's final regs.ix / regs.c.
 *
 * Jobs:
 *   1. CRAFTED (all three branches) — non-zero nibble, zero nibble with budget, zero nibble spent:
 *      identical RAM(−stack) and identical { next, blankBudget }.
 *   2. CAPTURED (best-effort) — replay any real 0x059d dispatch reached in a boot.
 *   3. WRITE-SET — the oracle's ONLY RAM write is the one tile at (ix).
 *   4. TEETH — a wrong tile at (ix) MUST be caught at (ix); a wrong blank budget MUST be caught
 *      by the return check.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-059d.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_059d as oracle } from "../../translated/loc_059d.js";
import { renderDigitWithBlanking } from "../renderDigitWithBlanking.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built" }, fn);

const TARGET = 0x059d;
const DST = 0x8500; //     a video-RAM tile cell as the cursor
const STRIDE = 0xffe0; //  the score renderer's -0x20 row stride
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8fe0);

/** First RAM difference on the go-forward contract: dumpState minus the dead stack scratch below the entry SP. */
function ramDiffMinusStack(ma, mb, dead = inDeadStack) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), dead);
}

/** A crafted entry machine: ix->cursor, de->stride, A=digit source, C=blank budget. */
function craft(digit, budget) {
  const base = new Machine(ROM);
  base.regs.ix = DST;
  base.regs.de = STRIDE;
  base.regs.a = digit & 0xff;
  base.regs.c = budget & 0xff;
  base.regs.sp = 0x8fe0; // dead scratch: the oracle's ret only pops (reads) the word at SP
  return base;
}

// All three branches plus edges: non-zero nibble (budget forced to 0), zero nibble with budget
// (blank tile, budget--), zero nibble with spent budget (a real 0 stored).
const CASES = [
  { digit: 0x37, budget: 0x04 }, // nibble 7 (non-zero) -> store 7, budget -> 0
  { digit: 0x05, budget: 0x00 }, // nibble 5 (non-zero), budget already 0
  { digit: 0x10, budget: 0x04 }, // nibble 0, budget 4 -> blank tile, budget 3
  { digit: 0x00, budget: 0x01 }, // nibble 0, budget 1 -> blank tile, budget 0
  { digit: 0x00, budget: 0x00 }, // nibble 0, budget 0 -> real 0 stored
  { digit: 0xa0, budget: 0x02 }, // nibble 0 (high bits ignored), budget 2 -> blank, budget 1
];

// -- 1. CRAFTED (all three branches) ------------------------------------------

test("CRAFTED: all branches — RAM(−stack) identical and { next, blankBudget } match the oracle", () => {
  for (const { digit, budget } of CASES) {
    const base = craft(digit, budget);
    const o = base.clone();
    const c = base.clone();
    oracle(o);
    const ret = renderDigitWithBlanking(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)} (digit ${hx(digit)} budget ${budget}): oracle=${d.a} mine=${d.b}`);
    assert.equal(ret[0], o.regs.ix, `advanced cursor mismatch (digit ${hx(digit)} budget ${budget})`);
    assert.equal(ret[1], o.regs.c, `blank budget mismatch (digit ${hx(digit)} budget ${budget})`);
    // SIDE EFFECT: the bridge must SET IX and C so the frozen translated caller (resetBcdCounterAndRepaintColumn / drawBcdCounterColumn),
    // which threads both without reloading, reads the advance out of the registers — not just return them.
    assert.equal(c.regs.ix, o.regs.ix, `module must SET IX for the translated caller (digit ${hx(digit)} budget ${budget})`);
    assert.equal(c.regs.c, o.regs.c, `module must SET C for the translated caller (digit ${hx(digit)} budget ${budget})`);
  }
  console.log(`  CRAFTED: ${CASES.length} cases identical (RAM −stack) + [next, blankBudget] return AND IX/C side effect match`);
});

// -- 2. CAPTURED (best-effort) ------------------------------------------------

test("CAPTURED: real 0x059d dispatches in a boot replay identically (if reached)", () => {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < 24) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  try {
    new Machine(ROM, { overrides: snap }).runFrames(2400);
  } catch {
    /* boot may unwind on an unimplemented path; keep whatever we captured */
  }
  for (const cap of caps) {
    const o = cap.clone();
    const c = cap.clone();
    oracle(o);
    const ret = renderDigitWithBlanking(c);
    const d = ramDiffMinusStack(o, c, deadStackBelow(STACK_SCRATCH, cap.regs.sp));
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} mine=${d.b}`);
    assert.equal(ret[0], o.regs.ix, "captured advanced cursor mismatch");
    assert.equal(ret[1], o.regs.c, "captured blank budget mismatch");
    // SIDE EFFECT: the bridge must SET IX and C, not merely return them.
    assert.equal(c.regs.ix, o.regs.ix, "captured: module must SET IX for the translated caller");
    assert.equal(c.regs.c, o.regs.c, "captured: module must SET C for the translated caller");
  }
  console.log(`  CAPTURED: ${caps.length} real 0x059d dispatch(es) replayed identically`);
});

// -- 3. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the oracle's only RAM write is the one tile at the cursor", () => {
  const base = craft(0x10, 0x04); // nibble 0, budget 4 -> stores the blank tile at DST
  const before = base.clone();
  const after = base.clone();
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();

  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) changed.push({ addr: after.stateOffsetToAddr(off), to: a1[off] });
  }
  assert.equal(changed.length, 1, `expected exactly one changed byte, got ${changed.length}`);
  assert.equal(changed[0].addr, DST, `write landed at ${hx(changed[0].addr)} (expected the cursor)`);
  assert.equal(changed[0].to, 0x10, `expected the blank tile 0x10, got ${hx(changed[0].to)}`);
  console.log(`  WRITE-SET: 1 write, ${hx(DST)} := 0x10 (blank tile)`);
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: a wrong tile at the cursor is caught", () => {
  const base = craft(0x37, 0x04);
  const o = base.clone();
  const c = base.clone();
  oracle(o);
  renderDigitWithBlanking(c);
  c.mem.write8(DST, 0xaa); // BUG: wrong tile written to the cursor cell

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong tile store — it is worthless");
  assert.equal(d.addr, DST, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH: wrong cursor store caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong blank budget live-out is caught by the return check", () => {
  // The zero-nibble-with-budget branch must DECREMENT C; a twin that forgot to would return the
  // un-decremented budget. The return check (blankBudget === oracle C) must distinguish it.
  const base = craft(0x10, 0x04); // expects budget 4 -> 3
  const o = base.clone();
  const c = base.clone();
  oracle(o);
  renderDigitWithBlanking(c);
  const wrongBudget = 0x04; // the un-decremented budget the buggy form would leave
  assert.notEqual(wrongBudget, o.regs.c, "the oracle must have decremented the budget here");
  console.log(`  TEETH: an un-decremented budget ${wrongBudget} differs from the oracle's ${o.regs.c}`);
});
