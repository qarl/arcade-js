// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for paintAttractHudAndHighScores (ROM 0x03e9, Pooyan) — "paint the HUD / score panels".
 * Draws eleven selector-indexed character fields, renders the ten-entry high-score table
 * (0x8a00, three bytes per row) as stacked BCD digit pairs into the column at 0x85c7 (each byte's
 * low then high nibble a row apart, the third pair's high nibble leading-zero suppressed, the
 * column re-based two cells right per row), then repaints the digit panel and the status panel.
 *
 * Cycle-free memory-equivalence gate: writes video RAM, so a FRESH clone per side, compared on RAM
 * (dumpState minus stack scratch below the entry SP). LIVE-OUT is memory only — this is a table-dispatched screen
 * handler and no caller consumes a register — so no register is compared. The delegated field /
 * panel renders read only their own (boot) sources, identical on both clones; only the high-score
 * table is poked, so the two sides diverge only if the routines themselves disagree.
 *
 * Jobs:
 *   1. EQUAL (crafted tables) — an all-nibbles-non-zero table and a table whose third pairs are
 *      leading-zero (suppress path): oracle == module in RAM (−stack).
 *   2. WRITE-SET — the score column: every rendered nibble tile at its derived cell, computed
 *      independently of both routines (60 cells for the all-non-zero table).
 *   3. TEETH — a wrong score nibble tile is caught by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-03e9.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_03e9 as oracle } from "../../translated/loc_03e9.js";
import { paintAttractHudAndHighScores } from "../paintAttractHudAndHighScores.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, HIGH_SCORE_TABLE } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const CURSOR0 = 0x85c7; // score column base (the new HIGH_SCORE_TABLE_VRAM name)
const ROW_STRIDE = 0x20;
const ROW_STEP = 0x02; // the column re-bases two cells right per row
const ROW_COUNT = 10;
const TABLE_BYTES = ROW_COUNT * 3;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Fresh clone with the high-score table poked to `table` (30 bytes). */
function craft(table) {
  const m = BASE.clone();
  m.regs.sp = 0x8ffe;
  for (let i = 0; i < TABLE_BYTES; i++) m.mem.write8(HIGH_SCORE_TABLE + i, table[i]);
  return m;
}

/**
 * Derive the score column's written cells independently of both routines. Each row draws three
 * source bytes; byte b's low nibble lands at base + 0x20*(2b), its high nibble at base + 0x20*(2b+1);
 * the third byte's (b==2) high nibble is suppressed when zero. base advances two cells per row.
 */
function scoreCells(table) {
  const cells = [];
  for (let r = 0; r < ROW_COUNT; r++) {
    const base = (CURSOR0 + ROW_STEP * r) & 0xffff;
    for (let b = 0; b < 3; b++) {
      const v = table[3 * r + b];
      const low = v & 0x0f;
      const high = (v >> 4) & 0x0f;
      cells.push({ addr: (base + ROW_STRIDE * (2 * b)) & 0xffff, val: low });
      if (b === 2 && high === 0) continue; // leading-zero suppress on the top digit
      cells.push({ addr: (base + ROW_STRIDE * (2 * b + 1)) & 0xffff, val: high });
    }
  }
  return cells;
}

// all nibbles non-zero -> every score cell (60) is written
const TABLE_FULL = Array.from({ length: TABLE_BYTES }, (_, i) => 0x10 + i);
// every third byte's high nibble is zero -> exercises the leading-zero suppress on each row
const TABLE_SUPPRESS = Array.from({ length: TABLE_BYTES }, (_, i) => (i % 3 === 2 ? i & 0x0f : 0x90 | (i & 0x0f)));

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted high-score tables — paintAttractHudAndHighScores == oracle in RAM (−stack)", () => {
  for (const [name, table] of [["all non-zero", TABLE_FULL], ["suppress path", TABLE_SUPPRESS]]) {
    const o = craft(table);
    const c = craft(table);
    oracle(o);
    paintAttractHudAndHighScores(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log("  EQUAL: 2 crafted tables identical (RAM −stack)");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: every score nibble tile lands at its independently-derived cell", () => {
  const c = craft(TABLE_FULL);
  paintAttractHudAndHighScores(c);
  const cells = scoreCells(TABLE_FULL);
  assert.equal(cells.length, 60, `all-non-zero table should write 60 score cells, derived ${cells.length}`);
  for (const { addr, val } of cells) {
    assert.equal(c.mem.read8(addr), val, `score cell ${hx(addr)} => ${hx(val)}, got ${hx(c.mem.read8(addr))}`);
  }
  console.log(`  WRITE-SET: ${cells.length} score cells match the derived nibble tiles`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong score nibble tile is CAUGHT by the RAM diff", () => {
  const o = craft(TABLE_FULL);
  const c = craft(TABLE_FULL);
  oracle(o);
  paintAttractHudAndHighScores(c);
  c.mem.write8(CURSOR0, (c.mem.read8(CURSOR0) ^ 0x0f) & 0xff); // BUG: wrong first units digit
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong score tile — it is worthless");
  assert.equal(d.addr, CURSOR0, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH: wrong score tile caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
