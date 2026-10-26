// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for spawnHunterIntoTableAndAdvanceLaunch (ROM 0x2856) — "launch state 2: seed a hunter, advance state".
 *
 * The cycle-free / memory-equivalence gate: oracle and module run on fresh clones and are
 * compared on RAM (dumpState, minus stack scratch below the entry SP). pc/SP/cycles are not compared.
 *
 * LIVE-OUT: memory only — a dispatched state handler whose scratch registers (A/B/DE/HL/IX)
 * no caller reads.
 *
 * The leaf is not reached in a plain boot/attract, so every case is CRAFTED: the play-mode
 * latch, the flip flag, the launch state, the six hunter records (cleared, with occupancy
 * poked), and the display ring are seated identically on both clones.
 *
 * Jobs:
 *   1. EQUAL — over crafted states (skip-spawn, seed-first-slot, seed-second-slot, no-free-slot,
 *      flip set/clear) oracle == spawnHunterIntoTableAndAdvanceLaunch in RAM (−stack).
 *   2. WRITE-SET — seeding a free slot writes the record's fixed opening bytes, the recorded
 *      pointer, the bumped launch state, the seeded countdown, and the enqueued command.
 *   3. TEETH — a wrong seeded record byte is caught by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-2856.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2856 as oracle } from "../../translated/loc_2856.js";
import { spawnHunterIntoTableAndAdvanceLaunch } from "../spawnHunterIntoTableAndAdvanceLaunch.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  PLAY_MODE_LATCH,
  HUNTER_TABLE_BASE,
  HUNTER_RECORD_PTR,
  LAUNCH_STATE,
  HUNTER_SPAWN_FLIP_FLAG,
  HUNTER_SPAWN_COUNTDOWN,
  HUNTER_SPAWN_SUBCOUNTER,
  DISPLAY_CMD_RING_WRITE_PTR,
} from "../names.js";

const STRIDE = 0x18;
const SLOTS = 6;
const RING_PAGE = DISPLAY_CMD_RING_WRITE_PTR & 0xff00;
const FREE_SLOT_LOW = 0xc0;
const recBase = (n) => (HUNTER_TABLE_BASE - n * STRIDE) & 0xffff;
const SEED = { 0x01: 0x05, 0x02: 0x10, 0x03: 0x00, 0x04: 0x08, 0x05: 0x00, 0x06: 0x1a, 0x0f: 0x37, 0x10: 0x42 };

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);
function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function craft({ playMode = 0, flip = 0, launchState = 0, occupied = [], countdown = 0, subcounter = 0 }) {
  const m = BASE.clone();
  m.regs.sp = 0x8ffe;
  m.mem8[PLAY_MODE_LATCH] = playMode;
  m.mem8[HUNTER_SPAWN_FLIP_FLAG] = flip;
  m.mem8[LAUNCH_STATE] = launchState;
  m.mem8[HUNTER_SPAWN_COUNTDOWN] = countdown;
  m.mem8[HUNTER_SPAWN_SUBCOUNTER] = subcounter;
  m.mem8[HUNTER_RECORD_PTR] = 0;
  m.mem8[HUNTER_RECORD_PTR + 1] = 0;
  for (let n = 0; n < SLOTS; n++) for (let k = 0; k < STRIDE; k++) m.mem8[recBase(n) + k] = 0; // clear records
  for (const n of occupied) m.mem8[recBase(n)] = 0x01; // mark occupied (leading byte nonzero)
  m.mem8[DISPLAY_CMD_RING_WRITE_PTR] = FREE_SLOT_LOW;
  m.mem8[RING_PAGE + FREE_SLOT_LOW] = 0x80; // free ring slot for the enqueue path
  return m;
}

const CASES = [
  { name: "play-mode set, flip clear (skip spawn, enqueue)", cfg: { playMode: 1, flip: 0, launchState: 3 } },
  { name: "play-mode set, flip set (skip spawn, bump subcounter)", cfg: { playMode: 1, flip: 1, launchState: 3, subcounter: 7 } },
  { name: "seed first slot", cfg: { playMode: 0, flip: 0, occupied: [] } },
  { name: "seed second slot", cfg: { playMode: 0, flip: 0, occupied: [0] } },
  { name: "no free slot -> no-op", cfg: { playMode: 0, occupied: [0, 1, 2, 3, 4, 5] } },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted states — spawnHunterIntoTableAndAdvanceLaunch == oracle in RAM (−stack)", () => {
  for (const { name, cfg } of CASES) {
    const o = craft(cfg);
    const c = craft(cfg);
    oracle(o);
    spawnHunterIntoTableAndAdvanceLaunch(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} mod=${d.b} (${name})`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted cases identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: seeding a free slot writes the record + ptr + state + countdown + command", () => {
  const cfg = { playMode: 0, flip: 0, occupied: [] };
  const before = craft(cfg);
  const after = craft(cfg);
  const b = before.dumpState();
  oracle(after);
  const a = after.dumpState();

  const rec = recBase(0); // 0x8c78, the first free slot
  const changed = new Set();
  for (let off = 0; off < b.length; off++) {
    if (b[off] === a[off]) continue;
    const addr = after.stateOffsetToAddr(off);
    if (inDeadStack(addr)) continue; // exclude the oracle's own push/pop scratch (matches EQUAL's ramDiffMinusStack)
    changed.add(addr);
  }
  const expected = new Set([
    ...Object.keys(SEED).map((k) => rec + Number(k)),
    HUNTER_RECORD_PTR, HUNTER_RECORD_PTR + 1, LAUNCH_STATE, HUNTER_SPAWN_COUNTDOWN,
    RING_PAGE + FREE_SLOT_LOW, RING_PAGE + FREE_SLOT_LOW + 1, DISPLAY_CMD_RING_WRITE_PTR,
  ]);
  for (const addr of changed) assert.ok(expected.has(addr), `unexpected write at ${hx(addr)}`);
  for (const [off, val] of Object.entries(SEED)) assert.equal(after.mem8[rec + Number(off)], val, `record+${off} := ${hx(val)}`);
  assert.equal(after.mem8[HUNTER_RECORD_PTR], rec & 0xff, "record ptr low");
  assert.equal(after.mem8[HUNTER_RECORD_PTR + 1], rec >> 8, "record ptr high");
  assert.equal(after.mem8[LAUNCH_STATE], 0x01, "launch state bumped");
  assert.equal(after.mem8[HUNTER_SPAWN_COUNTDOWN], 0x20, "spawn countdown seeded");
  console.log(`  WRITE-SET: rec ${hx(rec)} seeded + ptr/state/countdown/command`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong seeded record byte is CAUGHT by the RAM diff", () => {
  const cfg = { playMode: 0, flip: 0, occupied: [] };
  const o = craft(cfg);
  const c = craft(cfg);
  oracle(o);
  spawnHunterIntoTableAndAdvanceLaunch(c);
  const rec = recBase(0);
  c.mem8[rec + 0x10] = 0x00; // BUG: record+0x10 must be 0x42

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong seeded byte");
  assert.equal(d.addr, rec + 0x10, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong seeded byte caught at ${hx(d.addr)}`);
});
