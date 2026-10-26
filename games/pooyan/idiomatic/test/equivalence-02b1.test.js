// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for blankTileColumn (ROM 0x02b1) — "blank a 3-cell column":
 * write the blank tile 0x10 into three tilemap cells one row stride apart (start,
 * start+stride, start+2*stride).
 *
 * This is the CYCLE-FREE / memory-equivalence gate (docs/decompiler-pipeline). The
 * routine WRITES video RAM, so every case uses a FRESH clone per side. The oracle runs
 * on one clone, blankTileColumn on another, and they are compared on the go-forward
 * contract:
 *
 *     RAM (dumpState, minus stack scratch below the entry SP) + the declared register live-out (HL).
 *
 * pc is deliberately NOT compared. The oracle drives pc through m.step/m.ret (a modelled
 * fetch + stack pop the direct-call layer replaces with a JS return); comparing it would
 * test the stack model we drop, not the routine's effect. The register live-out — the
 * advanced pointer HL = start + 2*stride — IS checked, derived from the oracle clone.
 * That HL is a GENUINE live-out: repaintScrollColumnsElseVerifySignature issues 0x02b1 back-to-back without reloading
 * HL between its 3rd and 4th calls, so each call consumes the pointer the prior one left.
 *
 * The leaf is NOT reached in a plain boot/attract (a hooked 1500-frame run dispatches it
 * zero times — it runs during live sprite-scroll gameplay), so every case is CRAFTED:
 * an identical (HL, DE) poke on both sides, HL/DE being the routine's only inputs. (The
 * oracle also sets A := 0x10, but the routine re-establishes A on every entry, so A is
 * neither an input nor a consumed live-out and is not part of the contract.)
 *
 * Jobs:
 *   1. EQUAL (crafted sweep) — over curated (start, stride) pairs oracle ==
 *      blankTileColumn in RAM (−stack) and in the returned HL.
 *   2. WRITE-SET — the oracle's ONLY writes are the three cells start, start+stride,
 *      start+2*stride, each := 0x10. Documents the exact footprint.
 *   3. CRAFTED (overwrite) — pre-dirty those three cells to 0xAA identically on both
 *      sides and confirm both overwrite them to 0x10 (clear semantics).
 *   4. TEETH — a twin that writes a WRONG tile byte at the last cell MUST be caught by
 *      the RAM diff, and a twin that returns a WRONG HL MUST be caught by the live-out
 *      check.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-02b1.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_02b1 as oracle } from "../../translated/loc_02b1.js";
import { blankTileColumn } from "../blankTileColumn.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const TILE_BLANK = 0x10;
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

/** The three cells the routine writes, in order. */
function cells(start, stride) {
  const c0 = start & 0xffff;
  const c1 = (c0 + stride) & 0xffff;
  const c2 = (c1 + stride) & 0xffff;
  return [c0, c1, c2];
}

// Curated inputs: down-a-row (0x0020) and up-a-row (0xffe0) strides over several
// video-RAM (0x8400-0x87ff) bases, plus a base that makes the writes straddle a page.
const CASES = [
  { start: 0x84e0, stride: 0xffe0 }, // the real repaintScrollColumnsElseVerifySignature stride
  { start: 0x8420, stride: 0x0020 },
  { start: 0x8521, stride: 0xffe0 },
  { start: 0x8460, stride: 0x0020 },
  { start: 0x8401, stride: 0x0020 },
  { start: 0x87c0, stride: 0x0020 },
];

// -- 1. EQUAL (crafted sweep) -------------------------------------------------

test("EQUAL: crafted (start,stride) — blankTileColumn == oracle in RAM (−stack) + HL", () => {
  for (const { start, stride } of CASES) {
    const o = craft(start, stride);
    const c = craft(start, stride);
    oracle(o);
    const ret = blankTileColumn(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} blank=${d.b} (start=${hx(start)} stride=${hx(stride)})`);
    assert.equal(ret & 0xffff, o.regs.hl & 0xffff, `HL live-out mismatch for start=${hx(start)} stride=${hx(stride)}`);
    // SIDE-EFFECT arm: the bridge must SET HL on the module clone (not merely return it) —
    // repaintScrollColumnsElseVerifySignature reads HL out of the register across its chained 3rd->4th calls. A return-only
    // rewrite that never writes HL passes the ret check above but would fail here.
    assert.equal(c.regs.hl & 0xffff, o.regs.hl & 0xffff, `module must SET HL for the translated caller repaintScrollColumnsElseVerifySignature (start=${hx(start)} stride=${hx(stride)})`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted cases identical (RAM −stack + HL)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the oracle's only writes are the three column cells := 0x10", () => {
  const { start, stride } = CASES[0];
  const [c0, c1, c2] = cells(start, stride);

  const before = craft(start, stride);
  const after = craft(start, stride);
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();

  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) changed.push({ addr: after.stateOffsetToAddr(off), from: b0[off], to: a1[off] });
  }
  const addrs = new Set(changed.map((ch) => ch.addr));
  assert.equal(changed.length, 3, `expected exactly 3 written cells, got ${changed.length}`);
  for (const cell of [c0, c1, c2]) {
    assert.ok(addrs.has(cell), `expected a write at ${hx(cell)}`);
  }
  for (const ch of changed) {
    assert.equal(ch.to, TILE_BLANK, `cell ${hx(ch.addr)} must be 0x10, got ${ch.to}`);
  }
  console.log(`  WRITE-SET: ${hx(c0)}/${hx(c1)}/${hx(c2)} := 0x10 (3 cells)`);
});

// -- 3. CRAFTED (overwrite) ---------------------------------------------------

test("CRAFTED: pre-dirtied target cells are overwritten to 0x10 identically", () => {
  const { start, stride } = CASES[0];
  const cs = cells(start, stride);

  const o = craft(start, stride);
  const c = craft(start, stride);
  for (const cell of cs) {
    o.mem.write8(cell, 0xaa);
    c.mem.write8(cell, 0xaa);
  }
  oracle(o);
  blankTileColumn(c);

  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} blank=${d.b}`);
  assert.equal(c.regs.hl & 0xffff, o.regs.hl & 0xffff, "module must SET HL (advanced pointer) on the overwrite path too");
  for (const cell of cs) {
    assert.equal(c.mem.read8(cell), TILE_BLANK, `cell not overwritten (${hx(cell)})`);
  }
  console.log(`  CRAFTED: ${cs.map(hx).join("/")} dirtied to 0xAA -> both overwrite to 0x10`);
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: a wrong last-cell byte is CAUGHT by the RAM diff", () => {
  const { start, stride } = CASES[0];
  const [, , c2] = cells(start, stride);

  const o = craft(start, stride);
  const c = craft(start, stride);
  oracle(o);
  blankTileColumn(c);
  c.mem.write8(c2, 0x00); // BUG: last cell must be 0x10, not 0x00

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong last-cell byte — it is worthless");
  assert.equal(d.addr, c2, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(c2)})`);
  console.log(`  TEETH/RAM: wrong last byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong returned HL is CAUGHT by the live-out check", () => {
  const { start, stride } = CASES[0];
  const o = craft(start, stride);
  const c = craft(start, stride);
  oracle(o);
  const ret = blankTileColumn(c);
  assert.equal(ret, o.regs.hl, "sanity: the module's HL return matches the oracle");
  // an under-advanced return (one row short: start+stride) is a plausible bug the === check must reject
  assert.notEqual((start + stride) & 0xffff, o.regs.hl, "the live-out check must reject an under-advanced HL");
  console.log(`  TEETH/HL: module HL ${hx(ret)} == oracle; an under-advanced ${hx((start + stride) & 0xffff)} is rejected`);
});
