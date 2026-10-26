// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for restartActorAnimIfFlagBit0Set (Pooyan) — "spawn-step guard on a record flag": if bit 0
 * of the record's flag byte (rec+8) is clear, return untouched; else run the spawn/queue-step
 * helper, which no-ops when the phase is already advanced or clears a field and re-arms the
 * record's animation.
 *
 * CYCLE-FREE / memory-equivalence gate (docs/decompiler-pipeline). The routine WRITES RAM (via the
 * helper), so each case runs the oracle on one FRESH clone and restartActorAnimIfFlagBit0Set on another, compared on:
 *
 *     RAM (dumpState, minus stack scratch below the entry SP).
 *
 * The live-out is MEMORY ONLY. pc/SP are not compared. No register is a consumed result: the guard
 * only tests a bit and the helper writes record fields; the arm path ends in the shared animation
 * helper, whose own contract is memory-only. IX is an unchanged input.
 *
 * IX is register-dispatched, so every case CRAFTS a record at the actor table with (rec+6, rec+8)
 * and the animation fields poked identically on both sides. Three arms: guard-clear (no effect),
 * helper-gate hit (bit set but phase already advanced, no effect), and arm (bit set, phase low ->
 * clear rec+8 and point the record at the animation sequence with the frame index reset).
 *
 * Jobs:
 *   1. EQUAL (crafted) — the three arms match in RAM(−stack).
 *   2. WRITE-SET — the arm path's only writes are rec+8:=0 and the three animation-pointer bytes
 *      (rec+0x0C..rec+0x0E); the no-effect arms write nothing.
 *   3. CRAFTED — the two no-effect arms are byte-for-byte unchanged.
 *   4. TEETH — a wrong animation-pointer byte MUST be caught by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-1389.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1389 as oracle } from "../../translated/loc_1389.js";
import { restartActorAnimIfFlagBit0Set } from "../restartActorAnimIfFlagBit0Set.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, ACTOR_TABLE, ANIM_TABLE_3829 } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = ACTOR_TABLE; // craft the record at the actor table's lead slot
const ANIM_LO = ANIM_TABLE_3829 & 0xff;
const ANIM_HI = (ANIM_TABLE_3829 >> 8) & 0xff;

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

/** A fresh clone with the record's guard flag, phase, and animation fields seated identically. */
function craft(flag, phase) {
  const m = BASE.clone();
  m.regs.ix = REC;
  m.mem.write8(REC + 0x06, phase); // helper's phase gate
  m.mem.write8(REC + 0x08, flag); // guard flag (bit 0)
  m.mem.write8(REC + 0x0c, 0x11); // pre-dirtied anim pointer / index, to observe the arm
  m.mem.write8(REC + 0x0d, 0x22);
  m.mem.write8(REC + 0x0e, 0x33);
  m.regs.sp = 0x8ffe; // in STACK_SCRATCH; the oracle's rets/tail only POP dead RAM
  return m;
}

const CASES = [
  { name: "guard clear (bit0=0)", flag: 0x02, phase: 0x00 }, // returns untouched
  { name: "helper gate hit (phase>=2)", flag: 0x01, phase: 0x05 }, // returns untouched
  { name: "arm (bit0=1, phase<2)", flag: 0x03, phase: 0x01 }, // clears rec+8, arms animation
];

// -- 1. EQUAL (crafted) -------------------------------------------------------

test("EQUAL: crafted (flag,phase) — restartActorAnimIfFlagBit0Set == oracle in RAM(−stack)", () => {
  for (const c of CASES) {
    const o = craft(c.flag, c.phase);
    const k = craft(c.flag, c.phase);
    oracle(o);
    restartActorAnimIfFlagBit0Set(k);
    const d = ramDiffMinusStack(o, k);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} mine=${d.b} (${c.name})`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted arms identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the arm path writes only rec+8:=0 and the three animation-pointer bytes", () => {
  const o = craft(0x03, 0x01);
  const before = o.dumpState();
  oracle(o);
  const after = o.dumpState();
  const changed = changedMinusStack(o, before, after);
  assert.equal(changed.get(REC + 0x08), 0x00, "rec+8 cleared to 0");
  assert.equal(changed.get(REC + 0x0c), ANIM_LO, "anim pointer low byte");
  assert.equal(changed.get(REC + 0x0d), ANIM_HI, "anim pointer high byte");
  assert.equal(changed.get(REC + 0x0e), 0x00, "frame index reset to 0");
  assert.equal(changed.size, 4, `expected exactly 4 writes, got ${changed.size}`);
  console.log(`  WRITE-SET: rec+8:=0, anim -> ${hx(ANIM_TABLE_3829)}, frame:=0 (4 writes)`);
});

// -- 3. CRAFTED (no-effect arms) ----------------------------------------------

test("CRAFTED: the two no-effect arms leave RAM byte-for-byte unchanged", () => {
  for (const c of [CASES[0], CASES[1]]) {
    const o = craft(c.flag, c.phase);
    const before = o.dumpState();
    oracle(o);
    const changed = changedMinusStack(o, before, o.dumpState());
    assert.equal(changed.size, 0, `${c.name} must not write RAM, wrote ${changed.size} cells`);
  }
  console.log("  CRAFTED: guard-clear and helper-gate arms write nothing");
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: a wrong animation-pointer byte is CAUGHT by the RAM diff", () => {
  const o = craft(0x03, 0x01);
  const k = craft(0x03, 0x01);
  oracle(o);
  restartActorAnimIfFlagBit0Set(k);
  k.mem.write8(REC + 0x0c, (ANIM_LO ^ 0xff) & 0xff); // BUG: wrong anim pointer low byte

  const d = ramDiffMinusStack(o, k);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong animation-pointer byte — it is worthless");
  assert.equal(d.addr, REC + 0x0c, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
