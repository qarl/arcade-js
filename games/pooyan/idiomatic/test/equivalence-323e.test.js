// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for scanDisplaySlotsAndTickBoardClear (ROM 0x323e, Pooyan) — "scan 4 display-list slots".
 *
 * The cycle-free / memory-equivalence gate (docs/decompiler-pipeline): a fresh clone per side,
 * the oracle on one and scanDisplaySlotsAndTickBoardClear on the other, compared on RAM (dumpState, minus stack scratch below the entry SP).
 * pc/SP/registers are deliberately not compared.
 *
 * INPUTS: IX (record base) and B (loop count; the real callers preset B=4). For each slot whose
 * tag byte (IX+1) is 0x8c the routine runs tickHunterReturnCounterAndCheckBoardClear on that slot; IX steps by 2 each iteration.
 *
 * LIVE-OUT: none — the module walks the counter in a local and leaves no consumed register (the
 * oracle's advanced IX / drained B are unread by every caller, so they are not compared).
 *
 * tickHunterReturnCounterAndCheckBoardClear preserves B on every path exercised here (below-threshold skip, no-borrow drop, borrow
 * + paired dec, and the board-clear tail with TILE_CHECKSUM_LATCH pre-set so verifyPlayfieldTileChecksum no-ops). The
 * board-clear FULL-scan path (BOARD_CLEAR_FLAG set AND the latch clear) is the ONE state where
 * verifyPlayfieldTileChecksum sets B=4 and djnz-drains it, clobbering the caller's counter mid-scan; the oracle's
 * register-B loop would diverge from this local-counter loop there, so it is deliberately not
 * crafted (see the batch return notes) — the same state tickHunterReturnCounterAndCheckBoardClear's own gate also avoids.
 *
 * The leaf is not reached in a plain boot, so every case is CRAFTED (identical pokes on both sides).
 *
 * Jobs:
 *   1. EQUAL — over crafted 4-slot layouts (no match; match+skip; no-borrow; borrow; borrow+
 *      board-clear no-op), oracle == scanDisplaySlotsAndTickBoardClear in RAM (−stack).
 *   2. WRITE-SET — a single borrow match writes only the counter cell and the paired byte.
 *   3. TEETH — a wrong counter byte is CAUGHT by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-323e.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_323e as oracle } from "../../translated/loc_323e.js";
import { scanDisplaySlotsAndTickBoardClear } from "../scanDisplaySlotsAndTickBoardClear.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = 0x8d90; // isolated 4-slot record region (bytes REC..REC+7)
const HUNTER_PAGE = 0x8c00;
const BOARD_CLEAR_FLAG = 0x89e5;
const TILE_CHECKSUM_LATCH = 0x8f55;
const COUNT = 0x04; // the callers' preset loop count

const counterAddr = (field0) => HUNTER_PAGE | ((field0 + 0x05) & 0xff);
const pairedAddr = (field0) => (counterAddr(field0) + 1) & 0xffff;
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);
function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** A fresh clone with IX=REC, B=4, the 4 slots and any counter/gate cells seated. */
function craft(pokes) {
  const m = BASE.clone();
  m.regs.ix = REC;
  m.regs.b = COUNT;
  m.regs.sp = 0x8ffe; // stack lives in STACK_SCRATCH; oracle call/ret only touch it there
  // default all 4 slots to a non-matching tag, field-0 zero
  for (let i = 0; i < 4; i++) {
    m.mem8[REC + 2 * i] = 0x00;
    m.mem8[REC + 2 * i + 1] = 0x00;
  }
  m.mem8[BOARD_CLEAR_FLAG] = 0x00;
  for (const [addr, val] of pokes) m.mem8[addr] = val & 0xff;
  return m;
}

// slot n's field-0 is REC+2n, its tag REC+2n+1. Tag 0x8c triggers tickHunterReturnCounterAndCheckBoardClear.
const CASES = [
  { name: "no match (all tags != 0x8c)", pokes: [] },
  { name: "match slot0, below threshold (skip)", pokes: [[REC + 0, 0x30], [REC + 1, 0x8c]] },
  {
    name: "match slot1, no borrow",
    pokes: [[REC + 2, 0x44], [REC + 3, 0x8c], [counterAddr(0x44), 0x50]],
  },
  {
    name: "match slot2, borrow (board-clear off)",
    pokes: [[REC + 4, 0x48], [REC + 5, 0x8c], [counterAddr(0x48), 0x10], [pairedAddr(0x48), 0x05]],
  },
  {
    name: "match slot3, borrow + board-clear tail (verifyPlayfieldTileChecksum no-op)",
    pokes: [
      [REC + 6, 0x4c], [REC + 7, 0x8c], [counterAddr(0x4c), 0x10], [pairedAddr(0x4c), 0x05],
      [BOARD_CLEAR_FLAG, 0x01], [TILE_CHECKSUM_LATCH, 0x01],
    ],
  },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted 4-slot layouts — scanDisplaySlotsAndTickBoardClear == oracle in RAM (−stack)", () => {
  for (const cse of CASES) {
    const o = craft(cse.pokes);
    oracle(o);
    const c = craft(cse.pokes);
    scanDisplaySlotsAndTickBoardClear(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${cse.name}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted layouts identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: a single borrow match writes only the counter cell and paired byte", () => {
  const field0 = 0x48;
  const footprint = new Set([counterAddr(field0), pairedAddr(field0)]);
  const pokes = [[REC + 4, field0], [REC + 5, 0x8c], [counterAddr(field0), 0x10], [pairedAddr(field0), 0x05]];

  const before = craft(pokes);
  const after = craft(pokes);
  const b = before.dumpState();
  oracle(after);
  const a = after.dumpState();

  const changed = [];
  for (let off = 0; off < b.length; off++) {
    const ad = after.stateOffsetToAddr(off);
    if (b[off] !== a[off] && !inDeadStack(ad)) changed.push(ad); // -stack: oracle call trampolines push there
  }
  assert.equal(changed.length, 2, `expected 2 writes, got ${changed.length}`);
  for (const addr of changed) assert.ok(footprint.has(addr), `unexpected write at ${hx(addr)}`);
  assert.equal(after.mem8[counterAddr(field0)], (0x10 - 0x40) & 0xff, "counter dropped by 0x40 (borrow)");
  assert.equal(after.mem8[pairedAddr(field0)], 0x04, "paired byte decremented (0x05 -> 0x04)");
  console.log(`  WRITE-SET: ${hx(counterAddr(field0))} + ${hx(pairedAddr(field0))} (2 cells)`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong counter byte is CAUGHT by the RAM diff", () => {
  const field0 = 0x44;
  const pokes = [[REC + 2, field0], [REC + 3, 0x8c], [counterAddr(field0), 0x50]];
  const o = craft(pokes);
  const c = craft(pokes);
  oracle(o);
  scanDisplaySlotsAndTickBoardClear(c);
  c.mem8[counterAddr(field0)] = 0x00; // BUG: counter must be 0x50 - 0x40 = 0x10

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong counter byte — it is worthless");
  assert.equal(d.addr, counterAddr(field0), `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong counter caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

