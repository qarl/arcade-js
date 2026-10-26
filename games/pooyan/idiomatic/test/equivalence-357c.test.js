// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for resolveTargetColumnAndArmApproach (ROM 0x357c, Pooyan) — the target-tile resolver + state step
 * for the actor record at IX. It resolves a wanted tile from a per-frame table (no lane active) or
 * from an alternate lane (direct compare, or a second table base). An exact tile match tails into
 * the pre-spawn guard; a tile below the threshold returns; at or above it the record is latched
 * (rec+0x08) and pointed at one of two animation scripts (chosen by rec+0x07 bit1).
 *
 * SEATING: BALANCED — one plain ret (below-threshold) and three tail-jps (exact-hit guard, the two
 * animation scripts) reusing the caller's frame; no net SP move, so the routine WIREs. LIVE-OUT is
 * none: it is a dispatched state handler whose caller reloads A, so no register survives;
 * equivalence is RAM (dumpState) minus stack scratch below the entry SP, SP parked in STACK_SCRATCH.
 *
 * Cases are CRAFTED: a plain boot does not seat the lane/round/record geometry. The alternate-lane
 * cases seat their own RAM table so hit/no-hit is deterministic; the exact-hit case seats B >= 0x20
 * so the guard bails without a nested write.
 *
 * Jobs:
 *   1. EQUAL — lane-0 lookup, alt-lane direct latch (both scripts), alt-lane below-threshold, and
 *      alt-lane table hit/no-hit: oracle == module in RAM (−stack).
 *   2. WRITE-SET — a latch sets rec+0x08 and the anim pointer; a below-threshold record is inert.
 *   3. TEETH — a corrupted latch byte is caught by the RAM diff; and rec+0x07 bit1 genuinely
 *      selects between the two animation scripts (module tracks the oracle both ways).
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-357c.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_357c as oracle } from "../../translated/loc_357c.js";
import { resolveTargetColumnAndArmApproach } from "../resolveTargetColumnAndArmApproach.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const LANE = 0x8d79; // ACTIVE_LANE_COUNT
const ROUND = 0x8907; // ROUND_COUNTER
const ANIMF = 0x8d41; // ANIM_FRAME_COUNTER
const ALTPTR = 0x8d6f; // ALT_TARGET_TABLE_PTR (16-bit)
const SLOT = 0x8d7b; // SLOT_SPAWN_INDEX
const IX = 0x8840; // actor record base
const TILE = IX + 0x06; // rec+0x06 current tile
const FLAGS = IX + 0x07; // rec+0x07 (bit1 = script, bit2 = direct-compare re-entry)
const LATCH = IX + 0x08; // rec+0x08 state latch
const ANIMLO = IX + 0x0c; // rec+0x0c anim pointer low byte
const ALT_BASE = 0x8e00; // a RAM table the alt-lane lookup reads
const SCRIPT_A_LO = 0x38; // ANIM_TABLE_3838 low byte
const SCRIPT_B_LO = 0x56; // ANIM_TABLE_3856 low byte
const SP0 = 0x8ff0; // inside STACK_SCRATCH

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Seat IX + a clean record window and the shared cells; B >= 0x20 so any exact-hit guard bails. */
function seat(m, { lane = 0, flags = 0, tile = 0x50, round = 0x00, altCol = 0x03, altTile } = {}) {
  m.regs.sp = SP0;
  m.regs.ix = IX;
  m.regs.b = 0x40;
  for (let i = 0; i < 0x18; i++) m.mem.write8(IX + i, 0x00);
  m.mem.write8(LANE, lane);
  m.mem.write8(ROUND, round);
  m.mem.write8(ANIMF, 0x00);
  m.mem.write8(FLAGS, flags);
  m.mem.write8(TILE, tile);
  m.mem.write16(ALTPTR, ALT_BASE);
  m.mem.write8(SLOT, altCol);
  if (altTile !== undefined) m.mem.write8(ALT_BASE + altCol, altTile);
  return m;
}

const craftLane0 = () => seat(BASE.clone(), { lane: 0, tile: 0x50 });
const craftAltLatchA = () => seat(BASE.clone(), { lane: 1, flags: 0x00, tile: 0x50 }); // bit2 clear, bit1 clear
const craftAltLatchB = () => seat(BASE.clone(), { lane: 1, flags: 0x02, tile: 0x50 }); // bit1 set -> script B
const craftAltBelow = () => seat(BASE.clone(), { lane: 1, flags: 0x00, tile: 0x05 }); // below threshold -> ret
const craftAltHit = () => seat(BASE.clone(), { lane: 1, flags: 0x04, tile: 0x77, altTile: 0x77 }); // bit2 set, exact hit
const craftAltNoHit = () => seat(BASE.clone(), { lane: 1, flags: 0x04, tile: 0x50, altTile: 0x77 }); // miss -> latch

const CASES = [
  { name: "lane 0 lookup", craft: craftLane0 },
  { name: "alt-lane direct latch (script A)", craft: craftAltLatchA },
  { name: "alt-lane direct latch (script B)", craft: craftAltLatchB },
  { name: "alt-lane below threshold", craft: craftAltBelow },
  { name: "alt-lane table exact hit -> guard", craft: craftAltHit },
  { name: "alt-lane table miss -> latch", craft: craftAltNoHit },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: resolveTargetColumnAndArmApproach == oracle in RAM (−stack)", () => {
  for (const cfg of CASES) {
    const o = cfg.craft();
    const c = cfg.craft();
    oracle(o);
    resolveTargetColumnAndArmApproach(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${cfg.name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} outcomes identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: a latch marks rec+0x08 and the anim pointer; below-threshold is inert", () => {
  const latch = craftAltLatchA();
  oracle(latch);
  assert.equal(latch.mem.read8(LATCH), 0x01, "the record is latched");
  assert.equal(latch.mem.read8(ANIMLO), SCRIPT_A_LO, "script A pointer stored");

  const below = craftAltBelow();
  const b0 = below.dumpState();
  oracle(below);
  assert.deepEqual([...below.dumpState()], [...b0], "a below-threshold record must leave RAM untouched");
  console.log("  WRITE-SET: latch marks record; below-threshold inert");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a corrupted latch byte is CAUGHT by the RAM diff", () => {
  const o = craftAltLatchA();
  const c = craftAltLatchA();
  oracle(o);
  resolveTargetColumnAndArmApproach(c);
  c.mem.write8(LATCH, (o.mem.read8(LATCH) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted latch byte");
  assert.equal(d.addr, LATCH, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}`);
});

test("TEETH: rec+0x07 bit1 selects the animation script (module tracks oracle both ways)", () => {
  const a = craftAltLatchA();
  const b = craftAltLatchB();
  const ca = craftAltLatchA();
  const cb = craftAltLatchB();
  oracle(a);
  oracle(b);
  resolveTargetColumnAndArmApproach(ca);
  resolveTargetColumnAndArmApproach(cb);
  assert.equal(ramDiffMinusStack(a, ca), null, "script-A module must match the oracle");
  assert.equal(ramDiffMinusStack(b, cb), null, "script-B module must match the oracle");
  assert.equal(a.mem.read8(ANIMLO), SCRIPT_A_LO, "bit1 clear -> script A");
  assert.equal(b.mem.read8(ANIMLO), SCRIPT_B_LO, "bit1 set -> script B");
  assert.notEqual(a.mem.read8(ANIMLO), b.mem.read8(ANIMLO), "bit1 must select a different script");
  console.log("  TEETH(branch): bit1 selects the script, both tracked");
});
