// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for descendEnemyActorAndSeatSpawnSlot (ROM 0x672a) — object descent step. Runs the animation
 * sequencer (advanceObjectAnimationFrame), advances the record's 16-bit sub-position (rec+5 low, rec+6 high) by the
 * step rec+9, and while the high byte is below the landing row (0x18) scans three spawn-object slots
 * (SPAWN_OBJECT_TABLE, stride 0x18) for a free one whose row matches: on a hit it bumps
 * WAVE_ARRIVAL_COUNTER, marks the slot active (2), seats a biased X (rec+3 − 0x80) and Y (rec+5 +
 * 0x40) with borrow/carry into the high bytes, stamps an init byte 0xc0, links the slot back into
 * rec+7/8, and arms SHARED_FRAME_DELAY_TIMER=0x20; finding none it returns without advancing. Either arm then
 * bumps rec+2, reloads rec+9=0x18, and re-arms the record's animation to table 0x3838.
 *
 * CYCLE-FREE / memory-equivalence gate. The routine WRITES RAM, so every case uses a FRESH clone per
 * side. Contract: RAM (dumpState minus stack scratch below the entry SP) ONLY — advanceObjectAnimationFrame/setActorAnimation are
 * memory-only and the per-frame dispatcher reads no result register. pc/SP/cycles are NOT compared.
 *
 * The record is based at IX; every case is CRAFTED. rec+0x0e is seated non-zero so advanceObjectAnimationFrame just
 * decrements it, keeping the sequencer deterministic; the position bytes, step, state, X source, and
 * the three slots' active/row fields are seated identically on both sides, with the record + slots +
 * counters pre-dirtied so each write is visible.
 *
 * Jobs:
 *   1. EQUAL — skip-scan, no-free-slot (early return), a plain seat, a seat with X-borrow + Y-carry,
 *      and a position-carry that increments the row before the match; oracle == descendEnemyActorAndSeatSpawnSlot in RAM (−stack).
 *   2. WRITE-SET — the plain-seat case writes the exact slot fields, the back-link, the counters, and
 *      the merge (state++, step=0x18, anim->0x3838).
 *   3. TEETH — a twin that clears the seated slot's active marker MUST be caught; a twin that leaves
 *      the seat timer wrong MUST be caught.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-672a.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_672a as oracle } from "../../translated/loc_672a.js";
import { descendEnemyActorAndSeatSpawnSlot } from "../descendEnemyActorAndSeatSpawnSlot.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, SPAWN_OBJECT_TABLE, WAVE_ARRIVAL_COUNTER, SHARED_FRAME_DELAY_TIMER } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = 0x8b00;        // work-RAM record base (IX); disjoint from SPAWN_OBJECT_TABLE (0x8c48)
const REC_LEN = 0x18;
const SLOT_STRIDE = 0x18;
const ANIM_3838 = 0x38;    // 0x3838 low == high
const WAVE_SEED = 0x02;    // pre-seat arrival counter
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const slotBase = (i) => SPAWN_OBJECT_TABLE + i * SLOT_STRIDE;

const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);

function ramDiffMinusStack(ma, mb) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** A fresh clone: record + 3 slots + counters pre-dirtied, control fields + slots seated, IX=REC. */
function craft(scn) {
  const m = BASE.clone();
  for (let i = 0; i < REC_LEN; i++) m.mem.write8(REC + i, 0xaa);
  for (let s = 0; s < 3; s++) for (let i = 0; i < SLOT_STRIDE; i++) m.mem.write8(slotBase(s) + i, 0xaa);
  m.mem.write8(WAVE_ARRIVAL_COUNTER, WAVE_SEED);
  m.mem.write8(SHARED_FRAME_DELAY_TIMER, 0xaa);

  m.mem.write8(REC + 0x0e, 0x03); // non-zero: advanceObjectAnimationFrame just decrements this frame
  m.mem.write8(REC + 5, scn.posLo);
  m.mem.write8(REC + 6, scn.posHi);
  m.mem.write8(REC + 9, scn.step);
  m.mem.write8(REC + 2, scn.state);
  m.mem.write8(REC + 3, scn.xsrc);

  for (let s = 0; s < 3; s++) {
    m.mem.write8(slotBase(s) + 1, scn.slots[s].active);
    m.mem.write8(slotBase(s) + 6, scn.slots[s].row);
  }
  m.regs.ix = REC;
  m.regs.sp = 0x8ffe; // dead-stack scratch
  return m;
}

const BUSY = { active: 0x01, row: 0x00 };
const FREE5 = { active: 0x00, row: 0x05 };

const CASES = [
  { name: "skip-scan", posLo: 0x00, posHi: 0x20, step: 0x00, state: 0x04, xsrc: 0x90,
    slots: [BUSY, BUSY, BUSY] },
  { name: "no-free-slot", posLo: 0x00, posHi: 0x05, step: 0x00, state: 0x04, xsrc: 0x90,
    slots: [BUSY, BUSY, BUSY] },
  { name: "seat-simple", posLo: 0x10, posHi: 0x05, step: 0x00, state: 0x04, xsrc: 0x90,
    slots: [FREE5, BUSY, BUSY] },
  { name: "seat-borrow-carry", posLo: 0xf0, posHi: 0x05, step: 0x00, state: 0x04, xsrc: 0x10,
    slots: [FREE5, BUSY, BUSY] },
  { name: "pos-carry-then-seat", posLo: 0xff, posHi: 0x04, step: 0x02, state: 0x04, xsrc: 0x90,
    slots: [FREE5, BUSY, BUSY] },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: skip/no-slot/seat/borrow-carry/pos-carry — descendEnemyActorAndSeatSpawnSlot == oracle in RAM (−stack)", () => {
  for (const scn of CASES) {
    const o = craft(scn);
    const c = craft(scn);
    oracle(o);
    descendEnemyActorAndSeatSpawnSlot(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${scn.name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted cases identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the plain-seat case writes the slot, back-link, counters, and merge", () => {
  const scn = CASES[2]; // seat-simple: xsrc=0x90 -> X=0x10 (no borrow), Y=0x50 (no carry)
  const c = craft(scn);
  descendEnemyActorAndSeatSpawnSlot(c);
  const s0 = slotBase(0);

  assert.equal(c.mem.read8(WAVE_ARRIVAL_COUNTER), (WAVE_SEED + 1) & 0xff, "arrival counter bumped");
  assert.equal(c.mem.read8(s0 + 1), 0x02, "seated slot marked active (2)");
  assert.equal(c.mem.read8(s0 + 3), 0x10, "seated X low = rec+3 − 0x80");
  assert.equal(c.mem.read8(s0 + 4), 0xaa, "seated X high unchanged (no borrow)");
  assert.equal(c.mem.read8(s0 + 5), 0x50, "seated Y low = rec+5 + 0x40");
  assert.equal(c.mem.read8(s0 + 6), 0x05, "seated Y high unchanged (no carry)");
  assert.equal(c.mem.read8(s0 + 0x0f), 0xc0, "init byte stamped 0xc0");
  assert.equal(c.mem.read8(REC + 7), s0 & 0xff, "back-link low = slot base low");
  assert.equal(c.mem.read8(REC + 8), (s0 >> 8) & 0xff, "back-link high = slot base high");
  assert.equal(c.mem.read8(SHARED_FRAME_DELAY_TIMER), 0x20, "seat timer armed to 0x20");
  assert.equal(c.mem.read8(REC + 2), (scn.state + 1) & 0xff, "state bumped");
  assert.equal(c.mem.read8(REC + 9), 0x18, "step reloaded to the row height");
  assert.equal(c.mem.read8(REC + 0x0c), ANIM_3838, "anim pointer low -> 0x3838");
  assert.equal(c.mem.read8(REC + 0x0d), ANIM_3838, "anim pointer high -> 0x3838");
  assert.equal(c.mem.read8(REC + 0x0e), 0x00, "anim frame index reset by the re-arm");
  console.log(`  WRITE-SET: slot0 seated (X=0x10,Y=0x50), back-link ${hx(s0)}, timer=0x20, state->${hx(scn.state + 1)}, anim->0x3838`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a cleared seat active-marker is CAUGHT by the RAM diff", () => {
  const scn = CASES[2];
  const o = craft(scn);
  const c = craft(scn);
  oracle(o);
  descendEnemyActorAndSeatSpawnSlot(c);
  const s0 = slotBase(0);
  c.mem.write8(s0 + 1, 0x00); // BUG: seated slot must be marked active (2)

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a cleared active marker — it is worthless");
  assert.equal(d.addr, s0 + 1, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(s0 + 1)})`);
  console.log(`  TEETH/RAM: cleared active marker caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong seat timer is CAUGHT by the RAM diff", () => {
  const scn = CASES[2];
  const o = craft(scn);
  const c = craft(scn);
  oracle(o);
  descendEnemyActorAndSeatSpawnSlot(c);
  c.mem.write8(SHARED_FRAME_DELAY_TIMER, 0x00); // BUG: seat must arm the timer to 0x20

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong seat timer — it is worthless");
  assert.equal(d.addr, SHARED_FRAME_DELAY_TIMER, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong seat timer caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
