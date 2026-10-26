// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for drawLadder (ROM 0x0e19) — the board-layout
 * renderer's segment BODY FILL: stamps the ladder body tile 0xC0 across a segment's
 * run (span counter 0x63B2, write pointer HL), then draws the end cap (its ROM tail
 * into loc_0e2a) which advances the table cursor DE.
 *
 * This is the CYCLE-FREE / memory-equivalence gate (docs/decompiler-pipeline), not the retired strict
 * whole-machine one. drawLadder WRITES memory and calls a subroutine, so every case
 * uses a FRESH clone per side (never a reused machine). The oracle (translated loc_0e19,
 * whose own tail `m.call(0x0e2a)` runs the wired end cap) is run on one clone, and
 * drawLadder (whose tail is a direct call to drawSegmentEndCap, loc_0e2a's twin) on
 * another, then compared on the go-forward contract:
 *
 *     RAM (dumpState, minus the stack scratch below the entry SP) + SP + declared live-out DE.
 *
 * dumpState covers work + sprite + VIDEO RAM, so both the 0x63B2 counter and the tile
 * stamps — this routine's whole point — are inside the compared state. DE is the live-out:
 * the successor 0x0DA7 does `ld a,(de)` first thing, so the advanced cursor must match.
 * SP is compared and is trivially equal (neither side touches the stack). pc is NOT
 * compared: the oracle's tail chain leaves pc in loc_0e2a/0x0da7, but that tail is
 * structural in the direct-call layer. A and HL are dead at the tail (the end cap and
 * then 0x0DA7 overwrite them) so they are neither reproduced nor compared.
 *
 * Jobs:
 *   1. EQUAL (captured dispatches) — hook 0x0e19 in a real attract run; on each true
 *      dispatch, oracle vs drawLadder leave identical RAM (−stack) + SP + DE. Reports
 *      the span-length distribution actually exercised.
 *   2. WRITE-SET (captured) — the oracle's only work/sprite/video writes are the 0x63B2
 *      counter (work RAM) and VIDEO-RAM tile cells; documents the exact footprint.
 *   3. CRAFTED (span lengths forced) — poke 0x63B2 to force the immediate-borrow (zero
 *      tiles), single-tile, and multi-tile runs identically on both sides; confirm
 *      oracle==candidate AND that exactly floor(span/8) body tiles genuinely landed. The
 *      end cap is steered to a different VRAM page (0x63AD) and kept 0xC0-free (kind≠1,
 *      small remainder) so the counted 0xC0 cells are unambiguously the body's.
 *   4. TEETH — a twin that stamps 0xC1 instead of 0xC0 MUST be caught, on a captured
 *      dispatch and on the crafted multi-tile arm.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-0e19.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0e19 as oracle } from "../../translated/loc_0e19.js";
import { drawLadder } from "../drawLadder.js";
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

const TARGET = 0x0e19;
const SPAN = 0x63b2; // span counter (pixels), decremented 8 at a time; borrow ends the run
const KIND = 0x63b3; // record kind (used only by the end cap; 1 = single-cell segment)
const REMAINDER = 0x63b0; // sub-tile remainder (used only by the end cap)
const ENDPTR = 0x63ad; // second point's tilemap address (the end cap's write pointer)

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
 * Hook 0x0e19 in a real attract run and clone the machine at up to K true dispatches.
 * 0x0e19 is reached via m.call from loc_0dd3 during board-layout draw; the wrapper
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

test("EQUAL: real captured dispatches — drawLadder == oracle in RAM (−stack) + SP + DE", () => {
  assert.ok(CAPS.length >= 1, "expected at least one real 0x0e19 dispatch in the run window");

  const lengths = new Set();
  for (const cap of CAPS) {
    lengths.add(Math.floor(cap.mem.read8(SPAN) / 8)); // tiles this dispatch will draw

    const o = cap.clone();
    const c = cap.clone();
    oracle(o);
    drawLadder(c);

    const diff = contractDiff(o, c, cap.regs.sp);
    assert.equal(diff, null, diff);
  }
  console.log(
    `  EQUAL: ${CAPS.length} real dispatches identical (RAM −stack + SP + DE); ` +
      `span lengths (tiles) seen: ${[...lengths].sort((a, b) => a - b).join(", ")}`,
  );
});

// -- 2. WRITE-SET (captured) --------------------------------------------------

test("WRITE-SET: the oracle writes only the 0x63B2 counter and VIDEO-RAM tile cells", () => {
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
      const isCounter = addr === SPAN;
      const isVideo = addr >= 0x7400 && addr < 0x7800;
      assert.ok(
        isCounter || isVideo,
        `oracle wrote outside {0x63B2, video RAM} at ${hx(addr)} (${b0[off]}->${a1[off]})`,
      );
      if (isVideo) cells++;
    }
    maxCells = Math.max(maxCells, cells);
  }
  console.log(`  WRITE-SET: every dispatch wrote only 0x63B2 + VIDEO RAM (0x7400-0x77FF); up to ${maxCells} tile cell(s)/dispatch`);
});

// -- 3. CRAFTED (span lengths forced) -----------------------------------------

test("CRAFTED: forced span lengths — oracle==candidate + exactly floor(span/8) tiles land", () => {
  const base = CAPS[0];
  // The body walk stays within HL's tilemap page (`inc l` wraps the low byte). Steer the
  // end cap to a DIFFERENT VRAM page and keep it 0xC0-free (kind != 1 -> no back stamp;
  // small remainder -> forward tile is remainder+0xE0, not 0xC0), so every 0xC0 cell we
  // count is unambiguously a body tile, never the end cap's.
  const hl = base.regs.hl;
  const bodyPage = hl & 0xff00;
  const col = hl & 0x00ff;
  const VRAM_PAGES = [0x7400, 0x7500, 0x7600, 0x7700];
  const endPage = VRAM_PAGES.find((p) => p !== bodyPage); // guaranteed distinct from the body page
  const endPtr = endPage | 0x20; // an arbitrary column in the other page

  for (const span of [0x00, 0x05, 0x08, 0x0f, 0x10, 0x40]) {
    const N = Math.floor(span / 8); // tiles this span must draw
    const o = base.clone();
    const c = base.clone();

    // Identical surgical setup on BOTH sides.
    for (const mm of [o, c]) {
      mm.mem.write8(SPAN, span);
      mm.mem.write8(KIND, 0x02); // not 1 -> end cap makes no 0xC0 back-stamp
      mm.mem.write8(REMAINDER, 0x03); // small nonzero -> forward tile is 0xE3, not 0xC0
      mm.mem.write16(ENDPTR, endPtr); // end cap writes land in a different VRAM page
      // Pre-dirty the body path so a counted 0xC0 proves a write, not a leftover.
      for (let k = 0; k <= N + 1; k++) mm.mem.write8(bodyPage | ((col + k) & 0xff), 0x99);
    }

    oracle(o);
    drawLadder(c);

    const diff = contractDiff(o, c, base.regs.sp);
    assert.equal(diff, null, `span=${hx(span)}: ${diff}`);

    // Arm semantics: exactly the first N cells (col+1..col+N) became the body tile 0xC0;
    // HL's own cell (col+0) and the cell past the run (col+N+1) were not touched.
    assert.equal(c.mem.read8(bodyPage | (col & 0xff)), 0x99, `span=${hx(span)}: HL cell should be untouched`);
    for (let k = 1; k <= N; k++) {
      assert.equal(
        c.mem.read8(bodyPage | ((col + k) & 0xff)),
        0xc0,
        `span=${hx(span)}: body cell +${k} should be 0xC0`,
      );
    }
    assert.equal(
      c.mem.read8(bodyPage | ((col + N + 1) & 0xff)),
      0x99,
      `span=${hx(span)}: cell past the run (+${N + 1}) should be untouched`,
    );
  }
  console.log("  CRAFTED: immediate-borrow / single-tile / multi-tile spans — oracle==candidate and exactly floor(span/8) tiles landed");
});

// -- 4. TEETH -----------------------------------------------------------------

/** Broken twin: stamps 0xC1 instead of the ladder body tile 0xC0 — a plausible
 *  constant off-by-one bug. Identical to drawLadder otherwise (same end cap). */
function brokenDrawLadder(m) {
  const { regs, mem } = m;
  for (;;) {
    const span = mem.read8(SPAN);
    mem.write8(SPAN, (span - 0x08) & 0xff);
    if (span < 0x08) break;
    regs.l = (regs.l + 1) & 0xff;
    mem.write8(regs.hl, 0xc1); // BUG: body tile must be 0xC0
  }
  drawSegmentEndCap(m);
}

test("TEETH: a wrong body tile (0xC1) is CAUGHT on a captured dispatch and the crafted multi-tile arm", () => {
  let caught = null;
  for (const cap of CAPS) {
    if (Math.floor(cap.mem.read8(SPAN) / 8) < 1) continue; // needs at least one body tile
    const o = cap.clone();
    const c = cap.clone();
    oracle(o);
    brokenDrawLadder(c);
    const d = ramDiffMinusStack(o, c, cap.regs.sp);
    if (d) { caught = d; break; }
  }
  assert.notEqual(caught, null, "the gate FAILED to catch a wrong body tile — it is worthless");

  // Crafted multi-tile arm too — must be caught regardless.
  const o = CAPS[0].clone();
  const oFloor = o.regs.sp;
  const c = CAPS[0].clone();
  o.mem.write8(SPAN, 0x40); c.mem.write8(SPAN, 0x40);
  oracle(o);
  brokenDrawLadder(c);
  assert.notEqual(ramDiffMinusStack(o, c, oFloor), null, "teeth NOT caught on the crafted multi-tile arm");

  console.log(`  TEETH: wrong body tile caught at ${hx(caught.addr ?? 0)} (oracle=${caught.a} broken=${caught.b}) + crafted multi-tile arm`);
});
