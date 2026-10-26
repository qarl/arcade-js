// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for copyBiasedTileString (ROM 0x1b80, Pooyan) — copy a byte string
 * from a source pointer (DE) into a destination buffer (HL), adding a fixed +0x08 tile bias to
 * every byte, until a 0xa0 terminator ends the run (terminator not stored, the only exit).
 *
 * CYCLE-FREE / memory-equivalence gate (docs/decompiler-pipeline). The routine WRITES RAM, so
 * each case runs the oracle on one FRESH clone and copyBiasedTileString on another, compared on:
 *
 *     RAM (dumpState, minus stack scratch below the entry SP).
 *
 * The effect is memory-only: the oracle leaves the terminator in A and the advanced DE/HL in the
 * CPU, but its fall-through caller (rebuildFieldAndLatchPlayStateWithTamperCheck -> its dispatcher) reads none of them, so there is no
 * return value to compare. pc/SP are not in dumpState.
 *
 * Jobs:
 *   1. CAPTURE (best-effort) — replay any real 0x1b80 run a boot happens to reach.
 *   2. CRAFTED (load-bearing) — varied RAM source strings into a pre-dirtied buffer; both sides
 *      land identical bytes, the terminator position and beyond keep their dirt (surgical writes),
 *      and +8 truncation (0xff -> 0x07) is exercised.
 *   3. REAL-SOURCE — the exact live invocation (DE=0x1ff2 ROM source, HL=0x89f0 message buffer).
 *   4. WRITE-SET — the oracle's writes land only within [dst, dst+len).
 *   5. TEETH — a twin that writes a WRONG first byte MUST be caught, at dst.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-1b80.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1b80 as oracle } from "../../translated/loc_1b80.js";
import { copyBiasedTileString } from "../copyBiasedTileString.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, DISPLAY_MSG_BUF } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const TARGET = 0x1b80;
const END_MARKER = 0xa0;
const TILE_BIAS = 0x08;
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8fe0);

const DST = DISPLAY_MSG_BUF; // 0x89f0: the live destination (message tile buffer)
const SRC = 0x8b00;          // a scratch RAM source region for the crafted arm
const REAL_SRC = 0x1ff2;     // the exact ROM source the live caller (rebuildFieldAndLatchPlayStateWithTamperCheck) seeds
const DIRT = 0xaa;

/** First RAM difference on the go-forward contract: dumpState minus the dead stack scratch below the entry SP. */
function ramDiffMinusStack(ma, mb, dead = inDeadStack) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), dead);
}

/** Number of bytes copied before the terminator (index of the first END_MARKER). */
function copyLen(bytes) {
  const i = bytes.indexOf(END_MARKER);
  return i === -1 ? bytes.length : i;
}

/**
 * Crafted entry machine: write `bytes` at SRC, pre-dirty a wide dest window to DIRT, and point
 * DE at the source / HL at the destination.
 */
function craft(bytes, srcAddr = SRC, dstAddr = DST) {
  const m = new Machine(ROM);
  for (let i = 0; i < bytes.length; i++) m.mem.write8((srcAddr + i) & 0xffff, bytes[i]);
  for (let i = 0; i < 0x20; i++) m.mem.write8((dstAddr + i) & 0xffff, DIRT);
  m.regs.de = srcAddr & 0xffff;
  m.regs.hl = dstAddr & 0xffff;
  m.regs.sp = 0x8fe0; // parked in dead scratch (the routine pushes nothing; ret pops excluded RAM)
  return m;
}

// Varied source strings, all 0xa0-terminated. Includes an empty string (immediate terminator),
// a byte that biases up to the terminator value (0x98+8=0xa0 — legal, only the SOURCE is tested),
// and 0xff (0xff+8 truncates to 0x07).
const STRINGS = [
  [0x00, 0x01, 0x02, END_MARKER],
  [0x10, 0x20, 0x30, 0x40, 0x50, END_MARKER],
  [0x98, 0x99, END_MARKER],
  [0xff, 0x7f, 0x80, END_MARKER],
  [END_MARKER], // empty: nothing copied
];

// -- 1. CAPTURE (best-effort) -------------------------------------------------

function captureRuns(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  try {
    const host = new Machine(ROM, { overrides: snap });
    host.runFrames(maxFrames);
  } catch {
    /* boot may unwind on an unimplemented path; keep whatever we captured */
  }
  return caps;
}

test("CAPTURE: real 0x1b80 runs replay identically in RAM (−stack), if reached", () => {
  const caps = captureRuns(16, 2400);
  for (const cap of caps) {
    const o = cap.clone();
    const c = cap.clone();
    oracle(o);
    copyBiasedTileString(c);
    const d = ramDiffMinusStack(o, c, deadStackBelow(STACK_SCRATCH, cap.regs.sp));
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} mine=${d.b}`);
  }
  console.log(`  CAPTURE: ${caps.length} real 0x1b80 run(s) replayed identically`);
});

// -- 2. CRAFTED (load-bearing) ------------------------------------------------

test("CRAFTED: varied RAM source strings — RAM(−stack) identical, dirt kept past the terminator", () => {
  for (const bytes of STRINGS) {
    const o = craft(bytes);
    const c = craft(bytes);
    oracle(o);
    copyBiasedTileString(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `str ${bytes.map(hx)}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} mine=${d.b}`);

    const n = copyLen(bytes);
    for (let i = 0; i < n; i++) {
      const want = (bytes[i] + TILE_BIAS) & 0xff;
      assert.equal(c.mem.read8((DST + i) & 0xffff), want, `str ${bytes.map(hx)}: dst[${i}] wrong`);
    }
    // The terminator position and the byte after keep their pre-dirt (surgical, terminator not stored).
    assert.equal(c.mem.read8((DST + n) & 0xffff), DIRT, `str ${bytes.map(hx)}: terminator slot should be untouched`);
    assert.equal(c.mem.read8((DST + n + 1) & 0xffff), DIRT, `str ${bytes.map(hx)}: byte past terminator should be untouched`);
  }
  console.log(`  CRAFTED: ${STRINGS.length} source strings copied identically, dirt preserved`);
});

// -- 3. REAL-SOURCE (the exact live invocation) -------------------------------

test("REAL-SOURCE: DE=0x1ff2 (ROM) / HL=0x89f0 — RAM(−stack) identical to the oracle", () => {
  const base = new Machine(ROM);
  for (let i = 0; i < 0x20; i++) base.mem.write8((DST + i) & 0xffff, DIRT);
  base.regs.de = REAL_SRC;
  base.regs.hl = DST;
  base.regs.sp = 0x8fe0;
  const o = base.clone();
  const c = base.clone();
  oracle(o);
  copyBiasedTileString(c);
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} mine=${d.b}`);
  console.log("  REAL-SOURCE: live ROM string copied identically into the message buffer");
});

// -- 4. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the oracle's writes land only within [dst, dst+len)", () => {
  const bytes = [0x10, 0x20, 0x30, 0x40, 0x50, END_MARKER];
  const before = craft(bytes);
  const after = before.clone();
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();

  const n = copyLen(bytes);
  const inRange = (addr) => addr >= DST && addr < DST + n;
  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) changed.push(after.stateOffsetToAddr(off));
  }
  for (const addr of changed) {
    assert.ok(inRange(addr), `oracle wrote outside the copy window at ${hx(addr)}`);
  }
  assert.equal(changed.length, n, `expected exactly ${n} copied-byte writes, got ${changed.length}`);
  console.log(`  WRITE-SET: ${changed.length} writes, all within [${hx(DST)}, ${hx(DST + n)})`);
});

// -- 5. TEETH -----------------------------------------------------------------

test("TEETH: a wrong first copied byte is caught, at dst", () => {
  const bytes = [0x10, 0x20, 0x30, END_MARKER];
  const o = craft(bytes);
  const c = craft(bytes);
  oracle(o);
  copyBiasedTileString(c);
  c.mem.write8(DST, (c.mem.read8(DST) ^ 0x01) & 0xff); // BUG: corrupt the first stored byte

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong stored byte — it is worthless");
  assert.equal(d.addr, DST, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH: wrong first byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
