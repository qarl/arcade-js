// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for insertScoreIntoHighScoreTable (Pooyan) — "insert a score into the sorted ten-entry
 * high-score table": scan MSB-first for the rank the just-finished player's score reaches or
 * beats, open a 3-byte slot by shifting the tail down one entry, write the score, and ride two
 * parallel side tables (a play-time pair + a gate marker, and a display-tile side table whose new
 * cells are cleared to the blank tile).
 *
 * CYCLE-FREE / memory-equivalence gate (docs/decompiler-pipeline). The routine WRITES RAM, so each
 * case runs the oracle on one FRESH clone and insertScoreIntoHighScoreTable on another, compared on:
 *
 *     RAM (dumpState, minus stack scratch below the entry SP).
 *
 * The live-out is MEMORY ONLY — the table, both side tables, the rank cell, the gate. pc/SP are not
 * compared. No register is a consumed result: the table-exhausted path leaves the scan pointer's
 * high byte untouched from entry (caller-dependent), so the register file is not a stable contract;
 * on the insert path the trailing fill helper does set HL/B, but no caller reads them.
 *
 * The routine is a game-over helper never reached in a plain boot, so every case CRAFTS the whole
 * state: a strictly-descending (by MSB) ten-entry table with distinct bytes, the active player's
 * score buffer, the play-timer banks, and ramp-seeded side-table regions, all poked identically on
 * both sides. The active-player select drives which score buffer, timer bank, and gate are used.
 *
 * Jobs:
 *   1. EQUAL (crafted) — inserts at the top, the middle, the bottom, a tie, an exhausted (beats
 *      none), and a player-2 insert all match in RAM(−stack).
 *   2. WRITE-SET — a top insert writes the rank cell (rank+1), the score into slot 0, the P1 gate
 *      marker, and touches only the declared table / side-table / rank / gate regions.
 *   3. CRAFTED — an exhausted score writes nothing; a player-2 insert uses the P2 gate, not P1.
 *   4. TEETH — a wrong inserted score byte AND a wrong rank cell MUST be caught by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-1ab2.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1ab2 as oracle } from "../../translated/loc_1ab2.js";
import { insertScoreIntoHighScoreTable } from "../insertScoreIntoHighScoreTable.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  ACTIVE_PLAYER,
  P1_SCORE_BCD,
  P2_SCORE_BCD,
  HIGH_SCORE_TABLE,
  HIGH_SCORE_INSERT_RANK,
  HIGH_SCORE_TIME_TABLE,
  PLAY_TIMER_BCD_P1,
  PLAY_TIMER_BCD_P2,
  PLAY_TIMER_GATE_P1,
  PLAY_TIMER_GATE_P2,
  PANEL_TILE_SOURCE,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const ENTRIES = 10;
const STRIDE = 3;
const TILE_BLANK = 0x10;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}
function changedMinusStack(m, before, after) {
  const out = new Map();
  for (let off = 0; off < before.length; off++) {
    if (before[off] !== after[off]) {
      const addr = m.stateOffsetToAddr(off);
      if (!inDeadStack(addr)) out.set(addr, after[off]);
    }
  }
  return out;
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

// entry i: strictly-descending MSB (byte+2) with distinct low/mid bytes, so rank is unambiguous
const entryHi = (i) => 0x50 - 5 * i; // 0x50,0x4b,...,0x23
const entryMid = (i) => 0x60 + i;
const entryLo = (i) => 0x10 + i;

/** A fresh clone with the full sorted table, the active score buffer, timer banks, and side-table
 *  ramps seated identically; `score` = [lo, mid, hi]. */
function craft(player, score) {
  const m = BASE.clone();
  m.mem.write8(ACTIVE_PLAYER, player);

  for (let i = 0; i < ENTRIES; i++) {
    m.mem.write8(HIGH_SCORE_TABLE + STRIDE * i + 0, entryLo(i));
    m.mem.write8(HIGH_SCORE_TABLE + STRIDE * i + 1, entryMid(i));
    m.mem.write8(HIGH_SCORE_TABLE + STRIDE * i + 2, entryHi(i));
  }

  const buf = player !== 0 ? P2_SCORE_BCD : P1_SCORE_BCD;
  m.mem.write8(buf + 0, score[0]);
  m.mem.write8(buf + 1, score[1]);
  m.mem.write8(buf + 2, score[2]);

  // timer banks: distinct bytes so the side-table copy is observable
  for (let k = 0; k < 3; k++) {
    m.mem.write8(PLAY_TIMER_BCD_P1 + k, 0x30 + k);
    m.mem.write8(PLAY_TIMER_BCD_P2 + k, 0x33 + k);
  }

  // gate cells start clear (positive control for the marker write)
  m.mem.write8(PLAY_TIMER_GATE_P1, 0x00);
  m.mem.write8(PLAY_TIMER_GATE_P2, 0x00);
  m.mem.write8(HIGH_SCORE_INSERT_RANK, 0x00);

  // ramp-seed both side-table regions so the shifts move visible data
  for (let j = 0; j <= 48; j++) {
    m.mem.write8(HIGH_SCORE_TIME_TABLE - j, 0x80 + (j & 0x3f));
    m.mem.write8(PANEL_TILE_SOURCE + 0x1f - j, 0xc0 + (j & 0x3f));
  }

  m.regs.sp = 0x8ffe; // in STACK_SCRATCH; the oracle's push/pop/ret only touch dead RAM
  return m;
}

const CASES = [
  { name: "insert top (rank 0)", player: 0, score: [0x01, 0x02, 0x55], rank: 0 },
  { name: "insert middle (rank 4)", player: 0, score: [0x01, 0x02, 0x3e], rank: 4 },
  { name: "insert bottom (rank 9)", player: 0, score: [0x01, 0x02, 0x25], rank: 9 },
  { name: "tie with an entry (rank 3)", player: 0, score: [entryLo(3), entryMid(3), entryHi(3)], rank: 3 },
  { name: "exhausted (beats none)", player: 0, score: [0x01, 0x02, 0x20], rank: ENTRIES },
  { name: "player 2 insert top", player: 1, score: [0x07, 0x08, 0x55], rank: 0 },
];

// declared write footprint: table, rank cell, gates, both side tables
function inFootprint(addr) {
  if (addr >= HIGH_SCORE_TABLE && addr <= HIGH_SCORE_TABLE + 0x20) return true;
  if (addr === HIGH_SCORE_INSERT_RANK) return true;
  if (addr === PLAY_TIMER_GATE_P1 || addr === PLAY_TIMER_GATE_P2) return true;
  if (addr >= HIGH_SCORE_TIME_TABLE - (STRIDE * ENTRIES + 1) && addr <= HIGH_SCORE_TIME_TABLE) return true;
  if (addr >= PANEL_TILE_SOURCE && addr <= PANEL_TILE_SOURCE + 0x1f) return true;
  return false;
}

// -- 1. EQUAL (crafted) -------------------------------------------------------

test("EQUAL: crafted inserts — insertScoreIntoHighScoreTable == oracle in RAM(−stack)", () => {
  for (const c of CASES) {
    const o = craft(c.player, c.score);
    const k = craft(c.player, c.score);
    oracle(o);
    insertScoreIntoHighScoreTable(k);
    const d = ramDiffMinusStack(o, k);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} mine=${d.b} (${c.name})`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted cases identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: a top insert writes the rank cell, slot-0 score, the P1 gate; footprint contained", () => {
  const c = CASES[0];
  const o = craft(c.player, c.score);
  const before = o.dumpState();
  oracle(o);
  const changed = changedMinusStack(o, before, o.dumpState());

  assert.equal(changed.get(HIGH_SCORE_INSERT_RANK), c.rank + 1, "rank cell := rank+1");
  assert.equal(o.mem.read8(HIGH_SCORE_TABLE + 0), c.score[0], "slot0 low := new score low");
  assert.equal(o.mem.read8(HIGH_SCORE_TABLE + 1), c.score[1], "slot0 mid := new score mid");
  assert.equal(o.mem.read8(HIGH_SCORE_TABLE + 2), c.score[2], "slot0 hi := new score hi");
  assert.equal(changed.get(PLAY_TIMER_GATE_P1), 0x01, "P1 gate marker set");
  for (const addr of changed.keys()) {
    assert.ok(inFootprint(addr), `write outside the declared footprint at ${hx(addr)}`);
  }
  // the fill helper cleared the new display-tile cells to the blank tile
  assert.equal(o.mem.read8(PANEL_TILE_SOURCE + 0x1e - STRIDE * ENTRIES), TILE_BLANK, "first blanked cell");
  console.log(`  WRITE-SET: rank:=1, slot0:=score, P1 gate:=1, footprint contained (${changed.size} writes)`);
});

// -- 3. CRAFTED (exhausted / player 2) ----------------------------------------

test("CRAFTED: an exhausted score writes nothing", () => {
  const c = CASES[4];
  const o = craft(c.player, c.score);
  const before = o.dumpState();
  oracle(o);
  const changed = changedMinusStack(o, before, o.dumpState());
  assert.equal(changed.size, 0, `beats-none must not write RAM, wrote ${changed.size} cells`);
  console.log("  CRAFTED: exhausted score -> table unchanged");
});

test("CRAFTED: a player-2 insert uses the P2 gate, not P1", () => {
  const c = CASES[5];
  const o = craft(c.player, c.score);
  oracle(o);
  assert.equal(o.mem.read8(PLAY_TIMER_GATE_P2), 0x01, "P2 gate marker set");
  assert.equal(o.mem.read8(PLAY_TIMER_GATE_P1), 0x00, "P1 gate left clear");
  assert.equal(o.mem.read8(HIGH_SCORE_TABLE + 2), c.score[2], "player-2 score inserted at the top");
  console.log("  CRAFTED: player-2 insert -> P2 gate set, P1 untouched");
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: a wrong inserted score byte is CAUGHT by the RAM diff", () => {
  const c = CASES[0];
  const o = craft(c.player, c.score);
  const k = craft(c.player, c.score);
  oracle(o);
  insertScoreIntoHighScoreTable(k);
  const slotHi = HIGH_SCORE_TABLE + 2;
  k.mem.write8(slotHi, (c.score[2] ^ 0xff) & 0xff); // BUG: wrong inserted score hi byte

  const d = ramDiffMinusStack(o, k);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong inserted byte — it is worthless");
  assert.equal(d.addr, slotHi, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/score: wrong byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong rank cell is CAUGHT by the RAM diff", () => {
  const c = CASES[2]; // rank 9 -> rank cell should be 10
  const o = craft(c.player, c.score);
  const k = craft(c.player, c.score);
  oracle(o);
  insertScoreIntoHighScoreTable(k);
  k.mem.write8(HIGH_SCORE_INSERT_RANK, (c.rank + 2) & 0xff); // BUG: off-by-one rank

  const d = ramDiffMinusStack(o, k);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong rank cell — it is worthless");
  assert.equal(d.addr, HIGH_SCORE_INSERT_RANK, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/rank: wrong rank caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
