// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for advanceEagleToArrivalAndTallyWave (ROM 0x733c, Pooyan) — "eagle approach state" for the
 * record based at IX. It matches the eagle's grid column (EAGLE_X 0x8c96 >> 3, against IX+6 or
 * IX+6-1) and row (EAGLE_Y 0x8c94 >> 3 + 4, within a 5-row window of IX+4). On a hit it bumps
 * the record state (IX+2) and arms an animation (setActorAnimation): odd records (bit 3 of IXL)
 * get anim 0x7403 and IX+9 := 0x38; even records get anim 0x4086 and IX+9 := 0x40, bump
 * WAVE_RECORDS_ARRIVED (0x8f39), and once it equals WAVE_INDEX (0x8f3d) enqueue the wave-arrival
 * display command (0x0630 + arrived) via enqueueDisplayCommand.
 *
 * Cycle-free memory-equivalence gate: a fresh clone per side, compared on RAM (dumpState, minus
 * stack scratch below the entry SP). No register/flag live-out is declared: advanceEagleToArrivalAndTallyWave has no direct m.call caller (it
 * is reached by per-record state-table dispatch), so no consuming site is visible on the frozen
 * layer; its exit A/flags are treated as scratch. See the batch notes.
 *
 * Jobs:
 *   1. EQUAL (crafted) — no column match; no row match; even hit (wave incomplete); even hit
 *      (wave complete -> enqueue); odd hit: oracle == module in RAM (−stack).
 *   2. WRITE-SET — the even-hit-incomplete path writes exactly IX+2, IX+9, the three anim-field
 *      bytes (IX+0x0c..0x0e), and WAVE_RECORDS_ARRIVED.
 *   3. ENQUEUE — the wave-complete path lands command 0x0633 in the display ring (high byte,
 *      low byte, advanced pointer), documenting the DE computation.
 *   4. TEETH — a wrong IX+9 flag byte and a wrong anim-pointer byte are each CAUGHT by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-733c.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_733c as oracle } from "../../translated/loc_733c.js";
import { advanceEagleToArrivalAndTallyWave } from "../advanceEagleToArrivalAndTallyWave.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const EAGLE_X = 0x8c96;
const EAGLE_Y = 0x8c94;
const WAVE_RECORDS_ARRIVED = 0x8f39;
const WAVE_INDEX = 0x8f3d;
const RING_PTR = 0x88a0;
const RING_PAGE = 0x8800;
const ANIM_EVEN = 0x4086;
const ANIM_ODD = 0x7403;
const CMD_BASE = 0x0630;
const REC_EVEN = 0x8b00; // IXL bit3 clear -> even record
const REC_ODD = 0x8b28; //  IXL bit3 set   -> odd record

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** A fresh clone with the eagle coordinates, the record fields, and the wave counters seated. */
function craft(cfg) {
  const m = BASE.clone();
  const ix = cfg.ix;
  m.regs.ix = ix;
  m.mem.write8(EAGLE_X, cfg.eagleX);
  m.mem.write8(EAGLE_Y, cfg.eagleY);
  m.mem.write8(ix + 0x06, cfg.targetCol);
  m.mem.write8(ix + 0x04, cfg.targetRow);
  m.mem.write8(ix + 0x02, 0x02); // phase, so a bump to 0x03 is observable
  m.mem.write8(ix + 0x09, 0x00); // flag byte, so a store of 0x38/0x40 is observable
  m.mem.write8(ix + 0x0c, 0x00); // anim ptr low
  m.mem.write8(ix + 0x0d, 0x00); // anim ptr high
  m.mem.write8(ix + 0x0e, 0x77); // frame index, so a clear to 0 is observable
  m.mem.write8(WAVE_RECORDS_ARRIVED, cfg.arrived);
  m.mem.write8(WAVE_INDEX, cfg.waveIndex);
  if (cfg.ring) {
    m.mem.write8(RING_PTR, cfg.ring.ptr);
    m.mem.write8(RING_PAGE | cfg.ring.ptr, 0x80); //     free slot (bit 7 set)
    m.mem.write8(RING_PAGE | (cfg.ring.ptr + 1), 0xaa); // next slot pre-dirtied
  }
  m.regs.sp = 0x8ffe; // the sub-call push/ret lands inside STACK_SCRATCH
  return m;
}

// Eagle at column 8 (0x40>>3) and row 0x0c (0x40>>3 + 4); targets chosen per case.
const HIT = { eagleX: 0x40, eagleY: 0x40, targetCol: 0x08, targetRow: 0x0c };

const CASES = [
  { name: "no column match", ix: REC_EVEN, ...HIT, targetCol: 0x0a, arrived: 0x02, waveIndex: 0x05 },
  { name: "no row match", ix: REC_EVEN, ...HIT, targetRow: 0x02, arrived: 0x02, waveIndex: 0x05 },
  { name: "even hit, wave incomplete", ix: REC_EVEN, ...HIT, arrived: 0x02, waveIndex: 0x05 },
  { name: "even hit, wave complete (enqueue)", ix: REC_EVEN, ...HIT, arrived: 0x02, waveIndex: 0x03, ring: { ptr: 0xc0 } },
  { name: "odd hit", ix: REC_ODD, ...HIT, arrived: 0x02, waveIndex: 0x05 },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted approach cases — advanceEagleToArrivalAndTallyWave == oracle in RAM (−stack)", () => {
  for (const cfg of CASES) {
    const o = craft(cfg);
    const c = craft(cfg);
    oracle(o);
    advanceEagleToArrivalAndTallyWave(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${cfg.name}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted cases identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the even-hit-incomplete path writes state, flag, anim fields, and arrived", () => {
  const cfg = CASES[2];
  const ix = cfg.ix;
  const footprint = new Set([ix + 0x02, ix + 0x09, ix + 0x0c, ix + 0x0d, ix + 0x0e, WAVE_RECORDS_ARRIVED]);

  const m = craft(cfg);
  const b0 = m.dumpState();
  oracle(m);
  const a1 = m.dumpState();

  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) {
      const addr = m.stateOffsetToAddr(off);
      if (inDeadStack(addr)) continue; // sub-call push/ret scratch, not game state
      changed.push(addr);
    }
  }
  assert.equal(changed.length, 6, `expected 6 writes, got ${changed.length}`);
  for (const addr of changed) assert.ok(footprint.has(addr), `unexpected write at ${hx(addr)}`);
  assert.equal(m.mem.read8(ix + 0x02), 0x03, "record state bumped");
  assert.equal(m.mem.read8(ix + 0x09), 0x40, "even flag byte := 0x40");
  assert.equal(m.mem.read8(ix + 0x0c), ANIM_EVEN & 0xff, "anim ptr low");
  assert.equal(m.mem.read8(ix + 0x0d), ANIM_EVEN >> 8, "anim ptr high");
  assert.equal(m.mem.read8(ix + 0x0e), 0x00, "frame index reset");
  assert.equal(m.mem.read8(WAVE_RECORDS_ARRIVED), (cfg.arrived + 1) & 0xff, "arrived count bumped");
  console.log("  WRITE-SET: state/flag/anim(3)/arrived (6 cells)");
});

// -- 3. ENQUEUE ---------------------------------------------------------------

test("ENQUEUE: the wave-complete path lands command 0x0633 in the display ring", () => {
  const cfg = CASES[3];
  const o = craft(cfg);
  const c = craft(cfg);
  oracle(o);
  advanceEagleToArrivalAndTallyWave(c);

  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  const cmd = CMD_BASE + ((cfg.arrived + 1) & 0xff); // 0x0630 + 3 = 0x0633
  assert.equal(c.mem.read8(RING_PAGE | cfg.ring.ptr), cmd >> 8, "ring high byte := 0x06");
  assert.equal(c.mem.read8(RING_PAGE | (cfg.ring.ptr + 1)), cmd & 0xff, "ring low byte := 0x33");
  assert.equal(c.mem.read8(RING_PTR), (cfg.ring.ptr + 2) & 0xff, "ring write pointer advanced by 2");
  console.log(`  ENQUEUE: command ${hx(cmd)} written to the ring, pointer -> ${hx((cfg.ring.ptr + 2) & 0xff)}`);
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: a wrong flag byte (IX+9) is CAUGHT by the RAM diff", () => {
  const cfg = CASES[4]; // odd hit -> IX+9 := 0x38
  const ix = cfg.ix;
  const o = craft(cfg);
  const c = craft(cfg);
  oracle(o);
  advanceEagleToArrivalAndTallyWave(c);
  c.mem.write8(ix + 0x09, 0x40); // BUG: an odd record's flag byte must be 0x38, not 0x40
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong flag byte — it is worthless");
  assert.equal(d.addr, ix + 0x09, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(flag): caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong anim-pointer byte is CAUGHT by the RAM diff", () => {
  const cfg = CASES[2]; // even hit -> anim ptr low := 0x86
  const ix = cfg.ix;
  const o = craft(cfg);
  const c = craft(cfg);
  oracle(o);
  advanceEagleToArrivalAndTallyWave(c);
  c.mem.write8(ix + 0x0c, 0x03); // BUG: even record's anim low byte must be 0x86, not 0x03
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong anim-pointer byte — it is worthless");
  assert.equal(d.addr, ix + 0x0c, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(anim): caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
