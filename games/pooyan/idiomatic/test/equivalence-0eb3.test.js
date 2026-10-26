// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for enqueueSoundCommandRing (ROM 0x0eb3, Pooyan) — "enqueue a sound command":
 * store A into the ring slot named by the write pointer (SOUND_RING_WRITE_PTR), then advance
 * that pointer, wrapping the last slot (0x5e) back to the first (0x43). The original saves
 * and restores BC/DE/HL, so those registers survive unchanged.
 *
 * This is the CYCLE-FREE / memory-equivalence gate. The routine WRITES work RAM, so every
 * case runs the oracle on one fresh clone and enqueueSoundCommandRing on another, compared on the go-forward
 * contract: RAM (dumpState, minus stack scratch below the entry SP). There is NO register live-out — every
 * enqueue site reloads A before its next use, and BC/DE/HL are round-tripped — so no register
 * is part of the contract. As a documented extra, the round-tripped BC/DE/HL are seeded to
 * sentinels and confirmed identical on both sides (the caller's preservation guarantee).
 *
 * A (the byte to enqueue) is the ONLY input, passed via the m.regs.a param-default bridge.
 *
 * Jobs:
 *   1. EQUAL — over normal + wrap tail positions, oracle == enqueueSoundCommandRing in RAM(−stack); BC/DE/HL
 *      preserved identically.
 *   2. WRITE-SET — the oracle's only work-RAM writes are the filled slot + the pointer cell.
 *   3. TEETH — a wrong stored byte is caught at the slot, and a wrong advanced pointer at the
 *      pointer cell.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-0eb3.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0eb3 as oracle } from "../../translated/loc_0eb3.js";
import { enqueueSoundCommandRing } from "../enqueueSoundCommandRing.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, SOUND_RING_WRITE_PTR, HIGH_SCORE_TABLE } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const DIRT = 0x77; // pre-loaded into the target slot so the store is always a change
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);

function ramDiffMinusStack(ma, mb) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** Fresh clone: write pointer seated, its slot pre-dirtied, A = the byte to enqueue, BC/DE/HL
 *  seeded with sentinels (to prove they survive), SP in the dead stack window. */
function craft(tail, command) {
  const m = BASE.clone();
  m.mem.write8(SOUND_RING_WRITE_PTR, tail & 0xff);
  m.mem.write8((HIGH_SCORE_TABLE + tail) & 0xffff, DIRT);
  m.regs.a = command & 0xff;
  m.regs.bc = 0xb0b1;
  m.regs.de = 0xd0d1;
  m.regs.hl = 0xe0e1;
  m.regs.sp = 0x8ffe;
  return m;
}

// tail positions: interior, first slot, and the wrap boundary (0x5e -> 0x43).
const CASES = [
  { tail: 0x50, command: 0x27 },
  { tail: 0x43, command: 0x09 },
  { tail: 0x5e, command: 0x15 }, // wrap
  { tail: 0x4a, command: 0x95 },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: oracle == enqueueSoundCommandRing in RAM(−stack); BC/DE/HL preserved", () => {
  for (const { tail, command } of CASES) {
    const o = craft(tail, command);
    const c = craft(tail, command);
    oracle(o);
    enqueueSoundCommandRing(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} mine=${d.b} (tail=${hx(tail)} cmd=${hx(command)})`);
    assert.equal(c.regs.bc & 0xffff, o.regs.bc & 0xffff, `BC not preserved (tail=${hx(tail)})`);
    assert.equal(c.regs.de & 0xffff, o.regs.de & 0xffff, `DE not preserved (tail=${hx(tail)})`);
    assert.equal(c.regs.hl & 0xffff, o.regs.hl & 0xffff, `HL not preserved (tail=${hx(tail)})`);
  }
  console.log(`  EQUAL: ${CASES.length} enqueue cases identical (RAM −stack; BC/DE/HL preserved)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the only work-RAM writes are the filled slot + the pointer cell", () => {
  const { tail, command } = CASES[0];
  const slot = (HIGH_SCORE_TABLE + tail) & 0xffff;

  const before = craft(tail, command);
  const after = craft(tail, command);
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();

  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] === a1[off]) continue;
    const addr = after.stateOffsetToAddr(off);
    if (inDeadStack(addr)) continue; // the oracle's push/pop of bc/de/hl dirties STACK_SCRATCH; not game state
    changed.push(addr);
  }
  const addrs = new Set(changed);
  assert.equal(changed.length, 2, `expected exactly 2 written cells, got ${changed.length}`);
  assert.ok(addrs.has(slot), `expected the filled slot ${hx(slot)} to change`);
  assert.ok(addrs.has(SOUND_RING_WRITE_PTR), `expected the pointer cell ${hx(SOUND_RING_WRITE_PTR)} to change`);
  assert.equal(after.mem.read8(slot), command, "filled slot must hold the enqueued byte");
  console.log(`  WRITE-SET: slot ${hx(slot)}:=${hx(command)}, ptr ${hx(SOUND_RING_WRITE_PTR)} advanced (2 cells)`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong stored byte is caught at the slot", () => {
  const { tail, command } = CASES[0];
  const slot = (HIGH_SCORE_TABLE + tail) & 0xffff;
  const o = craft(tail, command);
  const c = craft(tail, command);
  oracle(o);
  enqueueSoundCommandRing(c);
  c.mem.write8(slot, (command ^ 0x01) & 0xff); // BUG: corrupt the enqueued byte

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong stored byte — it is worthless");
  assert.equal(d.addr, slot, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(slot)})`);
  console.log(`  TEETH/slot: wrong byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong advanced pointer is caught at the pointer cell", () => {
  const { tail, command } = CASES[2]; // wrap case: correct advance is 0x43
  const o = craft(tail, command);
  const c = craft(tail, command);
  oracle(o);
  enqueueSoundCommandRing(c);
  assert.equal(c.mem.read8(SOUND_RING_WRITE_PTR), o.mem.read8(SOUND_RING_WRITE_PTR), "sanity: module wraps like the oracle");
  c.mem.write8(SOUND_RING_WRITE_PTR, (tail + 1) & 0xff); // BUG: advanced instead of wrapping

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a non-wrapping pointer — it is worthless");
  assert.equal(d.addr, SOUND_RING_WRITE_PTR, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/ptr: non-wrapping pointer caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
