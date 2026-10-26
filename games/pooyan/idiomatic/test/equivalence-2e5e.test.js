// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for spawnHangingRopeObject (ROM 0x2e5e) — "rope-cell state 1 / bonus spawn":
 * gated on (0x8a5f)&3 and the per-cell timer (tickRopeCellFrameTimer); when both fire it re-arms the timer,
 * finds a free slot in the three-entry 0x8c48 spawn table, seeds it (state/anim/coords, the
 * +4 field from ROM table 0x2ec7 keyed by IXL&3), advances the cell (ix+0), then blits the
 * segment tile (0x2dfe) and enqueues its display command.
 *
 * Cycle-free memory-equivalence gate: fresh clone per side, compared on RAM (dumpState, minus
 * stack scratch below the entry SP) only. The routine has NO register live-out — its driver (driveActiveRopeCells) reads
 * nothing back after the dispatch and IX (the cell record) is only read — so pc and the whole
 * register file are deliberately NOT compared. IX is the one input register, seated on both sides.
 *
 * Jobs:
 *   1. EQUAL (crafted) — the free-slot spawn at each of the three slot indices (one with the
 *      round clamped), the no-free-slot path, the wrong-frame gate, and the timer-not-elapsed
 *      gate: oracle == spawnHangingRopeObject in RAM (−stack).
 *   2. WRITE-SET — the spawn path's deterministic writes: the timer entry, the seven slot
 *      fields (the +4 field matching the ROM table), and the advanced cell state.
 *   3. TEETH — a wrong seeded slot byte is caught by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-2e5e.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2e5e as oracle } from "../../translated/loc_2e5e.js";
import { spawnHangingRopeObject } from "../spawnHangingRopeObject.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  FRAME_COUNTER,
  ROUND_COUNTER,
  SPAWN_OBJECT_TABLE,
  ROPE_CELL_TIMERS,
  GAME_ACTIVE_FLAG,
  SOUND_RING_WRITE_PTR,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const SLOT_STRIDE = 0x18;
const IY4_TABLE = 0x2ec7; // ROM table: IXL&3 -> the slot's +4 field
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const timerAddr = (ix) => ROPE_CELL_TIMERS + 2 * ((ix & 0xff) & 0x03);
const slotAddr = (i) => SPAWN_OBJECT_TABLE + SLOT_STRIDE * i;
const reloadFor = (round) => ~(((round >= 0x10 ? 0x10 : round) - 0x28) & 0xff) & 0xff;

/** A fresh clone seating IX + all cells spawnHangingRopeObject reads. `occ[i]` marks spawn slot i occupied. */
function craft({ ix, frame, timer, round, occ, active }) {
  const m = BASE.clone();
  m.regs.ix = ix;
  m.regs.sp = 0x8ffe;
  m.mem.write8(FRAME_COUNTER, frame);
  m.mem.write8(timerAddr(ix), timer);
  m.mem.write8(ROUND_COUNTER, round);
  m.mem.write8(ix, 0x01); // (ix+0): the cell state the dispatcher landed on
  for (let i = 0; i < 3; i++) {
    m.mem.write8(slotAddr(i), occ[i] ? 0x01 : 0x00); // byte0 record-active
    m.mem.write8(slotAddr(i) + 1, 0x00); // byte1 low bit clear
  }
  m.mem.write8(GAME_ACTIVE_FLAG, active ? 0x01 : 0x00);
  m.mem.write8(SOUND_RING_WRITE_PTR, 0x43); // a valid ring slot for the display-command append
  return m;
}

const CASES = [
  { ix: 0x8f1c, frame: 0x00, timer: 0x01, round: 0x03, occ: [false, false, false], active: true }, // slot 0 free
  { ix: 0x8f1d, frame: 0x00, timer: 0x01, round: 0x03, occ: [true, false, false], active: true }, // slot 1 free
  { ix: 0x8f1e, frame: 0x00, timer: 0x01, round: 0x20, occ: [true, true, false], active: true }, // slot 2, round clamped
  { ix: 0x8f1f, frame: 0x00, timer: 0x01, round: 0x05, occ: [true, true, true], active: false }, // no free slot
  { ix: 0x8f1c, frame: 0x01, timer: 0x01, round: 0x03, occ: [false, false, false], active: false }, // wrong frame
  { ix: 0x8f1c, frame: 0x00, timer: 0x05, round: 0x03, occ: [false, false, false], active: false }, // timer not elapsed
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted cases — spawnHangingRopeObject == oracle in RAM (−stack)", () => {
  for (const cs of CASES) {
    const o = craft(cs);
    oracle(o);
    const c = craft(cs);
    spawnHangingRopeObject(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b} (${JSON.stringify(cs)})`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted cases identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the spawn path seeds the timer entry, the seven slot fields, and (ix+0)", () => {
  const cs = CASES[0]; // slot 0 free, ix=0x8f1c, round=3
  const m = craft(cs);
  oracle(m);
  const t = timerAddr(cs.ix);
  const s = slotAddr(0);
  assert.equal(m.mem.read8(t), reloadFor(cs.round), "timer entry byte0 := round-scaled reload");
  assert.equal(m.mem.read8(t + 1), 0x00, "timer entry byte1 := free slot index (0)");
  assert.equal(m.mem.read8(s + 0x00), 0x07, "slot +0 := 0x07 (state)");
  assert.equal(m.mem.read8(s + 0x02), 0x10, "slot +2 := 0x10");
  assert.equal(m.mem.read8(s + 0x04), m.mem.read8(IY4_TABLE), "slot +4 := ROM table[IXL&3]");
  assert.equal(m.mem.read8(s + 0x05), 0x40, "slot +5 := 0x40");
  assert.equal(m.mem.read8(s + 0x06), 0x1a, "slot +6 := 0x1a");
  assert.equal(m.mem.read8(s + 0x0f), 0x2e, "slot +0x0f := 0x2e");
  assert.equal(m.mem.read8(s + 0x10), 0x40, "slot +0x10 := 0x40");
  assert.equal(m.mem.read8(cs.ix), 0x02, "(ix+0) cell state advanced 0x01 -> 0x02");
  console.log("  WRITE-SET: timer entry + 7 slot fields + advanced (ix+0)");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong seeded slot byte is CAUGHT by the RAM diff", () => {
  const cs = CASES[0];
  const o = craft(cs);
  const c = craft(cs);
  oracle(o);
  spawnHangingRopeObject(c);
  const s = slotAddr(0);
  c.mem.write8(s + 0x00, 0x00); // BUG: slot state must be 0x07, not 0x00
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong seeded slot byte — it is worthless");
  assert.equal(d.addr, s, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH: wrong slot state caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
