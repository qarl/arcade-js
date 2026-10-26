// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for guardTilemapIntegrity (ROM 0x6ac5, Pooyan) — "one-shot playfield-tilemap integrity
 * checksum".
 *
 * guardTilemapIntegrity returns unless the wave index is exactly 2 and the once-latch is clear; on the first
 * qualifying pass it latches the flag, sums the tilemap into a 16-bit accumulator (column by column,
 * skipping one column, jumping a fixed span each row end, until the high address byte leaves the
 * tilemap), and returns on the pass value while any other result is a tamper trap. The idiomatic
 * module throws on a mismatch; the translated oracle diverts via m.call into anti-tamper routines
 * (one of which stalls forever), so oracle-vs-module is compared only on the reachable good-ROM
 * paths (valid tilemap accepted; the two gate-bails), and the module's trap tightness is asserted on
 * its own.
 *
 * Integrity-arm construction: the walked-cell SET is value-independent, so `walkCells()` re-derives
 * the visited addresses; placing 0xb8 then 82 bytes of 0x80 at the first visited cells makes the
 * 16-bit sum land on the pass value. The ORACLE arbitrates the walk — if `walkCells()` were wrong,
 * the oracle would trap the "valid" tilemap and INTEGRITY-CLEAN would fail.
 *
 * LIVE-OUT: none (memory only) — the once-flag latch is the sole write; no register is read back.
 *
 * Jobs:
 *   1. EQUAL — valid tilemap accepted; gate-bails (wrong wave, latch held): oracle == module in RAM
 *      (−stack).
 *   2. INTEGRITY — valid tilemap: neither traps, latch set, RAM (−stack) equal (oracle arbitrates).
 *   3. WRITE-SET — clean path writes only the latch; bails write nothing.
 *   4. TEETH — the module rets on valid and traps on a one-byte perturbation; a wrong latch byte on
 *      the clean path is CAUGHT by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-6ac5.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_6ac5 as oracle } from "../../translated/loc_6ac5.js";
import { guardTilemapIntegrity } from "../guardTilemapIntegrity.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const WAVE = 0x892d; // WAVE_NUMBER — integrity arm runs only at wave index 2
const LATCH = 0x8f56; // TILE_SUM_ONCE_LATCH — once-per-pass gate, set to 1 by the check
const TILE_LO = 0x8400;
const TILE_HI = 0x87ff;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

function changedAddrs(m, run) {
  const before = m.dumpState();
  run(m);
  const after = m.dumpState();
  const out = [];
  for (let off = 0; off < before.length; off++) {
    if (before[off] === after[off]) continue;
    const addr = m.stateOffsetToAddr(off);
    if (inDeadStack(addr)) continue;
    out.push(addr);
  }
  return out.sort((a, b) => a - b);
}

/** Re-derive the value-independent sequence of tilemap cells the checksum visits. */
function walkCells() {
  let hi = 0x84;
  let lo = 0x50;
  const cells = [];
  for (;;) {
    if (cells.length > 0x8000) throw new Error("walk did not terminate");
    cells.push((hi << 8) | lo);
    lo = (lo + 1) & 0xff;
    if ((lo & 0x1f) === 0x1b) { lo = (lo + 1) & 0xff; continue; }
    if ((lo & 0x1f) !== 0x1f) continue;
    const t = lo + 0x12;
    lo = t & 0xff;
    if (t <= 0xff) continue;
    hi = (hi + 1) & 0xff;
    if (hi < 0x88) continue;
    break;
  }
  return cells;
}

/** An integrity-arm clone: wave/latch poked, tilemap zeroed then optionally made valid. */
function craftIntegrity({ wave = 0x02, latch = 0x00, build = "valid", perturb = false } = {}) {
  const m = BASE.clone();
  m.mem.write8(WAVE, wave);
  m.mem.write8(LATCH, latch);
  for (let a = TILE_LO; a <= TILE_HI; a++) m.mem.write8(a, 0x00);
  if (build === "valid") {
    const cells = walkCells();
    m.mem.write8(cells[0], 0xb8);
    for (let i = 1; i <= 82; i++) m.mem.write8(cells[i], 0x80);
    if (perturb) m.mem.write8(cells[0], 0xb9); // one byte off -> sum mismatch
  }
  m.regs.sp = 0x8ffe; // dead stack: the oracle's ret drop falls in excluded RAM
  return m;
}

// -- 0. walk sanity (pure arithmetic) -----------------------------------------

test("walk visits distinct cells and admits the pass-value construction", () => {
  const cells = walkCells();
  assert.equal(new Set(cells).size, cells.length, "visited cells must be distinct");
  assert.ok(cells.length >= 83, "construction needs at least 83 visited cells");
  console.log(`  WALK: ${cells.length} distinct cells ${hx(cells[0])}..${hx(cells[cells.length - 1])}`);
});

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: valid tilemap / gate-bails — guardTilemapIntegrity == oracle in RAM (−stack)", () => {
  const cases = [
    { name: "valid tilemap (checksum matches)", m: () => craftIntegrity({ build: "valid" }) },
    { name: "gate: wrong wave", m: () => craftIntegrity({ wave: 0x03 }) },
    { name: "gate: latch held", m: () => craftIntegrity({ latch: 0x01 }) },
  ];
  for (const { name, m } of cases) {
    const o = m();
    const c = m();
    oracle(o);
    guardTilemapIntegrity(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${cases.length} cases identical (RAM −stack)`);
});

// -- 2. INTEGRITY -------------------------------------------------------------

test("INTEGRITY: a valid tilemap is accepted by both (oracle arbitrates the walk)", () => {
  const o = craftIntegrity({ build: "valid" });
  const c = craftIntegrity({ build: "valid" });
  assert.doesNotThrow(() => oracle(o), "oracle must accept the constructed valid tilemap");
  assert.doesNotThrow(() => guardTilemapIntegrity(c), "module must accept the constructed valid tilemap");
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  assert.equal(c.mem.read8(LATCH), 0x01, "the one-shot latch must be set on the clean path");
  console.log("  INTEGRITY/clean: both accept; latch set; RAM −stack equal");
});

// -- 3. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: integrity-clean -> latch only; bails -> none", () => {
  assert.deepEqual(changedAddrs(craftIntegrity({ build: "valid" }), oracle), [LATCH], "clean path writes only the latch");
  assert.deepEqual(changedAddrs(craftIntegrity({ wave: 0x03 }), oracle), [], "wrong-wave bail writes nothing");
  assert.deepEqual(changedAddrs(craftIntegrity({ latch: 0x01 }), oracle), [], "latch-held bail writes nothing");
  console.log("  WRITE-SET: clean -> [latch]; bails -> 0");
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: the checksum decision is tight (rets on valid, traps on +1)", () => {
  assert.doesNotThrow(() => guardTilemapIntegrity(craftIntegrity({ build: "valid" })), "module must NOT trap a valid tilemap");
  assert.throws(() => guardTilemapIntegrity(craftIntegrity({ build: "valid", perturb: true })), "module must trap a +1 tilemap");
  console.log("  TEETH/decision: valid accepted, +1 corruption trapped");
});

test("TEETH: a wrong latch byte (clean path) is CAUGHT by the RAM diff", () => {
  const o = craftIntegrity({ build: "valid" });
  const c = craftIntegrity({ build: "valid" });
  oracle(o);
  guardTilemapIntegrity(c);
  c.mem.write8(LATCH, 0x02); // BUG: the latch must be 0x01
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong latch — it is worthless");
  assert.equal(d.addr, LATCH, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/latch: wrong latch caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
