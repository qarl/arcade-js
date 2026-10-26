// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for renderPanelFromTable (ROM 0x0460) — "paint the status panel from
 * its tile-code table": walks ten rows of three cells from PANEL_TILE_SOURCE, painting each
 * source byte into PANEL_VRAM_DEST when non-zero, else the blank tile 0x40. Within a row the
 * first two cells climb one row (stride -0x20); the third re-bases forward (+0x42).
 *
 * CYCLE-FREE / memory-equivalence gate. The routine takes no register inputs and its only output
 * is memory (the painted panel), so each case runs on a FRESH clone per side and the contract is:
 *
 *     RAM (dumpState, minus stack scratch below the entry SP).
 *
 * Jobs:
 *   1. CAPTURE (best-effort) — hook 0x0460 in a real run; any dispatch must agree in RAM.
 *   2. CRAFTED — seed the source table (mixed / all-zero / all-nonzero) and pre-dirty the panel
 *      VRAM to 0xAA; both sides paint the same cells (blank-tile path for the zeros) and leave
 *      the untouched VRAM as dirt.
 *   3. TEETH — a twin that paints a WRONG tile MUST be caught in VRAM.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-0460.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0460 as oracle } from "../../translated/loc_0460.js";
import { renderPanelFromTable } from "../renderPanelFromTable.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, PANEL_TILE_SOURCE, PANEL_VRAM_DEST } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built" }, fn);

const TARGET = 0x0460;
const VIDEO_RAM_LO = 0x8400;
const VIDEO_RAM_HI = 0x8800;
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const inDeadStack = deadStackBelow(STACK_SCRATCH, 0); // crafted entries keep the reset SP 0, so no scratch cell lies below it

function ramDiffMinusStack(ma, mb, dead = inDeadStack) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), dead);
}

/** Build a machine with the 30-byte source seeded by `fill(i)` and all video RAM pre-dirtied. */
function craft(fill) {
  const m = new Machine(ROM);
  for (let i = 0; i < 30; i++) m.mem.write8((PANEL_TILE_SOURCE + i) & 0xffff, fill(i) & 0xff);
  for (let a = VIDEO_RAM_LO; a < VIDEO_RAM_HI; a++) m.mem.write8(a, 0xaa);
  return m;
}

const FILLS = {
  mixed: (i) => (i % 3 === 1 ? 0 : (0x30 + i)),   // every middle cell blank; others distinct codes
  allZero: () => 0,                                // every cell blank
  allSet: (i) => (0x11 + i),                       // every cell a distinct non-zero code
};

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

const CAPS = ROM_PRESENT ? captureDispatches(32, 4000) : [];

test("CAPTURE: real 0x0460 dispatches — renderPanelFromTable == oracle in RAM (−stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone();
    const c = cap.clone();
    oracle(o);
    renderPanelFromTable(c);
    const d = ramDiffMinusStack(o, c, deadStackBelow(STACK_SCRATCH, cap.regs.sp));
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  CAPTURE: ${CAPS.length} real dispatch(es) checked`);
});

// -- 2. CRAFTED (load-bearing) ------------------------------------------------

test("CRAFTED: mixed / all-zero / all-nonzero source — panel identical, dirt kept", () => {
  for (const [name, fill] of Object.entries(FILLS)) {
    const o = craft(fill);
    const c = craft(fill);
    oracle(o);
    renderPanelFromTable(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    // The first cell is painted at the panel base (source[0]); confirm the blank-vs-code choice.
    const expect0 = fill(0) !== 0 ? fill(0) & 0xff : 0x40;
    assert.equal(c.mem.read8(PANEL_VRAM_DEST), expect0, `${name}: base cell paint`);
  }
  console.log(`  CRAFTED: ${Object.keys(FILLS).length} source fills painted identically`);
});

// -- 3. TEETH -----------------------------------------------------------------

/** Broken twin: corrupts the first painted panel cell. */
function brokenRender(m) {
  renderPanelFromTable(m);
  m.mem.write8(PANEL_VRAM_DEST, (m.mem.read8(PANEL_VRAM_DEST) ^ 0x01) & 0xff); // BUG: wrong base tile
}

test("TEETH: a wrong painted tile is CAUGHT in VRAM", () => {
  const o = craft(FILLS.allSet);
  const c = craft(FILLS.allSet);
  oracle(o);
  brokenRender(c);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong painted tile — it is worthless");
  assert.equal(d.addr, PANEL_VRAM_DEST & 0xffff, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH: wrong tile caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
