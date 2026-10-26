// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for advancePlayStateToPhase7OnActorDelay (ROM 0x24fb, Pooyan) — actor-table state 5.
 *
 * It decrements the record's frame-delay (rec+0x11); while non-zero it returns. On expiry it
 * stamps 0x07 into the ROM-check flag cell (0x882b), or into the play-state index (0x880a)
 * when that flag is already clear, then — if the HUD-guard tally (0x8a3c) is set — falls
 * through into the shape loader seedFourRecordsAndCopyDisplayTiles keyed by that pointer.
 *
 * Cycle-free / memory-equivalence gate: contract = RAM (dumpState, minus stack scratch below the entry SP). The
 * oracle's fall-through m.call(0x250f) and the copier's inner calls push return addresses into
 * STACK_SCRATCH (sp seated there), which are excluded. The early-return and guard-clear paths
 * make no call and give exact RAM assertions; the deep fall-through is run under the
 * same-completion-path pattern (both sides take the same branch, RAM matches when both finish).
 * pc/sp/cycles are NOT compared. No register live-out is asserted: the early paths are memory-
 * only and the fall-through tail-inherits seedFourRecordsAndCopyDisplayTiles's register live-out through the return.
 *
 * Every case is CRAFTED — the leaf is not reached in a plain boot.
 *
 * Jobs:
 *   1. EQUAL (shallow) — still-holding, expire->0x882b, expire->0x880a (all guard-clear):
 *      oracle == advancePlayStateToPhase7OnActorDelay exactly in RAM (−stack).
 *   2. EQUAL (deep) — expire with the guard set: same completion path + RAM identical.
 *   3. WRITE-SET — the expire->0x882b guard-clear case writes exactly (rec+0x11) and 0x882b.
 *   4. TEETH — a twin stamping the wrong shape byte, and a twin that skips the decrement, are
 *      both caught by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-24fb.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_24fb as oracle } from "../../translated/loc_24fb.js";
import { advancePlayStateToPhase7OnActorDelay } from "../advancePlayStateToPhase7OnActorDelay.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, SCORE_DRIP_ACCUM, PLAY_STATE_INDEX, TAMPER_STRIKES_HUD_GUARD, BOARD_CLEAR_FLAG, TAMPER_STRIKES_TERMINATOR } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = 0x8a80; // record base (work RAM, clear of STACK_SCRATCH)
const HOLD = 0x11; //  frame-delay field
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8fe0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Seat the record + gating cells identically on a fresh clone. */
function craft({ hold, romFlag, hudGuard }) {
  const m = BASE.clone();
  m.regs.ix = REC;
  m.regs.sp = 0x8fe0; // in STACK_SCRATCH: the fall-through call pushes hit dead RAM
  m.mem.write8(REC + HOLD, hold);
  m.mem.write8(SCORE_DRIP_ACCUM, romFlag);
  m.mem.write8(PLAY_STATE_INDEX, 0x00); // observe the 0x880a write from a known value
  m.mem.write8(TAMPER_STRIKES_HUD_GUARD, hudGuard);
  m.mem.write8(BOARD_CLEAR_FLAG, 0x00); // keep copyDisplayTilesIntoActorRecords off its board-reset tail
  m.mem.write8(TAMPER_STRIKES_TERMINATOR, 0x00);
  return m;
}

const SHALLOW = [
  { name: "still holding", hold: 0x02, romFlag: 0x00, hudGuard: 0x00 },
  { name: "expire -> 0x882b", hold: 0x01, romFlag: 0x03, hudGuard: 0x00 },
  { name: "expire -> 0x880a", hold: 0x01, romFlag: 0x00, hudGuard: 0x00 },
];

// -- 1. EQUAL (shallow) -------------------------------------------------------

test("EQUAL: shallow paths — advancePlayStateToPhase7OnActorDelay == oracle exactly in RAM (−stack)", () => {
  for (const cs of SHALLOW) {
    const o = craft(cs);
    const c = craft(cs);
    oracle(o);
    advancePlayStateToPhase7OnActorDelay(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${cs.name}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL(shallow): ${SHALLOW.length} cases identical (RAM −stack)`);
});

// -- 2. EQUAL (deep fall-through into seedFourRecordsAndCopyDisplayTiles) -------------------------------

test("EQUAL: deep — expire with the guard set falls into seedFourRecordsAndCopyDisplayTiles; same path + RAM", () => {
  const cfg = { hold: 0x01, romFlag: 0x03, hudGuard: 0x01 };
  const o = craft(cfg);
  const c = craft(cfg);
  let oThrew = false;
  let cThrew = false;
  try { oracle(o); } catch { oThrew = true; }
  try { advancePlayStateToPhase7OnActorDelay(c); } catch { cThrew = true; }
  assert.equal(oThrew, cThrew, "oracle and module must take the same completion path");
  if (!oThrew) {
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL(deep): seedFourRecordsAndCopyDisplayTiles fall-through — same path (threw=${oThrew}), RAM identical when completing`);
});

// -- 3. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: expire->0x882b (guard clear) writes exactly (rec+0x11) and 0x882b", () => {
  const o = craft(SHALLOW[1]);
  const before = o.dumpState();
  oracle(o);
  const after = o.dumpState();

  const changed = new Set();
  for (let off = 0; off < before.length; off++) {
    if (before[off] !== after[off]) changed.add(o.stateOffsetToAddr(off));
  }
  assert.equal(changed.size, 2, `expected exactly 2 writes, got ${changed.size}`);
  assert.ok(changed.has(REC + HOLD), `expected a write at ${hx(REC + HOLD)}`);
  assert.ok(changed.has(SCORE_DRIP_ACCUM), `expected a write at ${hx(SCORE_DRIP_ACCUM)}`);
  assert.equal(o.mem.read8(SCORE_DRIP_ACCUM), 0x07, "0x882b must be stamped to 0x07");
  console.log(`  WRITE-SET: ${hx(REC + HOLD)} (1->0) + ${hx(SCORE_DRIP_ACCUM)} (:=0x07)`);
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: a wrong shape byte is CAUGHT by the RAM diff", () => {
  const o = craft(SHALLOW[1]);
  const c = craft(SHALLOW[1]);
  oracle(o);
  advancePlayStateToPhase7OnActorDelay(c);
  c.mem.write8(SCORE_DRIP_ACCUM, 0x00); // BUG: must be 0x07

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong shape byte — it is worthless");
  assert.equal(d.addr, SCORE_DRIP_ACCUM, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/shape: wrong byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a twin that skips the decrement is CAUGHT", () => {
  const o = craft(SHALLOW[0]);
  const c = craft(SHALLOW[0]);
  oracle(o);
  // broken twin: does nothing (never decrements the hold)
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a skipped decrement — it is worthless");
  assert.equal(d.addr, REC + HOLD, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/no-dec: caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
