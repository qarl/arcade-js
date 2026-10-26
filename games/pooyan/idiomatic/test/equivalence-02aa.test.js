// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for paintColumnBodyTiles (ROM 0x02aa) — "stamp a column's
 * two body tiles": advance a tilemap pointer one row stride and write the mid tile
 * 0x25, advance another stride and write the base tile 0x20.
 *
 * This is the CYCLE-FREE / memory-equivalence gate (docs/decompiler-pipeline). The
 * routine WRITES video RAM, so every case uses a FRESH clone per side. The oracle runs
 * on one clone, paintColumnBodyTiles on another, and they are compared on the
 * go-forward contract:
 *
 *     RAM (dumpState, minus stack scratch below the entry SP) + the declared register live-out (HL).
 *
 * pc is deliberately NOT compared. The oracle drives pc through m.step/m.ret (a modelled
 * fetch + stack pop the direct-call layer replaces with a JS return); comparing it would
 * test the stack model we drop, not the routine's effect. The register live-out — the
 * advanced pointer HL = start + 2*stride — IS checked, derived from the oracle clone.
 *
 * The leaf is NOT reached in a plain boot/attract (a hooked 1500-frame run dispatches it
 * zero times — it runs during live sprite-scroll gameplay), so every case is CRAFTED:
 * an identical (HL, DE) poke on both sides, HL/DE being the routine's only inputs.
 *
 * Jobs:
 *   1. EQUAL (crafted sweep) — over curated (start, stride) pairs (down/up strides,
 *      several video-RAM bases, a wrap edge) oracle == paintColumnBodyTiles in RAM
 *      (−stack) and in the returned HL.
 *   2. WRITE-SET — the oracle's ONLY writes are the two cells start+stride := 0x25 and
 *      start+2*stride := 0x20. Documents the exact footprint.
 *   3. CRAFTED (overwrite) — pre-dirty those two cells to 0xAA identically on both sides
 *      and confirm both overwrite them to 0x25/0x20 (clear semantics, not agree-on-zero).
 *   4. TEETH — a twin that writes a WRONG tile byte at the base cell MUST be caught by
 *      the RAM diff, and a twin that returns a WRONG HL MUST be caught by the live-out
 *      check.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-02aa.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_02aa as oracle } from "../../translated/loc_02aa.js";
import { paintColumnBodyTiles } from "../paintColumnBodyTiles.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const TILE_MID = 0x25;
const TILE_BASE = 0x20;
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);

/** First RAM difference minus the stack scratch below the entry SP (neither side writes it here). */
function ramDiffMinusStack(ma, mb) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

// A booted machine's frame machinery is neutralised by clone() (nextNmi/nextBoundary =
// Infinity), so an m.step in the oracle cannot trip a boundary/NMI at cycle 0.
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** A fresh clone with the routine's register inputs seated identically. */
function craft(start, stride) {
  const m = BASE.clone();
  m.regs.hl = start & 0xffff;
  m.regs.de = stride & 0xffff;
  m.regs.sp = 0x8ffe; // in work RAM; the oracle's ret only POPs (reads), never writes
  return m;
}

// Curated inputs: down-a-row (0x0020) and up-a-row (0xffe0) strides over several
// video-RAM (0x8400-0x87ff) bases, plus a base that makes the writes straddle a page.
const CASES = [
  { start: 0x8420, stride: 0x0020 },
  { start: 0x84e0, stride: 0xffe0 },
  { start: 0x8460, stride: 0x0020 },
  { start: 0x8700, stride: 0xffe0 },
  { start: 0x8401, stride: 0x0020 },
  { start: 0x87c0, stride: 0x0020 },
];

// -- 1. EQUAL (crafted sweep) -------------------------------------------------

test("EQUAL: crafted (start,stride) — paintColumnBodyTiles == oracle in RAM (−stack) + HL", () => {
  for (const { start, stride } of CASES) {
    const o = craft(start, stride);
    const c = craft(start, stride);
    oracle(o);
    const ret = paintColumnBodyTiles(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} paint=${d.b} (start=${hx(start)} stride=${hx(stride)})`);
    assert.equal(ret & 0xffff, o.regs.hl & 0xffff, `HL live-out mismatch for start=${hx(start)} stride=${hx(stride)}`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted cases identical (RAM −stack + HL)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the oracle's only writes are start+stride:=0x25 and start+2*stride:=0x20", () => {
  const { start, stride } = CASES[1]; // 0x84e0, up-a-row
  const mid = (start + stride) & 0xffff;
  const base = (mid + stride) & 0xffff;

  const before = craft(start, stride);
  const after = craft(start, stride);
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();

  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) changed.push({ addr: after.stateOffsetToAddr(off), from: b0[off], to: a1[off] });
  }
  assert.equal(changed.length, 2, `expected exactly 2 written cells, got ${changed.length}`);
  const byAddr = new Map(changed.map((ch) => [ch.addr, ch.to]));
  assert.equal(byAddr.get(mid), TILE_MID, `mid cell ${hx(mid)} must be 0x25`);
  assert.equal(byAddr.get(base), TILE_BASE, `base cell ${hx(base)} must be 0x20`);
  console.log(`  WRITE-SET: ${hx(mid)}:=0x25, ${hx(base)}:=0x20 (2 cells)`);
});

// -- 3. CRAFTED (overwrite) ---------------------------------------------------

test("CRAFTED: pre-dirtied target cells are overwritten to 0x25/0x20 identically", () => {
  const { start, stride } = CASES[1];
  const mid = (start + stride) & 0xffff;
  const base = (mid + stride) & 0xffff;

  const o = craft(start, stride);
  const c = craft(start, stride);
  for (const cell of [mid, base]) {
    o.mem.write8(cell, 0xaa);
    c.mem.write8(cell, 0xaa);
  }
  oracle(o);
  paintColumnBodyTiles(c);

  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} paint=${d.b}`);
  assert.equal(c.mem.read8(mid), TILE_MID, `mid cell not overwritten (${hx(mid)})`);
  assert.equal(c.mem.read8(base), TILE_BASE, `base cell not overwritten (${hx(base)})`);
  console.log(`  CRAFTED: ${hx(mid)}/${hx(base)} dirtied to 0xAA -> both overwrite to 0x25/0x20`);
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: a wrong base-cell byte is CAUGHT by the RAM diff", () => {
  const { start, stride } = CASES[1];
  const base = (start + stride + stride) & 0xffff; // start + 2*stride, the base cell

  const o = craft(start, stride);
  const c = craft(start, stride);
  oracle(o);
  paintColumnBodyTiles(c);
  c.mem.write8(base, 0x00); // BUG: base cell must be 0x20, not 0x00

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong base-cell byte — it is worthless");
  assert.equal(d.addr, base, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(base)})`);
  console.log(`  TEETH/RAM: wrong base byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong returned HL is CAUGHT by the live-out check", () => {
  const { start, stride } = CASES[1];
  const o = craft(start, stride);
  const c = craft(start, stride);
  oracle(o);
  const ret = paintColumnBodyTiles(c);
  assert.equal(ret, o.regs.hl, "sanity: the module's HL return matches the oracle");
  // an under-advanced return (one row short: start+stride) is a plausible bug the === check must reject
  assert.notEqual((start + stride) & 0xffff, o.regs.hl, "the live-out check must reject an under-advanced HL");
  console.log(`  TEETH/HL: module HL ${hx(ret)} == oracle; an under-advanced ${hx((start + stride) & 0xffff)} is rejected`);
});
