// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for seed50mBoardObjects (ROM 0x101f) — the board-2 (50m) arm
 * of the board-object setup dispatch (sub_0f56, table 0x0FCD idx 2). It seeds the 50m
 * board's object + hardware-sprite records via five already-idiomatic helpers plus four
 * ROM->sprite-buffer block copies, and closes by writing the board-object bookkeeping
 * byte 0x62B9 = 1.
 *
 * This is the cycle-free / memory-equivalence gate (docs/decompiler-pipeline), not the retired strict
 * whole-machine one. The routine WRITES a lot of memory and reads implicit inputs (the
 * pre-existing +3/+5 fields of the 0x6500 and 0x65A0 object blocks that the two gathers
 * permute into X/Y), so every case runs on a FRESH clone per side and is compared on:
 *
 *     RAM (dumpState, minus the stack scratch below the entry SP) + pc + SP.
 *
 * NO register safety margin (unlike the 0x1186 gate): live-out here is memory-only and
 * this routine deliberately drops the terminal `ldir` register-advance and the `ld a,1`,
 * so its terminal register file legitimately differs from the oracle's (e.g. oracle
 * C = 0 from the last ldir vs candidate C = 0x0c). The successor reached on return
 * (sub_2441, via sub_0f56/loc_0d5f) reloads HL/A/B/DE/IX/IY before reading any of them
 * and loc_0d5f then reloads HL, so every register/flag is dead — comparing them would be
 * comparing dead ABI, which the contract forbids.
 *
 * The idiomatic routine models the internal Z80 calls as direct JS calls (the callees
 * touch no stack) and drops its own terminal `ret`'s stack/PC bookkeeping, so the harness
 * performs ONE m.ret() on the candidate clone after the call to line pc + SP up with the
 * oracle (which rets internally). The oracle's transient push16/push land inside
 * STACK_SCRATCH (measured below; entry SP is one call level above the 0x1186 gate's
 * 0x6bea), so the dead stack scratch the candidate never writes is excluded by the
 * contract, exactly as intended. Cycles and flags are never compared (docs/decompiler-pipeline).
 *
 * REACHABILITY. seed50mBoardObjects is dispatched only for BOARD=2 (0x6227==2); attract
 * only plays 25m, so it NEVER dispatches in a plain run. Following the sibling 0x1186
 * gate, the test forces the real dispatch with an IDENTICAL-BOTH-SIDES board poke
 * (Karl-sanctioned "poke the board state to reach a state for validation"): at frame 100
 * set GAME_STATE=3, GAME_SUBSTATE=10 (board setup), SUBSTATE_TIMER=1, BOARD=2 — the same
 * path that feeds the 0x1186 board-2 capture, which reaches 0x1186 THROUGH this routine.
 *
 * Jobs:
 *   1. EQUAL (real forced dispatches) — oracle vs seed50mBoardObjects on fresh clones of
 *      each captured entry leave identical RAM (-STACK_SCRATCH) + pc + SP.
 *   2. CRAFTED (distinctive record content) — the real object blocks are near-empty at
 *      dispatch, so poke distinctive +3/+5 (X/Y) bytes into every 0x6500 and 0x65A0
 *      record identically both sides; this gives the two gathers non-trivial inputs.
 *      Oracle == candidate.
 *   3. TEETH — two deliberately-broken twins, each MUST be caught:
 *      (a) MISSING-MARKER: omits the 0x62B9 = 1 write (run against an entry forced to
 *          0x62B9 = 0 so the omission is observable) — the routine's signature write;
 *      (b) SKIP-PAIR: omits seedSpriteObjectPair, so the 0x6680/0x6690 object records
 *          and the 0x6A18 sprite pair are never built.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-101f.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_101f as oracle } from "../../translated/loc_101f.js";
import { seed50mBoardObjects } from "../seed50mBoardObjects.js";
import { replicateGroupStrided } from "../replicateGroupStrided.js";
import { seedObjectBlockSprites } from "../seedObjectBlockSprites.js";
import { gatherSpriteRecords } from "../gatherSpriteRecords.js";
import { loc_11fa } from "../loc_11fa.js";
import { seedSpriteObjectPair } from "../seedSpriteObjectPair.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x101f;
const MARKER = 0x62b9;
const hx = (v) => "0x" + (v & 0xffff).toString(16);


/** First RAM byte that differs between two machines, skipping the stack scratch below the entry SP, or null. */
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

/**
 * Run the oracle (rets internally) on one fresh clone and a candidate (+ one modelled
 * m.ret) on another, and diff the contract (RAM -stack + pc + SP). Returns a list of
 * human-readable mismatches (empty when equal).
 */
function contractDiffs(entry, fn) {
  const o = entry.clone();
  oracle(o);
  const c = entry.clone();
  fn(c);
  c.ret(); // model seed50mBoardObjects's own terminal `ret` so pc + SP line up
  const diffs = [];
  const ram = ramDiffMinusStack(o, c, entry.regs.sp);
  if (ram) diffs.push(`RAM@${hx(ram.addr ?? 0)} oracle=${ram.a} cand=${ram.b}`);
  if (o.pc !== c.pc) diffs.push(`pc oracle=${hx(o.pc)} cand=${hx(c.pc)}`);
  if (o.regs.sp !== c.regs.sp) diffs.push(`SP oracle=${hx(o.regs.sp)} cand=${hx(c.regs.sp)}`);
  return diffs;
}


const POKE_FRAME = 100;
const FRAMES = 120;
function boardPoke(board) {
  return [
    { addr: 0x6005, val: 0x03, frame: POKE_FRAME, dur: 1 }, // GAME_STATE = 3 (in-game dispatch)
    { addr: 0x600a, val: 0x0a, frame: POKE_FRAME, dur: 1 }, // GAME_SUBSTATE = 10 -> board setup
    { addr: 0x6009, val: 0x01, frame: POKE_FRAME, dur: 1 }, // SUBSTATE_TIMER = 1 (proceeds this frame)
    { addr: 0x6227, val: board, frame: POKE_FRAME, dur: 1 }, // BOARD = 2 (this arm)
  ];
}

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

const CAPS2 = ROM_PRESENT ? captureDispatches(2, 4) : [];

/**
 * Poke distinctive bytes into every field (+0..+8) of the ten 0x6500 records AND the
 * 0x65A0 object array, identically on a fresh clone of `entry`. The template fills
 * overwrite +7.. on both sides, so what survives to each gather is the distinctive +3
 * (X) and +5 (Y) — non-trivial, per-record-distinct inputs for the permuting gathers.
 */
function craftDistinctive(entry) {
  const w = entry.clone();
  for (let r = 0; r < 10; r++) {
    const base = (0x6500 + r * 0x10) & 0xffff;
    for (let d = 0; d <= 8; d++) w.mem.write8((base + d) & 0xffff, (0x21 + r * 0x11 + d) & 0xff);
  }
  for (let r = 0; r < 6; r++) {
    const base = (0x65a0 + r * 0x10) & 0xffff;
    for (let d = 0; d <= 8; d++) w.mem.write8((base + d) & 0xffff, (0x35 + r * 0x13 + d) & 0xff);
  }
  return w;
}

/** Fresh clone of `entry` with the marker forced to 0 so a missing-write twin is observable. */
function craftZeroMarker(entry) {
  const w = entry.clone();
  w.mem.write8(MARKER, 0x00);
  return w;
}


test("EQUAL: real forced board-2 dispatches of 0x101f match the oracle", () => {
  assert.ok(CAPS2.length >= 1, `expected >=1 real 0x101f dispatch after BOARD=2 poke, got ${CAPS2.length}`);
  for (const cap of CAPS2) {
    const diffs = contractDiffs(cap, seed50mBoardObjects); // fresh clones inside — cap untouched
    assert.equal(diffs.length, 0, diffs.join("; "));
  }
  console.log(
    `  EQUAL: ${CAPS2.length} real board-2 dispatch(es) identical (RAM -stack + pc + SP); ` +
      `entry SP=${hx(CAPS2[0].regs.sp)}`,
  );
});


test("CRAFTED: distinctive object-record content (identical both sides) matches the oracle", () => {
  const w = craftDistinctive(CAPS2[0]);
  const diffs = contractDiffs(w, seed50mBoardObjects);
  assert.equal(diffs.length, 0, diffs.join("; "));
  console.log("  CRAFTED: distinctive +3/+5 X/Y content in the 0x6500 + 0x65A0 blocks identical to the oracle");
});


/** Broken twin (a): MISSING-MARKER — everything correct except the 0x62B9 = 1 write. */
function missingMarkerTwin(m) {
  const { regs, mem } = m;
  regs.hl = 0x3dec; regs.de = 0x6407; regs.bc = 0x051c; replicateGroupStrided(m);
  seedObjectBlockSprites(m);
  regs.hl = 0x3e18; regs.de = 0x65a7; regs.bc = 0x060c; replicateGroupStrided(m);
  regs.ix = 0x65a0; regs.hl = 0x69b8; regs.de = 0x0010; regs.b = 0x06; gatherSpriteRecords(m);
  regs.hl = 0x3dfa; loc_11fa(m);
  copyRom(mem, 0x3e04, 0x69fc, 0x0004);
  copyRom(mem, 0x3e1c, 0x6944, 0x0008);
  copyRom(mem, 0x3e24, 0x69e4, 0x0018);
  regs.hl = 0x3e10; seedSpriteObjectPair(m);
  copyRom(mem, 0x3e3c, 0x6a0c, 0x000c);
  // BUG: the mem.write8(0x62B9, 1) marker is omitted.
}

/** Broken twin (b): SKIP-PAIR — omits seedSpriteObjectPair (step 9). */
function skipPairTwin(m) {
  const { regs, mem } = m;
  regs.hl = 0x3dec; regs.de = 0x6407; regs.bc = 0x051c; replicateGroupStrided(m);
  seedObjectBlockSprites(m);
  regs.hl = 0x3e18; regs.de = 0x65a7; regs.bc = 0x060c; replicateGroupStrided(m);
  regs.ix = 0x65a0; regs.hl = 0x69b8; regs.de = 0x0010; regs.b = 0x06; gatherSpriteRecords(m);
  regs.hl = 0x3dfa; loc_11fa(m);
  copyRom(mem, 0x3e04, 0x69fc, 0x0004);
  copyRom(mem, 0x3e1c, 0x6944, 0x0008);
  copyRom(mem, 0x3e24, 0x69e4, 0x0018);
  // BUG: seedSpriteObjectPair (0x11a6) is omitted — 0x6680/0x6690/0x6A18 never built.
  copyRom(mem, 0x3e3c, 0x6a0c, 0x000c);
  mem.write8(MARKER, 0x01);
}

/** Local forward block copy used by the twins (same as the routine's copyBlock). */
function copyRom(mem, src, dst, n) {
  for (let i = 0; i < n; i++) mem.write8((dst + i) & 0xffff, mem.read8((src + i) & 0xffff));
}

test("TEETH: the missing-marker twin and the skip-pair twin are CAUGHT", () => {
  const z = craftZeroMarker(CAPS2[0]);
  const markerDiffs = contractDiffs(z, missingMarkerTwin);
  assert.ok(markerDiffs.length > 0, "the missing-marker twin escaped — the gate is worthless");

  // (b) skip-pair: caught on the real capture (the pair's records/sprites differ).
  const pairDiffs = contractDiffs(CAPS2[0], skipPairTwin);
  assert.ok(pairDiffs.length > 0, "the skip-pair twin escaped on the real capture");

  console.log(`  TEETH: missing-marker caught (${markerDiffs[0]}); skip-pair caught (${pairDiffs[0]})`);
});
