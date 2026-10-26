// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for queueSirenSoundRun (ROM 0x0f76, Pooyan) — "draw the warning-siren tile run
 * while the siren gate is clear": when the siren-enable gate (0x8d68) is nonzero the routine does
 * nothing; otherwise it appends tile 0x1a + (round bit0) to the command ring, then appends the
 * completing four-tile run through the shared helper.
 *
 * Cycle-free memory-equivalence gate (docs/decompiler-pipeline). The routine writes work RAM and
 * nests the append helpers, so each case runs the oracle on one FRESH clone and the module on
 * another, compared on:
 *
 *     RAM (dumpState, minus stack scratch below the entry SP) + the A register live-out.
 *
 * A IS a live-out: on the disabled path A = the (nonzero) gate byte the oracle leaves; on the draw
 * path A = the advanced ring cursor the append chain leaves (A = 0 when the append gates 0x8806 /
 * 0x8f50 are both closed). AF is not restored across the appends. The module has no input register;
 * every input (gate, round, append gates, cursor) is a poked cell, seated identically on both sides.
 * Note the second appended byte is the cursor value the FIRST append leaves in A, threaded on into
 * the run helper — a faithful quirk both sides reproduce.
 *
 * Jobs:
 *   1. EQUAL — disabled, draw+gates-closed, draw+gates-open (mid cursor), and draw+gates-open across
 *      the ring wrap: module == oracle in RAM (−stack) and in A.
 *   2. WRITE-SET — draw+gates-open (no wrap) writes {pending byte, five ring cells, cursor}; disabled
 *      writes nothing.
 *   3. TEETH — a corrupted appended ring byte, and a wrong A live-out, are each CAUGHT.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-0f76.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0f76 as oracle } from "../../translated/loc_0f76.js";
import { queueSirenSoundRun } from "../queueSirenSoundRun.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  SIREN_ENABLE_GATE,
  ROUND_COUNTER,
  GAME_ACTIVE_FLAG,
  PLAY_MODE_LATCH,
  SOUND_RING_WRITE_PTR,
  SOUND_RING_PENDING_BYTE,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const RING_PAGE = SOUND_RING_WRITE_PTR & 0xff00; // ring cells live on this page
const RING_FIRST = 0x43;
const RING_LAST = 0x5e;
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ff0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** A fresh clone with the siren gate, round byte, append gates, cursor, pending byte and ring seated. */
function craft(gate, round, active, mode, cursor) {
  const m = BASE.clone();
  m.mem.write8(SIREN_ENABLE_GATE, gate);
  m.mem.write8(ROUND_COUNTER, round);
  m.mem.write8(GAME_ACTIVE_FLAG, active);
  m.mem.write8(PLAY_MODE_LATCH, mode);
  m.mem.write8(SOUND_RING_WRITE_PTR, cursor);
  m.mem.write8(SOUND_RING_PENDING_BYTE, 0x00); // known start so WRITE-SET sees the stash
  for (let c = RING_FIRST; c <= RING_LAST; c++) m.mem.write8(RING_PAGE + c, 0x00);
  m.regs.a = 0x77; // sentinel: a module that fails to set A on the disabled path is caught
  m.regs.sp = 0x8ff0; // dead stack: the nested appends push/pop here
  return m;
}

const CASES = [
  { name: "siren disabled", gate: 0x09, round: 0x00, active: 1, mode: 0, cursor: 0x50 },
  { name: "draw, gates closed", gate: 0x00, round: 0x00, active: 0, mode: 0, cursor: 0x50 },
  { name: "draw, gates open, mid cursor, round bit0", gate: 0x00, round: 0x01, active: 1, mode: 0, cursor: 0x50 },
  { name: "draw, gates open via play-mode, wrap", gate: 0x00, round: 0x00, active: 0, mode: 1, cursor: 0x5c },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted gate/round/cursor cases — queueSirenSoundRun == oracle in RAM (−stack) + A", () => {
  for (const { name, gate, round, active, mode, cursor } of CASES) {
    const o = craft(gate, round, active, mode, cursor);
    const c = craft(gate, round, active, mode, cursor);
    oracle(o);
    const ret = queueSirenSoundRun(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    assert.equal(c.regs.a & 0xff, o.regs.a & 0xff, `${name}: module must SET A to the oracle's exit A`);
    assert.equal(ret & 0xff, o.regs.a & 0xff, `${name}: returned A must match the oracle`);
  }
  console.log(`  EQUAL: ${CASES.length} cases identical (RAM −stack + A)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: draw+open writes {pending, five ring cells, cursor}; disabled writes nothing", () => {
  const startCursor = 0x50; // no wrap: five contiguous ring cells
  const open = craft(0x00, 0x01, 1, 0, startCursor);
  const b0 = open.dumpState();
  oracle(open);
  const a1 = open.dumpState();
  const openSet = new Set();
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] === a1[off]) continue;
    const addr = open.stateOffsetToAddr(off);
    if (inDeadStack(addr)) continue; // nested append push/pop scratch, not game state
    openSet.add(addr);
  }
  const expected = [
    SOUND_RING_PENDING_BYTE,
    RING_PAGE + startCursor,
    RING_PAGE + startCursor + 1,
    RING_PAGE + startCursor + 2,
    RING_PAGE + startCursor + 3,
    RING_PAGE + startCursor + 4,
    SOUND_RING_WRITE_PTR,
  ];
  assert.equal(openSet.size, expected.length, `open expected ${expected.length} writes, got ${openSet.size}`);
  for (const cell of expected) assert.ok(openSet.has(cell), `open missing a write at ${hx(cell)}`);

  const off = craft(0x09, 0x00, 1, 0, startCursor); // siren disabled
  const s0 = off.dumpState();
  oracle(off);
  const s1 = off.dumpState();
  const changed = [];
  for (let i = 0; i < s0.length; i++) {
    if (s0[i] === s1[i]) continue;
    const addr = off.stateOffsetToAddr(i);
    if (inDeadStack(addr)) continue;
    changed.push(addr);
  }
  assert.deepEqual(changed, [], `disabled path must write no game state, got ${changed.map(hx)}`);
  console.log("  WRITE-SET: open -> 7 cells, disabled -> nothing");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a corrupted appended ring byte is CAUGHT by the RAM diff", () => {
  const cursor = 0x50;
  const o = craft(0x00, 0x01, 1, 0, cursor);
  const c = craft(0x00, 0x01, 1, 0, cursor);
  oracle(o);
  queueSirenSoundRun(c);
  assert.equal(ramDiffMinusStack(o, c), null, "module agrees before the injected bug");
  const cell = RING_PAGE + cursor + 2; // one of the run bytes
  c.mem.write8(cell, c.mem.read8(cell) ^ 0xff); // BUG: corrupt a run byte
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong appended byte — it is worthless");
  assert.equal(d.addr, cell, `teeth caught wrong address ${hx(d.addr ?? 0)} (expected ${hx(cell)})`);
  console.log(`  TEETH(byte): caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong A live-out is CAUGHT by the live-out check", () => {
  const o = craft(0x09, 0x00, 1, 0, 0x50); // disabled: A = the gate byte
  const c = craft(0x09, 0x00, 1, 0, 0x50);
  oracle(o);
  const ret = queueSirenSoundRun(c);
  assert.equal(ret & 0xff, o.regs.a & 0xff, "sanity: module A matches the oracle");
  const broken = (ret ^ 0xff) & 0xff; // a plausible wrong A the === check must reject
  assert.notEqual(broken, o.regs.a & 0xff, "the A live-out check must reject a wrong A");
  console.log(`  TEETH(A): module A ${hx(ret)} == oracle; ${hx(broken)} rejected`);
});
