// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for renderPanelBcdDigitRows (ROM 0x0439, Pooyan) — "render ten rows of packed-BCD panel
 * digits into video RAM". Each row draws two source bytes as digit pairs: byte1's low then high
 * nibble a tilemap row apart, a fixed separator tile 0x51 a row on, then byte2's low nibble and —
 * unless byte2's high nibble is zero (leading-zero suppressed) — its high nibble. The source pointer
 * skips one byte per row (reads bytes 1 and 2 of every three); the destination re-bases two cells
 * right each row. The per-nibble split is delegated to splitBcdByte (ROM 0x0429).
 *
 * CYCLE-FREE / memory-equivalence gate. The routine WRITES RAM, so each case runs on a FRESH clone
 * per side. The routine takes NO input registers (it loads its own source/destination pointers and
 * row count), and no register survives (the caller renders the next panel with fresh pointers), so
 * the contract is RAM (dumpState, minus stack scratch below the entry SP) alone. pc/SP/registers are NOT compared.
 *
 * Jobs:
 *   1. EQUAL — over several seeded source tables (incl. one exercising leading-zero suppression),
 *      oracle == module in RAM.
 *   2. WRITE-SET — with an all-0x99 table (every high nibble non-zero, no suppression), the oracle
 *      writes EXACTLY five cells per row (low1, high1, separator, low2, high2) = 50 cells.
 *   3. CRAFTED — an all-0x05 table (every byte2 high nibble zero) so every high2 is suppressed: the
 *      oracle leaves those cells untouched, and the module matches.
 *   4. TEETH — a twin that writes a WRONG separator tile MUST be caught; a twin that ignores the
 *      leading-zero suppression (always writes high2) MUST be caught at the suppressed cells.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-0439.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0439 as oracle } from "../../translated/loc_0439.js";
import { renderPanelBcdDigitRows } from "../renderPanelBcdDigitRows.js";
import { splitBcdByte } from "../splitBcdByte.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, PANEL_DIGIT_SOURCE_TABLE, PANEL_DIGIT_VRAM_DEST } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built" }, fn);

const ROW_STRIDE = 0x20;
const SEPARATOR_TILE = 0x51;
const ROW_COUNT = 0x0a;
const TABLE_LEN = ROW_COUNT * 3; // ten 3-byte groups (byte 0 of each is skipped)
const PANEL_PAGE = PANEL_DIGIT_VRAM_DEST & 0xff00;
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8fe0);

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** A machine with the source table seeded by fn(k) and the panel page pre-dirtied to 0xAA. */
function craft(fn) {
  const m = new Machine(ROM);
  for (let k = 0; k < TABLE_LEN; k++) m.mem.write8((PANEL_DIGIT_SOURCE_TABLE + k) & 0xffff, fn(k) & 0xff);
  for (let i = 0; i < 0x100; i++) m.mem.write8((PANEL_PAGE + i) & 0xffff, 0xaa);
  m.regs.sp = 0x8fe0; // dead stack: the oracle's two 0x0429 calls push/pop here
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

const SEEDS = {
  varied: (k) => (0x13 + k * 7) & 0xff, // mixed nibbles, some high nibbles zero -> exercises suppress
  allNines: () => 0x99,
  allFives: () => 0x05, // byte2 high nibble always 0 -> every high2 suppressed
  ascending: (k) => (k * 0x11) & 0xff,
};

test("EQUAL: seeded source tables — module == oracle in RAM (−stack)", () => {
  for (const [name, fn] of Object.entries(SEEDS)) {
    const o = craft(fn);
    const c = craft(fn);
    oracle(o);
    renderPanelBcdDigitRows(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `seed=${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${Object.keys(SEEDS).length} seeded tables identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: all-0x99 table writes exactly five cells per row (50)", () => {
  const before = craft(SEEDS.allNines);
  const after = craft(SEEDS.allNines);
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();

  const changed = new Map();
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] === a1[off]) continue;
    const addr = after.stateOffsetToAddr(off);
    if (inDeadStack(addr)) continue; // the oracle's two 0x0429 calls push/pop into the dead stack; not game state
    changed.set(addr, a1[off]);
  }
  // Rebuild the expected footprint from the routine's geometry.
  let dst = PANEL_DIGIT_VRAM_DEST;
  let expected = 0;
  for (let row = 0; row < ROW_COUNT; row++) {
    const low1 = dst;
    const high1 = (dst + ROW_STRIDE) & 0xffff;
    const sep = (dst + 2 * ROW_STRIDE) & 0xffff;
    const low2 = (dst + 3 * ROW_STRIDE) & 0xffff;
    const high2 = (dst + 4 * ROW_STRIDE) & 0xffff;
    for (const [cell, val] of [[low1, 0x09], [high1, 0x09], [sep, SEPARATOR_TILE], [low2, 0x09], [high2, 0x09]]) {
      assert.ok(changed.has(cell), `row ${row}: expected a write at ${hx(cell)}`);
      assert.equal(changed.get(cell), val, `row ${row}: cell ${hx(cell)} expected ${hx(val)} got ${hx(changed.get(cell))}`);
      expected++;
    }
    dst = (dst + 2) & 0xffff;
  }
  assert.equal(changed.size, expected, `expected exactly ${expected} writes, got ${changed.size}`);
  console.log(`  WRITE-SET: ${expected} cells (5 per row incl. separator 0x51)`);
});

// -- 3. CRAFTED ---------------------------------------------------------------

test("CRAFTED: leading-zero suppression leaves the high2 cells untouched", () => {
  const o = craft(SEEDS.allFives);
  const c = craft(SEEDS.allFives);
  oracle(o);
  renderPanelBcdDigitRows(c);
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  // Sanity: the first row's high2 cell stayed at its 0xAA pre-dirty (suppressed, not written to 0).
  const firstHigh2 = (PANEL_DIGIT_VRAM_DEST + 4 * ROW_STRIDE) & 0xffff;
  assert.equal(c.mem.read8(firstHigh2), 0xaa, "suppressed high2 cell must be left untouched");
  console.log(`  CRAFTED: every high2 suppressed; ${hx(firstHigh2)} left at 0xAA`);
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: a wrong separator tile is CAUGHT in the panel", () => {
  const o = craft(SEEDS.allNines);
  const c = craft(SEEDS.allNines);
  oracle(o);
  renderPanelBcdDigitRows(c);
  const sep0 = (PANEL_DIGIT_VRAM_DEST + 2 * ROW_STRIDE) & 0xffff;
  c.mem.write8(sep0, 0x00); // BUG: the separator must be 0x51, not 0x00
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong separator tile — it is worthless");
  assert.equal(d.addr, sep0, `teeth caught wrong address ${hx(d.addr ?? 0)} (expected ${hx(sep0)})`);
  console.log(`  TEETH(separator): wrong tile caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

/** Broken twin: identical to renderPanelBcdDigitRows but never suppresses the leading-zero high2 nibble. */
function brokenNoSuppress(m) {
  const { mem8 } = m;
  let src = PANEL_DIGIT_SOURCE_TABLE;
  let dst = PANEL_DIGIT_VRAM_DEST;
  for (let row = 0; row < ROW_COUNT; row++) {
    src = (src + 1) & 0xffff;
    const [high1, afterLow1] = splitBcdByte(m, src, dst, ROW_STRIDE);
    mem8[afterLow1] = high1;
    let cell = (afterLow1 + ROW_STRIDE) & 0xffff;
    mem8[cell] = SEPARATOR_TILE;
    cell = (cell + ROW_STRIDE) & 0xffff;
    src = (src + 1) & 0xffff;
    const [high2, afterLow2] = splitBcdByte(m, src, cell, ROW_STRIDE);
    mem8[afterLow2] = high2; // BUG: always writes, ignoring the leading-zero suppression
    src = (src + 1) & 0xffff;
    dst = (afterLow2 + 0xff82) & 0xffff;
  }
}

test("TEETH: ignoring leading-zero suppression is CAUGHT at a suppressed cell", () => {
  const o = craft(SEEDS.allFives); // every high2 == 0 -> oracle suppresses all
  const c = craft(SEEDS.allFives);
  oracle(o);
  brokenNoSuppress(c); // writes 0x00 where the oracle wrote nothing
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch an unsuppressed high nibble — it is worthless");
  const firstHigh2 = (PANEL_DIGIT_VRAM_DEST + 4 * ROW_STRIDE) & 0xffff;
  assert.equal(d.addr, firstHigh2, `teeth caught wrong address ${hx(d.addr ?? 0)} (expected ${hx(firstHigh2)})`);
  console.log(`  TEETH(suppress): unsuppressed write caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
