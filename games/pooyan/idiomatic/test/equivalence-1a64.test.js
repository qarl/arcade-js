// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for advancePhaseGaugeCountdown (ROM 0x1a64, Pooyan) — gameplay-state entry.
 *
 * SEATING: BALANCED (plain ret / tail-branches) -> WIRE. Void handler: no caller reads a register
 * back, so LIVE-OUT is memory only and the comparison is RAM (dumpState) minus stack scratch below the entry SP;
 * nested sub-routine pushes park in the dead stack (SP in STACK_SCRATCH).
 *
 * Paths crafted: latch-set (tail to reseedSpawnCountersAndArmPlayMode); credit-gate teardown; gauge already-zero and
 * count-to-zero (tail to advancePlayStateThenInsertHighScore); the render path seeding the play sub-state; and the render
 * path with the display-command ring slot freed, so resetBoardRamAndReseedSpawnCounters's dissolved
 * call 0x2527 forwards the E live-in (display-command low byte) through enqueueDisplayCommand into 0x88c1.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-1a64.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1a64 as oracle } from "../../translated/loc_1a64.js";
import { advancePhaseGaugeCountdown } from "../advancePhaseGaugeCountdown.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  PLAY_MODE_LATCH,
  GAME_ACTIVE_FLAG,
  GAUGE_PHASE_COUNTER,
  ACTIVE_PLAYER,
  ROUND_COUNTER,
  PLAY_STATE_INDEX,
  DISPLAY_CMD_RING_WRITE_PTR,
  DISPLAY_CMD_RING_BUFFER,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const SP0 = 0x8ff0;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

// Display-command ring: enqueueDisplayCommand reads the write-ptr low byte (0x88a0), indexes the page-0x88 ring,
// and enqueues only when the pointed slot's bit 7 is set (free). Seeding the ptr to its start (0xc0)
// and freeing slot 0x88c0 makes the dissolved 0x2527 call actually enqueue D=0x08 / E=cmdLow.
const RING_START = 0xc0; //     write-ptr low byte at the ring start
const SLOT_FREE = 0x80; //      bit 7 set => slot free to write

/** Seat SP/interrupt/E state and the branch-selecting cells. `freeRing` opens the display-ring slot
 *  so the E live-in (display-command low byte) is forwarded rather than dropped. */
function seat(
  m,
  { latch = 0x00, active = 0x01, gauge = 0x02, player = 0x00, round = 0x00, e = 0x00, freeRing = false } = {},
) {
  m.regs.sp = SP0;
  m.regs.i = 0x00;
  m.regs.iff2 = false;
  m.regs.e = e;
  m.mem.write8(PLAY_MODE_LATCH, latch);
  m.mem.write8(GAME_ACTIVE_FLAG, active);
  m.mem.write8(GAUGE_PHASE_COUNTER, gauge);
  m.mem.write8(ACTIVE_PLAYER, player);
  m.mem.write8(ROUND_COUNTER, round);
  if (freeRing) {
    m.mem.write8(DISPLAY_CMD_RING_WRITE_PTR, RING_START); // 0x88a0 = 0xc0
    m.mem.write8(DISPLAY_CMD_RING_BUFFER, SLOT_FREE); //     0x88c0 bit7 set (free)
  }
  return m;
}

const CASES = {
  "latch set -> tail reseedSpawnCountersAndArmPlayMode": (m) => seat(m, { latch: 0x02, round: 0x00 }),
  "credit gate closed -> teardown": (m) => seat(m, { latch: 0x00, active: 0x00 }),
  "gauge already 0 -> advancePlayStateThenInsertHighScore": (m) => seat(m, { latch: 0x00, active: 0x01, gauge: 0x00 }),
  "gauge count to 0 -> advancePlayStateThenInsertHighScore": (m) => seat(m, { latch: 0x00, active: 0x01, gauge: 0x01 }),
  "render path (player 0)": (m) => seat(m, { latch: 0x00, active: 0x01, gauge: 0x02, player: 0x00 }),
  "render path (player 1)": (m) => seat(m, { latch: 0x00, active: 0x01, gauge: 0x02, player: 0x01 }),
  // Render path with the display-ring slot freed and a nonzero E: 0x2527's dissolved reset forwards
  // E through enqueueDisplayCommand, so the E bridge (cmdLow = m.regs.e) is genuinely exercised and any mis-bridge
  // diverges in RAM at 0x88c1.
  "render path + E bridge (ring free, E=0x37)": (m) =>
    seat(m, { latch: 0x00, active: 0x01, gauge: 0x02, player: 0x00, e: 0x37, freeRing: true }),
};

const CMD_LOW_ADDR = DISPLAY_CMD_RING_BUFFER + 1; // 0x88c1 — where enqueueDisplayCommand stores E

test("EQUAL: advancePhaseGaugeCountdown == oracle in RAM (−stack)", () => {
  for (const [name, craft] of Object.entries(CASES)) {
    const o = craft(BASE.clone());
    const c = craft(BASE.clone());
    oracle(o);
    advancePhaseGaugeCountdown(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${Object.keys(CASES).length} paths identical (RAM −stack)`);
});

test("WRITE-SET: the render path decrements the gauge and seeds the sub-state", () => {
  const p0 = CASES["render path (player 0)"](BASE.clone());
  oracle(p0);
  assert.equal(p0.mem.read8(GAUGE_PHASE_COUNTER), 0x01, "0x02 - 1 = 0x01 at the gauge counter");
  assert.equal(p0.mem.read8(PLAY_STATE_INDEX), 0x0a, "player 0 seeds sub-state 0x0a");

  const p1 = CASES["render path (player 1)"](BASE.clone());
  oracle(p1);
  assert.equal(p1.mem.read8(PLAY_STATE_INDEX), 0x0b, "player 1 seeds sub-state 0x0b");
  console.log("  WRITE-SET: gauge -1; sub-state 0x0a/0x0b");
});

test("TEETH: a corrupted post-run byte is CAUGHT by the RAM diff", () => {
  const o = CASES["render path (player 0)"](BASE.clone());
  const c = CASES["render path (player 0)"](BASE.clone());
  oracle(o);
  advancePhaseGaugeCountdown(c);
  c.mem.write8(PLAY_STATE_INDEX, (o.mem.read8(PLAY_STATE_INDEX) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted byte");
  console.log(`  TEETH(RAM): caught at ${hx(d.addr ?? 0)}`);
});

test("TEETH: a twin that skips the gauge decrement diverges from the oracle", () => {
  const o = CASES["render path (player 0)"](BASE.clone());
  const c = CASES["render path (player 0)"](BASE.clone());
  oracle(o); // decrements the gauge, renders, seeds the sub-state
  // twin: do nothing -> the seated cells survive
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "a skipped gauge decrement must be caught by the RAM diff");
  console.log(`  TEETH(gauge): caught at ${hx(d.addr ?? 0)}`);
});

test("WRITE-SET: the freed ring forwards D=0x08 and the E live-in into the ring (oracle)", () => {
  const o = CASES["render path + E bridge (ring free, E=0x37)"](BASE.clone());
  oracle(o);
  // live-out derived from the oracle: enqueueDisplayCommand stores D then E and advances the write ptr by two.
  assert.equal(o.mem.read8(DISPLAY_CMD_RING_BUFFER), 0x08, "0x88c0 gets the command high byte D=0x08");
  assert.equal(o.mem.read8(CMD_LOW_ADDR), 0x37, "0x88c1 gets the command low byte from E");
  assert.equal(o.mem.read8(DISPLAY_CMD_RING_WRITE_PTR), 0xc2, "write ptr advances 0xc0 -> 0xc2");
  console.log("  WRITE-SET(E bridge): 0x88c0=0x08 0x88c1=E(0x37) ptr=0xc2");
});

test("TEETH: a poison-E twin (dropped cmdLow) diverges from the oracle at 0x88c1", () => {
  // o carries the real low byte through the E bridge; the twin poisons E, mimicking a bridge that
  // ignores cmdLow. The RAM diff must see the difference the E live-in makes at 0x88c1 -- otherwise
  // a broken E bridge in the module would pass the EQUAL case above unnoticed.
  const o = seat(BASE.clone(), { latch: 0x00, active: 0x01, gauge: 0x02, player: 0x00, e: 0x37, freeRing: true });
  const c = seat(BASE.clone(), { latch: 0x00, active: 0x01, gauge: 0x02, player: 0x00, e: 0x00, freeRing: true });
  oracle(o);
  oracle(c);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "a poisoned display-command low byte must be caught by the RAM diff");
  assert.equal(d.addr, CMD_LOW_ADDR, `the divergence must land at the E-forwarded low-byte slot ${hx(CMD_LOW_ADDR)}`);
  console.log(`  TEETH(E bridge): caught at ${hx(d.addr ?? 0)}`);
});
