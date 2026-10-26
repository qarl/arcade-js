// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for drawBcdCounterColumn (Pooyan) — "draw one packed-BCD counter down a column":
 * the selector (0/1/2) picks a counter's three source bytes and its screen column; each byte's high
 * then low digit is painted one cell apart up the column with leading zeros suppressed by a budget.
 *
 * CYCLE-FREE / memory-equivalence gate (docs/decompiler-pipeline). The routine WRITES video RAM, so
 * each case runs the oracle on one FRESH clone and drawBcdCounterColumn on another, compared on:
 *
 *     RAM (dumpState, minus stack scratch below the entry SP).
 *
 * pc/SP are NOT compared. No register live-out is declared: the sole caller that keeps running
 * reloads its own pointer afterwards (its stack pop is a saved-value restore, not a result of this
 * routine), so the contract is memory-only. The cursor and blank budget the per-digit callee leaves
 * in registers coincide with the oracle's but are not consumed, so they are not part of the contract.
 *
 * The leaf runs during live HUD draws; every case is CRAFTED — the selector and the three counter
 * source bytes are poked identically on both sides.
 *
 * Jobs:
 *   1. EQUAL (crafted) — over selectors 0/1/2 (and 3, which selects the same arm as 2) oracle ==
 *      drawBcdCounterColumn in RAM(−stack).
 *   2. CAPTURED (best-effort) — replay any real dispatch a short boot happens to reach.
 *   3. WRITE-SET — for an all-nonzero counter the oracle writes exactly the six column cells.
 *   4. TEETH — a twin that writes a WRONG tile at a column cell MUST be caught by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-056b.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_056b as oracle } from "../../translated/loc_056b.js";
import { drawBcdCounterColumn } from "../drawBcdCounterColumn.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const TARGET = 0x056b;
const ROW_UP = 0xffe0; // -0x20, one tilemap row up (the column step)
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);

function ramDiffMinusStack(ma, mb, dead = inDeadStack) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), dead);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

// The (source MSB, dest column) pair per selector, and the destination cells the six digits paint.
const DEST = { 0: 0x8781, 1: 0x8521, 2: 0x8641, 3: 0x8641 };
function columnCells(dest) {
  const out = [];
  let c = dest & 0xffff;
  for (let i = 0; i < 6; i++) {
    out.push(c);
    c = (c + ROW_UP) & 0xffff;
  }
  return out;
}

/** A fresh clone with the selector seated and all three counters poked to known BCD. */
function craft(selector) {
  const m = BASE.clone();
  m.regs.a = selector & 0xff;
  m.regs.sp = 0x8ffe; // in STACK_SCRATCH; per-digit calls push/pop dead RAM
  // player-1 counter 0x88a2..0x88a4, player-2 0x88a5..0x88a7, top 0x88a8..0x88aa
  m.mem.write8(0x88a2, 0x00); m.mem.write8(0x88a3, 0x12); m.mem.write8(0x88a4, 0x34);
  m.mem.write8(0x88a5, 0x00); m.mem.write8(0x88a6, 0x56); m.mem.write8(0x88a7, 0x78);
  m.mem.write8(0x88a8, 0x11); m.mem.write8(0x88a9, 0x11); m.mem.write8(0x88aa, 0x11);
  return m;
}

// -- 1. EQUAL (crafted) -------------------------------------------------------

test("EQUAL: crafted selectors — drawBcdCounterColumn == oracle in RAM(−stack)", () => {
  for (const selector of [0, 1, 2, 3]) {
    const o = craft(selector);
    const c = craft(selector);
    oracle(o);
    drawBcdCounterColumn(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)} (selector ${selector}): oracle=${d.a} mine=${d.b}`);
  }
  console.log("  EQUAL: selectors 0/1/2/3 identical (RAM −stack)");
});

// -- 2. CAPTURED (best-effort) ------------------------------------------------

test("CAPTURED: real dispatches replay identically (if reached)", () => {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < 16) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  try {
    new Machine(ROM, { overrides: snap }).runFrames(1500);
  } catch {
    /* boot may unwind on an unimplemented path; keep whatever we captured */
  }
  for (const cap of caps) {
    const o = cap.clone();
    const c = cap.clone();
    oracle(o);
    drawBcdCounterColumn(c);
    const d = ramDiffMinusStack(o, c, deadStackBelow(STACK_SCRATCH, cap.regs.sp));
    assert.equal(d, null, d && `captured RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} mine=${d.b}`);
  }
  console.log(`  CAPTURED: ${caps.length} real dispatch(es) replayed identically`);
});

// -- 3. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: an all-nonzero counter writes exactly its six column cells", () => {
  const selector = 2; // the top counter, poked to 0x11/0x11/0x11 -> all six nibbles nonzero
  const cs = columnCells(DEST[selector]);

  const before = craft(selector);
  const after = craft(selector);
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();

  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) {
      const addr = after.stateOffsetToAddr(off);
      if (!inDeadStack(addr)) changed.push(addr);
    }
  }
  const addrs = new Set(changed);
  assert.equal(changed.length, cs.length, `expected ${cs.length} column writes, got ${changed.length}`);
  for (const cell of cs) assert.ok(addrs.has(cell), `expected a write at ${hx(cell)}`);
  for (const cell of cs) assert.equal(after.mem.read8(cell), 0x01, `cell ${hx(cell)} must be digit 1`);
  console.log(`  WRITE-SET: 6 column cells ${hx(cs[0])}..${hx(cs[5])} written`);
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: a wrong tile at a column cell is CAUGHT by the RAM diff", () => {
  const selector = 2;
  const cs = columnCells(DEST[selector]);
  const victim = cs[3];

  const o = craft(selector);
  const c = craft(selector);
  oracle(o);
  drawBcdCounterColumn(c);
  c.mem.write8(victim, 0xaa); // BUG: wrong tile in the middle of the column

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong column tile — it is worthless");
  assert.equal(d.addr, victim, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(victim)})`);
  console.log(`  TEETH: wrong column tile caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
