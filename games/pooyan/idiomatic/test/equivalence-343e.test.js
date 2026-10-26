// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for advanceActorColumnAndArmTurnOrBand (ROM 0x343e) — object X-movement handler for the record at
 * IX. Advances the sub-position (rec+0x05) by the delta (rec+0x09) with a carry into the column
 * (rec+0x06), then compares the masked column against the turn-column limit and branches: below the
 * limit it returns; above it flags rec+0x08 and arms the turn-around animation (setActorAnimation
 * with pointer 0x3838); at the limit it gates on the play sub-state and delta, then either latches
 * rec+0x01 (band already armed) or, on the first arm, bumps the capped phase snapshot, looks up the
 * new turn-column limit (rst-0x20 table 0x3418), stamps the interior sprite band, sets the armed
 * latch, and tails into despawnActorAndRenderStageCountdown.
 *
 * CYCLE-FREE / memory-equivalence gate. The routine WRITES RAM, so every case uses a FRESH clone
 * per side. Contract: RAM (dumpState minus stack scratch below the entry SP) ONLY — every callee is memory-only and
 * moveFormationAndSpawnObject reloads A from memory immediately after the call and reads no other register back, so
 * there is NO register live-out. pc/SP/cycles are NOT compared.
 *
 * The record is based at IX; the leaf runs only during live object updates, so every case is
 * CRAFTED: the record is pre-dirtied to 0xAA and its control fields (rec+0x05/0x06/0x08/0x09) plus
 * the shared cells (turn-column limit, play sub-state, phase snapshot, armed latch) are seated
 * identically on both sides.
 *
 * Jobs:
 *   1. EQUAL — below/at/above the limit, the carry-into-column path, the turn arm, the despawnActorAndRenderStageCountdown
 *      tail, the already-armed latch, and the full band-build path all agree in RAM (−stack).
 *   2. WRITE-SET — the turn-arm path writes exactly rec+0x05, rec+0x08, and the animation triple
 *      rec+0x0c/0x0d/0x0e (points at pointer 0x3838, frame index 0).
 *   3. TEETH — a twin with a wrong sprite-band byte on the build path, and a twin with a wrong
 *      rec+0x08 flag on the arm path, are both CAUGHT by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-343e.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_343e as oracle } from "../../translated/loc_343e.js";
import { advanceActorColumnAndArmTurnOrBand } from "../advanceActorColumnAndArmTurnOrBand.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = 0x8ba0;         // work-RAM record base (IX); disjoint from every shared cell touched
const REC_LEN = 0x18;
const TURN_LIMIT = 0x8d4b;  // TURN_COLUMN_LIMIT
const PLAY_STATE = 0x880a;  // PLAY_STATE_INDEX
const PHASE_SNAP = 0x8d43;  // SPAWN_PHASE_SNAPSHOT
const ARMED = 0x8f63;       // ANIM_ARMED_LATCH
const BAND = 0x86e3;        // SPRITE_BAND_86E3 base (writes at +0,+1,+0x20,+0x21)
const ANIM_38 = 0x3838;     // turn-around animation pointer
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);

function ramDiffMinusStack(ma, mb) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** A fresh clone: record pre-dirtied to 0xAA, control fields + shared cells seated, IX=REC. */
function craft(scn) {
  const m = BASE.clone();
  for (let i = 0; i < REC_LEN; i++) m.mem.write8(REC + i, 0xaa);
  m.mem.write8(REC + 0x05, scn.pos);
  m.mem.write8(REC + 0x06, scn.col);
  m.mem.write8(REC + 0x09, scn.delta);
  m.mem.write8(TURN_LIMIT, scn.limit);
  m.mem.write8(PLAY_STATE, scn.play ?? 0x00);
  m.mem.write8(PHASE_SNAP, scn.phase ?? 0x00);
  m.mem.write8(ARMED, scn.armed ?? 0x00);
  m.regs.ix = REC;
  m.regs.sp = 0x8ffe; // dead-stack scratch (inside STACK_SCRATCH; oracle push/ret excluded)
  return m;
}

const CASES = [
  { name: "below-limit ret",        pos: 0x10, delta: 0x05, col: 0x01, limit: 0x05 },
  { name: "carry-into-column ret",  pos: 0xf0, delta: 0x20, col: 0x01, limit: 0x05 },
  { name: "above-limit turn-arm",   pos: 0x10, delta: 0x05, col: 0x05, limit: 0x02 },
  { name: "at-limit-zero -> tail",  pos: 0x10, delta: 0x05, col: 0x00, limit: 0x00 },
  { name: "at-limit latch (armed)", pos: 0x00, delta: 0x08, col: 0x04, limit: 0x04, play: 0x04, armed: 0x01 },
  { name: "at-limit band build",    pos: 0x00, delta: 0x08, col: 0x04, limit: 0x04, play: 0x04, armed: 0x00, phase: 0x02 },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: all branch paths — advanceActorColumnAndArmTurnOrBand == oracle in RAM (−stack)", () => {
  for (const scn of CASES) {
    const o = craft(scn);
    const c = craft(scn);
    oracle(o);
    advanceActorColumnAndArmTurnOrBand(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${scn.name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted branch cases identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the turn-arm path writes exactly rec+0x05/0x08 + the animation triple", () => {
  const scn = CASES[2]; // above-limit turn arm (no despawnActorAndRenderStageCountdown tail: a clean, enumerable footprint)
  const c = craft(scn);
  const before = c.dumpState();
  advanceActorColumnAndArmTurnOrBand(c);
  const after = c.dumpState();

  const changed = [];
  for (let off = 0; off < before.length; off++) {
    if (before[off] !== after[off]) changed.push(c.stateOffsetToAddr(off));
  }
  const expected = [REC + 0x05, REC + 0x08, REC + 0x0c, REC + 0x0d, REC + 0x0e].sort((a, b) => a - b);
  assert.deepEqual(changed.sort((a, b) => a - b), expected, `unexpected write footprint: ${changed.map(hx)}`);

  assert.equal(c.mem.read8(REC + 0x05), 0x15, "sub-position advanced 0x10 + 0x05");
  assert.equal(c.mem.read8(REC + 0x06), 0x05, "column unchanged (no carry)");
  assert.equal(c.mem.read8(REC + 0x08), 0x01, "turn flag set to 1");
  assert.equal(c.mem.read8(REC + 0x0c), ANIM_38 & 0xff, "anim pointer low = 0x3838");
  assert.equal(c.mem.read8(REC + 0x0d), (ANIM_38 >> 8) & 0xff, "anim pointer high = 0x3838");
  assert.equal(c.mem.read8(REC + 0x0e), 0x00, "anim frame index reset to 0");
  console.log(`  WRITE-SET: turn arm -> rec+0x05=0x15, rec+0x08=1, anim->${hx(ANIM_38)} (5 cells)`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong sprite-band byte on the build path is CAUGHT by the RAM diff", () => {
  const scn = CASES[5]; // full band-build path
  const o = craft(scn);
  const c = craft(scn);
  oracle(o);
  advanceActorColumnAndArmTurnOrBand(c);
  c.mem.write8(BAND + 0x20, 0x00); // BUG: the third band cell must be 0xda, not 0x00

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong sprite-band byte — it is worthless");
  assert.equal(d.addr, BAND + 0x20, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong band byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong turn flag on the arm path is CAUGHT by the RAM diff", () => {
  const scn = CASES[2]; // turn-arm sets rec+0x08 = 1
  const o = craft(scn);
  const c = craft(scn);
  oracle(o);
  advanceActorColumnAndArmTurnOrBand(c);
  c.mem.write8(REC + 0x08, 0x00); // BUG: the arm must flag rec+0x08 = 1

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong turn flag — it is worthless");
  assert.equal(d.addr, REC + 0x08, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong turn flag caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
