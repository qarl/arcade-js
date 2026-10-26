// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for tickHunterReturnCounterAndCheckBoardClear (ROM 0x324d, Pooyan) — "per-slot hunter-return tick".
 * A slot whose (IX+0) < 0x40 is skipped. Otherwise a paced counter on the hunter page
 * (0x8c00 | ((IX+0)+5)) is dropped by 0x40; if that did not borrow it returns. On a borrow it
 * decrements the paired byte one cell up, and if BOARD_CLEAR_FLAG (0x89e5) is set it tail-calls
 * the board tile-sum check verifyPlayfieldTileChecksum (returning its result).
 *
 * Cycle-free memory-equivalence gate: a fresh clone per side, compared on RAM (dumpState,
 * minus stack scratch below the entry SP) PLUS register B. B is the loop counter of the sole caller scanDisplaySlotsAndTickBoardClear
 * (`inc ix; inc ix; djnz` right after the call), so it must survive the call; tickHunterReturnCounterAndCheckBoardClear never
 * writes B, and on the board-clear tail path the check leaves it untouched too, so it is
 * checked equal to the oracle (a broken twin that clobbers B is caught). A/HL/flags are left
 * modified but scanDisplaySlotsAndTickBoardClear reads none of them (inc ix and djnz consult neither), so they are not
 * compared.
 *
 * The board-clear tail path is exercised with TILE_CHECKSUM_LATCH (0x8f55) pre-set, so both the
 * translated and idiomatic verifyPlayfieldTileChecksum early-return (no writes, B untouched); the checksum-scan
 * arm of verifyPlayfieldTileChecksum has its own gate. The mismatch/throw arm cannot be reached without corrupting
 * the read-only tile region, so it is not crafted here (see notes in the batch return).
 *
 * Jobs:
 *   1. EQUAL (crafted) — below-threshold skip; no-borrow drop; borrow + paired dec (board flag
 *      clear); borrow + board-clear tail-call (verifyPlayfieldTileChecksum no-op): oracle == module in RAM (−stack)
 *      and in B.
 *   2. WRITE-SET — the borrow path's only writes are the counter cell and the paired byte.
 *   3. TEETH — a wrong counter byte (RAM) and a clobbered B (live-out) are each CAUGHT.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-324d.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_324d as oracle } from "../../translated/loc_324d.js";
import { tickHunterReturnCounterAndCheckBoardClear } from "../tickHunterReturnCounterAndCheckBoardClear.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = 0x8d90; // isolated work-RAM record base; only (IX+0) is read
const HUNTER_PAGE = 0x8c00;
const BOARD_CLEAR_FLAG = 0x89e5;
const TILE_CHECKSUM_LATCH = 0x8f55;
const B_SENTINEL = 0x07; // the caller's loop counter, which tickHunterReturnCounterAndCheckBoardClear must preserve

const counterAddr = (slot) => HUNTER_PAGE | ((slot + 0x05) & 0xff);
const pairedAddr = (slot) => (counterAddr(slot) + 1) & 0xffff;
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** A fresh clone with (IX+0)=slot, the slot's counter/paired cells, and the two gates seated. */
function craft(slot, counterVal, boardFlag, latch) {
  const m = BASE.clone();
  m.regs.ix = REC;
  m.mem.write8(REC, slot & 0xff);
  m.mem.write8(counterAddr(slot), counterVal & 0xff);
  m.mem.write8(pairedAddr(slot), 0x05); // paired byte value, for the borrow-path dec
  m.mem.write8(BOARD_CLEAR_FLAG, boardFlag & 0xff);
  m.mem.write8(TILE_CHECKSUM_LATCH, latch & 0xff);
  m.regs.b = B_SENTINEL;
  m.regs.sp = 0x8ffe;
  return m;
}

const CASES = [
  { name: "skip (slot < 0x40)", slot: 0x30, counterVal: 0x50, boardFlag: 0x00, latch: 0x01 },
  { name: "no-borrow drop", slot: 0x40, counterVal: 0x50, boardFlag: 0x00, latch: 0x01 },
  { name: "borrow + paired dec", slot: 0x44, counterVal: 0x20, boardFlag: 0x00, latch: 0x01 },
  { name: "borrow + board-clear tail (verifyPlayfieldTileChecksum no-op)", slot: 0x48, counterVal: 0x10, boardFlag: 0x01, latch: 0x01 },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted slot/counter/gate cases — tickHunterReturnCounterAndCheckBoardClear == oracle in RAM (−stack) + B", () => {
  for (const { name, slot, counterVal, boardFlag, latch } of CASES) {
    const o = craft(slot, counterVal, boardFlag, latch);
    oracle(o);
    const c = craft(slot, counterVal, boardFlag, latch);
    tickHunterReturnCounterAndCheckBoardClear(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${name}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    assert.equal(c.regs.b, o.regs.b, `[${name}] B must be preserved (caller loop counter)`);
    assert.equal(c.regs.b, B_SENTINEL, `[${name}] B must still be the seeded loop counter`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted cases identical (RAM −stack + B)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the borrow path writes only the counter cell and the paired byte", () => {
  const { slot, counterVal, boardFlag, latch } = CASES[2];
  const footprint = new Set([counterAddr(slot), pairedAddr(slot)]);

  const m = craft(slot, counterVal, boardFlag, latch);
  const b0 = m.dumpState();
  oracle(m);
  const a1 = m.dumpState();

  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) changed.push(m.stateOffsetToAddr(off));
  }
  assert.equal(changed.length, 2, `expected 2 writes, got ${changed.length}`);
  for (const addr of changed) assert.ok(footprint.has(addr), `unexpected write at ${hx(addr)}`);
  assert.equal(m.mem.read8(counterAddr(slot)), (counterVal - 0x40) & 0xff, "counter dropped by 0x40");
  assert.equal(m.mem.read8(pairedAddr(slot)), 0x04, "paired byte decremented (0x05 -> 0x04)");
  console.log(`  WRITE-SET: ${hx(counterAddr(slot))} := ${hx((counterVal - 0x40) & 0xff)}, ${hx(pairedAddr(slot))} := 0x04 (2 cells)`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong counter byte is CAUGHT by the RAM diff", () => {
  const { slot, counterVal, boardFlag, latch } = CASES[1];
  const o = craft(slot, counterVal, boardFlag, latch);
  const c = craft(slot, counterVal, boardFlag, latch);
  oracle(o);
  tickHunterReturnCounterAndCheckBoardClear(c);
  c.mem.write8(counterAddr(slot), 0x00); // BUG: counter must be counterVal-0x40
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong counter byte — it is worthless");
  assert.equal(d.addr, counterAddr(slot), `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a clobbered B is CAUGHT by the live-out check", () => {
  const { slot, counterVal, boardFlag, latch } = CASES[2];
  const o = craft(slot, counterVal, boardFlag, latch);
  oracle(o);
  const c = craft(slot, counterVal, boardFlag, latch);
  tickHunterReturnCounterAndCheckBoardClear(c);
  c.regs.b = (o.regs.b + 1) & 0xff; // BUG: the caller's loop counter must survive intact
  assert.notEqual(c.regs.b, o.regs.b, "the B live-out check must reject a clobbered loop counter");
  console.log(`  TEETH(B): clobbered B ${hx(c.regs.b)} rejected against oracle ${hx(o.regs.b)}`);
});
