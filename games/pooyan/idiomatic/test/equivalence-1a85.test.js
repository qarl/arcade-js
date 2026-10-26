// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for renderGaugeAndSetPlayStateForPlayer (ROM 0x1a85) — redraw the phase gauge (call 0x03c2 /
 * renderPhaseGauge), then set the play sub-state index (0x880a): 0x0a, bumped to 0x0b when
 * the active-player selector (0x880d) is nonzero.
 *
 * Cycle-free / memory-equivalence gate. The routine writes only RAM (gauge tiles + the
 * sub-state index), so the contract is RAM (dumpState, minus stack scratch below the entry SP). pc/SP/cycles
 * are NOT compared, and no register survives for the caller, so there is no register
 * live-out. The oracle's call 0x03c2 pushes a return slot into STACK_SCRATCH (excluded); the
 * module calls renderPhaseGauge directly (no push), so the stack diverges only inside the
 * excluded window.
 *
 * Jobs:
 *   1. EQUAL — over crafted (activePlayer, gaugeCount) pairs, module == oracle in RAM (−stack)
 *      and in the play sub-state index.
 *   2. WRITE-SET — with a nonzero gauge count, the writes are the five gauge cells plus the
 *      sub-state index; with a zero count, only the sub-state index.
 *   3. CRAFTED — the zero-gauge-count arm (gauge left untouched) and the active-player-bumped
 *      arm are exercised.
 *   4. TEETH — a twin that writes the WRONG sub-state index is caught by the RAM diff; a twin
 *      that never bumps for the active player is rejected.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-1a85.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1a85 as oracle } from "../../translated/loc_1a85.js";
import { renderGaugeAndSetPlayStateForPlayer } from "../renderGaugeAndSetPlayStateForPlayer.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, ACTIVE_PLAYER, PLAY_STATE_INDEX, GAUGE_PHASE_COUNTER, PHASE_GAUGE_BASE_TILE } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const u16 = (v) => v & 0xffff;
const hx = (v) => "0x" + u16(v).toString(16);
const PLAY_STATE_BASE = 0x0a;
const GAUGE_ROW_UP = -0x20; // gauge cells march one tilemap row up

const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);

function ramDiffMinusStack(ma, mb) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function craft(activePlayer, gaugeCount) {
  const m = BASE.clone();
  m.regs.sp = 0x8ffe; // scratch; the oracle's call/ret only touch STACK_SCRATCH
  m.mem.write8(ACTIVE_PLAYER, activePlayer & 0xff);
  m.mem.write8(GAUGE_PHASE_COUNTER, gaugeCount & 0xff);
  return m;
}

const expectedIndex = (activePlayer) => (activePlayer !== 0 ? PLAY_STATE_BASE + 1 : PLAY_STATE_BASE);

const CASES = [
  { activePlayer: 0x00, gaugeCount: 0x00 },
  { activePlayer: 0x00, gaugeCount: 0x03 },
  { activePlayer: 0x01, gaugeCount: 0x03 },
  { activePlayer: 0xff, gaugeCount: 0x07 },
  { activePlayer: 0x01, gaugeCount: 0x00 },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted (activePlayer, gaugeCount) — renderGaugeAndSetPlayStateForPlayer == oracle in RAM (−stack)", () => {
  for (const { activePlayer, gaugeCount } of CASES) {
    const o = craft(activePlayer, gaugeCount);
    const c = craft(activePlayer, gaugeCount);
    oracle(o);
    renderGaugeAndSetPlayStateForPlayer(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} mod=${d.b} (ap=${hx(activePlayer)} gc=${hx(gaugeCount)})`);
    assert.equal(c.mem.read8(PLAY_STATE_INDEX), o.mem.read8(PLAY_STATE_INDEX), "sub-state index matches oracle");
    assert.equal(c.mem.read8(PLAY_STATE_INDEX), expectedIndex(activePlayer), `sub-state index value (ap=${hx(activePlayer)})`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted cases identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: nonzero gauge -> five gauge cells + the sub-state index", () => {
  const activePlayer = 0x01;
  const gaugeCount = 0x03;
  const before = craft(activePlayer, gaugeCount);
  const b0 = before.dumpState();
  const after = craft(activePlayer, gaugeCount);
  oracle(after);
  const a1 = after.dumpState();

  const changed = new Set();
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off] && !inDeadStack(after.stateOffsetToAddr(off))) changed.add(after.stateOffsetToAddr(off));
  }
  const gaugeCells = [0, 1, 2, 3, 4].map((i) => u16(PHASE_GAUGE_BASE_TILE + i * GAUGE_ROW_UP));
  assert.equal(changed.size, 6, `expected 6 written cells, got ${changed.size}`);
  for (const cell of [...gaugeCells, PLAY_STATE_INDEX]) {
    assert.ok(changed.has(cell), `expected a write at ${hx(cell)}`);
  }
  console.log(`  WRITE-SET: 5 gauge cells + sub-state index ${hx(PLAY_STATE_INDEX)} (6 cells)`);
});

test("WRITE-SET: zero gauge -> ONLY the sub-state index", () => {
  const before = craft(0x00, 0x00);
  const b0 = before.dumpState();
  const after = craft(0x00, 0x00);
  oracle(after);
  const a1 = after.dumpState();

  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off] && !inDeadStack(after.stateOffsetToAddr(off))) changed.push(after.stateOffsetToAddr(off));
  }
  assert.deepEqual(changed, [PLAY_STATE_INDEX], "zero gauge count leaves the gauge untouched");
  console.log(`  WRITE-SET: zero gauge -> only ${hx(PLAY_STATE_INDEX)} written`);
});

// -- 3. CRAFTED ---------------------------------------------------------------

test("CRAFTED: the active-player bump lands 0x0b, the single-player arm 0x0a", () => {
  const cP2 = craft(0x01, 0x03);
  renderGaugeAndSetPlayStateForPlayer(cP2);
  assert.equal(cP2.mem.read8(PLAY_STATE_INDEX), PLAY_STATE_BASE + 1, "active-player -> 0x0b");

  const cP1 = craft(0x00, 0x03);
  renderGaugeAndSetPlayStateForPlayer(cP1);
  assert.equal(cP1.mem.read8(PLAY_STATE_INDEX), PLAY_STATE_BASE, "single-player -> 0x0a");
  console.log("  CRAFTED: 0x0b (bumped) / 0x0a (base) both reached");
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: a wrong sub-state index is CAUGHT by the RAM diff", () => {
  const activePlayer = 0x01;
  const gaugeCount = 0x03;
  const o = craft(activePlayer, gaugeCount);
  const c = craft(activePlayer, gaugeCount);
  oracle(o);
  renderGaugeAndSetPlayStateForPlayer(c);
  c.mem.write8(PLAY_STATE_INDEX, 0x00); // BUG: wrong sub-state index

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong sub-state index — it is worthless");
  assert.equal(d.addr, PLAY_STATE_INDEX, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong sub-state index caught at ${hx(d.addr)}`);
});

test("TEETH: never bumping for the active player is rejected", () => {
  const o = craft(0x01, 0x00);
  oracle(o);
  assert.notEqual(PLAY_STATE_BASE, o.mem.read8(PLAY_STATE_INDEX), "a never-bumped 0x0a must differ from the oracle's 0x0b");
  assert.equal(o.mem.read8(PLAY_STATE_INDEX), PLAY_STATE_BASE + 1, "sanity: oracle bumped to 0x0b for the active player");
  console.log("  TEETH/bump: an un-bumped index is rejected for the active player");
});
