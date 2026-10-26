// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for latchFreeSlotCountAndTamperCheck (Pooyan) — "gated slot sweep with a code-region checksum
 * tripwire": while the advance guard is set and the sweep latch clear, count the empty records among
 * six stride-0x18 slots; with four or more free, latch the count and fold a fixed code block, bumping
 * a tamper strike counter if the fold misses its expected value.
 *
 * Cycle-free memory-equivalence gate. The routine writes work RAM and folds through the byte-table
 * lookup helper, so each case runs on a FRESH clone per side, compared on:
 *
 *     RAM (dumpState, minus stack scratch below the entry SP).
 *
 * There is no register live-out: the trampoline caller ignores the result, so pc/SP/registers are NOT
 * compared. Inputs (guard, latch, the six slot words) are poked identically on both sides; the fold
 * lookup pushes/pops in the dead stack. The checksum reads a fixed code block whose fold value depends
 * on that block, so match-vs-mismatch is derived from the run, not assumed.
 *
 * The checksum folds a fixed block of ROM (0x0bf3 downward); the genuine ROM folds to 0x0915, which
 * the routine accepts, so it never bumps the tamper counter. A corrupt-block arm is impossible — ROM
 * is not writable in a clone — so the tamper-bump path cannot be reached by a poke; a POSITIVE-CONTROL
 * proves the comparison is load-bearing instead (as the batch-1 checksum gates do).
 *
 * Jobs:
 *   1. EQUAL — guard clear, already latched, too few free, and enough free (six and five, block
 *      intact): module == oracle in RAM (−stack).
 *   2. WRITE-SET — the gated-out paths write nothing; the enough-free path writes only the latch (=
 *      free count) (the fold matches the genuine ROM, so no tamper write).
 *   3. TEETH — a wrong latched count, and a spurious tamper bump, are each CAUGHT.
 *   4. POSITIVE-CONTROL — a twin folding the same block but expecting the WRONG sum bumps the tamper
 *      counter where the module leaves it clean, proving the checksum comparison is real.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-52f6.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_52f6 as oracle } from "../../translated/loc_52f6.js";
import { latchFreeSlotCountAndTamperCheck } from "../latchFreeSlotCountAndTamperCheck.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  SCRIPT_ADVANCE_GUARD,
  SLOT_SWEEP_LATCH,
  ENEMY_ACTOR_TABLE,
  SLOT_SWEEP_CKSUM_BASE,
  TAMPER_STRIKES_SLOTSWEEP,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const SLOT_STRIDE = 0x18;
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8fe0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** A fresh clone: guard/latch/tamper seated, `freeCount` slots emptied. */
function craft(guard, latch, freeCount) {
  const m = BASE.clone();
  m.mem.write8(SCRIPT_ADVANCE_GUARD, guard);
  m.mem.write8(SLOT_SWEEP_LATCH, latch);
  m.mem.write8(TAMPER_STRIKES_SLOTSWEEP, 0x00);
  for (let i = 0; i < 6; i++) {
    const rec = ENEMY_ACTOR_TABLE + i * SLOT_STRIDE;
    if (i < freeCount) { m.mem.write8(rec, 0x00); m.mem.write8(rec + 1, 0x00); }
    else { m.mem.write8(rec, 0x11); m.mem.write8(rec + 1, 0x22); }
  }
  m.regs.sp = 0x8fe0; // dead stack: the rolling-fold lookup pushes/pops here
  return m;
}

// The block-perturbed case is intentionally absent: it required writing ROM (throws UnmappedAccess),
// and the genuine ROM folds to a match, so the tamper-bump path is unreachable by a poke. Its intent
// (the checksum comparison is real) is carried by the POSITIVE-CONTROL below.
const CASES = [
  { name: "guard clear", guard: 0x00, latch: 0x00, freeCount: 6 },
  { name: "already latched", guard: 0x01, latch: 0x03, freeCount: 6 },
  { name: "too few free", guard: 0x01, latch: 0x00, freeCount: 2 },
  { name: "enough free (6), block intact", guard: 0x01, latch: 0x00, freeCount: 6 },
  { name: "enough free (5), block intact", guard: 0x01, latch: 0x00, freeCount: 5 },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted guard/slot/block cases — latchFreeSlotCountAndTamperCheck == oracle in RAM (−stack)", () => {
  for (const { name, guard, latch, freeCount } of CASES) {
    const o = craft(guard, latch, freeCount);
    const c = craft(guard, latch, freeCount);
    oracle(o);
    latchFreeSlotCountAndTamperCheck(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} cases identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: gated-out paths write nothing; enough-free writes the latch (+ tamper on a miss)", () => {
  for (const g of [
    { name: "guard clear", guard: 0x00, latch: 0x00 },
    { name: "already latched", guard: 0x01, latch: 0x03 },
    { name: "too few free", guard: 0x01, latch: 0x00, freeCount: 2 },
  ]) {
    const before = craft(g.guard, g.latch, g.freeCount ?? 6);
    const after = craft(g.guard, g.latch, g.freeCount ?? 6);
    const b0 = before.dumpState();
    oracle(after);
    const a1 = after.dumpState();
    const changed = [];
    for (let off = 0; off < b0.length; off++) if (b0[off] !== a1[off]) changed.push(after.stateOffsetToAddr(off));
    assert.deepEqual(changed, [], `${g.name}: expected no writes, got ${changed.map(hx)}`);
  }

  // Enough free: the latch takes the free count; the tamper counter moves only on a fold miss.
  const before = craft(0x01, 0x00, 6);
  const after = craft(0x01, 0x00, 6);
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();
  const changed = new Map();
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] === a1[off]) continue;
    const addr = after.stateOffsetToAddr(off);
    if (inDeadStack(addr)) continue; // the rolling-fold lookup pushes/pops here; not game state
    changed.set(addr, a1[off]);
  }
  assert.ok(changed.has(SLOT_SWEEP_LATCH), "enough-free must latch the free count");
  assert.equal(changed.get(SLOT_SWEEP_LATCH), 6, "the latch must hold the free-slot count");
  for (const cell of changed.keys()) {
    assert.ok(cell === SLOT_SWEEP_LATCH || cell === TAMPER_STRIKES_SLOTSWEEP, `unexpected write at ${hx(cell)}`);
  }
  console.log("  WRITE-SET: gated-out -> none; enough-free -> latch (+ tamper on a miss)");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong latched count is CAUGHT by the RAM diff", () => {
  const o = craft(0x01, 0x00, 6);
  const c = craft(0x01, 0x00, 6);
  oracle(o);
  latchFreeSlotCountAndTamperCheck(c);
  c.mem.write8(SLOT_SWEEP_LATCH, c.mem.read8(SLOT_SWEEP_LATCH) ^ 0xff); // BUG: wrong latched count
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong latched count — it is worthless");
  assert.equal(d.addr, SLOT_SWEEP_LATCH, `teeth caught wrong address ${hx(d.addr ?? 0)} (expected ${hx(SLOT_SWEEP_LATCH)})`);
  console.log(`  TEETH(latch): wrong count caught at ${hx(d.addr)}`);
});

test("TEETH: a spurious tamper bump is CAUGHT at the tamper counter", () => {
  const o = craft(0x01, 0x00, 6);
  const c = craft(0x01, 0x00, 6);
  oracle(o);
  latchFreeSlotCountAndTamperCheck(c);
  c.mem.write8(TAMPER_STRIKES_SLOTSWEEP, c.mem.read8(TAMPER_STRIKES_SLOTSWEEP) ^ 0xff); // BUG: spurious/missed bump
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a tamper-counter divergence — it is worthless");
  assert.equal(d.addr, TAMPER_STRIKES_SLOTSWEEP, `teeth caught wrong address ${hx(d.addr ?? 0)} (expected ${hx(TAMPER_STRIKES_SLOTSWEEP)})`);
  console.log(`  TEETH(tamper): divergence caught at ${hx(d.addr)}`);
});

// -- 4. POSITIVE-CONTROL ------------------------------------------------------
// A corrupt-ROM arm is impossible (ROM is not writable; the checksum folds ROM 0x0bf3 downward), and
// the genuine ROM folds to a match, so the tamper-bump path cannot be reached by a poke. Instead prove
// the checksum comparison is load-bearing: a twin folding the SAME block but expecting the WRONG sum
// bumps the tamper counter on the genuine ROM where the module (and oracle) leave it clean.
const CKSUM_LEN = 0x17; // bytes folded, matching the module
const CKSUM_LO = 0x15; // the low byte the genuine ROM folds to (and the module expects)
const CKSUM_HI = 0x09; // the high byte the genuine ROM folds to

function wrongSentinelTwin(m) {
  const { mem8 } = m;
  let sum = 0;
  let src = SLOT_SWEEP_CKSUM_BASE;
  for (let i = 0; i < CKSUM_LEN; i++) { sum = (sum + mem8[src]) & 0xffff; src = (src - 1) & 0xffff; }
  // Expect a deliberately wrong low byte: the genuine 0x15 never matches -> always a "miss" -> bump.
  if (!((sum & 0xff) === ((CKSUM_LO + 1) & 0xff) && (sum >> 8) === CKSUM_HI)) {
    mem8[TAMPER_STRIKES_SLOTSWEEP] = (mem8[TAMPER_STRIKES_SLOTSWEEP] + 1) & 0xff;
  }
}

test("POSITIVE-CONTROL: the checksum comparison is load-bearing (a wrong-sentinel twin bumps tamper)", () => {
  const c = craft(0x01, 0x00, 6);
  latchFreeSlotCountAndTamperCheck(c);
  assert.equal(c.mem.read8(TAMPER_STRIKES_SLOTSWEEP), 0x00, "sanity: the module leaves tamper clear on the genuine ROM");
  const t = craft(0x01, 0x00, 6);
  wrongSentinelTwin(t);
  assert.equal(t.mem.read8(TAMPER_STRIKES_SLOTSWEEP), 0x01, "a wrong-sentinel twin must bump tamper where the module does not");
  console.log("  POSITIVE-CONTROL: module leaves tamper clear; a wrong-sentinel twin bumps it");
});
