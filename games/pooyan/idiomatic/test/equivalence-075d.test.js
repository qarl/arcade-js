// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for fillAttributeColumns (ROM 0x075d) — the tile-attribute
 * column-fill: 31 columns (offsets 0x40..0x5e on the 0x8000 attribute page), each flooded
 * with one source byte (BC) down all 30 rows at the 0x20 row stride, BC advancing per column.
 *
 * CYCLE-FREE / memory-equivalence gate: the routine WRITES RAM, so every case uses a FRESH
 * clone per side. The contract is RAM (dumpState minus stack scratch below the entry SP) PLUS the A live-out: the
 * loop exits at (L & 0x1f) == 0x1f leaving A = 0x1f, and fillIntroRowsThenBuildBoardIntro stores that to ACTIVE_PLAYER
 * (0x880d), so a memory-only rewrite that drops A diverges on the credit screen.
 *
 * Jobs:
 *   1. CAPTURE (best-effort) — hook 0x075d in a real run; any dispatch must agree in RAM.
 *   2. CRAFTED — the load-bearing arm. Pre-dirtied fill region + distinct per-column source
 *      bytes; both sides flood the 31x30 grid identically.
 *   3. REGISTER — the A live-out (0x1f) must match the oracle (the arm a memory-only gate misses).
 *   4. TEETH — a twin that writes a WRONG attribute cell MUST be caught at the destination.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-075d.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_075d as oracle } from "../../translated/loc_075d.js";
import { fillAttributeColumns } from "../fillAttributeColumns.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, ATTRIB_MAP_BASE } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built" }, fn);

const TARGET = 0x075d;
const N_COLS = 31;
const N_ROWS = 30;
const ROW_STRIDE = 0x20;
const SRC = 0x8800; // 31 per-column source bytes in work RAM, disjoint from dest + STACK_SCRATCH
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const destCell = (col, row) => (ATTRIB_MAP_BASE + col + row * ROW_STRIDE) & 0xffff;
const inDeadStack = deadStackBelow(STACK_SCRATCH, STACK_SCRATCH.hi - 0x10);

/** First RAM difference on the go-forward contract: whole dump minus stack scratch below the entry SP. */
function ramDiffMinusStack(ma, mb, dead = inDeadStack) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), dead);
}

/** Fill region pre-dirtied to 0xAA, distinct per-column source bytes, BC=SRC. */
function craft(seed) {
  const m = new Machine(ROM);
  m.regs.sp = STACK_SCRATCH.hi - 0x10;
  for (let col = 0; col < N_COLS; col++)
    for (let row = 0; row < N_ROWS; row++) m.mem.write8(destCell(col, row), 0xaa);
  for (let i = 0; i < N_COLS; i++) m.mem.write8((SRC + i) & 0xffff, (seed + i) & 0xff);
  m.regs.bc = SRC;
  return m;
}

const SEEDS = [0xa0, 0x00, 0xff, 0x3c];

// -- 1. CAPTURE (best-effort) -------------------------------------------------

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(maxFrames);
  return caps;
}

const CAPS = ROM_PRESENT ? captureDispatches(16, 4000) : [];

test("CAPTURE: real 0x075d dispatches — module == oracle in RAM (−stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone();
    const c = cap.clone();
    oracle(o);
    fillAttributeColumns(c);
    const d = ramDiffMinusStack(o, c, deadStackBelow(STACK_SCRATCH, cap.regs.sp));
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  CAPTURE: ${CAPS.length} real dispatch(es) checked`);
});

// -- 2. CRAFTED (load-bearing) ------------------------------------------------

test("CRAFTED: pre-dirtied region + distinct source — 31x30 grid identical", () => {
  for (const seed of SEEDS) {
    const o = craft(seed);
    const c = craft(seed);
    oracle(o);
    fillAttributeColumns(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `seed ${hx(seed)}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);

    // Every column's source byte flooded down all 30 rows (spot-check corners + a mid column).
    for (const col of [0, 15, N_COLS - 1]) {
      const want = (seed + col) & 0xff;
      for (const row of [0, 1, N_ROWS - 1]) {
        assert.equal(c.mem.read8(destCell(col, row)), want, `seed ${hx(seed)}: col ${col} row ${row}`);
      }
    }
  }
  console.log(`  CRAFTED: ${SEEDS.length} source patterns flooded identically`);
});

// -- 3. REGISTER LIVE-OUT -----------------------------------------------------

test("REGISTER: A live-out == oracle (fillIntroRowsThenBuildBoardIntro stores it to ACTIVE_PLAYER 0x880d)", () => {
  for (const seed of SEEDS) {
    const o = craft(seed); o.regs.a = 0x99; // sentinel: neither side may leave A untouched
    const c = craft(seed); c.regs.a = 0x99;
    oracle(o);
    fillAttributeColumns(c);
    assert.equal(c.regs.a, o.regs.a,
      `seed ${hx(seed)}: A live-out differs — oracle=${hx(o.regs.a)} module=${hx(c.regs.a)}`);
    assert.notEqual(c.regs.a, 0x99, "module never set the A live-out (a memory-only rewrite)");
  }
  console.log("  REGISTER: A live-out (0x1f) matches the oracle across all seeds");
});

// -- 4. TEETH -----------------------------------------------------------------

/** Broken twin: corrupts one attribute cell — must be caught at that destination. */
function brokenFill(m) {
  fillAttributeColumns(m);
  const bad = destCell(15, 10);
  m.mem.write8(bad, (m.mem.read8(bad) ^ 0x01) & 0xff); // BUG: wrong attribute
}

test("TEETH: a wrong attribute cell is CAUGHT at the destination", () => {
  let caught = null;
  for (const seed of SEEDS) {
    const o = craft(seed);
    const c = craft(seed);
    oracle(o);
    brokenFill(c);
    const d = ramDiffMinusStack(o, c);
    if (d) { caught = d; break; }
  }
  assert.notEqual(caught, null, "the gate FAILED to catch a wrong attribute — it is worthless");
  assert.equal(caught.addr, destCell(15, 10), `teeth caught wrong address ${hx(caught.addr ?? 0)}`);
  console.log(`  TEETH: wrong attribute caught at ${hx(caught.addr)} (oracle=${caught.a} broken=${caught.b})`);
});
