// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for clearPlayfieldAndSprites (ROM 0x0874) — the board/power-on
 * screen + sprite-buffer CLEAR (playfield fill + two side columns + sprite-buffer zero).
 *
 * sub_0874 WRITES memory (video RAM 0x7404.. playfield + 0x7522/0x7523 columns,
 * and work RAM 0x6900-0x6A7F) and reads NOTHING — every operand is an immediate, so
 * it is an input-free, straight-line constant memory transform. It is validated by
 * capture/clone/replay on a FRESH clone per case — never by reusing one machine,
 * never on the full register file, never on cycles. The contract compared is RAM
 * (minus the stack scratch below the entry SP); there are no live-out registers — every one of the nine
 * callers overwrites A/flags or does a flag-neutral load before reading anything,
 * so A/BC/DE/HL/F are dead ABI. SP and PC are likewise not
 * compared — the oracle's terminal `ret` pops the stack (SP += 2) and vectors PC;
 * the idiomatic layer drops that bookkeeping (the JS call stack replaces it).
 *
 *   1. REALISM — hook 0x0874 in a real attract run and clone the machine at each
 *      real dispatch (3 fire by frame 518: board/state setup). For each, run oracle
 *      vs clearPlayfieldAndSprites on two fresh clones and confirm identical RAM
 *      (ex-stack).
 *
 *   2. CRAFTED (footprint) — because the routine reads nothing, one start state with
 *      the three target regions pre-poked to a SENTINEL (0xEE, distinct from the fill
 *      bytes 0x10 / 0x00) — identically on both sides, plus guard bands around the
 *      sprite buffer — pins the EXACT write footprint against the oracle: any cell the
 *      candidate writes-but-oracle-doesn't (or misses) holds the sentinel on one side
 *      and a fill byte on the other, so the RAM gate bites. A handful of sentinel
 *      values are swept to be thorough.
 *
 *   3. TEETH — a deliberately-broken twin (a one-column-short playfield fill: 27
 *      columns per row, not 28) MUST be caught. On the sentinel entry the dropped
 *      column holds the sentinel vs the oracle's 0x10, so the RAM gate bites; it is
 *      also caught on the real captures (VRAM starts 0x00, so the dropped cells differ
 *      from the oracle's 0x10).
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-0874.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0874 as oracle } from "../../translated/loc_0874.js";
import { clearPlayfieldAndSprites } from "../clearPlayfieldAndSprites.js";
import { Machine } from "../../machine.js";
import { SPRITE_BUFFER, STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x0874;

// The routine's exact write footprint (used only by the crafted-entry harness).
const PLAYFIELD_TOP = 0x7404;
const PLAYFIELD_ROWS = 32;
const PLAYFIELD_COLS = 28;
const ROW_STRIDE = 0x20;
const SIDE_COL_BASES = [0x7522, 0x7523];
const SIDE_COL_CELLS = 0x0e;
const SPRITE_BUFFER_BYTES = 0x180;

const hx = (v) => "0x" + (v & 0xffff).toString(16);

// -- comparison plumbing ------------------------------------------------------

/** First RAM byte that differs between two machines, skipping the stack scratch below the entry SP, or null. */
function firstRamDiffOutsideStack(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState();
  const db = b.dumpState();
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) continue;
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

/**
 * Run the oracle and a candidate on two FRESH clones of `entry` (a memory-writing
 * routine demands a fresh clone per side) and diff RAM outside the dead stack.
 */
function diffAgainstOracle(entry, candidate) {
  const a = entry.clone(); // oracle
  const b = entry.clone(); // candidate
  oracle(a);
  candidate(b);
  return firstRamDiffOutsideStack(a, b, entry.regs.sp);
}

/**
 * Hook 0x0874 in a real attract run and clone the machine at up to K real dispatches.
 * The wrapper clones the entry state, then runs the oracle so the host game proceeds
 * undisturbed to a clean stop.
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

/**
 * Build a crafted entry from a real capture: paint every cell the routine could
 * touch — all of video RAM (0x7400-0x77FF, covering both fills) and a guard-banded
 * span around the sprite buffer (0x68F0-0x6A8F) — with `sentinel`, identically on
 * both sides. The guard bands catch an over-write past either end of the buffer.
 */
function craftSentinelEntry(base, sentinel) {
  const w = base.clone();
  for (let a = 0x7400; a <= 0x77ff; a++) w.mem.write8(a, sentinel);
  for (let a = SPRITE_BUFFER - 0x10; a < SPRITE_BUFFER + SPRITE_BUFFER_BYTES + 0x10; a++) {
    w.mem.write8(a & 0xffff, sentinel);
  }
  return w;
}

// -- 1. REALISM (captured dispatches) -----------------------------------------

test("REALISM: real captured 0x0874 dispatches — RAM (ex-stack) matches the oracle", () => {
  const caps = captureDispatches(64, 700);
  assert.ok(caps.length >= 1, "expected at least one real 0x0874 dispatch during attract");

  for (const cap of caps) {
    const ram = diffAgainstOracle(cap, clearPlayfieldAndSprites);
    assert.equal(ram, null, ram && `RAM diff at ${hx(ram.addr)}: oracle=${ram.a} cand=${ram.b}`);
  }
  console.log(`  REALISM: ${caps.length} real 0x0874 dispatches — identical RAM (ex-stack)`);
});

// -- 2. CRAFTED (exact write footprint) ---------------------------------------

test("CRAFTED: sentinel-painted entries pin the exact write footprint against the oracle", () => {
  const [base] = captureDispatches(1, 700);
  assert.ok(base, "need one real capture to derive crafted entries from");

  // Sentinels distinct from the fill bytes (0x10 playfield/columns, 0x00 sprite buf).
  for (const sentinel of [0xee, 0x55, 0xaa, 0x01, 0xff]) {
    const w = craftSentinelEntry(base, sentinel);
    const ram = diffAgainstOracle(w, clearPlayfieldAndSprites);
    assert.equal(
      ram,
      null,
      ram && `footprint mismatch (sentinel ${hx(sentinel)}) at ${hx(ram.addr)}: oracle=${ram.a} cand=${ram.b}`,
    );
  }
  console.log("  CRAFTED: 5 sentinel-painted entries — candidate's write footprint is identical to the oracle");
});

// -- 3. TEETH -----------------------------------------------------------------

/** Broken twin: fills only 27 playfield columns per row (drops column 27 of each). */
function brokenClear(m) {
  const { mem } = m;
  let cell = PLAYFIELD_TOP;
  for (let row = 0; row < PLAYFIELD_ROWS; row++) {
    for (let col = 0; col < PLAYFIELD_COLS - 1; col++) { // BUG: should be PLAYFIELD_COLS
      mem.write8(cell, 0x10);
      cell = (cell + 1) & 0xffff;
    }
    cell = (cell + (ROW_STRIDE - (PLAYFIELD_COLS - 1))) & 0xffff;
  }
  for (const b of SIDE_COL_BASES) {
    let c = b;
    for (let i = 0; i < SIDE_COL_CELLS; i++) { mem.write8(c, 0x10); c = (c + ROW_STRIDE) & 0xffff; }
  }
  for (let i = 0; i < SPRITE_BUFFER_BYTES; i++) mem.write8((SPRITE_BUFFER + i) & 0xffff, 0x00);
}

test("TEETH: the one-column-short twin is CAUGHT — on the sentinel entry and on real captures", () => {
  // Guaranteed catch: on the sentinel entry the dropped column holds 0xEE vs 0x10.
  const [base] = captureDispatches(1, 700);
  const w = craftSentinelEntry(base, 0xee);
  const ram = diffAgainstOracle(w, brokenClear);
  assert.notEqual(ram, null, "the RAM gate FAILED to catch the one-column-short fill — it is worthless");
  assert.equal(
    ram.addr,
    (PLAYFIELD_TOP + (PLAYFIELD_COLS - 1)) & 0xffff, // 0x741F, the first dropped cell
    "the diff must be the dropped column-27 cell of row 0",
  );

  // Also caught on real captures (VRAM starts 0x00, so the dropped cells differ from 0x10).
  const caps = captureDispatches(64, 700);
  let caughtOnCapture = false;
  for (const cap of caps) {
    if (diffAgainstOracle(cap, brokenClear)) { caughtOnCapture = true; break; }
  }
  assert.ok(caughtOnCapture, "the one-column-short twin was not caught on any real capture");
  console.log(`  TEETH: one-column-short twin caught by RAM at ${hx(ram.addr)} (oracle=${ram.a} broken=${ram.b}) and on real captures`);
});
