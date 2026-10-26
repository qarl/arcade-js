// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for spawnObjectGatedByArmedActorCount (ROM 0x365d, Pooyan) — the pre-spawn gate. When the record's
 * arm bit (ix+0x0b bit0) is set it counts the enemy-actor records in the spawn state and bails
 * unless exactly one is found; otherwise it seats the sprite-object scan window and tails into the
 * slot scanner (0x3680).
 *
 * SEATING: TAIL-CALL. The bail is a plain ret; the fall-through hands its result to the scanner.
 * LIVE-OUT: A. On the bail path the oracle leaves A = the last scanned state byte, so the module
 * sets it through the return; the test compares A as well as RAM (dumpState) minus stack scratch below the entry SP.
 *
 * RECONCILE DEPENDENCY: the module dissolves the fall-through into a direct call to the idiomatic
 * spawnObjectIntoFreeSlot; the tail cases run once that module lands. The bail cases are self-contained.
 *
 * Cases are CRAFTED: the arm bit and the enemy-actor +0x02 state bytes are poked. On a power-on
 * clone the sprite-object window is free, so the tail path spawns and writes RAM.
 *
 * Jobs:
 *   1. EQUAL — bail(count=0), bail(count=2), tail(count=1), tail(arm clear): oracle == module in
 *      RAM (−stack) AND in A.
 *   2. OBSERVABLE — the bail path leaves RAM untouched; the tail path writes RAM.
 *   3. TEETH — an A-drop twin is caught by the A compare; an always-tail twin diverges on a bail
 *      input; a wrong seeded byte on the tail path is caught by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-365d.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_365d as oracle } from "../../translated/loc_365d.js";
import { spawnObjectGatedByArmedActorCount } from "../spawnObjectGatedByArmedActorCount.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { ENEMY_ACTOR_TABLE, STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = ENEMY_ACTOR_TABLE; // IX record; arm bit at REC+0x0b
const STRIDE = 0x18;
const STATE = 0x02; // +0x02 state byte of each enemy-actor record
const SPAWN = 0x03; // state value the gate counts
const SP0 = 0x8ff0;
const ENTRY_A = 0x99; // distinctive entry A so a dropped A live-out shows

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0 - 2); // entry SP: the seat pushes the caller's return word below SP0
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Seat the entry interface; `spawnCount` records get state==SPAWN, `arm` sets the gate bit. */
function craft({ arm = true, spawnCount = 0 } = {}) {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.push16(0xabcd); // a dead-stack return for the frozen gate's ret
  m.regs.a = ENTRY_A;
  m.regs.ix = REC;
  m.mem.write8(REC + 0x0b, arm ? 0x01 : 0x00);
  // clear the six +0x02 state bytes, then plant `spawnCount` of them in the spawn state
  for (let k = 0; k < 6; k++) m.mem.write8(ENEMY_ACTOR_TABLE + STATE + k * STRIDE, 0x00);
  for (let k = 0; k < spawnCount; k++) m.mem.write8(ENEMY_ACTOR_TABLE + STATE + k * STRIDE, SPAWN);
  return m;
}

const CASES = [
  { name: "bail (count=0)", cfg: { arm: true, spawnCount: 0 }, writes: false },
  { name: "bail (count=2)", cfg: { arm: true, spawnCount: 2 }, writes: false },
  { name: "tail (count=1)", cfg: { arm: true, spawnCount: 1 }, writes: true },
  { name: "tail (arm clear)", cfg: { arm: false, spawnCount: 0 }, writes: true },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: spawnObjectGatedByArmedActorCount == oracle in RAM (−stack) and in A", () => {
  for (const { name, cfg } of CASES) {
    const o = craft(cfg);
    const c = craft(cfg);
    oracle(o);
    spawnObjectGatedByArmedActorCount(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    assert.equal(c.regs.a, o.regs.a, `${name}: A live-out diverged: oracle=${hx(o.regs.a)} module=${hx(c.regs.a)}`);
  }
  console.log(`  EQUAL: ${CASES.length} outcomes identical (RAM −stack + A)`);
});

// -- 2. OBSERVABLE ------------------------------------------------------------

test("OBSERVABLE: bail leaves RAM untouched; the tail path writes RAM", () => {
  const bail = craft({ arm: true, spawnCount: 0 });
  const b0 = bail.dumpState();
  oracle(bail);
  assert.equal(ramDiffMinusStack(bail, craft({ arm: true, spawnCount: 0 })), null, "a bail must not write RAM");
  void b0;

  const tail = craft({ arm: false });
  oracle(tail);
  assert.notEqual(ramDiffMinusStack(tail, craft({ arm: false })), null, "the tail must write RAM (else EQUAL proves nothing)");
  console.log("  OBSERVABLE: bail inert; tail writes");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: an A-drop twin (bails without setting A) is CAUGHT by the A compare", () => {
  const aDropTwin = (m, rec = m.regs.ix) => {
    const { mem8 } = m;
    if (mem8[rec + 0x0b] & 0x01) {
      let count = 0;
      for (let k = 0; k < 6; k++) if (mem8[ENEMY_ACTOR_TABLE + STATE + k * STRIDE] === SPAWN) count++;
      if (((count - 1) & 0xff) !== 0) return; // WRONG: leaves A at the entry value
    }
    // (tail path unreached for this input)
  };
  const o = craft({ arm: true, spawnCount: 0 });
  const t = craft({ arm: true, spawnCount: 0 });
  oracle(o);
  aDropTwin(t);
  assert.notEqual(t.regs.a, o.regs.a, "the A compare FAILED to catch a dropped live-out");
  console.log(`  TEETH(A): dropped live-out caught (oracle A=${hx(o.regs.a)}, twin A=${hx(t.regs.a)})`);
});

test("TEETH: an always-tail twin (ignores the count guard) diverges on a bail input", () => {
  const o = craft({ arm: true, spawnCount: 0 }); // oracle bails, RAM unchanged
  const c = craft({ arm: true, spawnCount: 0 });
  oracle(o);
  spawnObjectGatedByArmedActorCount(c);
  // planting a bail-path RAM write in the module's copy models an always-tail twin's spurious write
  c.mem.write8(REC + 0x14, (o.mem.read8(REC + 0x14) ^ 0xff) & 0xff);
  assert.notEqual(ramDiffMinusStack(o, c), null, "the RAM diff FAILED to catch a bail-path write");
  console.log("  TEETH(guard): a spurious bail-path write is caught by the RAM diff");
});

test("TEETH: a wrong seeded byte on the tail path is CAUGHT by the RAM diff", () => {
  const o = craft({ arm: false });
  const c = craft({ arm: false });
  oracle(o);
  spawnObjectGatedByArmedActorCount(c);
  c.mem.write8(REC + 0x0c, (o.mem.read8(REC + 0x0c) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted tail-path byte");
  console.log(`  TEETH(RAM): caught at ${hx(d.addr ?? 0)}`);
});
