// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for spawnObjectIntoFreeSlot (ROM 0x3680, Pooyan) — "find a free actor slot and spawn".
 *
 * The cycle-free / memory-equivalence gate (docs/decompiler-pipeline): a fresh clone per side, the
 * oracle on one and spawnObjectIntoFreeSlot on the other, compared on RAM (dumpState, minus stack scratch below the entry SP). The
 * routine's effect is memory: the spawn counters, the seeded template fields, the attribute byte
 * built by mergeActorAttributeByte and the slot fields laid by the spawnActorSlotFromTemplate tail (which itself tails queueSoundCommand04IfNotBusy);
 * pc/SP/cycles are not compared. On the table-full path it writes nothing.
 *
 * INPUTS: IY (scan-window base), DE (stride), B (slot count), IX (template). Reads the scanned
 * slots' +0/+1 pair, the template's +7 (bit1 anim select, bit2 lane-counter arm) and the fields the
 * tail chain consumes, plus the spawn counters and the ROM tables the real ROM supplies both sides.
 *
 * The window (0x8b70) and template (0x8b00) are isolated work RAM; the tail's queueSoundCommand04IfNotBusy writes land
 * on the page-0x8a sound ring (covered by queueSoundCommand04IfNotBusy's own gate). The leaf is not reached in a plain
 * boot, so every case is CRAFTED: the registers, the slot pairs and the cells are poked both sides.
 *
 * Jobs:
 *   1. EQUAL — a hit with the lane counters idle, a hit that arms them (and picks the alt anim), a
 *      frame-counter wrap, and a table-full miss: oracle == spawnObjectIntoFreeSlot in RAM (−stack).
 *   2. WRITE-SET — a hit bumps the frame counter into template+14, arms the lane counters only when
 *      +7 bit2 is set, and lays the slot's +0=1 marker; a table-full miss leaves RAM untouched.
 *   3. TEETH — a wrong slot cell, a wrong attribute byte and a wrong frame counter are each CAUGHT.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-3680.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_3680 as oracle } from "../../translated/loc_3680.js";
import { spawnObjectIntoFreeSlot } from "../spawnObjectIntoFreeSlot.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const TEMPLATE = 0x8b00;
const WINDOW = 0x8b70;
const STRIDE = 0x18;
const DSW = 0x8820;
const SPEED_INDEX_ADDR = 0x8900;
const ROUND_COUNTER_ADDR = 0x8907;
const FRAME_COUNTER = 0x8d41;
const LANE_COUNTDOWN = 0x8d75;
const LANE_SCRATCH = 0x8d76;
const LANE_COUNT = 0x8d79;
const SLOT_INDEX = 0x8d7b;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);
function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** A fresh clone with the scan window, template and counters seated; slot 0 free unless full. */
function craft(spec = {}) {
  const { t7 = 0x00, frame = 0x10, lanes = 0x05, full = false } = spec;
  const m = BASE.clone();
  m.regs.sp = 0x8ffe; // tail/rst pushes live in STACK_SCRATCH
  m.regs.iy = WINDOW;
  m.regs.de = STRIDE;
  m.regs.b = 0x05;
  m.regs.ix = TEMPLATE;

  for (let i = 0; i < 5; i++) {
    m.mem8[WINDOW + i * STRIDE + 0] = full ? 0x01 : 0x00; // bit0 set => occupied
    m.mem8[WINDOW + i * STRIDE + 1] = 0x00;
  }
  m.mem8[TEMPLATE + 0x07] = t7 & 0xff;
  m.mem8[TEMPLATE + 0x0b] = 0x00; // anim override off -> spawnActorSlotFromTemplate uses the looked-up vector
  m.mem8[TEMPLATE + 0x03] = 0x40;
  m.mem8[TEMPLATE + 0x04] = 0x50;
  m.mem8[TEMPLATE + 0x05] = 0x60;
  m.mem8[TEMPLATE + 0x06] = 0x70;
  m.mem8[DSW] = 0x00;
  m.mem8[SPEED_INDEX_ADDR] = 0x03;
  m.mem8[ROUND_COUNTER_ADDR] = 0x00;
  m.mem8[FRAME_COUNTER] = frame & 0xff;
  m.mem8[LANE_COUNT] = lanes & 0xff;
  m.mem8[SLOT_INDEX] = 0x20;
  m.mem8[LANE_COUNTDOWN] = 0x00;
  m.mem8[LANE_SCRATCH] = 0xee; // pre-dirty; cleared to 0 on the armed path
  return m;
}

const CASES = [
  { name: "hit, lane counters idle (+7 bit2 clear)", craft: () => craft({ t7: 0x00 }) },
  { name: "hit, lane counters armed + alt anim (+7 bits1,2)", craft: () => craft({ t7: 0x06 }) },
  { name: "hit, frame counter wraps 0xff -> 1", craft: () => craft({ t7: 0x00, frame: 0xff }) },
  { name: "table full -> no spawn", craft: () => craft({ full: true }) },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted scan/spawn cases — spawnObjectIntoFreeSlot == oracle in RAM (−stack)", () => {
  for (const spec of CASES) {
    const o = spec.craft();
    oracle(o);
    const c = spec.craft();
    spawnObjectIntoFreeSlot(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${spec.name}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted scan/spawn cases identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: a hit bumps the counters + marks the slot; a full table is inert", () => {
  // idle-lane hit: frame counter steps into template+14, lane counters untouched, slot +0 marked.
  const idle = craft({ t7: 0x00, frame: 0x10 });
  oracle(idle);
  assert.equal(idle.mem8[FRAME_COUNTER], 0x11, "frame counter 0x10 -> 0x11");
  assert.equal(idle.mem8[TEMPLATE + 0x14], 0x11, "template+14 <- stepped frame counter");
  assert.equal(idle.mem8[SLOT_INDEX], 0x20, "slot index untouched (bit2 clear)");
  assert.equal(idle.mem8[LANE_COUNT], 0x05, "lane count untouched (bit2 clear)");
  assert.equal(idle.mem8[WINDOW + 0x00], 0x01, "found slot marked active by the tail");

  // armed-lane hit: slot index bumped, lane count decremented, countdown = pre-dec, scratch cleared.
  const armed = craft({ t7: 0x04, frame: 0x10, lanes: 0x05 });
  oracle(armed);
  assert.equal(armed.mem8[SLOT_INDEX], 0x21, "slot index bumped (bit2 set)");
  assert.equal(armed.mem8[LANE_COUNT], 0x04, "lane count decremented");
  assert.equal(armed.mem8[LANE_COUNTDOWN], 0x05, "countdown <- pre-decrement lane count");
  assert.equal(armed.mem8[LANE_SCRATCH], 0x00, "lane scratch cleared");

  // full table: no write anywhere.
  const full = craft({ full: true });
  const before = full.dumpState();
  oracle(full);
  assert.deepEqual([...full.dumpState()], [...before], "a full table must leave RAM untouched");
  console.log("  WRITE-SET: counters/slot per contract; full table inert");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong slot / attribute / frame cell is CAUGHT by the RAM diff", () => {
  const spots = [
    { name: "slot marker", craft: () => craft({ t7: 0x00 }), addr: WINDOW + 0x00 },
    { name: "attribute byte (mergeActorAttributeByte)", craft: () => craft({ t7: 0x00 }), addr: TEMPLATE + 0x08 },
    { name: "frame counter bump", craft: () => craft({ t7: 0x00 }), addr: FRAME_COUNTER },
  ];
  for (const { name, craft: c0, addr } of spots) {
    const o = c0();
    const c = c0();
    oracle(o);
    spawnObjectIntoFreeSlot(c);
    c.mem8[addr] = (o.mem8[addr] ^ 0xff) & 0xff; // BUG: corrupt one contract cell
    const d = ramDiffMinusStack(o, c);
    assert.notEqual(d, null, `${name}: the gate FAILED to catch a wrong cell — worthless`);
    assert.equal(d.addr, addr, `${name}: teeth caught wrong address ${hx(d.addr ?? 0)} (expected ${hx(addr)})`);
    console.log(`  TEETH/RAM ${name}: caught at ${hx(d.addr)}`);
  }
});
