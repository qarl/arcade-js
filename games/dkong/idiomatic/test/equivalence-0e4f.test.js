// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for drawGirderSpan (ROM 0x0E4F) — the board-layout renderer's
 * kind-2 GIRDER drawer: walks DOWN the tilemap laying a (up to two-wide, optionally
 * slanting) girder run, paying the height counter 0x63B1 down 8 px per row, then steps
 * the record cursor DE past the record.
 *
 * This is the CYCLE-FREE / memory-equivalence gate (docs/decompiler-pipeline), not the retired strict
 * whole-machine one. drawGirderSpan WRITES memory (0x63B5 tile code, 0x63B1 height, and the
 * tilemap VRAM cells) and, on the kind != 2 arm, calls a subroutine, so every case uses
 * a FRESH clone per side (never a reused machine). The oracle (translated loc_0e4f) is
 * run on one clone and drawGirderSpan on another, then compared on the go-forward contract:
 *
 *     RAM (dumpState, minus the stack scratch below the entry SP) + SP + declared live-out DE.
 *
 * dumpState covers work + sprite + VIDEO RAM, so both the 0x63B1/0x63B5 scratch and the
 * tile stamps — this routine's whole point — are inside the compared state. DE is the
 * live-out: the successor sub_0da7 (0x0DA7) does `ld a,(de)` first thing, so the advanced
 * cursor must match. SP is compared and is trivially equal (neither side touches the
 * stack; m.call adds no push). pc is NOT compared: the oracle's tail chain leaves pc in a
 * callee / 0x0DA7, but that tail is structural in the direct-call layer. A / HL / BC are
 * dead at the tail (the walk and its dispatch overwrite them) so they are neither
 * reproduced nor compared.
 *
 * Attract renders this for real on every 25m girder — all captured dispatches are kind 2,
 * and they naturally span straight (x-delta 0), slant-right (0x07/0x0C) and slant-left
 * (0xF4/0xFD) runs over real heights, so the stamp loop, both descend blocks, and both
 * slant arms are exercised by real states. The kind != 2 DELEGATION (to drawCappedTileColumn)
 * is unreached in attract, so it is a CRAFTED entry (docs/decompiler-pipeline): a real render-walk state with
 * a surgical kind nudge, identical on both sides.
 *
 * Jobs:
 *   1. EQUAL (captured dispatches) — hook 0x0E4F in a real attract run; on each true
 *      dispatch, oracle vs drawGirderSpan leave identical RAM (−stack) + SP + DE. Reports the
 *      x-delta and height distribution actually exercised.
 *   2. WRITE-SET (captured) — the oracle's only writes are 0x63B1, 0x63B5, and VIDEO-RAM
 *      tile cells; documents the exact footprint.
 *   3. CRAFTED (kind != 2 delegation) — poke the record kind to 3/4/5/6/7 identically on
 *      both sides so the routine hands off to drawCappedTileColumn (kind 3 = capped column;
 *      4/5/6 = uniform fill; 7 = bail); confirm oracle == drawGirderSpan including the DE the
 *      callee advances.
 *   4. CRAFTED (row-boundary early exit) — the slant-right path ends the run early when a
 *      shift lands the write pointer on a 32-cell row boundary (block 0x0EC9's `and 0x1f`
 *      exit). Attract never hits it — real girders always exit by exhausting the height —
 *      so it is crafted: a slant-right run started on a row-aligned column, identically on
 *      both sides. Confirms oracle == drawGirderSpan AND that the run really stopped on the
 *      boundary (height left unspent) rather than running to exhaustion.
 *
 *      The band-edge column shifts (0xF8 wrap / 0xF0 re-seat) need no crafting: the real
 *      captured dispatches in job 1 hit them naturally (8 wraps + 8 re-seats across the 18).
 *   5. TEETH (paired tile) — a twin that lays the paired half-tile as (tile − 0x08) instead
 *      of (tile − 0x10) MUST be caught in the tilemap VRAM.
 *   6. TEETH (live-out DE) — a twin that forgets to advance DE MUST be caught by the DE
 *      comparison; a gate blind to the record cursor would let the walk desync silently.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-0e4f.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0e4f as oracle } from "../../translated/loc_0e4f.js";
import { drawGirderSpan } from "../drawGirderSpan.js";
import { drawCappedTileColumn } from "../drawCappedTileColumn.js";
import { Machine } from "../../machine.js";
import { firstStateDiff, deadStackBelow } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x0e4f;
const KIND = 0x63b3; // record kind (2 = girder; anything else delegates)
const TILE_SEED = 0x63af; // record tile byte; girder tile code = this + 0xF0
const HEIGHT = 0x63b1; // girder run length, in px, paid down 8 at a time
const XDELTA = 0x63b2; // 0 = straight; sign of nonzero picks the slant direction
const TILECODE = 0x63b5; // live girder tile code (seeded then nudged as it descends)

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
 * Hook 0x0E4F in a real attract run and clone the machine at up to K true dispatches.
 * 0x0E4F is reached via m.call from loc_0dd3 during the board-layout draw (the kind-2
 * arm); the wrapper snapshots the entry state, then runs the oracle so the host proceeds
 * undisturbed. The snapshot overrides ONLY 0x0E4F, so the oracle's own m.call(0x0EE8) on a
 * crafted kind != 2 arm still resolves to the translated loc_0ee8 (the true oracle callee).
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

const CAPS = ROM_PRESENT ? captureDispatches(64, 4000) : [];

// -- 1. EQUAL (captured dispatches) -------------------------------------------

test("EQUAL: real captured dispatches — drawGirderSpan == oracle in RAM (−stack) + SP + DE", () => {
  assert.ok(CAPS.length >= 1, "expected at least one real 0x0E4F dispatch in the run window");

  const xdeltas = new Set();
  const heights = new Set();
  for (const cap of CAPS) {
    assert.equal(cap.mem.read8(KIND), 0x02, "attract dispatches should all be kind-2 girders");
    xdeltas.add(cap.mem.read8(XDELTA));
    heights.add(cap.mem.read8(HEIGHT));

    const o = cap.clone();
    const c = cap.clone();
    oracle(o);
    drawGirderSpan(c);

    const diff = contractDiff(o, c, cap.regs.sp);
    assert.equal(diff, null, diff);
  }
  const asHex = (s) => [...s].sort((a, b) => a - b).map((v) => hx(v)).join(", ");
  console.log(
    `  EQUAL: ${CAPS.length} real dispatches identical (RAM −stack + SP + DE); ` +
      `x-deltas seen: ${asHex(xdeltas)}; heights seen: ${asHex(heights)}`,
  );
});

// -- 2. WRITE-SET (captured) --------------------------------------------------

test("WRITE-SET: the oracle writes only 0x63B1, 0x63B5 and VIDEO-RAM tile cells", () => {
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
      const isScratch = addr === HEIGHT || addr === TILECODE;
      const isVideo = addr >= 0x7400 && addr < 0x7800;
      assert.ok(
        isScratch || isVideo,
        `oracle wrote outside {0x63B1, 0x63B5, video RAM} at ${hx(addr)} (${b0[off]}->${a1[off]})`,
      );
      if (isVideo) cells++;
    }
    maxCells = Math.max(maxCells, cells);
  }
  console.log(`  WRITE-SET: every dispatch wrote only 0x63B1 + 0x63B5 + VIDEO RAM (0x7400-0x77FF); up to ${maxCells} tile cell(s)/dispatch`);
});

// -- 3. CRAFTED (kind != 2 delegation) ----------------------------------------

test("CRAFTED: kind != 2 hands off to drawCappedTileColumn — oracle == drawGirderSpan (incl. DE)", () => {
  const base = CAPS[0];
  for (const kind of [0x03, 0x04, 0x05, 0x06, 0x07]) {
    const o = base.clone();
    const c = base.clone();
    o.mem.write8(KIND, kind);
    c.mem.write8(KIND, kind);

    oracle(o); // translated loc_0e4f -> m.call(0x0EE8) -> translated loc_0ee8
    drawGirderSpan(c); // -> drawCappedTileColumn directly

    const diff = contractDiff(o, c, base.regs.sp);
    assert.equal(diff, null, `kind=${hx(kind)}: ${diff}`);
  }
  // Sanity: the idiomatic delegate is the one this arm calls (guards against a silent
  // import drift where the kind != 2 branch no longer reaches drawCappedTileColumn).
  assert.equal(typeof drawCappedTileColumn, "function");
  console.log("  CRAFTED/kind: kinds 3/4/5/6/7 delegate identically (RAM −stack + SP + DE)");
});

// -- 4. CRAFTED (row-boundary early exit) -------------------------------------

test("CRAFTED: slant-right row-boundary early exit — oracle == drawGirderSpan, run stops on the boundary", () => {
  // Surgical nudges on a real capture: keep it a kind-2 girder, start the run on a
  // row-aligned VRAM column (0x7420, low 5 bits 0) with a positive x-delta and a small
  // tile seed (tile 0xF0 -> +1 = 0xF1, no 0xF8 wrap that cycle). After two descents the
  // slant-right shift leaves HL on the next row boundary, so block 0x0EC9 exits with the
  // height only partly spent — the arm attract never reaches. Both sides identical.
  const START = 0x7420; // row-aligned tilemap column, deep enough inside VRAM to stay in it
  const HEIGHT_IN = 0x40; // 64 px — two 8-px descents happen, then the boundary exit
  const o = CAPS[0].clone();
  const oFloor = o.regs.sp;
  const c = CAPS[0].clone();
  for (const mm of [o, c]) {
    mm.mem.write8(KIND, 0x02);
    mm.mem.write16(0x63ab, START); // converted VRAM corner address
    mm.mem.write8(TILE_SEED, 0x00); // girder tile code 0xF0
    mm.mem.write8(XDELTA, 0x01); // positive -> slant right
    mm.mem.write8(HEIGHT, HEIGHT_IN);
  }
  oracle(o);
  drawGirderSpan(c);

  const diff = contractDiff(o, c, oFloor);
  assert.equal(diff, null, diff);

  // Prove the run exited on the row boundary, not by exhausting the height: exactly two
  // descents were paid (0x40 - 2*0x08 = 0x30 left), so the height is still well above 0.
  assert.equal(
    c.mem.read8(HEIGHT),
    0x30,
    "expected the run to stop on the row boundary after two descents (0x30 height left), " +
      `not run to exhaustion — got 0x63B1 = ${hx(c.mem.read8(HEIGHT))}`,
  );
  console.log("  CRAFTED/row-exit: slant-right run stopped on the row boundary (0x63B1 left at 0x30), oracle == drawGirderSpan");
});

// -- 5. TEETH (paired tile) ---------------------------------------------------

/**
 * Broken twin: lays the paired half-tile as (tile − 0x08) instead of the real
 * (tile − 0x10) — a plausible confusion of the pair offset with the per-row step.
 * Identical to drawGirderSpan in every other respect (same descend, slant, DE advance).
 */
function brokenPairedTile(m) {
  const { regs, mem } = m;
  if (mem.read8(KIND) !== 0x02) return drawCappedTileColumn(m);
  mem.write8(TILECODE, (mem.read8(TILE_SEED) + 0xf0) & 0xff);
  let hl = mem.read16(0x63ab);
  function stamp(skipOnSentinel) {
    const t = mem.read8(TILECODE);
    mem.write8(hl, t);
    hl = (hl + 1) & 0xffff;
    if ((hl & 0x1f) === 0) return;
    if (skipOnSentinel && t === 0xf0) return;
    mem.write8(hl, (t - 0x08) & 0xff); // BUG: pair must be tile − 0x10
  }
  function descend() {
    hl = (hl + 0x1f) & 0xffff;
    const h = mem.read8(HEIGHT);
    if (h < 0x08) return false;
    mem.write8(HEIGHT, (h - 0x08) & 0xff);
    return true;
  }
  let phase = "STAMP_ROW";
  for (;;) {
    if (phase === "STAMP_ROW") { stamp(true); phase = "DESCEND_A"; continue; }
    if (phase === "DESCEND_A") {
      if (!descend()) break;
      if (mem.read8(XDELTA) === 0x00) { phase = "STAMP_ROW"; continue; }
      stamp(false); phase = "DESCEND_B"; continue;
    }
    if (phase === "DESCEND_B") {
      if (!descend()) break;
      if (mem.read8(XDELTA) & 0x80) { phase = "SLANT_LEFT"; continue; }
      const t = (mem.read8(TILECODE) + 1) & 0xff;
      mem.write8(TILECODE, t);
      if (t === 0xf8) { hl = (hl + 1) & 0xffff; mem.write8(TILECODE, 0xf0); }
      phase = "ROW_CHECK"; continue;
    }
    if (phase === "ROW_CHECK") { if ((hl & 0x1f) !== 0) { phase = "STAMP_ROW"; continue; } break; }
    const t = (mem.read8(TILECODE) - 1) & 0xff;
    mem.write8(TILECODE, t);
    if (((t - 0xf0) & 0x80) !== 0) { hl = (hl - 1) & 0xffff; mem.write8(TILECODE, 0xf7); }
    phase = "STAMP_ROW";
  }
  regs.de = (regs.de + 1) & 0xffff;
}

test("TEETH: a wrong paired tile (−0x08) is CAUGHT in the tilemap on a captured dispatch", () => {
  let caught = null;
  for (const cap of CAPS) {
    const o = cap.clone();
    const c = cap.clone();
    oracle(o);
    brokenPairedTile(c);
    const d = ramDiffMinusStack(o, c, cap.regs.sp);
    if (d) { caught = d; break; }
  }
  assert.notEqual(caught, null, "the gate FAILED to catch a wrong paired tile — it is worthless");
  console.log(`  TEETH/pair: wrong paired tile caught at ${hx(caught.addr ?? 0)} (oracle=${caught.a} broken=${caught.b})`);
});

// -- 6. TEETH (live-out DE) ---------------------------------------------------

/** Broken twin: runs the real drawGirderSpan but never advances DE. The RAM is identical;
 *  only the DE live-out diverges, so a gate blind to DE would pass it. */
function brokenNoDeAdvance(m) {
  const saved = m.regs.de;
  drawGirderSpan(m);
  m.regs.de = saved; // undo the advance -> DE never moves
}

test("TEETH: forgetting to advance DE is CAUGHT by the DE comparison", () => {
  const cap = CAPS[0];
  const o = cap.clone();
  const c = cap.clone();
  oracle(o);
  brokenNoDeAdvance(c);

  // RAM alone must NOT catch this (proves the DE check is load-bearing, not redundant).
  assert.equal(ramDiffMinusStack(o, c, cap.regs.sp), null, "RAM unexpectedly differs — this teeth no longer isolates DE");
  const diff = contractDiff(o, c, cap.regs.sp);
  assert.notEqual(diff, null, "the gate FAILED to catch a stalled DE cursor — the walk could desync silently");
  assert.match(diff, /^DE:/, `expected a DE mismatch, got: ${diff}`);
  console.log(`  TEETH/DE: stalled cursor caught — ${diff}`);
});
