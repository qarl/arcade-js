// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for paintTileBlock2x2 (ROM 0x0a40) — "copy four source bytes into a
 * 2x2 tilemap block anchored at the top-left". Inputs: dst in HL (a tilemap cell), src in DE (a
 * 4-byte source run). Writes dst=src0, dst+1=src1, dst+0x21=src2, dst+0x20=src3 (source order
 * top-left, top-right, bottom-RIGHT, bottom-left).
 *
 * CYCLE-FREE / memory-equivalence gate (docs/decompiler-pipeline). The routine WRITES tile RAM, so
 * every case uses a FRESH clone per side; the oracle runs on one clone, paintTileBlock2x2 on
 * another, compared on the go-forward contract: RAM (dumpState, minus stack scratch below the entry SP).
 *
 * pc/registers are NOT compared: it is memory-only. The walk ends DE at src+3 and HL at dst+0x20,
 * but the caller (advanceAttractAnimationAndRepaint) pops DE and reloads HL, so neither survives for a reader.
 *
 * The two real dst entries are 0x866a and 0x86aa (advanceAttractAnimationAndRepaint); both are in the crafted sweep. The
 * leaf runs during the animation paint, not a plain attract boot, so every case is CRAFTED: an
 * identical dst/src/source-byte poke on both sides. src sits in work RAM (readable, disjoint from
 * every dst write) so the four bytes can be seeded to distinct values that catch a mapping bug.
 *
 * Jobs:
 *   1. EQUAL — over curated dst starts (incl. both real entries) oracle == module in RAM (−stack).
 *   2. WRITE-SET — the oracle writes exactly the four cells, with the right byte in each.
 *   3. CRAFTED (overwrite) — pre-dirty the four target cells to 0xAA identically; both overwrite.
 *   4. TEETH — a twin that writes a WRONG byte at the bottom-right cell MUST be caught by the diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-0a40.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0a40 as oracle } from "../../translated/loc_0a40.js";
import { paintTileBlock2x2 } from "../paintTileBlock2x2.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const SRC = 0x8b00; // work RAM: readable, disjoint from every dst write
const SRC_BYTES = [0x11, 0x22, 0x33, 0x44]; // distinct so a wrong TL/TR/BR/BL mapping is caught
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);

/** First RAM difference minus the stack scratch below the entry SP. */
function ramDiffMinusStack(ma, mb) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** A fresh clone with dst in HL, src in DE, and the four source bytes seeded. */
function craft(dst) {
  const m = BASE.clone();
  SRC_BYTES.forEach((v, i) => m.mem.write8((SRC + i) & 0xffff, v));
  m.regs.hl = dst & 0xffff;
  m.regs.de = SRC;
  m.regs.sp = 0x8ffe; // in STACK_SCRATCH; the oracle's ret only POPs (reads), never writes
  return m;
}

// The two real dst values plus more tile-RAM (0x8000-0x87ff) bases; low bytes chosen so the
// original's 8-bit column step never straddles a page (matching every address the ROM passes).
const STARTS = [0x866a, 0x86aa, 0x8400, 0x8440, 0x8560, 0x87a0];

// dst=src0, dst+1=src1, dst+0x21=src2, dst+0x20=src3.
const cellsOf = (dst) => [
  { addr: dst & 0xffff, val: SRC_BYTES[0] },
  { addr: (dst + 0x01) & 0xffff, val: SRC_BYTES[1] },
  { addr: (dst + 0x21) & 0xffff, val: SRC_BYTES[2] },
  { addr: (dst + 0x20) & 0xffff, val: SRC_BYTES[3] },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted dst — paintTileBlock2x2 == oracle in RAM (−stack)", () => {
  for (const dst of STARTS) {
    const o = craft(dst);
    const c = craft(dst);
    oracle(o);
    paintTileBlock2x2(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b} (dst=${hx(dst)})`);
  }
  console.log(`  EQUAL: ${STARTS.length} crafted dst starts identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the oracle writes exactly the four block cells with the right bytes", () => {
  const dst = 0x866a;
  const want = cellsOf(dst);
  const wantAddrs = new Set(want.map((c) => c.addr));

  const before = craft(dst);
  const after = craft(dst);
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();

  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) changed.push(after.stateOffsetToAddr(off));
  }
  for (const addr of changed) assert.ok(wantAddrs.has(addr), `oracle wrote unexpected addr ${hx(addr)}`);
  for (const c of want) assert.equal(after.mem.read8(c.addr), c.val, `cell ${hx(c.addr)} must be ${hx(c.val)}`);
  console.log(`  WRITE-SET: 4 cells ${want.map((c) => hx(c.addr)).join(",")} carry src0..3`);
});

// -- 3. CRAFTED (overwrite) ---------------------------------------------------

test("CRAFTED: pre-dirtied target cells are overwritten to src0..3 identically", () => {
  const dst = 0x86aa;
  const want = cellsOf(dst);

  const o = craft(dst);
  const c = craft(dst);
  for (const cell of want) {
    o.mem.write8(cell.addr, 0xaa);
    c.mem.write8(cell.addr, 0xaa);
  }
  oracle(o);
  paintTileBlock2x2(c);

  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  for (const cell of want) assert.equal(c.mem.read8(cell.addr), cell.val, `cell ${hx(cell.addr)} not overwritten`);
  console.log(`  CRAFTED: four 0xAA cells overwritten to src0..3`);
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: a wrong bottom-right byte is CAUGHT by the RAM diff", () => {
  const dst = 0x866a;
  const br = (dst + 0x21) & 0xffff; // bottom-right cell holds src2

  const o = craft(dst);
  const c = craft(dst);
  oracle(o);
  paintTileBlock2x2(c);
  c.mem.write8(br, (SRC_BYTES[2] ^ 0x01) & 0xff); // BUG: wrong byte at the bottom-right cell

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong bottom-right byte — it is worthless");
  assert.equal(d.addr, br, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(br)})`);
  console.log(`  TEETH: wrong bottom-right byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
