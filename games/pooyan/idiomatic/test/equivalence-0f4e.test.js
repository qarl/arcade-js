// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for queueSoundCommands82And95 (ROM 0x0f4e, Pooyan) — "enqueue two fixed bytes (0x82
 * then 0x95) into the command ring" via the enqueue helper (the second a tail call). Each store
 * lands at 0x8a00 + tail (tail = 0x8a40) and the tail advances 0x43..0x5e, wrapping 0x5e -> 0x43.
 * The enqueue is ungated (unlike the 0x0ea2 append).
 *
 * Cycle-free memory-equivalence gate: writes work RAM, so a FRESH clone per side, compared on
 * RAM (dumpState minus stack scratch below the entry SP). LIVE-OUT is memory only: the helper leaves the advanced
 * pointer in A, but every enqueue site reloads A, so A is NOT part of the contract and is not
 * compared. The helper's push/pop framing lands in STACK_SCRATCH and is excluded.
 *
 * Jobs:
 *   1. EQUAL (crafted) — a mid tail, a tail that wraps on the second store, and a tail that wraps
 *      on the first: oracle == module in RAM (−stack).
 *   2. WRITE-SET — writes exactly {ring[tail], ring[tail+1], 0x8a40} (3 cells).
 *   3. TEETH — a wrong enqueued byte (RAM diff) and a missed 0x5e -> 0x43 wrap are both caught.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-0f4e.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0f4e as oracle } from "../../translated/loc_0f4e.js";
import { queueSoundCommands82And95 } from "../queueSoundCommands82And95.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, SOUND_RING_WRITE_PTR, HIGH_SCORE_TABLE } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const RING_PAGE = HIGH_SCORE_TABLE; // 0x8a00: the ring page
const RING_FIRST = 0x43;
const RING_LAST = 0x5e;
const CMDS = [0x82, 0x95]; // the two fixed bytes, in enqueue order

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);
const nextTail = (t) => (t === RING_LAST ? RING_FIRST : t + 1);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Fresh clone with the tail pointer poked and the ring window cleared. */
function craft(tail) {
  const m = BASE.clone();
  m.mem.write8(SOUND_RING_WRITE_PTR, tail);
  for (let c = RING_FIRST; c <= RING_LAST; c++) m.mem.write8(RING_PAGE + c, 0x00);
  m.regs.sp = 0x8ffe;
  return m;
}

/** Game-state cells changed by `run`, excluding the transient stack framing. */
function changedCells(mm, run) {
  const b0 = mm.dumpState();
  run(mm);
  const a1 = mm.dumpState();
  const out = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] === a1[off]) continue;
    const addr = mm.stateOffsetToAddr(off);
    if (!inDeadStack(addr)) out.push(addr);
  }
  return out;
}

const TAILS = [0x50, 0x5d, RING_LAST]; // mid; wrap on the 2nd store; wrap on the 1st store

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted tail values — queueSoundCommands82And95 == oracle in RAM (−stack)", () => {
  for (const tail of TAILS) {
    const o = craft(tail);
    const c = craft(tail);
    oracle(o);
    queueSoundCommands82And95(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `tail=${hx(tail)}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${TAILS.length} crafted tails identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: writes exactly {ring[tail], ring[tail+1], 0x8a40}", () => {
  const tail = 0x50;
  const changed = changedCells(craft(tail), oracle);
  const set = new Set(changed);
  const expected = [RING_PAGE + tail, RING_PAGE + nextTail(tail), SOUND_RING_WRITE_PTR];
  assert.equal(changed.length, expected.length, `expected ${expected.length} writes, got ${changed.length} (${changed.map(hx)})`);
  for (const cell of expected) assert.ok(set.has(cell), `missing a write at ${hx(cell)}`);
  console.log("  WRITE-SET: 2 ring slots + the tail pointer");
});

// -- 3. TEETH -----------------------------------------------------------------

/** Broken twin: enqueues the first byte inverted. */
function brokenWrongByte(m) {
  let tail = m.mem.read8(SOUND_RING_WRITE_PTR);
  for (let i = 0; i < CMDS.length; i++) {
    m.mem.write8(RING_PAGE + tail, i === 0 ? CMDS[i] ^ 0xff : CMDS[i]); // BUG on the first byte
    tail = nextTail(tail);
  }
  m.mem.write8(SOUND_RING_WRITE_PTR, tail);
}

/** Broken twin: never wraps the tail (0x5e -> 0x5f instead of 0x43). */
function brokenNoWrap(m) {
  let tail = m.mem.read8(SOUND_RING_WRITE_PTR);
  for (let i = 0; i < CMDS.length; i++) {
    m.mem.write8(RING_PAGE + tail, CMDS[i]);
    tail = (tail + 1) & 0xff; // BUG: no 0x5e -> 0x43 wrap
  }
  m.mem.write8(SOUND_RING_WRITE_PTR, tail);
}

test("TEETH: a wrong enqueued byte is CAUGHT by the RAM diff", () => {
  const tail = 0x50;
  const o = craft(tail);
  const c = craft(tail);
  oracle(o);
  brokenWrongByte(c);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong enqueued byte — it is worthless");
  assert.equal(d.addr, RING_PAGE + tail, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(byte): caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a missed tail wrap is CAUGHT by the RAM diff", () => {
  const tail = RING_LAST; // wraps on the first store
  const o = craft(tail);
  const c = craft(tail);
  oracle(o);
  brokenNoWrap(c);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a missed tail wrap — it is worthless");
  console.log(`  TEETH(wrap): caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
