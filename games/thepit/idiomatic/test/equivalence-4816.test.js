// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for paintPlayfieldStripCol1Row11 (ROM 0x4816) — the round-setup strip painter:
 * it places a tile-cell cursor at column 1 / row 11, resolves the cell's addresses,
 * fills a 10-cell vertical tilemap strip from the ROM table at 0x494f (top cell a fixed
 * cap, the nine below walked back through the table), then paints the same 10 cells with
 * colour 0.
 *
 * CRAFTED-ENTRY, because attract never dispatches paintPlayfieldStripCol1Row11 (it is round setup — the
 * caller holdRoundIntroLoop/setUpRoundAndHoldIntro only runs once a game starts). So we capture REAL machine
 * states at a routine it shares that attract DOES dispatch — loc_3dae, the shared row/col -> offset calc
 * (first entered ~frame 81) — clone at its entry, and run oracle-vs-idiomatic on those states. The routine
 * supplies all of its own inputs (it overwrites the cursor/count/fill scratch it reads and sets its own
 * source pointer), so any real captured state is a valid entry with a realistic RAM image and stack.
 *
 * OBSERVABLE-EQUIVALENCE CONTRACT. The idiomatic routine dissolved three stale oracle
 * calls into direct calls of their decompiled siblings — rowColToTileOffset (0x3dae),
 * deriveTileWriteCursors (0x3dc9) and fillColourColumn (0x3e01) — which are plain JS
 * calls with no Z80 stack frame. Two consequences the oracle does but the idiomatic no
 * longer does: (a) it no longer pushes those callees' return addresses onto the compared
 * work-RAM stack, and (b) the final colour fill was the oracle's tail `jp` whose `ret`
 * returned to paintPlayfieldStripCol1Row11's caller — as a direct call it just paints and returns, so the
 * idiomatic leaves pc/SP one return short. So the gate models the return with one
 * m.ret() on the candidate (lining pc + SP up with the oracle), compares the observable
 * RAM the strip paints + pc + SP, and EXCLUDES the dead stack-scratch window just below
 * the entry stack pointer and the declared-dead value registers (the honest live-out is
 * memory-only). (In this routine the one retained oracle call — the tilemap fill 0x3ddb,
 * which has no idiomatic form yet — re-pushes the same return-address slot, so the
 * excluded window in fact coincides byte-for-byte; the exclusion is the general dissolve
 * guard, and here the RAM matches through it.)
 *
 * Jobs:
 *   1. EQUAL   — on each captured real entry, oracle and idiomatic leave identical
 *                observable RAM + pc + SP.
 *   2. PAINTED — pre-dirty the 20 target cells, run the oracle, and confirm exactly the
 *                10 tilemap cells and 10 colour cells (plus the scratch) were written —
 *                proof the entries actually exercise the paint, and the footprint.
 *   3. TEETH   — a twin that fills 9 cells instead of 10 MUST be caught, both on the
 *                whole-state contract and specifically at the 10th (unpainted) cell.
 *
 * Run: node --test games/thepit/idiomatic/test/equivalence-4816.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_4816 as oracle } from "../../translated/loc_4816.js";
import { paintPlayfieldStripCol1Row11 as idiomatic } from "../paintPlayfieldStripCol1Row11.js";
import { loc_3dae as proxyOracle } from "../../translated/loc_3dae.js";
import { rowColToTileOffset } from "../rowColToTileOffset.js";
import { deriveTileWriteCursors } from "../deriveTileWriteCursors.js";
import { fillColourColumn } from "../fillColourColumn.js";
import { makeMachineFactory } from "../../machine.js";
import { firstStateDiff, deadStackBelow } from "../../../../core/equivalence.js";

const ROM_PATH = new URL("../../rom/maincpu.bin", import.meta.url);
const ROM_PRESENT = existsSync(ROM_PATH);
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(ROM_PATH)) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not present at games/thepit/rom/maincpu.bin" }, fn);

const PROXY = 0x3dae; // a shared callee attract dispatches; its entry states are real
const STRIP_HEIGHT = 0x8055; // strip cell count (scratch)
// Dead-scratch window: the return-address word the retained tilemap-fill call parks below the entry SP.
const STACK_SCRATCH_BYTES = 2;

// The routine paints column 1 / row 11: offset = 32*11 + 1 = 0x161; colour base
// 0x161 + 0x8800 = 0x8961, tilemap base + 0x9000 = 0x9161. Both runs are 10 cells,
// stride 0x20 (one row down).
const TILE_CELLS = Array.from({ length: 10 }, (_, k) => 0x9161 + k * 0x20);
const COLOUR_CELLS = Array.from({ length: 10 }, (_, k) => 0x8961 + k * 0x20);
const DIRTY = 0x99; // sentinel for the pre-dirty proof

const hx = (v) => "0x" + (v & 0xffff).toString(16);

const makeMachine = ROM_PRESENT ? await makeMachineFactory(ROM) : null;

/**
 * Capture up to K real machine states at PROXY's dispatch during a boot/attract run.
 * The wrapper clones on entry, then delegates to the oracle so the host proceeds
 * undisturbed — the capture/clone/replay pattern, off to the side of the live run.
 */
function captureEntries(K, maxFrames) {
  const caps = [];
  const snap = new Map([[PROXY, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return proxyOracle(mm);
  }]]);
  makeMachine(snap).runFrames(maxFrames);
  return caps;
}

const ENTRIES = ROM_PRESENT ? captureEntries(6, 240) : [];

/** First differing RAM byte, EXCLUDING the dead stack-scratch window [entrySP - STACK_SCRATCH_BYTES, entrySP).
 *  Null when otherwise identical. */
function ramDiffOutsideStack(a, b, entrySP) {
  const da = a.dumpState();
  const db = b.dumpState();
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (deadStackBelow({ lo: entrySP - STACK_SCRATCH_BYTES, hi: entrySP }, entrySP)(addr)) continue; // dead stack scratch
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

/**
 * Candidate vs oracle over the contract for one entry: RAM (outside the stack scratch) + pc + SP; the
 * candidate models its return with one m.ret(). Returns { diffs, ram } (diffs empty == EQUAL).
 */
function contractDiffs(entry, fn) {
  const sp = entry.regs.sp;
  const o = entry.clone();
  oracle(o);
  const c = entry.clone();
  fn(c);
  c.ret();

  const diffs = [];
  const ram = ramDiffOutsideStack(o, c, sp);
  if (ram) diffs.push(`RAM@${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
  if (o.pc !== c.pc) diffs.push(`pc oracle=${hx(o.pc)} cand=${hx(c.pc)}`);
  if (o.regs.sp !== c.regs.sp) diffs.push(`SP oracle=${hx(o.regs.sp)} cand=${hx(c.regs.sp)}`);
  return { diffs, ram };
}

test("EQUAL: real captured entries — idiomatic paintPlayfieldStripCol1Row11 == oracle in observable RAM + pc + SP", () => {
  assert.ok(ENTRIES.length >= 1, "expected at least one real proxy dispatch in the run window");
  for (const entry of ENTRIES) {
    const { diffs } = contractDiffs(entry, idiomatic);
    assert.equal(diffs.length, 0, diffs.join("; "));
  }
  console.log(`  EQUAL: ${ENTRIES.length} real entries identical (observable RAM + pc + SP)`);
});

test("PAINTED: the oracle writes exactly the 10 tilemap + 10 colour cells (and the scratch)", () => {
  const entry = ENTRIES[0];
  const before = entry.clone();
  const after = entry.clone();
  for (const a of [...TILE_CELLS, ...COLOUR_CELLS]) {
    before.mem.write8(a, DIRTY);
    after.mem.write8(a, DIRTY);
  }
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();

  for (const a of TILE_CELLS) {
    assert.notEqual(after.mem.read8(a), DIRTY, `tilemap cell ${hx(a)} was not painted`);
  }
  for (const a of COLOUR_CELLS) {
    assert.equal(after.mem.read8(a), 0x00, `colour cell ${hx(a)} must be colour 0`);
  }

  // The full write-set stays inside {paint scratch 0x8055-0x8061} + the 20 target
  // cells + the stack window below the entry SP (the pushed/popped return-address word — the routine's
  // real stack traffic, which is exactly why the gate excludes that dead window).
  const targets = new Set([...TILE_CELLS, ...COLOUR_CELLS]);
  const stackTop = entry.regs.sp;
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] === a1[off]) continue;
    const addr = after.stateOffsetToAddr(off);
    const isScratch = addr >= 0x8055 && addr <= 0x8061;
    const isStack = deadStackBelow({ lo: stackTop - 8, hi: 0x8400 }, stackTop)(addr);
    assert.ok(
      isScratch || isStack || targets.has(addr),
      `oracle wrote outside the paint footprint at ${hx(addr)} (${b0[off]}->${a1[off]})`,
    );
  }
  console.log("  PAINTED: 10 tilemap + 10 colour cells written; footprint = paint scratch + those cells + the return-address stack word");
});

/** Broken twin: a faithful copy of the idiomatic body (same dissolved direct calls,
 *  same retained tilemap-fill call) with the strip height wrong — 9 instead of 10, a
 *  plausible off-by-one that fills one cell too few. */
function brokenLoc4816(m) {
  const { regs, mem } = m;
  mem.write8(0x8058, 1);
  mem.write8(0x8059, 11);
  rowColToTileOffset(m);
  deriveTileWriteCursors(m);
  mem.write8(0x8057, 0);
  mem.write8(STRIP_HEIGHT, 9); // BUG: the strip is 10 cells tall
  regs.ix = 0x494f;
  m.push16(0x4837);
  m.call(0x3ddb);
  return fillColourColumn(m);
}

test("TEETH: a twin that fills 9 cells instead of 10 is CAUGHT (the gate can fail)", () => {
  const entry = ENTRIES[0];

  // Observable-equivalence contract catches it on a plain entry.
  const { diffs } = contractDiffs(entry, brokenLoc4816);
  assert.ok(diffs.length > 0, "the gate FAILED to catch a short strip fill — it is worthless");

  // And it reaches the painted output: with the target cells pre-dirtied, the oracle
  // paints the 10th tilemap cell while the short twin leaves it dirty.
  const tenth = TILE_CELLS[9];
  const od = entry.clone();
  const cd = entry.clone();
  for (const a of [...TILE_CELLS, ...COLOUR_CELLS]) {
    od.mem.write8(a, DIRTY);
    cd.mem.write8(a, DIRTY);
  }
  oracle(od);
  brokenLoc4816(cd);
  assert.notEqual(od.mem.read8(tenth), DIRTY, "oracle should have painted the 10th cell");
  assert.equal(cd.mem.read8(tenth), DIRTY, "short twin should have left the 10th cell unpainted");
  assert.notEqual(
    od.mem.read8(tenth),
    cd.mem.read8(tenth),
    "teeth NOT caught at the 10th painted cell",
  );
  console.log(`  TEETH: short fill caught (${diffs.join("; ")}) and at the 10th cell ${hx(tenth)} (oracle=${od.mem.read8(tenth)} twin=${cd.mem.read8(tenth)})`);
});
