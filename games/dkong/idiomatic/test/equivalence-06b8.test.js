// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for drawLivesAndLevel (ROM 0x06B8) — redraw the reserve-lives
 * indicator and the level-number digits.
 *
 * entry_06b8 WRITES memory (video-RAM HUD cells + a conditional LEVEL clamp),
 * READS work RAM (ATTRACT, LIVES, LEVEL), and skips its whole body behind a
 * `rst 0x08` guard — so it is gated by capture / clone / replay (docs/decompiler-pipeline), not
 * the exhaustive-leaf pattern. A FRESH clone is used per case because it mutates
 * RAM. The oracle pushes/pops (the rst-0x08 skip trick + the terminal `ret`), so
 * a few bytes of DEAD stack-scratch residue are expected and excluded from the
 * game-visible diff; drawLivesAndLevel models no stack at all.
 *
 *   1. EQUAL (real captured dispatches) — hook 0x06B8 in a real boot/attract run
 *      and clone the machine at each true dispatch. Both arms occur naturally: an
 *      early dispatch with ATTRACT=0 (the guard PROCEEDS — full draw) and one with
 *      ATTRACT=1 (the guard SKIPS — writes nothing). For each, run the ORACLE on
 *      one clone and drawLivesAndLevel on another and confirm identical
 *      game-visible RAM (RAM minus the stack scratch below the entry SP), and that SP/pc are untouched.
 *
 *   2. EQUAL (crafted draw arm) — attract only ever feeds this routine LIVES=1,
 *      A=1 (zero reserve) and small levels, so to exercise the marker fill, the
 *      `jp z` zero-reserve skip, the level clamp edge (0x63 vs 0x64), and the
 *      digit-split range, crafted entries poke ATTRACT=0 / LIVES / LEVEL / A
 *      IDENTICALLY on both sides and confirm oracle == drawLivesAndLevel. Reserve
 *      (LIVES-A) is kept in 0..6 so the ROM's 8-bit fill stays in mapped video RAM
 *      (a larger count makes the *oracle itself* walk off into unmapped space).
 *
 *   3. TEETH (crafted draw arm) — a broken twin that fills the reserve markers
 *      with the wrong tile (0xFE instead of 0xFF) MUST be caught by the crafted
 *      draw sweep, naming the marker cell 0x7783. A gate a real corruption slips
 *      through is worthless.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-06b8.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_06b8 as oracle } from "../../translated/loc_06b8.js";
import { drawLivesAndLevel } from "../drawLivesAndLevel.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH, ATTRACT, LIVES, LEVEL } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x06b8;
const MARKER_BOTTOM = 0x7783; // the reserve-marker cell the fill starts from

const hx = (v) => "0x" + (v & 0xffff).toString(16);

/**
 * Diff two machines' full state (work + sprite + video RAM, per dumpState).
 * Returns the first GAME-VISIBLE difference (outside the stack scratch below the entry SP — a real
 * failure) or null, plus a count of DEAD stack-scratch bytes that differed
 * (expected here: the oracle's rst/ret pushes+pops leave a little residue).
 */
function ramDiffMinusStack(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState(), db = b.dumpState();
  const n = Math.min(da.length, db.length);
  let stackDiffs = 0;
  let bad = null;
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) { stackDiffs++; continue; }
    if (!bad) bad = { addr, a: da[i], b: db[i] };
  }
  return { bad, stackDiffs };
}

/** Replay one entry state through the oracle and a candidate on FRESH clones. */
function replay(entry, candidate) {
  const a = entry.clone(); // oracle
  const b = entry.clone(); // candidate
  oracle(a);
  candidate(b);
  return { a, b, ...ramDiffMinusStack(a, b, entry.regs.sp) };
}

/**
 * Hook 0x06B8 in a real boot/attract run and clone the machine at up to K true
 * dispatches. handler_01c3 (state-0 init) and the main-loop task table both reach
 * it, so a short run captures BOTH the ATTRACT=0 draw arm and the ATTRACT=1 skip.
 */
function captureDispatches(K, maxFrames) {
  const caps = [];
  const snapshot = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snapshot });
  host.runFrames(maxFrames);
  return caps;
}

/** Poke one entry to a specific draw-arm scenario, identically on both clones. */
function craftPair(entry, { a: aByte, lives, level }) {
  const a = entry.clone(), b = entry.clone();
  for (const mm of [a, b]) {
    mm.mem.write8(ATTRACT, 0x00); // bit 0 clear -> guard PROCEEDS (draw arm)
    mm.mem.write8(LIVES, lives);
    mm.mem.write8(LEVEL, level);
    mm.regs.a = aByte;
  }
  return { a, b };
}

// A/LIVES pairs giving reserve (LIVES-A) in 0..6, and levels spanning the clamp
// edge (0x63 keep / 0x64 clamp) and the digit-split range.
const DRAW_PAIRS = [
  { a: 1, lives: 1 }, // reserve 0 -> jp z (no markers)
  { a: 1, lives: 2 },
  { a: 1, lives: 3 },
  { a: 1, lives: 5 },
  { a: 1, lives: 6 },
  { a: 0, lives: 0 }, // reserve 0
  { a: 0, lives: 6 },
  { a: 2, lives: 2 }, // reserve 0
  { a: 2, lives: 6 },
  { a: 3, lives: 3 }, // reserve 0
];
const DRAW_LEVELS = [0x00, 0x01, 0x09, 0x0a, 0x19, 0x62, 0x63, 0x64, 0x80, 0xff];

// -- 1. EQUAL (real captured dispatches) --------------------------------------

test("EQUAL (captured): drawLivesAndLevel == oracle on every real dispatch, both arms", () => {
  const caps = captureDispatches(64, 300);
  assert.ok(caps.length >= 1, "expected at least one real 0x06B8 dispatch during boot/attract");

  let sawDraw = false, sawSkip = false;
  for (const entry of caps) {
    if ((entry.mem.read8(ATTRACT) & 0x01) === 0) sawDraw = true; else sawSkip = true;

    const { bad } = replay(entry, drawLivesAndLevel);
    assert.equal(
      bad,
      null,
      bad && `game-visible RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b})`,
    );

    // No stack modelling: SP and pc unchanged from entry.
    const b = entry.clone();
    const sp0 = b.regs.sp, pc0 = b.pc;
    drawLivesAndLevel(b);
    assert.equal(b.regs.sp, sp0, "drawLivesAndLevel must leave SP unchanged (no stack modelling)");
    assert.equal(b.pc, pc0, "drawLivesAndLevel must leave pc unchanged (no ret modelling)");
  }
  assert.ok(sawDraw, "expected a real dispatch on the DRAW arm (ATTRACT bit clear)");
  assert.ok(sawSkip, "expected a real dispatch on the SKIP arm (ATTRACT bit set)");
  console.log(`  EQUAL/captured: ${caps.length} real dispatches (draw + skip) — game-visible RAM identical to the oracle`);
});

// -- 2. EQUAL (crafted draw arm) ----------------------------------------------

test("EQUAL (crafted): the draw arm matches the oracle over reserve counts, the jp-z, the clamp, and digits", () => {
  const caps = captureDispatches(1, 300);
  assert.ok(caps.length >= 1, "need a real entry to craft from");
  const entry = caps[0];

  let n = 0;
  for (const pair of DRAW_PAIRS) {
    for (const level of DRAW_LEVELS) {
      const { a, b } = craftPair(entry, { ...pair, level });
      const aFloor = a.regs.sp;
      oracle(a);
      drawLivesAndLevel(b);
      const { bad } = ramDiffMinusStack(a, b, aFloor);
      n++;
      assert.equal(
        bad,
        null,
        bad && `A=${pair.a} LIVES=${pair.lives} LEVEL=${hx(level)}: ` +
          `game-visible RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b})`,
      );
    }
  }
  console.log(`  EQUAL/crafted: ${n} draw-arm combos identical to the oracle`);
});

// -- 3. TEETH (crafted draw arm) ----------------------------------------------

/**
 * Broken twin: fills the reserve markers with 0xFE instead of 0xFF — a plausible
 * "wrote the wrong tile" bug that diverges only where reserve > 0, so it demands a
 * real draw-arm sweep to catch, and names the marker cell 0x7783.
 */
function brokenDrawLivesAndLevel(m) {
  const { regs, mem } = m;
  const livesInPlay = regs.a & 0xff;
  if ((mem.read8(ATTRACT) & 0x01) !== 0) return;
  let cell = MARKER_BOTTOM;
  for (let i = 0; i < 6; i++) { mem.write8(cell, 0x10); cell = (cell - 0x20) & 0xffff; }
  const reserve = (mem.read8(LIVES) - livesInPlay) & 0xff;
  if (reserve !== 0) {
    cell = MARKER_BOTTOM;
    for (let i = 0; i < reserve; i++) { mem.write8(cell, 0xfe); cell = (cell - 0x20) & 0xffff; } // BUG: 0xFE
  }
  mem.write8(0x7503, 0x1c);
  mem.write8(0x74e3, 0x34);
  let level = mem.read8(LEVEL);
  if (level > 0x63) { level = 0x63; mem.write8(LEVEL, 0x63); }
  let tens = 0xff, units = level, borrow;
  do { tens = (tens + 1) & 0xff; borrow = units < 10; units = (units - 10) & 0xff; } while (!borrow);
  units = (units + 10) & 0xff;
  mem.write8(0x74a3, units);
  mem.write8(0x74c3, tens);
}

test("TEETH (crafted): a wrong marker tile is CAUGHT and names 0x7783", () => {
  const caps = captureDispatches(1, 300);
  assert.ok(caps.length >= 1, "need a real entry to craft from");
  const entry = caps[0];

  let caught = null;
  outer: for (const pair of DRAW_PAIRS) {
    for (const level of DRAW_LEVELS) {
      const { a, b } = craftPair(entry, { ...pair, level });
      const aFloor = a.regs.sp;
      oracle(a);
      brokenDrawLivesAndLevel(b);
      const { bad } = ramDiffMinusStack(a, b, aFloor);
      if (bad) { caught = bad; break outer; }
    }
  }
  assert.notEqual(caught, null, "the crafted draw sweep FAILED to catch a wrong marker tile — it is worthless");
  assert.equal(caught.addr, MARKER_BOTTOM, `expected the caught diff at ${hx(MARKER_BOTTOM)}, got ${hx(caught.addr)}`);
  console.log(`  TEETH/crafted: caught at ${hx(caught.addr)} (oracle=${caught.a} broken=${caught.b})`);
});
