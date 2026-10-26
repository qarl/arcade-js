// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for renderPhaseGauge (ROM 0x03c2, Pooyan) — draw the phase counter
 * at GAUGE_PHASE_COUNTER as a five-cell vertical HUD gauge from PHASE_GAUGE_BASE_TILE upward
 * (stride -0x20): a zero count leaves the gauge untouched; otherwise min(count-1, 5) cells
 * get the filled tile 0xb0 and the rest get the blank tile 0x10. Every other RAM byte is
 * left as found.
 *
 * This is the CYCLE-FREE / memory-equivalence gate. The routine WRITES VRAM, so every case
 * runs the oracle on one FRESH clone and the module on another, compared on the go-forward
 * contract: RAM (dumpState, minus stack scratch below the entry SP). There is NO register live-out — every
 * caller discards it — so nothing else is compared.
 *
 * Jobs:
 *   1. CRAFTED (load-bearing) — pre-dirty the five gauge cells, sweep counts across the
 *      empty / partial / clamped paths, confirm both sides land identical RAM.
 *   2. CAPTURED (best-effort) — replay any real 0x03c2 dispatch from a boot window.
 *   3. WRITE-SET — a partial gauge writes only within the five gauge cells.
 *   4. TEETH — a twin that corrupts the base cell MUST be caught at PHASE_GAUGE_BASE_TILE.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-03c2.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_03c2 as oracle } from "../../translated/loc_03c2.js";
import { renderPhaseGauge } from "../renderPhaseGauge.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, GAUGE_PHASE_COUNTER, PHASE_GAUGE_BASE_TILE } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const TARGET = 0x03c2;
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8fe0);

// The five gauge cells, base then one tilemap row up each (stride -0x20).
const CELLS = [0, 1, 2, 3, 4].map((i) => (PHASE_GAUGE_BASE_TILE - i * 0x20) & 0xffff);
const WRITTEN = new Set(CELLS);
const DIRT = 0xee; // sentinel pre-loaded into every gauge cell (differs from 0xb0 / 0x10)

/** First RAM difference on the go-forward contract: dumpState minus the dead stack scratch below the entry SP. */
function ramDiffMinusStack(ma, mb, dead = inDeadStack) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), dead);
}

/** Fresh machine: count seeded, all five gauge cells pre-dirtied, SP parked in dead scratch. */
function craft(count) {
  const base = new Machine(ROM);
  base.mem.write8(GAUGE_PHASE_COUNTER, count & 0xff);
  for (const cell of CELLS) base.mem.write8(cell, DIRT);
  base.regs.sp = 0x8fe0; // inside STACK_SCRATCH
  return base;
}

// counts: empty (0), all-blank (1), partials (2/3/5), exactly full (6), and clamped (7/0xff).
const COUNTS = [0x00, 0x01, 0x02, 0x03, 0x05, 0x06, 0x07, 0xff];

// -- 1. CRAFTED (load-bearing) ------------------------------------------------

test("CRAFTED: swept counts — RAM(−stack) identical, five gauge cells match oracle", () => {
  for (const count of COUNTS) {
    const base = craft(count);
    const o = base.clone();
    const c = base.clone();
    oracle(o);
    renderPhaseGauge(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `count ${hx(count)}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} mine=${d.b}`);

    // Each gauge cell equals what the oracle left (derived from the ORACLE clone, never the module).
    for (const cell of CELLS) {
      assert.equal(c.mem.read8(cell), o.mem.read8(cell), `count ${hx(count)}: cell ${hx(cell)}`);
    }
  }
  console.log(`  CRAFTED: ${COUNTS.length} counts rendered identically`);
});

// -- 2. CAPTURED (best-effort) ------------------------------------------------

test("CAPTURED: real 0x03c2 dispatches replay identically (if reached in the boot window)", () => {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < 24) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  try {
    new Machine(ROM, { overrides: snap }).runFrames(4000);
  } catch {
    /* boot may unwind on an unimplemented path; keep whatever we captured */
  }
  for (const cap of caps) {
    const o = cap.clone();
    const c = cap.clone();
    oracle(o);
    renderPhaseGauge(c);
    const d = ramDiffMinusStack(o, c, deadStackBelow(STACK_SCRATCH, cap.regs.sp));
    assert.equal(d, null, d && `captured RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} mine=${d.b}`);
  }
  console.log(`  CAPTURED: ${caps.length} real 0x03c2 dispatch(es) replayed identically`);
});

// -- 3. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: a partial gauge writes only within the five gauge cells", () => {
  const base = craft(0x03); // 2 filled + 3 blank -> all five cells change from the dirt
  const before = base.clone();
  const after = base.clone();
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
  assert.equal(changed.length, 5, `expected five changed cells, got ${changed.length}`);
  for (const addr of changed) assert.ok(WRITTEN.has(addr), `oracle wrote unexpected addr ${hx(addr)}`);
  console.log(`  WRITE-SET: ${changed.length} writes, all within the five gauge cells`);
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: a wrong base cell is caught at PHASE_GAUGE_BASE_TILE", () => {
  const base = craft(0x03);
  const o = base.clone();
  const c = base.clone();
  oracle(o);
  renderPhaseGauge(c);
  c.mem.write8(CELLS[0], (c.mem.read8(CELLS[0]) ^ 0x01) & 0xff); // BUG: corrupt the base gauge cell

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong base cell — it is worthless");
  assert.equal(d.addr, CELLS[0], `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH: wrong base cell caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
