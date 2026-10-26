// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for advanceActorGroupRiseAndCycleTiles (ROM 0x6666) — "advance then animate the three hunter
 * records": walk three actor records backward from the incoming IX (stride -0x18) running the
 * idle-actor advance (advanceActorToTopRowThenRetire) on each, then run the countdown-gated blink animation (cycleActorGroupSpriteFramesOnTimer)
 * over the hunter table (0x8c78 / 0x8c60 / 0x8c48).
 *
 * Cycle-free memory-equivalence gate: fresh clone per side, compared on RAM (dumpState, minus
 * stack scratch below the entry SP). pc/SP/cycles are NOT compared. This is a dispatch handler run for side effects;
 * the oracle protects its loop counter/stride across the calls with exx/djnz (register-only), and
 * nothing is read back from a register — so no register live-out is declared or compared. IX is the
 * loop-start pointer, seated via the module's register-default bridge; cycleActorGroupSpriteFramesOnTimer is always applied to
 * the hunter table base regardless of IX.
 *
 * The leaf is not reached in a plain attract, so every case is CRAFTED: the three loop records are
 * seated so each advance writes (state 0, sub-position + step -> a carry-free bump), BLINK_PHASE is
 * armed to drain this frame so cycleActorGroupSpriteFramesOnTimer takes its full tile-copy path, and the board-clear /
 * terminator flags are zeroed so copyDisplayTilesIntoActorRecords does not divert to the board reset.
 *
 * Jobs:
 *   1. EQUAL — oracle == advanceActorGroupRiseAndCycleTiles in RAM (−stack).
 *   2. WRITE-SET — the pass writes exactly the three advanced sub-positions, the three record tiles,
 *      the blink reload, and the select phase.
 *   3. TEETH — a broken twin that advances only two of the three records is CAUGHT by the RAM diff,
 *      and a wrong record tile is CAUGHT.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-6666.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_6666 as oracle } from "../../translated/loc_6666.js";
import { advanceActorGroupRiseAndCycleTiles } from "../advanceActorGroupRiseAndCycleTiles.js";
import { advanceActorToTopRowThenRetire } from "../advanceActorToTopRowThenRetire.js";
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

const HUNTER_TABLE_BASE = 0x8c78;
const RECS = [0x8c78, 0x8c60, 0x8c48]; // IX, IX-0x18, IX-0x30
const OFF_STATE = 0x01, OFF_SUBPOS = 0x05, OFF_ROW = 0x06, OFF_STEP = 0x09, OFF_TILE = 0x0f;
const BLINK_PHASE = 0x892b;
const SELECT_PHASE = 0x892c;
const TABLE_ODD = 0x66c2; // phase bit0=1 -> odd table (BLINK 1, SELECT 0)
const TAMPER_STRIKES_TERMINATOR = 0x8df9;
const BOARD_CLEAR_FLAG = 0x89e5;
const SUBPOS = 0x10, STEP = 0x05; // carry-free advance: rec+5 0x10 -> 0x15

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Fresh clone: three loop records armed to advance, BLINK armed to drain, divert flags cleared. */
function craft() {
  const m = BASE.clone();
  for (const r of RECS) {
    m.mem.write8(r + OFF_STATE, 0x00); // idle -> advanceActorToTopRowThenRetire advances
    m.mem.write8(r + OFF_SUBPOS, SUBPOS);
    m.mem.write8(r + OFF_ROW, 0x00);
    m.mem.write8(r + OFF_STEP, STEP);
    m.mem.write8(r + OFF_TILE, 0xaa); // pre-dirty so the tile copy shows
  }
  m.mem.write8(BLINK_PHASE, 0x01); // drains to 0 this frame
  m.mem.write8(SELECT_PHASE, 0x00);
  m.mem.write8(TAMPER_STRIKES_TERMINATOR, 0x00);
  m.mem.write8(BOARD_CLEAR_FLAG, 0x00);
  m.regs.ix = HUNTER_TABLE_BASE;
  m.regs.sp = 0x8ffe;
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: advanceActorGroupRiseAndCycleTiles == oracle in RAM (−stack)", () => {
  const o = craft();
  const c = craft();
  oracle(o);
  advanceActorGroupRiseAndCycleTiles(c);
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  console.log("  EQUAL: identical (RAM −stack) — three advances + blink animation");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the pass writes the three sub-positions, three tiles, blink reload, select phase", () => {
  const before = craft();
  const after = craft();
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();

  const allowed = new Set([
    BLINK_PHASE, SELECT_PHASE,
    ...RECS.map((r) => r + OFF_SUBPOS),
    ...RECS.map((r) => r + OFF_TILE),
  ]);
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] === a1[off]) continue;
    const addr = after.stateOffsetToAddr(off);
    if (inDeadStack(addr)) continue;
    assert.ok(allowed.has(addr), `unexpected write at ${hx(addr)} (=${a1[off]})`);
  }
  assert.equal(after.mem.read8(BLINK_PHASE), 0x08, "blink reloaded");
  assert.equal(after.mem.read8(SELECT_PHASE), 0x01, "select phase advanced");
  for (let i = 0; i < RECS.length; i++) {
    assert.equal(after.mem.read8(RECS[i] + OFF_SUBPOS), (SUBPOS + STEP) & 0xff, `record ${i} advanced`);
    assert.equal(after.mem.read8(RECS[i] + OFF_TILE), ROM[TABLE_ODD + i], `record ${i} tile`);
  }
  console.log("  WRITE-SET: 3x sub-position advance + 3x tile + 0x892b:=08 + 0x892c:=01");
});

// -- 3. TEETH -----------------------------------------------------------------

/** Broken twin: advances only two of the three loop records (drops the last iteration). */
function brokenLoopTwice(m, ix = m.regs.ix) {
  let record = ix;
  for (let i = 0; i < 2; i++) { // BUG: should be 3 iterations
    advanceActorToTopRowThenRetire(m, record);
    record = (record - 0x18) & 0xffff;
  }
  cycleActorGroupSpriteFramesOnTimer(m, HUNTER_TABLE_BASE);
}

test("TEETH: dropping the third advance is CAUGHT by the RAM diff", () => {
  const o = craft();
  const c = craft();
  oracle(o);
  brokenLoopTwice(c);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a missing advance — it is worthless");
  assert.equal(d.addr, RECS[2] + OFF_SUBPOS, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: missing third advance caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong record tile is CAUGHT by the RAM diff", () => {
  const o = craft();
  const c = craft();
  oracle(o);
  advanceActorGroupRiseAndCycleTiles(c);
  c.mem.write8(RECS[2] + OFF_TILE, 0x00); // BUG: last record tile must be the ROM value
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong record tile — it is worthless");
  assert.equal(d.addr, RECS[2] + OFF_TILE, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong record tile caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
