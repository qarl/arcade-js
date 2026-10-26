// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for cycleActorGroupSpriteFramesOnTimer (ROM 0x66a1) — "countdown-gated sprite-table applier":
 * decrement the BLINK_PHASE (0x892b) cell; while non-zero return; on zero reload it to 0x08, advance
 * the select phase (0x892c), pick a 3-tile ROM source table by the phase's bit 0 (even 0x66bf / odd
 * 0x66c2), and copy those tiles into three actor records (IX, IX-0x18, IX-0x30) via copyDisplayTilesIntoActorRecords.
 *
 * The go-forward contract is RAM (dumpState, minus stack scratch below the entry SP). pc/SP/cycles are NOT compared.
 * There is no register live-out: the sole caller (advanceActorGroupRiseAndCycleTiles) issues this then ret's, reading nothing
 * back, so the oracle's early-exit A/HL/flags are dead. IX is the one live-in (advanceActorGroupRiseAndCycleTiles seeds 0x8c78).
 *
 * The routine is not reached in a plain attract, so every case is CRAFTED (poke BLINK_PHASE / the
 * select phase / IX identically on both sides). copyDisplayTilesIntoActorRecords's board-clear tail is kept off by zeroing
 * TAMPER_STRIKES_TERMINATOR + BOARD_CLEAR_FLAG.
 *
 * Jobs: 1. EQUAL over both table parities + the early-exit bail. 2. WRITE-SET (the reload, the phase,
 * three record tiles). 3. CRAFTED overwrite of pre-dirtied record fields. 4. TEETH — a wrong record
 * tile and a wrong reload each caught.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-66a1.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_66a1 as oracle } from "../../translated/loc_66a1.js";
import { cycleActorGroupSpriteFramesOnTimer } from "../cycleActorGroupSpriteFramesOnTimer.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const BLINK_PHASE = 0x892b;
const SELECT_PHASE = 0x892c;
const TABLE_EVEN = 0x66bf;
const TABLE_ODD = 0x66c2;
const REC_TILE = 0x0f; //           record byte copyDisplayTilesIntoActorRecords writes the tile into
const IX = 0x8c78; //               the record pointer advanceActorGroupRiseAndCycleTiles seeds
const RECS = [0x8c78, 0x8c60, 0x8c48]; // IX, IX-0x18, IX-0x30 (count 3, stride -0x18)
const TAMPER_STRIKES_TERMINATOR = 0x8df9;
const BOARD_CLEAR_FLAG = 0x89e5;
const DIRTY = 0xaa; //              pre-seed for record tile fields so an overwrite always shows

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);

function ramDiffMinusStack(ma, mb) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function craft(ix, blink, select) {
  const m = BASE.clone();
  m.regs.ix = ix;
  m.mem.write8(BLINK_PHASE, blink);
  m.mem.write8(SELECT_PHASE, select);
  m.mem.write8(TAMPER_STRIKES_TERMINATOR, 0);
  m.mem.write8(BOARD_CLEAR_FLAG, 0);
  for (const r of RECS) m.mem.write8(r + REC_TILE, DIRTY);
  m.regs.sp = 0x8ffe;
  return m;
}

// CRAFTED cases: drain -> odd table, drain -> even table, and still-live -> bail.
const CASES = [
  { blink: 1, select: 0, table: TABLE_ODD, drained: true },
  { blink: 1, select: 1, table: TABLE_EVEN, drained: true },
  { blink: 3, select: 5, table: null, drained: false },
];

// -- 1. EQUAL (crafted sweep) -------------------------------------------------

test("EQUAL: crafted (blink,select) — cycleActorGroupSpriteFramesOnTimer == oracle in RAM (−stack)", () => {
  for (const { blink, select } of CASES) {
    const o = craft(IX, blink, select);
    const c = craft(IX, blink, select);
    oracle(o);
    cycleActorGroupSpriteFramesOnTimer(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} mine=${d.b} (blink=${blink} select=${select})`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted cases identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: full path writes only the reload, the phase, and three record tiles", () => {
  const before = craft(IX, 1, 0); // drains -> phase 1 (bit0=1) -> odd table [9,9,9]
  const after = craft(IX, 1, 0);
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();

  const allowed = new Set([BLINK_PHASE, SELECT_PHASE, RECS[0] + REC_TILE, RECS[1] + REC_TILE, RECS[2] + REC_TILE]);
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] === a1[off]) continue;
    const addr = after.stateOffsetToAddr(off);
    if (inDeadStack(addr)) continue;
    assert.ok(allowed.has(addr), `unexpected write at ${hx(addr)} (=${a1[off]})`);
  }
  assert.equal(after.mem.read8(BLINK_PHASE), 0x08, "countdown reloaded");
  assert.equal(after.mem.read8(SELECT_PHASE), 1, "phase advanced");
  assert.equal(after.mem.read8(RECS[0] + REC_TILE), ROM[TABLE_ODD], "record 0 tile");
  assert.equal(after.mem.read8(RECS[1] + REC_TILE), ROM[TABLE_ODD + 1], "record 1 tile");
  assert.equal(after.mem.read8(RECS[2] + REC_TILE), ROM[TABLE_ODD + 2], "record 2 tile");
  console.log("  WRITE-SET: 0x892b:=08, 0x892c:=01, three records := odd tiles");
});

// -- 3. CRAFTED (overwrite) ---------------------------------------------------

test("CRAFTED: pre-dirtied record fields are overwritten to the even-table tiles identically", () => {
  const o = craft(IX, 1, 1); // drains -> phase 2 (bit0=0) -> even table [3,3,3]
  const c = craft(IX, 1, 1);
  oracle(o);
  cycleActorGroupSpriteFramesOnTimer(c);
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} mine=${d.b}`);
  for (let i = 0; i < RECS.length; i++) {
    assert.equal(c.mem.read8(RECS[i] + REC_TILE), ROM[TABLE_EVEN + i], `record ${i} overwritten`);
  }
  console.log("  CRAFTED: 0xAA record fields -> even-table tiles on both sides");
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: a wrong record tile is CAUGHT by the RAM diff", () => {
  const o = craft(IX, 1, 0);
  const c = craft(IX, 1, 0);
  oracle(o);
  cycleActorGroupSpriteFramesOnTimer(c);
  c.mem.write8(RECS[2] + REC_TILE, 0x00); // BUG: last record tile must be the ROM value
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong record tile — it is worthless");
  assert.equal(d.addr, RECS[2] + REC_TILE, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong record tile caught at ${hx(d.addr)}`);
});

test("TEETH: a wrong reload value is CAUGHT by the RAM diff", () => {
  const o = craft(IX, 1, 0);
  const c = craft(IX, 1, 0);
  oracle(o);
  cycleActorGroupSpriteFramesOnTimer(c);
  c.mem.write8(BLINK_PHASE, 0x07); // BUG: reload must be 0x08
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong reload");
  assert.equal(d.addr, BLINK_PHASE, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong reload caught at ${hx(d.addr)}`);
});
