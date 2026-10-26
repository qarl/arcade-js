// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for floodFieldAndLatchPlayStatePhaseTimer (ROM 0x1b8c) — a 0x15a8-dispatch play-state handler:
 * tick one row of the tilemap clear (clearBoardRamAndBlankFillRow) and bail while it drains; once drained, flood the
 * attribute columns (fillAttributeColumns from 0x0819), enqueue display commands 0x0600 and 0x0603
 * (enqueueDisplayCommand), run the shared integrity/timer handler (renderPlayTimerNibblesAndGuardChecksum), then latch the play sub-state index
 * (0x880a) to 0x0c and the phase timer (0x8808) to 0x60.
 *
 * The go-forward contract is RAM (dumpState, minus stack scratch below the entry SP). pc/SP/cycles are NOT compared, and
 * there is no register live-out — the caller (dispatchInPlaySubState) tail-dispatches via jp (hl), so the handler's
 * ret returns upstream and no register/flag result is read back. The oracle uses the stack via m.call;
 * the idiomatic form spends none, so its STACK_SCRATCH stays clean — hence the exclusion.
 *
 * The row-drain branch is selected by the fill-row counter (0x8809): 1 -> drains this tick (full
 * path), >1 -> bail. TILE_FILL_PTR (0x880b) is seated at a fixed VRAM base so clearBoardRamAndBlankFillRow's row blank is
 * deterministic. Both branches are CRAFTED (this handler is not reached in a plain attract).
 *
 * Jobs: 1. EQUAL over the full path and the early bail. 2. WRITE-SET (the handler's own two latches).
 * 3. CRAFTED (the early-bail arm isolated). 4. TEETH — a wrong sub-state and a wrong phase timer.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-1b8c.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1b8c as oracle } from "../../translated/loc_1b8c.js";
import { floodFieldAndLatchPlayStatePhaseTimer } from "../floodFieldAndLatchPlayStatePhaseTimer.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const FILL_ROW_COUNTER = 0x8809;
const TILE_FILL_PTR = 0x880b;
const PLAY_STATE_INDEX = 0x880a;
const PHASE_TIMER = 0x8808;
const FILL_VRAM = 0x8420; // a tile-region base for the deterministic row blank

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);

function ramDiffMinusStack(ma, mb) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function craft(rowCounter) {
  const m = BASE.clone();
  m.mem.write8(FILL_ROW_COUNTER, rowCounter);
  m.mem.write16(TILE_FILL_PTR, FILL_VRAM);
  m.regs.sp = 0x8ffe;
  return m;
}

// -- 1. EQUAL (crafted) -------------------------------------------------------

test("EQUAL: full path (drains) + early bail — floodFieldAndLatchPlayStatePhaseTimer == oracle in RAM (−stack)", () => {
  for (const rowCounter of [1, 3]) {
    const o = craft(rowCounter);
    const c = craft(rowCounter);
    oracle(o);
    floodFieldAndLatchPlayStatePhaseTimer(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} mine=${d.b} (rowCounter=${rowCounter})`);
  }
  console.log("  EQUAL: full path + early bail identical (RAM −stack)");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: on the full path the handler latches 0x880a:=0x0c and 0x8808:=0x60", () => {
  const m = craft(1);
  oracle(m);
  assert.equal(m.mem.read8(PLAY_STATE_INDEX), 0x0c, "play sub-state index latched");
  assert.equal(m.mem.read8(PHASE_TIMER), 0x60, "phase timer reloaded");
  // (The wider footprint — the tilemap clear, attribute flood, display ring and timer render — is
  // the callees' own contract, gated by their own equivalence tests; EQUAL covers it wholesale.)
  console.log("  WRITE-SET: 0x880a:=0x0c, 0x8808:=0x60");
});

// -- 3. CRAFTED (early bail) --------------------------------------------------

test("CRAFTED: with the fill still draining, floodFieldAndLatchPlayStatePhaseTimer bails identically (only 0x8809 steps)", () => {
  const o = craft(4);
  const c = craft(4);
  oracle(o);
  floodFieldAndLatchPlayStatePhaseTimer(c);
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} mine=${d.b}`);
  assert.notEqual(c.mem.read8(PLAY_STATE_INDEX), 0x0c, "the bail path must NOT latch the sub-state");
  console.log("  CRAFTED: early bail matches; sub-state not latched");
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: a wrong latched sub-state is CAUGHT by the RAM diff", () => {
  const o = craft(1);
  const c = craft(1);
  oracle(o);
  floodFieldAndLatchPlayStatePhaseTimer(c);
  c.mem.write8(PLAY_STATE_INDEX, 0x0d); // BUG: must be 0x0c
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong sub-state — it is worthless");
  assert.equal(d.addr, PLAY_STATE_INDEX, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong sub-state caught at ${hx(d.addr)}`);
});

test("TEETH: a wrong phase-timer reload is CAUGHT by the RAM diff", () => {
  const o = craft(1);
  const c = craft(1);
  oracle(o);
  floodFieldAndLatchPlayStatePhaseTimer(c);
  c.mem.write8(PHASE_TIMER, 0x00); // BUG: must be 0x60
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong phase timer");
  assert.equal(d.addr, PHASE_TIMER, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong phase timer caught at ${hx(d.addr)}`);
});
