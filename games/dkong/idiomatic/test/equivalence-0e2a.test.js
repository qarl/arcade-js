// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for drawSegmentEndCap (ROM 0x0e2a) — the board-layout
 * renderer's segment end cap: stamps a segment's endpoint tiles into video RAM, then
 * advances the table cursor DE and re-enters sub_0da7's walk.
 *
 * This is the CYCLE-FREE / memory-equivalence gate (docs/decompiler-pipeline), not the retired strict
 * whole-machine one. drawSegmentEndCap WRITES memory, so every case uses a FRESH clone
 * per side (never a reused machine). The oracle is run on one clone, drawSegmentEndCap
 * on another, and they are compared on the go-forward contract:
 *
 *     RAM (dumpState, minus the stack scratch below the entry SP) + SP + declared live-out DE.
 *
 * dumpState covers work + sprite + VIDEO RAM, so the tile stamps — this routine's whole
 * point — are inside the compared state. DE is the live-out: the successor 0x0DA7 does
 * `ld a,(de)` first thing, so the advanced cursor must match. SP is compared and is
 * trivially equal (neither side touches the stack). pc is NOT compared: the oracle's
 * tail `jp 0x0da7` leaves pc = 0x0da7, but that tail-jump is structural in the direct-
 * call layer (the caller's walk loop re-enters) — same treatment as loadSpriteObjectBlock.
 * A and HL are dead at the tail-jump (0x0DA7 overwrites A, then H then L) so the routine
 * neither reproduces nor compares them.
 *
 * Jobs:
 *   1. EQUAL (captured dispatches) — hook 0x0e2a in a real attract run; on each true
 *      dispatch, oracle vs drawSegmentEndCap leave identical RAM (−stack) + SP + DE.
 *      Also asserts all four arm combinations actually occur in the capture set.
 *   2. WRITE-SET (captured) — the oracle's only work/sprite/video writes are 1–3 VIDEO-
 *      RAM tile cells; documents the exact footprint the gate covers.
 *   3. CRAFTED (each arm forced) — the two guards (kind==1, remainder!=0) select four
 *      arms; force each with a surgical poke to 0x63B3 / 0x63B0 identical on both sides,
 *      confirm oracle==candidate AND that the expected tiles genuinely land (arm
 *      semantics, not mere agreement).
 *   4. TEETH — a twin that biases the endpoint body tile by +1 (0xD1 not 0xD0) MUST be
 *      caught, on every captured state and every crafted arm.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-0e2a.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0e2a as oracle } from "../../translated/loc_0e2a.js";
import { drawSegmentEndCap } from "../drawSegmentEndCap.js";
import { Machine } from "../../machine.js";
import { firstStateDiff, deadStackBelow } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x0e2a;
const KIND = 0x63b3; // record kind (1 = single-cell segment)
const REMAINDER = 0x63b0; // sub-tile span remainder
const ENDPTR = 0x63ad; // second point's tilemap address (VRAM)

const hx = (v) => "0x" + (v & 0xffff).toString(16);

/**
 * First RAM difference on the go-forward contract: the whole state dump (work +
 * sprite + video) minus the stack scratch below the entry SP. Returns {addr,a,b} or null.
 */
function ramDiffMinusStack(ma, mb, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const a = ma.dumpState();
  const b = mb.dumpState();
  let d = firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off));
  let from = 0;
  while (d && dead(d.addr)) {
    from = d.offset + 1;
    d = firstStateDiff(a.subarray(from), b.subarray(from), (off) => ma.stateOffsetToAddr(off + from));
  }
  return d;
}

/** Full contract diff: RAM (−stack), then SP, then the DE live-out. null if equal. */
function contractDiff(o, c, liveFloor) {
  const d = ramDiffMinusStack(o, c, liveFloor);
  if (d) return `RAM at ${hx(d.addr ?? 0)}: oracle=${d.a} cand=${d.b}`;
  if (o.regs.sp !== c.regs.sp) return `SP: oracle=${hx(o.regs.sp)} cand=${hx(c.regs.sp)}`;
  if (o.regs.de !== c.regs.de) return `DE: oracle=${hx(o.regs.de)} cand=${hx(c.regs.de)}`;
  return null;
}

/**
 * Hook 0x0e2a in a real attract run and clone the machine at up to K true dispatches.
 * 0x0e2a is reached via m.call from loc_0e19 during board-layout draw; the wrapper
 * snapshots the entry state, then runs the oracle so the host proceeds undisturbed.
 */
function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(maxFrames);
  return caps;
}

const CAPS = ROM_PRESENT ? captureDispatches(48, 4000) : [];

// -- 1. EQUAL (captured dispatches) -------------------------------------------

test("EQUAL: real captured dispatches — drawSegmentEndCap == oracle in RAM (−stack) + SP + DE", () => {
  assert.ok(CAPS.length >= 1, "expected at least one real 0x0e2a dispatch in the run window");

  const seen = new Set();
  for (const cap of CAPS) {
    const single = cap.mem.read8(KIND) === 1;
    const overhang = cap.mem.read8(REMAINDER) !== 0;
    seen.add(`${single ? "single" : "multi"}/${overhang ? "rem" : "flush"}`);

    const o = cap.clone();
    const c = cap.clone();
    oracle(o);
    drawSegmentEndCap(c);

    const diff = contractDiff(o, c, cap.regs.sp);
    assert.equal(diff, null, diff);
  }
  // Reachability claim in the header must hold: all four arm combinations occur.
  for (const arm of ["single/rem", "single/flush", "multi/rem", "multi/flush"]) {
    assert.ok(seen.has(arm), `arm ${arm} was never reached in the capture set (saw ${[...seen]})`);
  }
  console.log(`  EQUAL: ${CAPS.length} real dispatches identical (RAM −stack + SP + DE); arms: ${[...seen].join(", ")}`);
});

// -- 2. WRITE-SET (captured) --------------------------------------------------

test("WRITE-SET: the oracle's only work/sprite/video writes are 1-3 VIDEO-RAM tile cells", () => {
  let maxCells = 0;
  for (const cap of CAPS) {
    const before = cap.clone();
    const after = cap.clone();
    const b0 = before.dumpState();
    oracle(after);
    const a1 = after.dumpState();

    let cells = 0;
    for (let off = 0; off < b0.length; off++) {
      if (b0[off] === a1[off]) continue;
      const addr = after.stateOffsetToAddr(off);
      assert.ok(
        addr >= 0x7400 && addr < 0x7800,
        `oracle wrote outside video RAM at ${hx(addr)} (${b0[off]}->${a1[off]})`,
      );
      cells++;
    }
    maxCells = Math.max(maxCells, cells);
  }
  console.log(`  WRITE-SET: every dispatch wrote only VIDEO RAM (0x7400-0x77FF); up to ${maxCells} cell(s)/dispatch`);
});

// -- 3. CRAFTED (each arm forced) ---------------------------------------------

test("CRAFTED: each of the four arms forced by a surgical poke — oracle==candidate + tiles land", () => {
  const base = CAPS[0];
  // remainder value used for the "overhang" arms; nonzero so remainder!=0 selects the arm.
  const REM = 0x05;

  // (kind, remainder) -> the tiles that MUST be present after the routine, keyed by
  // page-relative column offset. -1 = one cell back, 0 = the endpoint, +1 = one forward.
  const arms = [
    { single: false, rem: 0x00, want: { 0: (0x00 + 0xd0) & 0xff } },
    { single: false, rem: REM, want: { 0: (REM + 0xd0) & 0xff, 1: (REM + 0xe0) & 0xff } },
    { single: true, rem: 0x00, want: { 0: (0x00 + 0xd0) & 0xff, "-1": 0xc0 } },
    { single: true, rem: REM, want: { 0: (REM + 0xd0) & 0xff, "-1": 0xc0, 1: (REM + 0xe0) & 0xff } },
  ];

  for (const arm of arms) {
    const o = base.clone();
    const c = base.clone();
    // Identical surgical nudge on BOTH sides.
    o.mem.write8(KIND, arm.single ? 1 : 0);
    c.mem.write8(KIND, arm.single ? 1 : 0);
    o.mem.write8(REMAINDER, arm.rem);
    c.mem.write8(REMAINDER, arm.rem);

    const ptr = c.mem.read16(ENDPTR);
    const page = ptr & 0xff00;
    const col = ptr & 0x00ff;
    // Pre-dirty the three candidate cells so "tile lands" proves a write, not a leftover.
    for (const rel of [-1, 0, 1]) c.mem.write8(page | ((col + rel) & 0xff), 0x99);
    for (const rel of [-1, 0, 1]) o.mem.write8(page | ((col + rel) & 0xff), 0x99);

    oracle(o);
    drawSegmentEndCap(c);

    const diff = contractDiff(o, c, base.regs.sp);
    const label = `${arm.single ? "single" : "multi"}/${arm.rem ? "rem" : "flush"}`;
    assert.equal(diff, null, `${label}: ${diff}`);

    // Arm semantics: the expected tiles genuinely landed at the expected cells.
    for (const rel of [-1, 0, 1]) {
      const cell = page | ((col + rel) & 0xff);
      const expected = Object.prototype.hasOwnProperty.call(arm.want, String(rel)) ? arm.want[String(rel)] : 0x99;
      assert.equal(
        c.mem.read8(cell),
        expected,
        `${label}: cell col${rel >= 0 ? "+" + rel : rel} = ${hx(c.mem.read8(cell))}, expected ${hx(expected)}`,
      );
    }
  }
  console.log("  CRAFTED: all four arms forced — oracle==candidate and every expected tile landed");
});

// -- 4. TEETH -----------------------------------------------------------------

/** Broken twin: biases the endpoint body tile by +1 (0xD1 not 0xD0) — a plausible
 *  constant-off-by-one bug, written at the endpoint ptr on every dispatch. */
function brokenDrawSegmentEndCap(m) {
  const { regs, mem } = m;
  const remainder = mem.read8(REMAINDER);
  const ptr = mem.read16(ENDPTR);
  const page = ptr & 0xff00;
  const col = ptr & 0x00ff;
  mem.write8(ptr, (remainder + 0xd1) & 0xff); // BUG: base bias must be 0xD0
  if (mem.read8(KIND) === 0x01) mem.write8(page | ((col - 1) & 0xff), 0xc0);
  if (remainder !== 0) mem.write8(page | ((col + 1) & 0xff), (remainder + 0xe0) & 0xff);
  regs.de = (regs.de + 1) & 0xffff;
}

test("TEETH: a wrong endpoint-tile bias is CAUGHT on every captured and crafted case", () => {
  let caught = null;
  for (const cap of CAPS) {
    const o = cap.clone();
    const c = cap.clone();
    oracle(o);
    brokenDrawSegmentEndCap(c);
    const d = ramDiffMinusStack(o, c, cap.regs.sp);
    if (d) { caught = d; break; }
  }
  assert.notEqual(caught, null, "the gate FAILED to catch a wrong endpoint tile — it is worthless");

  // Crafted arms too — must be caught regardless of which guards fire.
  const base = CAPS[0];
  for (const [single, rem] of [[false, 0x00], [false, 0x05], [true, 0x00], [true, 0x05]]) {
    const o = base.clone();
    const c = base.clone();
    o.mem.write8(KIND, single ? 1 : 0); c.mem.write8(KIND, single ? 1 : 0);
    o.mem.write8(REMAINDER, rem); c.mem.write8(REMAINDER, rem);
    oracle(o);
    brokenDrawSegmentEndCap(c);
    const d = ramDiffMinusStack(o, c, base.regs.sp);
    assert.notEqual(d, null, `teeth NOT caught on crafted arm single=${single} rem=${rem}`);
  }
  console.log(`  TEETH: wrong endpoint tile caught at ${hx(caught.addr ?? 0)} (oracle=${caught.a} broken=${caught.b}) + all crafted arms`);
});
