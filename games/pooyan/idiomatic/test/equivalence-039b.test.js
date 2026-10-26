// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for paintActorCountColumn (ROM 0x039b) — "paint the count column": when the
 * game-active gate is set, fill N cells of a vertical VRAM column with tile 0x0c (N =
 * (actor-table count + 1) clamped to 8, one row 0x20 apart) then blank the remaining 8-N
 * cells with tile 0x10.
 *
 * This is the CYCLE-FREE / memory-equivalence gate (docs/decompiler-pipeline). The routine
 * WRITES video RAM, so each case uses a FRESH clone per side: the oracle runs on one clone,
 * paintActorCountColumn on another, and they are compared on the go-forward contract — RAM (dumpState)
 * minus stack scratch below the entry SP. pc/SP/cycles are deliberately NOT compared. paintActorCountColumn has NO register
 * live-out (a memory-only paint routine reached off-attract via dynamic dispatch), so only
 * RAM is compared.
 *
 * The leaf is not reached in a plain boot/attract, so every case is CRAFTED: identical
 * (GAME_ACTIVE_FLAG, ACTOR_TABLE) pokes on both sides — the routine's only inputs. The
 * degenerate djnz-underflow arm (actor 0xff -> fill height 0 -> a 256-cell wrap into IO /
 * unmapped space) is modelled by the module's do/while but is NOT swept: both sides would
 * behave identically, yet the 256-cell wrap stores past RAM. Swept fill heights stay 1..8,
 * whose eight cells all land in video RAM (0x8482..0x8562).
 *
 * Jobs:
 *   1. EQUAL (crafted sweep) — over curated (active, actor) pairs paintActorCountColumn == oracle in
 *      RAM (-stack), including the gate-clear no-op.
 *   2. WRITE-SET — the oracle's only writes are the eight column cells: the top N := 0x0c,
 *      the rest := 0x10.
 *   3. CRAFTED (overwrite) — pre-dirty the column to 0xAA on both sides; both overwrite it.
 *   4. TEETH — a wrong last-cell byte, and a twin that fills with the blank tile, are both
 *      CAUGHT by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-039b.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_039b as oracle } from "../../translated/loc_039b.js";
import { paintActorCountColumn } from "../paintActorCountColumn.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const GAME_ACTIVE_FLAG = 0x8806;
const ACTOR_TABLE = 0x8a80;
const COLUMN_BASE = 0x8482;
const ROW_STRIDE = 0x20;
const TILE_FILL = 0x0c;
const TILE_BLANK = 0x10;
const COLUMN_HEIGHT = 8;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);

function ramDiffMinusStack(ma, mb) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function craft(active, actor) {
  const m = BASE.clone();
  m.mem.write8(GAME_ACTIVE_FLAG, active & 0xff);
  m.mem.write8(ACTOR_TABLE, actor & 0xff);
  m.regs.sp = 0x8ffe; // in work RAM; the oracle's ret only POPs (reads)
  return m;
}

/** The eight column cells, top to bottom. */
function columnCells() {
  const cs = [];
  let c = COLUMN_BASE;
  for (let i = 0; i < COLUMN_HEIGHT; i++) { cs.push(c & 0xffff); c = (c + ROW_STRIDE) & 0xffff; }
  return cs;
}

/** Fill height for a swept actor value (all cases keep it in 1..8). */
function fillHeight(actor) {
  let f = (actor + 1) & 0xff;
  if (f >= COLUMN_HEIGHT) f = COLUMN_HEIGHT;
  return f;
}

// active=1 exercises fill heights 1..8; active=0 is the gate-clear no-op.
const CASES = [
  { active: 0, actor: 0x03 }, // gate clear -> nothing painted
  { active: 1, actor: 0x00 }, // fill 1, blank 7
  { active: 1, actor: 0x01 }, // fill 2, blank 6
  { active: 1, actor: 0x03 }, // fill 4, blank 4
  { active: 1, actor: 0x06 }, // fill 7, blank 1
  { active: 1, actor: 0x07 }, // fill 8, blank 0 (no blank loop)
  { active: 1, actor: 0x08 }, // clamp -> fill 8
  { active: 1, actor: 0x7f }, // clamp -> fill 8
];

// -- 1. EQUAL (crafted sweep) -------------------------------------------------

test("EQUAL: crafted (active,actor) — paintActorCountColumn == oracle in RAM (−stack)", () => {
  for (const { active, actor } of CASES) {
    const o = craft(active, actor);
    const c = craft(active, actor);
    oracle(o);
    paintActorCountColumn(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiomatic=${d.b} (active=${active} actor=${hx(actor)})`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted cases identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the oracle writes exactly the eight column cells (top N := 0x0c, rest := 0x10)", () => {
  const actor = 0x03; // fill 4, blank 4
  const n = fillHeight(actor);
  const cells = columnCells();

  const before = craft(1, actor);
  const after = craft(1, actor);
  for (const cell of cells) { before.mem.write8(cell, 0xaa); after.mem.write8(cell, 0xaa); }
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();

  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) changed.push({ addr: after.stateOffsetToAddr(off), to: a1[off] });
  }
  assert.equal(changed.length, COLUMN_HEIGHT, `expected exactly ${COLUMN_HEIGHT} written cells, got ${changed.length}`);
  const byAddr = new Map(changed.map((ch) => [ch.addr, ch.to]));
  cells.forEach((cell, i) => {
    assert.ok(byAddr.has(cell), `expected a write at ${hx(cell)}`);
    const want = i < n ? TILE_FILL : TILE_BLANK;
    assert.equal(byAddr.get(cell), want, `cell ${hx(cell)} (row ${i}) must be ${hx(want)}`);
  });
  console.log(`  WRITE-SET: ${COLUMN_HEIGHT} cells — top ${n} := 0x0c, rest := 0x10`);
});

// -- 3. CRAFTED (overwrite) ---------------------------------------------------

test("CRAFTED: a pre-dirtied column is overwritten identically", () => {
  const actor = 0x03;
  const cells = columnCells();
  const o = craft(1, actor);
  const c = craft(1, actor);
  for (const cell of cells) { o.mem.write8(cell, 0xaa); c.mem.write8(cell, 0xaa); }
  oracle(o);
  paintActorCountColumn(c);
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiomatic=${d.b}`);
  for (const cell of cells) {
    assert.notEqual(c.mem.read8(cell), 0xaa, `cell not overwritten (${hx(cell)})`);
  }
  console.log("  CRAFTED: column dirtied to 0xAA -> both overwrite it");
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: a wrong last-cell byte is CAUGHT by the RAM diff", () => {
  const actor = 0x03;
  const lastCell = columnCells()[COLUMN_HEIGHT - 1];
  const o = craft(1, actor);
  const c = craft(1, actor);
  oracle(o);
  paintActorCountColumn(c);
  c.mem.write8(lastCell, 0x00); // BUG: last blank cell must be 0x10, not 0x00
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong last-cell byte — it is worthless");
  assert.equal(d.addr, lastCell, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(lastCell)})`);
  console.log(`  TEETH/last: wrong last byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

/** Broken twin: fills the column with the blank tile instead of the fill tile. */
function brokenLoc039b(m) {
  const { mem } = m;
  if (mem.read8(GAME_ACTIVE_FLAG) === 0) return;
  let n = (mem.read8(ACTOR_TABLE) + 1) & 0xff;
  if (n >= COLUMN_HEIGHT) n = COLUMN_HEIGHT;
  let cell = COLUMN_BASE;
  for (let i = 0; i < COLUMN_HEIGHT; i++) {
    mem.write8(cell, i < n ? TILE_BLANK : TILE_BLANK); // BUG: fill rows should be 0x0c
    cell = (cell + ROW_STRIDE) & 0xffff;
  }
}

test("TEETH: a twin that fills with the blank tile is CAUGHT at the first cell", () => {
  const actor = 0x03;
  const first = columnCells()[0];
  const o = craft(1, actor);
  const c = craft(1, actor);
  oracle(o);
  brokenLoc039b(c);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong fill tile — it is worthless");
  assert.equal(d.addr, first, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(first)})`);
  console.log(`  TEETH/fill: wrong fill tile caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
