// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for stampCappedTileColumn (ROM 0x02a8) — "stamp a three-tile column": write the
 * cap tile 0x01 at the start cell, then the mid tile 0x25 one row stride down and the base
 * tile 0x20 a second stride down (the body-tile helper it falls into).
 *
 * This is the CYCLE-FREE / memory-equivalence gate. The routine WRITES video RAM, so every
 * case uses a FRESH clone per side, compared on:
 *
 *     RAM (dumpState, minus stack scratch below the entry SP) + the advanced pointer.
 *
 * pc/SP/cycles are NOT compared. The advanced pointer HL = start + 2*stride is checked as an
 * idiomatic-only return: the oracle leaves it in HL, but the sole caller reloads its own
 * pointer immediately after, so it is NOT load-bearing — hence no c.regs.hl side-effect arm.
 *
 * The leaf runs during live sprite-scroll gameplay, not attract, so every case is CRAFTED:
 * an identical (HL, DE) poke on both sides, HL/DE being the only inputs. CASES[0] is the real
 * caller state (start 0x8740, stride 0xffe0).
 *
 * Jobs: 1. EQUAL over curated (start,stride) pairs; 2. WRITE-SET (exactly the three cells);
 * 3. CRAFTED overwrite of pre-dirtied cells; 4. TEETH (wrong tile byte + wrong returned HL).
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-02a8.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_02a8 as oracle } from "../../translated/loc_02a8.js";
import { stampCappedTileColumn } from "../stampCappedTileColumn.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const TILE_CAP = 0x01;
const TILE_MID = 0x25;
const TILE_BASE = 0x20;
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function craft(start, stride) {
  const m = BASE.clone();
  m.regs.hl = start & 0xffff;
  m.regs.de = stride & 0xffff;
  m.regs.sp = 0x8ffe;
  return m;
}

/** The three cells the routine writes, in order: cap, mid, base. */
function cells(start, stride) {
  const c0 = start & 0xffff;
  const c1 = (c0 + stride) & 0xffff;
  const c2 = (c1 + stride) & 0xffff;
  return [c0, c1, c2];
}

const CASES = [
  { start: 0x8740, stride: 0xffe0 }, // the real caller state
  { start: 0x8420, stride: 0x0020 },
  { start: 0x84e0, stride: 0xffe0 },
  { start: 0x8460, stride: 0x0020 },
  { start: 0x8401, stride: 0x0020 },
  { start: 0x87c0, stride: 0x0020 },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted (start,stride) — stampCappedTileColumn == oracle in RAM (−stack) + advanced pointer", () => {
  for (const { start, stride } of CASES) {
    const o = craft(start, stride);
    const c = craft(start, stride);
    oracle(o);
    const ret = stampCappedTileColumn(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiom=${d.b} (start=${hx(start)} stride=${hx(stride)})`);
    // HL is idiomatic-only (not load-bearing): compare the return to the oracle's HL, no side-effect arm.
    assert.equal(ret & 0xffff, o.regs.hl & 0xffff, `advanced-pointer mismatch for start=${hx(start)} stride=${hx(stride)}`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted cases identical (RAM −stack + advanced pointer)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the oracle's only writes are cap:=0x01, mid:=0x25, base:=0x20", () => {
  const { start, stride } = CASES[0];
  const [c0, c1, c2] = cells(start, stride);

  const before = craft(start, stride);
  const after = craft(start, stride);
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();

  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) changed.push({ addr: after.stateOffsetToAddr(off), to: a1[off] });
  }
  assert.equal(changed.length, 3, `expected exactly 3 written cells, got ${changed.length}`);
  const byAddr = new Map(changed.map((ch) => [ch.addr, ch.to]));
  assert.equal(byAddr.get(c0), TILE_CAP, `cap cell ${hx(c0)} must be 0x01`);
  assert.equal(byAddr.get(c1), TILE_MID, `mid cell ${hx(c1)} must be 0x25`);
  assert.equal(byAddr.get(c2), TILE_BASE, `base cell ${hx(c2)} must be 0x20`);
  console.log(`  WRITE-SET: ${hx(c0)}:=0x01, ${hx(c1)}:=0x25, ${hx(c2)}:=0x20 (3 cells)`);
});

// -- 3. CRAFTED (overwrite) ---------------------------------------------------

test("CRAFTED: pre-dirtied target cells are overwritten identically", () => {
  const { start, stride } = CASES[0];
  const cs = cells(start, stride);

  const o = craft(start, stride);
  const c = craft(start, stride);
  for (const cell of cs) {
    o.mem.write8(cell, 0xaa);
    c.mem.write8(cell, 0xaa);
  }
  oracle(o);
  stampCappedTileColumn(c);

  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiom=${d.b}`);
  const want = [TILE_CAP, TILE_MID, TILE_BASE];
  cs.forEach((cell, i) => assert.equal(c.mem.read8(cell), want[i], `cell ${hx(cell)} not overwritten`));
  console.log(`  CRAFTED: ${cs.map(hx).join("/")} dirtied to 0xAA -> overwritten to 0x01/0x25/0x20`);
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: a wrong cap-cell byte is CAUGHT by the RAM diff", () => {
  const { start, stride } = CASES[0];
  const [c0] = cells(start, stride);

  const o = craft(start, stride);
  const c = craft(start, stride);
  oracle(o);
  stampCappedTileColumn(c);
  c.mem.write8(c0, 0x00); // BUG: cap cell must be 0x01, not 0x00

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong cap byte — it is worthless");
  assert.equal(d.addr, c0, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(c0)})`);
  console.log(`  TEETH/RAM: wrong cap byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong advanced pointer is CAUGHT by the return check", () => {
  const { start, stride } = CASES[0];
  const o = craft(start, stride);
  const c = craft(start, stride);
  oracle(o);
  const ret = stampCappedTileColumn(c);
  assert.equal(ret, o.regs.hl, "sanity: the module's advanced pointer matches the oracle");
  // an under-advanced return (one stride short) is a plausible bug the === check must reject
  assert.notEqual((start + stride) & 0xffff, o.regs.hl, "the pointer check must reject an under-advanced value");
  console.log(`  TEETH/PTR: module pointer ${hx(ret)} == oracle; under-advanced ${hx((start + stride) & 0xffff)} is rejected`);
});
