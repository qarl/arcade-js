// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for resetBoardRamAndReseedSpawnCounters (ROM 0x2527) — board/HUD reset. Enqueues one display
 * command (opcode 0x08, low byte from the incoming E) via rst 0x38; when SPAWN_PHASE_COUNTER has
 * reached its cap (>= 7) it reseeds that counter and ROPE_DRAW_COUNT to 4 and fills the formation
 * slot table with TAMPER_OBJECT_FREEZE_FLAG; it then fills three more RAM blocks with that value and
 * mirrors it into five actor/HUD cells. The fill value is 0 unless the reseed branch ran.
 *
 * CYCLE-FREE / memory-equivalence gate. The routine WRITES RAM, so every case uses a FRESH clone
 * per side. Contract: RAM (dumpState minus stack scratch below the entry SP) PLUS the register live-out — A (the fill
 * value), HL (0x8d33, the last rst-0x10 fill's advanced pointer) and B (0, the drained djnz). E is
 * an INPUT (the display command's low byte) and is seated identically on both sides. pc/SP/cycles
 * are NOT compared.
 *
 * The leaf is reached only from live board-reset paths, so every case is CRAFTED: the branch
 * selector (SPAWN_PHASE_COUNTER), the freeze flag, the command low byte (E), and the display-ring
 * write pointer are poked identically on both sides, with the fill regions + target cells pre-dirtied
 * to 0xAA so an overwrite is observable.
 *
 * Jobs:
 *   1. EQUAL — over both branches (skip vs reseed) and both fill values (0 vs a non-zero freeze
 *      flag) oracle == resetBoardRamAndReseedSpawnCounters in RAM (−stack) AND in A/HL/B; the module must SET A on its clone.
 *   2. WRITE-SET — on the reseed + ring-free case, the reseed cells, the four fill blocks, the five
 *      mirror cells, and the two enqueued ring bytes + advanced pointer hold their exact values.
 *   3. TEETH — a twin that leaves one mirror cell wrong MUST be caught by the RAM diff; a twin that
 *      returns a WRONG A MUST be caught by the live-out check.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-2527.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2527 as oracle } from "../../translated/loc_2527.js";
import { resetBoardRamAndReseedSpawnCounters } from "../resetBoardRamAndReseedSpawnCounters.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  SPAWN_PHASE_COUNTER,
  ROPE_DRAW_COUNT,
  FORMATION_SLOT_TABLE,
  TAMPER_OBJECT_FREEZE_FLAG,
  ANIM_SCRIPT_CURSOR,
  SECONDARY_TEARDOWN_FLAG,
  FORMATION_SPAWN_TIMER,
  LEAD_ACTOR_STATE,
  ENEMY_TARGET_REC0,
  ENEMY_TARGET_REC1,
  HIT_TALLY,
  ANIM_ARMED_LATCH,
  DISPLAY_CMD_RING_WRITE_PTR,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const RING_PAGE = 0x8800;         // the display-command ring shares the pointer cell's page
const HL_END = 0x8d33;            // FORMATION_SPAWN_TIMER + 3, the last fill's advanced pointer
const MIRROR_CELLS = [LEAD_ACTOR_STATE, ENEMY_TARGET_REC0, ENEMY_TARGET_REC1, HIT_TALLY, ANIM_ARMED_LATCH];
const FILL_BLOCKS = [
  [FORMATION_SLOT_TABLE, 0x20],
  [ANIM_SCRIPT_CURSOR, 0x4f],
  [SECONDARY_TEARDOWN_FLAG, 0x04],
  [FORMATION_SPAWN_TIMER, 0x03],
];
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);

function ramDiffMinusStack(ma, mb) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** A fresh clone: inputs seated, fill regions + target cells pre-dirtied to 0xAA, ring set. */
function craft(scn) {
  const m = BASE.clone();

  // Pre-dirty every region the routine may write, so an overwrite (or its absence) is visible.
  for (const [base, len] of FILL_BLOCKS) for (let i = 0; i < len; i++) m.mem.write8(base + i, 0xaa);
  for (const cell of MIRROR_CELLS) m.mem.write8(cell, 0xaa);
  m.mem.write8(ROPE_DRAW_COUNT, 0xaa);

  m.mem.write8(SPAWN_PHASE_COUNTER, scn.phase);
  m.mem.write8(TAMPER_OBJECT_FREEZE_FLAG, scn.freeze);
  m.regs.e = scn.e; // INPUT: the display command's low byte

  m.mem.write8(DISPLAY_CMD_RING_WRITE_PTR, scn.ringPtr);
  const slot = RING_PAGE + scn.ringPtr;
  m.mem.write8(slot, scn.ringFree ? 0x80 : 0x00); // bit7 set => slot free to write
  m.mem.write8(RING_PAGE + ((scn.ringPtr + 1) & 0xff), 0xaa);

  m.regs.sp = 0x8ffe; // dead-stack scratch; the oracle's rst helpers only POP what they PUSH
  return m;
}

const CASES = [
  { name: "skip/ring-free", phase: 0x03, freeze: 0x55, e: 0x5a, ringPtr: 0xc0, ringFree: true, fill: 0x00 },
  { name: "reseed/ring-occupied", phase: 0x07, freeze: 0x00, e: 0x00, ringPtr: 0x00, ringFree: false, fill: 0x00 },
  { name: "reseed/nonzero-fill", phase: 0x07, freeze: 0x99, e: 0x33, ringPtr: 0xc0, ringFree: true, fill: 0x99 },
  { name: "reseed/phase>cap", phase: 0x08, freeze: 0x00, e: 0x00, ringPtr: 0x00, ringFree: false, fill: 0x00 },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted branch/fill cases — resetBoardRamAndReseedSpawnCounters == oracle in RAM (−stack) + A/HL/B", () => {
  for (const scn of CASES) {
    const o = craft(scn);
    const c = craft(scn);
    oracle(o);
    const ret = resetBoardRamAndReseedSpawnCounters(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${scn.name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    assert.equal(ret & 0xff, o.regs.a & 0xff, `${scn.name}: A live-out mismatch (ret)`);
    assert.equal(c.regs.a & 0xff, o.regs.a & 0xff, `${scn.name}: module must SET A (fill value) for the caller`);
    assert.equal(c.regs.hl & 0xffff, o.regs.hl & 0xffff, `${scn.name}: HL live-out (advanced fill pointer) mismatch`);
    assert.equal(c.regs.b & 0xff, o.regs.b & 0xff, `${scn.name}: B live-out (drained djnz) mismatch`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted cases identical (RAM −stack + A/HL/B)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: reseed + ring-free case writes the exact footprint", () => {
  const scn = CASES[2]; // reseed, fill=0x99, ring free at 0xc0
  const c = craft(scn);
  resetBoardRamAndReseedSpawnCounters(c);

  assert.equal(c.mem.read8(SPAWN_PHASE_COUNTER), 0x04, "phase counter reseeded to 4");
  // ROPE_DRAW_COUNT (0x8934) sits INSIDE the formation-slot fill [0x8920,0x8940): the reseed-to-4
  // is immediately overwritten by that fill, so its final value is the fill value (matches oracle).
  assert.equal(c.mem.read8(ROPE_DRAW_COUNT), scn.fill, "rope-draw count overwritten by the formation-slot fill");
  for (const [base, len] of FILL_BLOCKS) {
    for (let i = 0; i < len; i++) {
      assert.equal(c.mem.read8(base + i), scn.fill, `fill block ${hx(base)}+${i} := ${hx(scn.fill)}`);
    }
  }
  for (const cell of MIRROR_CELLS) assert.equal(c.mem.read8(cell), scn.fill, `mirror cell ${hx(cell)} := ${hx(scn.fill)}`);
  assert.equal(c.mem.read8(RING_PAGE + 0xc0), 0x08, "ring slot 0x88c0 holds the command opcode 0x08");
  assert.equal(c.mem.read8(RING_PAGE + 0xc1), scn.e, "ring slot 0x88c1 holds the command low byte (E)");
  assert.equal(c.mem.read8(DISPLAY_CMD_RING_WRITE_PTR), 0xc2, "ring write pointer advanced by 2");
  assert.equal(c.regs.hl & 0xffff, HL_END, "HL left at the last fill's advanced pointer");
  console.log(`  WRITE-SET: reseed=4/4, 4 fill blocks + 5 mirror cells := ${hx(scn.fill)}, ring (0x08,${hx(scn.e)})->0xc2`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong mirror cell is CAUGHT by the RAM diff", () => {
  const scn = CASES[2];
  const o = craft(scn);
  const c = craft(scn);
  oracle(o);
  resetBoardRamAndReseedSpawnCounters(c);
  c.mem.write8(HIT_TALLY, (scn.fill ^ 0x01) & 0xff); // BUG: wrong value in a mirror cell

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong mirror cell — it is worthless");
  assert.equal(d.addr, HIT_TALLY, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(HIT_TALLY)})`);
  console.log(`  TEETH/RAM: wrong mirror cell caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong returned A is CAUGHT by the live-out check", () => {
  const scn = CASES[2]; // fill = 0x99
  const o = craft(scn);
  const c = craft(scn);
  oracle(o);
  const ret = resetBoardRamAndReseedSpawnCounters(c);
  assert.equal(ret & 0xff, o.regs.a & 0xff, "sanity: the module's A matches the oracle");
  assert.notEqual((scn.fill ^ 0x01) & 0xff, o.regs.a & 0xff, "the live-out check must reject a corrupted fill value");
  console.log(`  TEETH/A: module A ${hx(ret)} == oracle fill ${hx(scn.fill)}`);
});
