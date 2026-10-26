// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for turnFireAtGroundEdge (ROM 0x298C) — the "the tile 12 px BELOW the object is
 * outside the accepted band" predicate, which is how the caller sees a ground edge.
 *
 * sub_298c is READ-ONLY: it reads the iterated object record (OBJ_ITER_PTR), takes
 * that object's two working coordinates, carries the Y one 12 pixels DOWN (the X is
 * left alone — 0x2993-0x2998 loads +0x0E into D and +0x0F PLUS 0x0C into E, and the
 * `ex de,hl` puts them in H,L in that order), maps the pixel to its
 * tilemap cell (via 0x2FF0 / tileAddrForPixel), reads the tile there, and returns
 * A = 1 when the tile is out of band (below 0xB0, or low nibble >= 8) and A = 0
 * when it is in band. It writes NO memory. Its only live-out is that A — the caller
 * (entry_3202) does `cp 0x01; jp z` on it — so the idiomatic routine returns a
 * boolean and this gate compares (return ? 1 : 0) against the oracle's A.
 *
 * The oracle brackets its call to 0x2FF0 with a `push16`/`ret` and finishes with a
 * terminal `ret`; the idiomatic routine dissolves both (a direct tileAddrForPixel
 * call + a plain JS return). So the oracle writes a dead return address into the
 * STACK_SCRATCH region and nets one caller-return pop; the candidate models the
 * terminal `ret` with one m.ret() to line up pc + SP, and the RAM diff excludes
 * STACK_SCRATCH (the memory-equivalence contract) — the only place the two runs
 * can differ in memory, since the routine itself stores nothing.
 *
 *   1. REALISM (captured) — hook 0x298C in a real attract run (~285 dispatches per
 *      2000 frames), clone the machine at each real dispatch, and confirm turnFireAtGroundEdge
 *      reproduces the oracle's RAM (− STACK_SCRATCH), pc, SP, and A on every state
 *      the game actually produces.
 *
 *   2. EQUAL (crafted) — poke a record + its target tile identically on both sides
 *      to pin every tile-band edge: below the 0xB0 floor, the 0xB0/0xB7 in-band
 *      edges, the low-nibble-8 out edge, a high in-band tile (0xF7), an all-ones
 *      tile, and zero — plus the low-byte page wrap on the record fields, and the
 *      12px X probe offset. Each asserts turnFireAtGroundEdge == oracle AND that the oracle's A
 *      matches the hand-computed predicate (so the fixtures themselves are checked).
 *
 *   3. TEETH — four broken twins, each of which the SAME suite MUST catch:
 *        (a) wrong tile floor (`< 0xB1`) — caught at tile 0xB0.
 *        (b) dropped low-nibble check — caught at tile 0xB8.
 *        (c) dropped X probe offset — caught where +12px lands in a different column.
 *        (d) record read not page-confined (16-bit add) — caught where the low byte
 *            wraps and the unconfined read lands in the next page.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-298c.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_298c as oracle } from "../../translated/loc_298c.js";
import { turnFireAtGroundEdge } from "../turnFireAtGroundEdge.js";
import { tileAddrForPixel } from "../tileAddrForPixel.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH, OBJ_ITER_PTR } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x298c;
const RET_ADDR = 0x3241; // the entry_3202 site right after `call 0x298c`

const hx = (v) => "0x" + (v & 0xffff).toString(16);

// The page-confined address of a record field: advance the low byte only, so an
// offset that overruns 0xFF wraps back inside the record's own 256-byte page.
const recAddr = (ptr, off) => (ptr & 0xff00) | ((ptr + off) & 0xff);

// The hand-computed predicate the routine implements: A = 1 (out of band) when the
// tile is below 0xB0 or its low nibble reaches 8, else A = 0 (in band).
const expectedA = (tile) => (tile < 0xb0 || (tile & 0x0f) >= 0x08 ? 1 : 0);

// First RAM byte that differs between two machines, skipping the stack scratch below the entry SP
// region (the memory-equivalence contract is RAM − the stack scratch below the entry SP). { addr, a, b } | null.
function firstRamDiff(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState(), db = b.dumpState();
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) continue;
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

/** Run the ORACLE on a fresh clone. It performs its own internal call bracket and
 *  terminal `ret`; its live-out is register A. */
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

/**
 * Run a candidate on a fresh clone, capture its boolean return, then model its
 * terminal `ret` with one m.ret() so pc + SP line up with the oracle's (the
 * idiomatic routine replaces the Z80 stack with the JS call stack, so it neither
 * pushes the call bracket nor pops the caller return itself).
 */
function runCandidate(entry, fn) {
  const c = entry.clone();
  const ret = fn(c);
  c.ret();
  return { c, ret };
}

/** Full contract diff: RAM − the stack scratch below the entry SP, pc, SP, and the A live-out (oracle's
 *  register A vs the candidate's boolean return mapped to 0/1). */
function contractDiffs(entry, fn) {
  const o = runOracle(entry);
  const { c, ret } = runCandidate(entry, fn);
  const diffs = [];
  const ram = firstRamDiff(o, c, entry.regs.sp);
  if (ram) diffs.push(`RAM@${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
  if (o.pc !== c.pc) diffs.push(`pc oracle=${hx(o.pc)} cand=${hx(c.pc)}`);
  if (o.regs.sp !== c.regs.sp) diffs.push(`SP oracle=${hx(o.regs.sp)} cand=${hx(c.regs.sp)}`);
  const candA = ret ? 1 : 0;
  if (o.regs.a !== candA) diffs.push(`A oracle=${o.regs.a} cand=${candA}`);
  return diffs;
}

// A real, self-consistent machine: boot + a stretch of attract so work RAM holds
// realistic values. Records are crafted by poking onto a clone of this.
function attractBase(frames = 180) {
  const m = new Machine(ROM);
  m.runFrames(frames);
  return m.clone(); // clone neutralises the frame machinery (nextNmi/nextBoundary = Infinity)
}

// Poke a record whose Y/X fields (page-confined) and target tile are set, onto a
// clone of the base with a safe stack (a plausible caller return so the terminal
// `ret` has a sane target). The tile is written at the cell 0x2FF0 maps the probe
// point to, so both sides read the value we chose.
function craftProbe(base, { ptr = 0x6400, y, xRaw, tile }) {
  const m = base.clone();
  m.regs.sp = 0x6c00;
  m.push16(RET_ADDR);
  m.mem.write8(OBJ_ITER_PTR, ptr & 0xff);
  m.mem.write8(OBJ_ITER_PTR + 1, (ptr >> 8) & 0xff);
  m.mem.write8(recAddr(ptr, 0x0e), y);
  m.mem.write8(recAddr(ptr, 0x0f), xRaw);
  m.mem.write8(tileAddrForPixel(y, (xRaw + 0x0c) & 0xff), tile);
  return m;
}

// -- 0. REACHABILITY ----------------------------------------------------------

test("REACHABILITY: 0x298C is dispatched during attract", () => {
  let count = 0;
  const snap = new Map([[TARGET, (mm) => { count++; return oracle(mm); }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(1200);
  assert.ok(count > 0, "0x298C should be dispatched during attract (entry_3202 object walk)");
  console.log(`  REACHABILITY: ${count} natural 0x298C dispatches in 1200 frames`);
});

// -- 1. REALISM (captured) ----------------------------------------------------

test("REALISM: real captured 0x298C dispatches — turnFireAtGroundEdge matches oracle (RAM/pc/SP/A)", () => {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < 200) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(2000);
  assert.ok(caps.length >= 1, "expected at least one real 0x298C dispatch during attract");

  let compared = 0, sawOut = 0, sawIn = 0;
  for (const entry of caps) {
    // Skip the (unobserved) deep-stack case where the oracle's dead push would land
    // below STACK_SCRATCH — it would masquerade as a real RAM diff.
    if ((entry.regs.sp - 2) < STACK_SCRATCH.lo) continue;
    const diffs = contractDiffs(entry, turnFireAtGroundEdge);
    assert.equal(diffs.length, 0, `captured dispatch: ${diffs.join("; ")}`);
    if (runOracle(entry).regs.a === 1) sawOut++; else sawIn++;
    compared++;
  }
  assert.ok(compared >= 1, "expected at least one comparable capture");
  console.log(`  REALISM: ${compared} real dispatches identical to the oracle (${sawOut} out-of-band, ${sawIn} in-band)`);
});

// -- 2. EQUAL (crafted, all band edges + wrap) --------------------------------

test("EQUAL (crafted): every tile-band edge and the page wrap match the oracle", () => {
  const base = attractBase();

  const cases = [
    { name: "below floor (0xA0)", opts: { y: 0x40, xRaw: 0x08, tile: 0xa0 } },
    { name: "just below floor (0xAF)", opts: { y: 0x40, xRaw: 0x08, tile: 0xaf } },
    { name: "floor, nibble 0 (0xB0) IN", opts: { y: 0x40, xRaw: 0x08, tile: 0xb0 } },
    { name: "nibble 7 edge (0xB7) IN", opts: { y: 0x40, xRaw: 0x08, tile: 0xb7 } },
    { name: "nibble 8 edge (0xB8) OUT", opts: { y: 0x40, xRaw: 0x08, tile: 0xb8 } },
    { name: "high in-band (0xF7)", opts: { y: 0x50, xRaw: 0x20, tile: 0xf7 } },
    { name: "all ones (0xFF)", opts: { y: 0x50, xRaw: 0x20, tile: 0xff } },
    { name: "zero (0x00)", opts: { y: 0x50, xRaw: 0x20, tile: 0x00 } },
    // low byte 0xF5 + field 0x0F wraps to 0x04 inside the page (0x6404, not 0x6504).
    { name: "page-wrapped record (ptr 0x64F5)", opts: { ptr: 0x64f5, y: 0x40, xRaw: 0x04, tile: 0xb0 } },
  ];

  for (const { name, opts } of cases) {
    const entry = craftProbe(base, opts);
    // The fixture is self-checking: the oracle's A must equal the hand predicate.
    assert.equal(runOracle(entry).regs.a, expectedA(opts.tile), `${name}: fixture — oracle A != predicted`);
    const diffs = contractDiffs(entry, turnFireAtGroundEdge);
    assert.equal(diffs.length, 0, `${name}: ${diffs.join("; ")}`);
  }
  console.log(`  EQUAL/crafted: ${cases.length} band edges + page wrap identical to the oracle`);
});

// -- 3. TEETH -----------------------------------------------------------------

/** (a) wrong tile floor: treats 0xB0 itself as out of band. */
function brokenFloor(m) {
  const { mem } = m;
  const rec = mem.read16(OBJ_ITER_PTR);
  const page = rec & 0xff00;
  const y = mem.read8(page | ((rec + 0x0e) & 0xff));
  const x = mem.read8(page | ((rec + 0x0f) & 0xff)) + 0x0c;
  const tile = mem.read8(tileAddrForPixel(y, x));
  if (tile < 0xb1) return true; // BUG: floor should be 0xB0
  if ((tile & 0x0f) >= 0x08) return true;
  return false;
}

/** (b) dropped low-nibble check: any tile at/above the floor is "in band". */
function brokenNibble(m) {
  const { mem } = m;
  const rec = mem.read16(OBJ_ITER_PTR);
  const page = rec & 0xff00;
  const y = mem.read8(page | ((rec + 0x0e) & 0xff));
  const x = mem.read8(page | ((rec + 0x0f) & 0xff)) + 0x0c;
  const tile = mem.read8(tileAddrForPixel(y, x));
  if (tile < 0xb0) return true;
  return false; // BUG: never checks the low nibble
}

/** (c) dropped X probe offset: reads the tile under the object's own X. */
function brokenXAddend(m) {
  const { mem } = m;
  const rec = mem.read16(OBJ_ITER_PTR);
  const page = rec & 0xff00;
  const y = mem.read8(page | ((rec + 0x0e) & 0xff));
  const x = mem.read8(page | ((rec + 0x0f) & 0xff)); // BUG: no +12px
  const tile = mem.read8(tileAddrForPixel(y, x));
  if (tile < 0xb0) return true;
  if ((tile & 0x0f) >= 0x08) return true;
  return false;
}

/** (d) record read not page-confined: a 16-bit add spills into the next page. */
function brokenNoWrap(m) {
  const { mem } = m;
  const rec = mem.read16(OBJ_ITER_PTR);
  const y = mem.read8((rec + 0x0e) & 0xffff); // BUG: not confined to the page
  const x = mem.read8((rec + 0x0f) & 0xffff) + 0x0c;
  const tile = mem.read8(tileAddrForPixel(y, x));
  if (tile < 0xb0) return true;
  if ((tile & 0x0f) >= 0x08) return true;
  return false;
}

test("TEETH: wrong floor and dropped nibble twins are CAUGHT", () => {
  const base = attractBase();
  const floorEntry = craftProbe(base, { y: 0x40, xRaw: 0x08, tile: 0xb0 }); // IN band -> A=0
  const nibbleEntry = craftProbe(base, { y: 0x40, xRaw: 0x08, tile: 0xb8 }); // OUT -> A=1

  const floorDiffs = contractDiffs(floorEntry, brokenFloor);
  assert.ok(floorDiffs.length > 0, "the wrong-floor twin escaped — the gate is worthless");
  assert.ok(floorDiffs.some((d) => d.startsWith("A ")), `expected an A live-out diff, got ${floorDiffs.join("; ")}`);

  const nibbleDiffs = contractDiffs(nibbleEntry, brokenNibble);
  assert.ok(nibbleDiffs.length > 0, "the dropped-nibble twin escaped — the gate is worthless");
  assert.ok(nibbleDiffs.some((d) => d.startsWith("A ")), `expected an A live-out diff, got ${nibbleDiffs.join("; ")}`);

  console.log(`  TEETH/band: wrong-floor caught (${floorDiffs.join("; ")}); dropped-nibble caught (${nibbleDiffs.join("; ")})`);
});

test("TEETH: dropped X-offset and non-page-confined record twins are CAUGHT", () => {
  const base = attractBase();

  // (c) dropped X offset: correct x = 0x04 + 12 = 0x10 (column 2); the twin's x = 0x04
  //     (column 0). Put an in-band tile at the correct cell, an out tile at the twin's.
  const xe = base.clone();
  xe.regs.sp = 0x6c00; xe.push16(RET_ADDR);
  xe.mem.write8(OBJ_ITER_PTR, 0x00); xe.mem.write8(OBJ_ITER_PTR + 1, 0x64);
  xe.mem.write8(recAddr(0x6400, 0x0e), 0x40);
  xe.mem.write8(recAddr(0x6400, 0x0f), 0x04);
  const xCorrect = tileAddrForPixel(0x40, (0x04 + 0x0c) & 0xff);
  const xTwin = tileAddrForPixel(0x40, 0x04);
  assert.notEqual(xCorrect, xTwin, "fixture: the +12px probe must land in a different cell");
  xe.mem.write8(xCorrect, 0xb0); // correct -> A=0
  xe.mem.write8(xTwin, 0x00);    // twin reads this -> A=1
  assert.equal(runOracle(xe).regs.a, 0, "fixture: oracle should read the +12px cell (in band)");
  const xDiffs = contractDiffs(xe, brokenXAddend);
  assert.ok(xDiffs.some((d) => d.startsWith("A ")), `dropped-X-offset twin escaped: ${xDiffs.join("; ") || "none"}`);

  // (d) non-page-confined read: ptr 0x64F5, so the confined fields sit at 0x6403/0x6404
  //     but a 16-bit add reads 0x6503/0x6504. Point those at a different probe/tile.
  const we = base.clone();
  we.regs.sp = 0x6c00; we.push16(RET_ADDR);
  we.mem.write8(OBJ_ITER_PTR, 0xf5); we.mem.write8(OBJ_ITER_PTR + 1, 0x64);
  assert.equal(recAddr(0x64f5, 0x0e), 0x6403, "fixture: field 0x0E must wrap to 0x6403");
  assert.equal(recAddr(0x64f5, 0x0f), 0x6404, "fixture: field 0x0F must wrap to 0x6404");
  we.mem.write8(0x6403, 0x40); we.mem.write8(0x6404, 0x04); // confined (correct) fields
  const wCorrect = tileAddrForPixel(0x40, (0x04 + 0x0c) & 0xff);
  we.mem.write8(wCorrect, 0xb0); // correct -> A=0
  we.mem.write8(0x6503, 0x80); we.mem.write8(0x6504, 0x40); // unconfined (twin) fields
  const wTwin = tileAddrForPixel(0x80, (0x40 + 0x0c) & 0xff);
  assert.notEqual(wCorrect, wTwin, "fixture: the unconfined read must land in a different cell");
  we.mem.write8(wTwin, 0x00); // twin reads this -> A=1
  assert.equal(runOracle(we).regs.a, 0, "fixture: oracle should read the confined (0x6403/04) fields");
  const wDiffs = contractDiffs(we, brokenNoWrap);
  assert.ok(wDiffs.some((d) => d.startsWith("A ")), `non-page-confined twin escaped: ${wDiffs.join("; ") || "none"}`);

  console.log(`  TEETH/addr: dropped-X-offset caught (${xDiffs.join("; ")}); non-page-confined caught (${wDiffs.join("; ")})`);
});
