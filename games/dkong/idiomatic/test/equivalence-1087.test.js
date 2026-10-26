// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for seed75mBoardObjects (ROM 0x1087) — the 75m (board 3,
 * elevators) arm of the per-board setup dispatcher sub_0f56. It seeds three object-record
 * blocks (0x6400, 0x6500, 0x6600) in work RAM and builds their hardware sprite records
 * inside SPRITE_BUFFER, via four already-decompiled helpers (replicateGroupStrided 0x122a,
 * seedObjectBlockSprites 0x1186, copyBytePairsStrided 0x11ec, gatherSpriteRecords 0x11d3)
 * plus in-line fills and two ROM->RAM block copies.
 *
 * This is the cycle-free / memory-equivalence gate (docs/decompiler-pipeline), not the retired strict
 * whole-machine one. The routine WRITES a large RAM footprint and reads implicit inputs
 * (the 0x6500 block's +3/+5 fields), so every case runs on FRESH clones per side and is
 * compared on:
 *
 *     RAM (dumpState, minus the stack scratch below the entry SP) + pc + SP.
 *
 * NO registers and NO cycles are compared (docs/decompiler-pipeline). Live-out here is memory-only: the
 * board-setup caller reads game RAM next frame, not registers, and — unlike the sibling
 * 0x1186 gate — the register file is NOT byte-faithful (the helpers and block copies leave
 * HL/DE/BC/IX/A in helper-specific states the oracle's trailing `ld`s never reconcile), so
 * including it would be wrong, not a free margin. The idiomatic routine models the internal
 * Z80 calls as direct JS calls (the callees touch no stack) and drops its own terminal
 * `ret`; the harness performs ONE m.ret() on the candidate clone to line pc + SP up with the
 * oracle (which rets internally). The oracle's transient push16s for its internal calls land
 * in STACK_SCRATCH [0x6be0,0x6c00) (measured entry SP printed below; deepest push, 2 levels
 * via 0x1186, stays >= 0x6be0), so those dead bytes — which the candidate never writes — are
 * excluded by the contract, exactly as intended.
 *
 * REACHABILITY. seed75mBoardObjects is dispatched only for BOARD(0x6227) == 3 (sub_0f56's
 * rst-0x28 table at 0x0FCD, index 3); attract only plays 25m, so it NEVER dispatches in a
 * plain run. Following the sibling gates (0x0D4C, 0x1186), the test forces the real dispatch
 * with an IDENTICAL-BOTH-SIDES board poke (Karl-sanctioned "poke the board state to reach a
 * state for validation"): at frame 100 set GAME_STATE=3, GAME_SUBSTATE=10 (board setup),
 * SUBSTATE_TIMER=1, BOARD=3 — a REAL captured entry (real register file, real stack, real
 * board). This is the same poke the 0x1186 gate uses for its board-3 captures, and 0x1186 is
 * called BY this routine, so the poke provably reaches 0x1087.
 *
 * Jobs:
 *   1. EQUAL (real forced dispatches) — oracle vs seed75mBoardObjects on fresh clones of
 *      each captured board-3 entry leave identical RAM (-STACK_SCRATCH) + pc + SP.
 *   2. CRAFTED (distinctive 0x6500 content) — the real 0x6500 block is zero-filled at
 *      dispatch, so poke distinctive +3/+5 (X/Y) into every record identically both sides,
 *      giving the permuting gather non-trivial inputs; oracle == candidate. Then read the
 *      candidate back and assert the routine's OWN fixed outputs (the 0x6400 record
 *      constants, the two ROM->RAM template copies) landed as intended.
 *   3. TEETH — two deliberately-broken twins, each MUST be caught on RAM:
 *      (a) SKIP-FILL: omits step 3 (the 0x6600-block 0x01 fill), leaving those cells at 0.
 *      (b) WRONG-DEST: block-copies the 0x1121 inline table to 0x6960 instead of 0x6970.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-1087.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1087 as oracle } from "../../translated/loc_1087.js";
import { seed75mBoardObjects } from "../seed75mBoardObjects.js";
import { replicateGroupStrided } from "../replicateGroupStrided.js";
import { seedObjectBlockSprites } from "../seedObjectBlockSprites.js";
import { copyBytePairsStrided } from "../copyBytePairsStrided.js";
import { gatherSpriteRecords } from "../gatherSpriteRecords.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x1087;
const hx = (v) => "0x" + (v & 0xffff).toString(16);


function ramDiffMinusStack(ma, mb, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const a = ma.dumpState();
  const b = mb.dumpState();
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] === b[i]) continue;
    const addr = ma.stateOffsetToAddr(i);
    if (dead(addr)) continue;
    return { addr, a: a[i], b: b[i] };
  }
  return null;
}

function contractDiffs(entry, fn) {
  const o = entry.clone();
  oracle(o);
  const c = entry.clone();
  fn(c);
  c.ret(); // model seed75mBoardObjects's own terminal `ret` so pc + SP line up
  const diffs = [];
  const ram = ramDiffMinusStack(o, c, entry.regs.sp);
  if (ram) diffs.push(`RAM@${hx(ram.addr ?? 0)} oracle=${ram.a} cand=${ram.b}`);
  if (o.pc !== c.pc) diffs.push(`pc oracle=${hx(o.pc)} cand=${hx(c.pc)}`);
  if (o.regs.sp !== c.regs.sp) diffs.push(`SP oracle=${hx(o.regs.sp)} cand=${hx(c.regs.sp)}`);
  return diffs;
}


const POKE_FRAME = 100;
const FRAMES = 120; // the forced dispatch lands ~frame 102
function boardPoke(board) {
  return [
    { addr: 0x6005, val: 0x03, frame: POKE_FRAME, dur: 1 }, // GAME_STATE = 3 (in-game dispatch)
    { addr: 0x600a, val: 0x0a, frame: POKE_FRAME, dur: 1 }, // GAME_SUBSTATE = 10 -> board setup
    { addr: 0x6009, val: 0x01, frame: POKE_FRAME, dur: 1 }, // SUBSTATE_TIMER = 1 (proceeds this frame)
    { addr: 0x6227, val: board, frame: POKE_FRAME, dur: 1 }, // BOARD = 3 -> sub_0f56 table idx 3 -> loc_1087
  ];
}

/**
 * Force the real dispatches of 0x1087 via the board-3 poke and clone the machine at up to K
 * true entries. The wrapper snapshots the entry state, then runs the oracle so the host
 * proceeds; the callees still resolve to the frozen ORACLE_ROUTINES table (only 0x1087 is
 * overridden), so a captured clone drives the fully-translated chain as its reference.
 */
function captureDispatches(board, K) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.pokes = boardPoke(board).map((p) => ({ ...p }));
  host.runFrames(FRAMES);
  return caps;
}

const CAPS3 = ROM_PRESENT ? captureDispatches(3, 4) : [];

/**
 * Poke distinctive +3 (X) and +5 (Y) into every record of the ten-record 0x6500 block,
 * identically on a fresh clone of `entry`. seedObjectBlockSprites overwrites +7..+10 on both
 * sides, so what survives to its permuting gather is the distinctive +3/+5 — giving the
 * gather non-trivial inputs the real zero-filled block does not.
 */
function craftDistinctive(entry) {
  const w = entry.clone();
  for (let r = 0; r < 10; r++) {
    const base = (0x6500 + r * 0x10) & 0xffff;
    w.mem.write8((base + 0x03) & 0xffff, (0x31 + r) & 0xff); // X source (+3)
    w.mem.write8((base + 0x05) & 0xffff, (0xa1 + r) & 0xff); // Y source (+5)
  }
  return w;
}


test("EQUAL: real forced board-3 (75m) dispatches match the oracle on RAM + pc + SP", () => {
  assert.ok(CAPS3.length >= 1, `expected >=1 real 0x1087 dispatch after BOARD=3 poke, got ${CAPS3.length}`);

  for (const cap of CAPS3) {
    const diffs = contractDiffs(cap, seed75mBoardObjects); // fresh clones inside — cap untouched
    assert.equal(diffs.length, 0, diffs.join("; "));
  }
  console.log(
    `  EQUAL: ${CAPS3.length} board-3 real dispatch(es) identical (RAM -stack + pc + SP); ` +
      `entry SP=${hx(CAPS3[0].regs.sp)}`,
  );
});


test("CRAFTED: distinctive 0x6500 content (identical both sides) matches; fixed outputs verified", () => {
  const w = craftDistinctive(CAPS3[0]);
  const diffs = contractDiffs(w, seed75mBoardObjects);
  assert.equal(diffs.length, 0, diffs.join("; "));

  // Read the candidate back and assert the routine's OWN fixed outputs (not just equality):
  const c = w.clone();
  seed75mBoardObjects(c);

  // (a) the 0x6400 block's two lead records (step 9 field writes).
  assert.equal(c.mem.read8(0x6400), 0x01, "0x6400 +0 active flag");
  assert.equal(c.mem.read8(0x6403), 0x58, "0x6403 rec0 X");
  assert.equal(c.mem.read8(0x640e), 0x58, "0x640e rec0 X'");
  assert.equal(c.mem.read8(0x6405), 0x80, "0x6405 rec0 Y");
  assert.equal(c.mem.read8(0x640f), 0x80, "0x640f rec0 Y'");
  assert.equal(c.mem.read8(0x6420), 0x01, "0x6420 rec1 active flag");
  assert.equal(c.mem.read8(0x6423), 0xeb, "0x6423 rec1 X");
  assert.equal(c.mem.read8(0x642f), 0x60, "0x642f rec1 Y'");

  // (b) the 0x6600 block fills (steps 3-4).
  for (let i = 0; i < 6; i++) assert.equal(c.mem.read8(0x6600 + i * 0x10), 0x01, `0x66${(i * 0x10).toString(16)} fill`);
  for (let i = 0; i < 3; i++) assert.equal(c.mem.read8(0x660d + i * 0x10), 0x08, `0x66${(0x0d + i * 0x10).toString(16)} fill`);

  // (c) the two ROM->RAM template copies (steps 8, 10) equal their ROM sources.
  for (let i = 0; i < 0x0c; i++) {
    assert.equal(c.mem.read8(0x6a0c + i), c.mem.read8(0x3e48 + i), `0x6a0c+${i} != ROM 0x3e48+${i}`);
  }
  for (let i = 0; i < 0x10; i++) {
    assert.equal(c.mem.read8(0x6970 + i), c.mem.read8(0x1121 + i), `0x6970+${i} != ROM 0x1121+${i}`);
  }

  console.log("  CRAFTED: distinctive 0x6500 content identical to the oracle; fixed 0x6400/0x6600/template outputs verified");
});


/**
 * Broken twin (a): SKIP-FILL — omits step 3 (the six-cell 0x6600 fill with 0x01), a plausible
 * dropped-initialisation bug; those cells stay at their captured value (0 on the real block).
 */
function skipFillTwin(m) {
  const { regs, mem } = m;
  regs.hl = 0x3dec; regs.de = 0x6407; regs.bc = 0x051c;
  replicateGroupStrided(m);
  seedObjectBlockSprites(m);
  // BUG: step 3 (the 0x6600-block 0x01 fill) is omitted.
  for (let i = 0; i < 3; i++) mem.write8((0x660d + i * 0x10) & 0xffff, 0x08);
  regs.hl = 0x3e64; regs.de = 0x6603; regs.bc = 0x060e;
  copyBytePairsStrided(m);
  regs.hl = 0x3e60; regs.de = 0x6607; regs.bc = 0x060c;
  replicateGroupStrided(m);
  regs.ix = 0x6600; regs.hl = 0x6958; regs.b = 0x06; regs.de = 0x0010;
  gatherSpriteRecords(m);
  for (let i = 0; i < 0x0c; i++) mem.write8((0x6a0c + i) & 0xffff, mem.read8((0x3e48 + i) & 0xffff));
  const IX = 0x6400;
  for (const [d, v] of [[0x00, 0x01], [0x03, 0x58], [0x0e, 0x58], [0x05, 0x80], [0x0f, 0x80],
    [0x20, 0x01], [0x23, 0xeb], [0x2e, 0xeb], [0x25, 0x60], [0x2f, 0x60]]) {
    mem.write8((IX + d) & 0xffff, v);
  }
  for (let i = 0; i < 0x10; i++) mem.write8((0x6970 + i) & 0xffff, mem.read8((0x1121 + i) & 0xffff));
}

/**
 * Broken twin (b): WRONG-DEST — block-copies the 0x1121 inline table to 0x6960 instead of
 * 0x6970 (a mistyped destination), so those 16 bytes land in the wrong SPRITE_BUFFER slot.
 */
function wrongDestTwin(m) {
  const { regs, mem } = m;
  regs.hl = 0x3dec; regs.de = 0x6407; regs.bc = 0x051c;
  replicateGroupStrided(m);
  seedObjectBlockSprites(m);
  for (let i = 0; i < 6; i++) mem.write8((0x6600 + i * 0x10) & 0xffff, 0x01);
  for (let i = 0; i < 3; i++) mem.write8((0x660d + i * 0x10) & 0xffff, 0x08);
  regs.hl = 0x3e64; regs.de = 0x6603; regs.bc = 0x060e;
  copyBytePairsStrided(m);
  regs.hl = 0x3e60; regs.de = 0x6607; regs.bc = 0x060c;
  replicateGroupStrided(m);
  regs.ix = 0x6600; regs.hl = 0x6958; regs.b = 0x06; regs.de = 0x0010;
  gatherSpriteRecords(m);
  for (let i = 0; i < 0x0c; i++) mem.write8((0x6a0c + i) & 0xffff, mem.read8((0x3e48 + i) & 0xffff));
  const IX = 0x6400;
  for (const [d, v] of [[0x00, 0x01], [0x03, 0x58], [0x0e, 0x58], [0x05, 0x80], [0x0f, 0x80],
    [0x20, 0x01], [0x23, 0xeb], [0x2e, 0xeb], [0x25, 0x60], [0x2f, 0x60]]) {
    mem.write8((IX + d) & 0xffff, v);
  }
  for (let i = 0; i < 0x10; i++) mem.write8((0x6960 + i) & 0xffff, mem.read8((0x1121 + i) & 0xffff)); // BUG: 0x6960
}

test("TEETH: the skip-fill twin and the wrong-destination twin are CAUGHT", () => {
  const skip = contractDiffs(CAPS3[0], skipFillTwin);
  assert.ok(skip.length > 0, "the skip-fill twin escaped — the gate is worthless");

  const wrong = contractDiffs(CAPS3[0], wrongDestTwin);
  assert.ok(wrong.length > 0, "the wrong-destination twin escaped — the gate is worthless");

  console.log(`  TEETH: skip-fill caught (${skip[0]}); wrong-dest caught (${wrong[0]})`);
});
