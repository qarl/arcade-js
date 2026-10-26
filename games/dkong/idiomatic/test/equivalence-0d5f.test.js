// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_0d5f (ROM 0x0D5F) — the board-setup continuation: run the
 * common per-board init (loc_0f56), scatter the object records, arm the setup dwell
 * timer + advance the sub-state, stage the sprite-object block from the ROM template at
 * 0x385C, then apply a per-board sprite offset.
 *
 * The routine WRITES memory and is NOT a leaf — it drives loc_0f56 (the oracle, incl.
 * its rst-0x28 per-board setup dispatch), loadBoardObjectRecords, loadSpriteObjectBlock,
 * and the add-strided leaves — so it is gated by clone / replay (docs/decompiler-pipeline) with a FRESH
 * clone per case. The memory-equivalence contract is RAM − the stack scratch below the entry SP: the oracle's
 * push16 / m.call / ret stack traffic (and the whole board-setup call chain) lands in the
 * dead stack region, which the compare excludes; the direct-call layer drops it entirely.
 *
 * Attract sets up 25m ONLY, so it dispatches 0x0D5F exactly once, with BOARD == 1. That
 * one real entry validates the common path + the 25m arm; the 50m/75m/100m arms are
 * reached — exactly as docs/decompiler-pipeline prescribes for arms attract never takes — by a
 * Karl-sanctioned BOARD poke (2/3/4) applied identically on both sides of the real entry.
 *
 *   1. STRUCTURE — on the real board-1 entry, game-visible RAM (RAM − the stack scratch below the entry SP) is
 *      identical, and the oracle actually did the work (SUBSTATE_TIMER = 0x40, the
 *      GAME_SUBSTATE inc, the sprite block copied from the 0x385C template, the head copy
 *      into 0x6900, and the 25m Y-column −4). stackDiffs > 0 proves the exclusion is
 *      load-bearing (so it cannot mask a real diff), and the entry SP sits in STACK_SCRATCH.
 *
 *   2. BOARDS (crafted) — BOARD poked to 1/2/3/4 identically on both sides: RAM − STACK
 *      identical per board, plus the observable per-board offset on the oracle side
 *      (100m: X-column + 0x44; 50m/75m: no offset; 25m: Y-column − 4).
 *
 *   3. TEETH — two twins the gate MUST catch: (a) a dropped GAME_SUBSTATE advance, caught
 *      naming 0x600A; (b) a 25m offset applied to the X column (0x6908) instead of the Y
 *      column (0x690B), caught naming 0x6908.
 *
 *   4. REALISM — hook 0x0D5F over a long attract run and replay every real dispatch; at
 *      least one occurs (25m board build), each RAM − STACK identical to the oracle.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-0d5f.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0d5f as oracle } from "../../translated/loc_0d5f.js";
import { loc_0d5f as idiomatic } from "../loc_0d5f.js";
import { loc_0f56 } from "../../translated/loc_0f56.js";
import { loadBoardObjectRecords } from "../loadBoardObjectRecords.js";
import { loadSpriteObjectBlock } from "../loadSpriteObjectBlock.js";
import { addToSpriteObjectColumn } from "../addToSpriteObjectColumn.js";
import { addStrided } from "../addStrided.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH, SUBSTATE_TIMER, GAME_SUBSTATE, BOARD, SPRITE_OBJ_BLOCK, SPRITE_BUFFER } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x0d5f;
const OBJECT_TEMPLATE_SRC = 0x385c; // ROM template staged into the sprite buffer
const HEAD_SRC = 0x3884; // 0x385C + 0x28 — where the 8-byte head copy reads from
const P6908 = SPRITE_OBJ_BLOCK; // 0x6908 — X field of record 0
const P690B = SPRITE_OBJ_BLOCK + 3; // 0x690B — Y field of record 0
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inStack = (a) => a >= STACK_SCRATCH.lo && a < STACK_SCRATCH.hi;

/**
 * First game-visible differing RAM byte between two machines, EXCLUDING the dead
 * stack-scratch region (the memory-equivalence contract is RAM − the stack scratch below the entry SP).
 */
function ramDiffMinusStack(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState(), db = b.dumpState();
  const n = Math.min(da.length, db.length);
  let stackDiffs = 0, bad = null;
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) { stackDiffs++; continue; }
    if (!bad) bad = { addr, a: da[i], b: db[i] };
  }
  return { bad, stackDiffs };
}

/** Hook 0x0D5F over an attract run and clone the machine at up to K real dispatches. */
function captureEntries(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(maxFrames);
  assert.equal(host.stoppedBy, null, "attract capture run must reach the vblank spin cleanly");
  return caps;
}

// The single real board-1 dispatch attract produces, captured once and reused as the base
// for every crafted entry (cloned per case, never mutated — this routine writes RAM).
let _base = null;
function base() {
  if (!_base) {
    const caps = captureEntries(1, 2600);
    assert.ok(caps.length >= 1, "attract must dispatch 0x0D5F at least once (25m board build)");
    _base = caps[0];
  }
  return _base;
}

// -- 1. STRUCTURE -------------------------------------------------------------

test("STRUCTURE: real board-1 entry — game-visible RAM identical; oracle actually did the work", () => {
  const entry = base();
  assert.equal(entry.mem.read8(BOARD), 1, "the real attract dispatch is the 25m board build (BOARD == 1)");
  assert.ok(inStack(entry.regs.sp), `entry SP must sit in STACK_SCRATCH for the exclusion to be sound (SP=${hx(entry.regs.sp)})`);

  const subBefore = entry.mem.read8(GAME_SUBSTATE);
  const a = entry.clone(), b = entry.clone();
  const aFloor = a.regs.sp;
  oracle(a);
  idiomatic(b);

  const { bad, stackDiffs } = ramDiffMinusStack(a, b, aFloor);
  assert.equal(bad, null, bad && `game-visible RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b})`);

  // Non-vacuous: the salient outputs on the oracle side.
  assert.equal(a.mem.read8(SUBSTATE_TIMER), 0x40, "oracle must arm SUBSTATE_TIMER (0x6009) = 0x40");
  assert.equal(a.mem.read8(GAME_SUBSTATE), (subBefore + 1) & 0xff, "oracle must inc GAME_SUBSTATE (0x600A)");
  // The sprite block was staged from the ROM template (25m does not touch the X column).
  assert.equal(a.mem.read8(P6908), ROM[OBJECT_TEMPLATE_SRC], "oracle must copy record-0 X from the 0x385C template");
  assert.equal(a.mem.read8(SPRITE_BUFFER), ROM[HEAD_SRC], "oracle must copy the head byte from 0x3884 into SPRITE_BUFFER (0x6900)");
  // 25m arm: the Y column is shifted up by 4 (template[+3] − 4).
  assert.equal(a.mem.read8(P690B), (ROM[OBJECT_TEMPLATE_SRC + 3] - 4) & 0xff, "oracle must shift record-0 Y up by 4 on 25m");
  assert.notEqual((ROM[OBJECT_TEMPLATE_SRC + 3] - 4) & 0xff, ROM[OBJECT_TEMPLATE_SRC + 3], "the −4 must actually change the byte (offset is observable)");
  assert.ok(stackDiffs > 0, "the oracle's stack traffic must land in STACK_SCRATCH (so the exclusion is load-bearing)");
  console.log(`  STRUCTURE: RAM − STACK identical; timer/substate/block/25m-offset all executed (stackDiffs=${stackDiffs})`);
});

// -- 2. BOARDS (crafted) ------------------------------------------------------

test("BOARDS (crafted): loc_0d5f == oracle for BOARD 1/2/3/4, with the per-board offset", () => {
  for (const board of [1, 2, 3, 4]) {
    const a = base().clone(), b = base().clone();
    const aFloor = a.regs.sp;
    a.mem.write8(BOARD, board);
    b.mem.write8(BOARD, board);
    oracle(a);
    idiomatic(b);

    const { bad } = ramDiffMinusStack(a, b, aFloor);
    assert.equal(bad, null, bad && `BOARD ${board}: RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b})`);

    // Observable per-board offset on the oracle side (non-vacuous).
    const templX = ROM[OBJECT_TEMPLATE_SRC];
    const templY = ROM[OBJECT_TEMPLATE_SRC + 3];
    if (board === 4) {
      assert.equal(a.mem.read8(P6908), (templX + 0x44) & 0xff, "100m: X column must be shifted right by 0x44");
    } else if (board === 2 || board === 3) {
      assert.equal(a.mem.read8(P6908), templX, `${board === 2 ? "50m" : "75m"}: X column must be unchanged`);
      assert.equal(a.mem.read8(P690B), templY, `${board === 2 ? "50m" : "75m"}: Y column must be unchanged (no offset)`);
    } else {
      assert.equal(a.mem.read8(P690B), (templY - 4) & 0xff, "25m: Y column must be shifted up by 4");
    }
  }
  console.log("  BOARDS/crafted: 1/2/3/4 identical to the oracle; per-board offset confirmed (25m Y−4, 100m X+0x44, 50m/75m none)");
});

// -- 3. TEETH -----------------------------------------------------------------

/** Twin (a): drops the `inc (GAME_SUBSTATE)`. Everything else faithful, so the ONLY
 *  divergence is 0x600A staying at its entry value where the oracle advances it. */
function brokenNoAdvance(m) {
  const { regs, mem } = m;
  loc_0f56(m);
  loadBoardObjectRecords(m);
  mem.write8(SUBSTATE_TIMER, 0x40);
  // BUG: no GAME_SUBSTATE advance
  regs.hl = OBJECT_TEMPLATE_SRC;
  loadSpriteObjectBlock(m);
  let src = regs.hl, dst = SPRITE_BUFFER;
  for (let i = 0; i < 8; i++) { mem.write8(dst, mem.read8(src)); src = (src + 1) & 0xffff; dst = (dst + 1) & 0xffff; }
  regs.hl = src; regs.de = dst; regs.bc = 0;
  const board = mem.read8(BOARD);
  if (board === 4) {
    regs.hl = SPRITE_OBJ_BLOCK; regs.c = 0x44; addToSpriteObjectColumn(m);
    regs.de = 0x0004; regs.b = 0x02; regs.c = 0x10; regs.hl = SPRITE_BUFFER; addStrided(m);
    regs.b = 0x02; regs.c = 0xf8; regs.hl = SPRITE_BUFFER + 3; addStrided(m);
    return;
  }
  if (board & 0x02) return;
  regs.hl = SPRITE_OBJ_BLOCK + 3; regs.c = 0xfc; addToSpriteObjectColumn(m);
}

/** Twin (b): on 25m, shifts the X column (0x6908) instead of the Y column (0x690B). Every
 *  other write is faithful, so X reads (template − 4) where the oracle leaves it untouched. */
function brokenWrongOffset(m) {
  const { regs, mem } = m;
  loc_0f56(m);
  loadBoardObjectRecords(m);
  mem.write8(SUBSTATE_TIMER, 0x40);
  mem.write8(GAME_SUBSTATE, (mem.read8(GAME_SUBSTATE) + 1) & 0xff);
  regs.hl = OBJECT_TEMPLATE_SRC;
  loadSpriteObjectBlock(m);
  let src = regs.hl, dst = SPRITE_BUFFER;
  for (let i = 0; i < 8; i++) { mem.write8(dst, mem.read8(src)); src = (src + 1) & 0xffff; dst = (dst + 1) & 0xffff; }
  regs.hl = src; regs.de = dst; regs.bc = 0;
  const board = mem.read8(BOARD);
  if (board === 4) {
    regs.hl = SPRITE_OBJ_BLOCK; regs.c = 0x44; addToSpriteObjectColumn(m);
    regs.de = 0x0004; regs.b = 0x02; regs.c = 0x10; regs.hl = SPRITE_BUFFER; addStrided(m);
    regs.b = 0x02; regs.c = 0xf8; regs.hl = SPRITE_BUFFER + 3; addStrided(m);
    return;
  }
  if (board & 0x02) return;
  regs.hl = SPRITE_OBJ_BLOCK; regs.c = 0xfc; addToSpriteObjectColumn(m); // BUG: 0x6908 (X) not 0x690B (Y)
}

test("TEETH (drop-advance): the dropped GAME_SUBSTATE inc is CAUGHT and names 0x600A", () => {
  const a = base().clone(), b = base().clone();
  const aFloor = a.regs.sp;
  oracle(a);
  brokenNoAdvance(b);
  const { bad } = ramDiffMinusStack(a, b, aFloor);
  assert.notEqual(bad, null, "the gate FAILED to catch a dropped GAME_SUBSTATE advance — it is worthless");
  assert.equal(bad.addr, GAME_SUBSTATE, `expected the caught diff at 0x600A, got ${hx(bad.addr)}`);
  console.log(`  TEETH/drop-advance: caught at 0x600A (oracle=${bad.a} broken=${bad.b})`);
});

test("TEETH (wrong-offset): a 25m X-column shift instead of Y is CAUGHT and names 0x6908", () => {
  const a = base().clone(), b = base().clone();
  const aFloor = a.regs.sp;
  oracle(a);
  brokenWrongOffset(b);
  const { bad } = ramDiffMinusStack(a, b, aFloor);
  assert.notEqual(bad, null, "the gate FAILED to catch a wrong-column offset — it is worthless");
  assert.equal(bad.addr, P6908, `expected the caught diff at 0x6908, got ${hx(bad.addr)}`);
  console.log(`  TEETH/wrong-offset: caught at 0x6908 (oracle=${bad.a} broken=${bad.b})`);
});

// -- 4. REALISM ---------------------------------------------------------------

test("REALISM: replay every real 0x0d5f dispatch — game-visible RAM identical to the oracle", () => {
  const caps = captureEntries(16, 6000);
  assert.ok(caps.length >= 1, "expected at least one real 0x0d5f dispatch in a long attract run");
  for (const entry of caps) {
    const a = entry.clone(), b = entry.clone();
    const aFloor = a.regs.sp;
    oracle(a);
    idiomatic(b);
    const { bad } = ramDiffMinusStack(a, b, aFloor);
    assert.equal(bad, null, bad && `real-dispatch RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b})`);
  }
  console.log(`  REALISM: ${caps.length} real 0x0d5f dispatch(es) — game-visible RAM identical to the oracle`);
});
