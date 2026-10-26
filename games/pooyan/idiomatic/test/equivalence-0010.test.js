// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for fillByteRun (Pooyan) — "fill a run of bytes": write the fill byte
 * into `count` cells from a start pointer, advancing the pointer, where a zero counter means a
 * full 256.
 *
 * CYCLE-FREE / memory-equivalence gate (docs/decompiler-pipeline). The routine WRITES RAM, so
 * each case runs the oracle on one FRESH clone and fillByteRun on another, compared on:
 *
 *     RAM (dumpState, minus stack scratch below the entry SP)  +  the declared register live-out (HL).
 *
 * pc/SP are NOT compared (the oracle drives them through the dropped call/stack ABI; neither is
 * in dumpState). HL — the advanced pointer start+count — IS a genuine live-out: a caller issues
 * this fill and then adds a row stride to HL without reloading it, so the bridge SETS HL and the
 * module clone's HL is asserted equal to the oracle clone's. A/B are not consumed by any caller
 * (the fill byte is an input re-supplied each entry; the counter ends at zero), so they are not
 * part of the contract.
 *
 * The routine is a register-dispatched fill helper reached mid-sequence, so every case is CRAFTED:
 * identical (start, fill, len) poked on both sides.
 *
 * Jobs:
 *   1. EQUAL (crafted) — over curated (start, fill, len) triples oracle == fillByteRun in RAM(−stack)
 *      and in HL, and the module SETS HL on its own clone (the side effect the caller reads).
 *   2. WRITE-SET — the oracle's only writes are the `count` filled cells, each := fill.
 *   3. CRAFTED (zero counter) — len 0 fills a full 256 cells (the djnz wrap), checked explicitly.
 *   4. TEETH — a twin with a WRONG last filled byte MUST be caught by the RAM diff, and a twin
 *      returning an UNDER-ADVANCED HL MUST be rejected by the live-out check.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-0010.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0010 as oracle } from "../../translated/loc_0010.js";
import { fillByteRun } from "../fillByteRun.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);

function ramDiffMinusStack(ma, mb) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** A fresh clone with the fill's register inputs seated identically; sp parked in dead scratch. */
function craft(start, fill, len) {
  const m = BASE.clone();
  m.regs.hl = start & 0xffff;
  m.regs.a = fill & 0xff;
  m.regs.b = len & 0xff;
  m.regs.sp = 0x8ffe; // in STACK_SCRATCH; the oracle's ret only POPs (reads) dead RAM
  return m;
}

/** The cells the fill writes, in order (len 0 means 256). */
function cells(start, len) {
  const n = len === 0 ? 256 : len;
  const out = [];
  let c = start & 0xffff;
  for (let i = 0; i < n; i++) {
    out.push(c);
    c = (c + 1) & 0xffff;
  }
  return out;
}

// Curated inputs: short and single-cell fills over video RAM, a full row (0x20), a work-RAM base,
// and the zero-counter 256 fill. Fill bytes are non-zero so every write is a visible change.
const CASES = [
  { start: 0x8500, fill: 0x3c, len: 5 },
  { start: 0x8420, fill: 0xa5, len: 1 },
  { start: 0x8600, fill: 0x11, len: 0x20 },
  { start: 0x8880, fill: 0x09, len: 8 },
  { start: 0x8480, fill: 0x77, len: 0 }, // zero counter -> 256
];

// -- 1. EQUAL (crafted) -------------------------------------------------------

test("EQUAL: crafted (start,fill,len) — fillByteRun == oracle in RAM(−stack) + HL", () => {
  for (const { start, fill, len } of CASES) {
    const o = craft(start, fill, len);
    const c = craft(start, fill, len);
    oracle(o);
    const ret = fillByteRun(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} mine=${d.b} (start=${hx(start)} len=${len})`);
    assert.equal(ret & 0xffff, o.regs.hl & 0xffff, `HL live-out mismatch (start=${hx(start)} len=${len})`);
    // SIDE-EFFECT: the bridge must SET HL on the module clone — a caller adds a stride to HL after.
    assert.equal(c.regs.hl & 0xffff, o.regs.hl & 0xffff, `module must SET HL for the caller (start=${hx(start)} len=${len})`);
    // B live-out: djnz drains the counter to 0; a caller reads that zero, so the module must set it too.
    assert.equal(c.regs.b & 0xff, o.regs.b & 0xff, `B live-out mismatch — djnz leaves B=0 (start=${hx(start)} len=${len})`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted fills identical (RAM −stack + HL + B)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the oracle's only writes are the filled cells := fill", () => {
  const { start, fill, len } = CASES[0];
  const cs = cells(start, len);

  const before = craft(start, fill, len);
  const after = craft(start, fill, len);
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();

  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) {
      const addr = after.stateOffsetToAddr(off);
      if (!inDeadStack(addr)) changed.push({ addr, to: a1[off] });
    }
  }
  const addrs = new Set(changed.map((ch) => ch.addr));
  assert.equal(changed.length, cs.length, `expected ${cs.length} filled cells, got ${changed.length}`);
  for (const cell of cs) assert.ok(addrs.has(cell), `expected a write at ${hx(cell)}`);
  for (const ch of changed) assert.equal(ch.to, fill, `cell ${hx(ch.addr)} must be ${hx(fill)}, got ${ch.to}`);
  console.log(`  WRITE-SET: ${cs.length} cells ${hx(cs[0])}..${hx(cs[cs.length - 1])} := ${hx(fill)}`);
});

// -- 3. CRAFTED (zero counter -> 256) -----------------------------------------

test("CRAFTED: a zero counter fills a full 256 cells", () => {
  const start = 0x8480;
  const fill = 0x55;
  const o = craft(start, fill, 0);
  const c = craft(start, fill, 0);
  oracle(o);
  const ret = fillByteRun(c);

  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} mine=${d.b}`);
  assert.equal(ret & 0xffff, (start + 256) & 0xffff, "256-fill must advance HL by 0x100");
  assert.equal(c.regs.hl & 0xffff, o.regs.hl & 0xffff, "module must SET the advanced HL on the 256 path");
  assert.equal(c.mem.read8(start), fill, "first cell filled");
  assert.equal(c.mem.read8((start + 255) & 0xffff), fill, "256th cell filled");
  console.log(`  CRAFTED: zero counter filled 256 cells ${hx(start)}.. and HL -> ${hx(ret)}`);
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: a wrong last filled byte is CAUGHT by the RAM diff", () => {
  const { start, fill, len } = CASES[0];
  const last = (start + len - 1) & 0xffff;

  const o = craft(start, fill, len);
  const c = craft(start, fill, len);
  oracle(o);
  fillByteRun(c);
  c.mem.write8(last, (fill ^ 0xff) & 0xff); // BUG: wrong byte at the last filled cell

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong filled byte — it is worthless");
  assert.equal(d.addr, last, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(last)})`);
  console.log(`  TEETH/RAM: wrong last byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: an under-advanced HL is REJECTED by the live-out check", () => {
  const { start, fill, len } = CASES[0];
  const o = craft(start, fill, len);
  const c = craft(start, fill, len);
  oracle(o);
  const ret = fillByteRun(c);
  assert.equal(ret & 0xffff, o.regs.hl & 0xffff, "sanity: the module's HL matches the oracle");
  // one cell short (start+len-1) is the plausible off-by-one the === check must reject
  assert.notEqual((start + len - 1) & 0xffff, o.regs.hl & 0xffff, "the live-out check must reject an under-advanced HL");
  console.log(`  TEETH/HL: module HL ${hx(ret)} == oracle; an under-advanced ${hx((start + len - 1) & 0xffff)} is rejected`);
});
