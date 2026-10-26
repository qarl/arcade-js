// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for stampScorePopupSprite (ROM 0x1E36) — stamp the 0x6A30 sprite record + cue
 * the board-gated sound latch 0x6085.
 *
 * stampScorePopupSprite WRITES memory (record 0x6A30..0x6A33 and, when the board gate is open,
 * SND_TRIGGER[5] at 0x6085) and is NOT a leaf (it calls boardBitGate / the oracle's
 * `rst 0x30`), so it is gated by capture / clone / replay (docs/decompiler-pipeline) with a FRESH clone
 * per case. Its only branch is the board gate; A, B, C are stored verbatim. The gate
 * depends solely on BOARD (0x6227) — mask A = 0x05 opens on 25m (1) and 75m (3):
 *
 *   1. REALISM (real captured dispatch) — attract dispatches 0x1e36 on 25m (BOARD 1,
 *      gate OPEN). Run the ORACLE on one clone and stampScorePopupSprite on another and confirm
 *      every game-visible byte matches — the diff is confined to STACK_SCRATCH. That
 *      confinement is the whole point: the oracle models `push … rst 0x30 … ret`
 *      (writing the stack + consuming a return address, so its SP/pc move); stampScorePopupSprite
 *      uses the JS call stack and models neither, so the ONLY residual difference is
 *      stack-scratch bytes. SP/pc must be unchanged for the idiomatic side.
 *
 *   2. BOARD (exhaustive crafted) — the gate is the routine's only logic and attract
 *      only exercises BOARD 1, so on a real captured entry poke BOARD to EVERY byte
 *      0..255 identically on both sides and compare game-visible RAM. This pins the
 *      50m/100m CLOSED arms (no 0x6085 write) that attract never reaches, plus the full
 *      rotate behaviour of the mask-0x05 gate (open on 1/3/9/11/…, closed elsewhere).
 *
 *   3. A/B/C record (edge crafted) — the four stored bytes and their order, swept over
 *      distinct edge values with the gate both open (BOARD 1) and closed (BOARD 2), so
 *      a byte-order or wrong-attribute error would show.
 *
 *   4. TEETH — two twins the sweeps MUST catch: (a) one that DROPS the gate (writes
 *      0x6085 unconditionally) is caught by the BOARD sweep at a closed board, naming
 *      0x6085; (b) one that stores the record in SWAPPED order (C,B,A) is caught by the
 *      A/B/C sweep, naming 0x6A30.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-1e36.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1e36 as oracle } from "../../translated/loc_1e36.js";
import { stampScorePopupSprite as idiomatic } from "../stampScorePopupSprite.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x1e36;
const BOARD = 0x6227;
const REC = 0x6a30; // sprite-record slot
const SND = 0x6085; // sound latch
const hx = (v) => "0x" + (v & 0xffff).toString(16);

/**
 * First differing RAM byte between two machines, EXCLUDING the dead stack-scratch
 * region (the memory-equivalence contract is RAM − the stack scratch below the entry SP). Returns the first
 * game-visible difference { addr, a, b } or null, plus the count tolerated in stack.
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

/**
 * Replay one entry state through the oracle and a candidate on independent FRESH clones
 * (the routine writes RAM), and return the game-visible diff + both machines.
 */
function replay(entry, candidate) {
  const a = entry.clone(); // oracle
  const b = entry.clone(); // candidate
  oracle(a);
  candidate(b);
  return { a, b, ...ramDiffMinusStack(a, b, entry.regs.sp) };
}

/**
 * Run attract and clone the machine at each real 0x1e36 dispatch (reached via
 * stageAwardPopupAtHitObject's `jp`/call while the 25m demo plays). The wrapper delegates to the oracle
 * so the host run proceeds to a clean stop.
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

// -- 1. REALISM (real captured dispatch) --------------------------------------

test("REALISM: real captured 25m 0x1e36 dispatch — game-visible RAM identical, SP/pc unmodelled", () => {
  const caps = captureDispatches(8, 3000);
  assert.ok(caps.length >= 1, "expected at least one real 0x1e36 dispatch during 25m attract");

  for (const entry of caps) {
    assert.equal(entry.mem.read8(BOARD), 1, "attract dispatches 0x1e36 on 25m (BOARD==1)");

    const { bad } = replay(entry, idiomatic);
    assert.equal(
      bad,
      null,
      bad && `game-visible RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b}) ` +
        `on A=${hx(entry.regs.a)} B=${hx(entry.regs.b)} C=${hx(entry.regs.c)}`,
    );
    // The oracle's push16(0x1e44) writes to [SP-2,SP-1]; that target must sit inside
    // STACK_SCRATCH, so excluding it cannot mask a real diff.
    assert.ok(
      (entry.regs.sp - 2) >= STACK_SCRATCH.lo && entry.regs.sp <= STACK_SCRATCH.hi,
      `oracle's push target must sit inside STACK_SCRATCH (SP=${hx(entry.regs.sp)})`,
    );
    // stampScorePopupSprite must NOT model the stack: SP and pc unchanged from entry.
    const b = entry.clone();
    const sp0 = b.regs.sp, pc0 = b.pc;
    idiomatic(b);
    assert.equal(b.regs.sp, sp0, "stampScorePopupSprite must leave SP unchanged (no stack modelling)");
    assert.equal(b.pc, pc0, "stampScorePopupSprite must leave pc unchanged (no ret modelling)");
  }
  console.log(`  REALISM: ${caps.length} real 25m dispatch(es) — game-visible RAM identical to the oracle`);
});

// -- 2. BOARD (exhaustive crafted) --------------------------------------------

// A real captured 0x1e36 entry (BOARD 1) to poke BOARD onto — a real state + a surgical
// nudge (docs/decompiler-pipeline crafted entry). Its SP is real, in STACK_SCRATCH, so the oracle's push
// lands in the tolerated region.
function craftedBase() {
  const caps = captureDispatches(1, 3000);
  assert.ok(caps.length >= 1, "expected a real 0x1e36 entry to craft from");
  return caps[0];
}

test("BOARD (exhaustive): stampScorePopupSprite == oracle over all 256 BOARD values (open + closed arms)", () => {
  const base = craftedBase();
  let count = 0, opened = 0, closed = 0, mismatch = null;
  for (let v = 0; v < 256 && !mismatch; v++) {
    const a = base.clone(); const b = base.clone();
    a.mem.write8(BOARD, v);
    b.mem.write8(BOARD, v);
    oracle(a);
    idiomatic(b);
    const { bad } = ramDiffMinusStack(a, b, base.regs.sp);
    count++;
    // Track which arm this board took, from the oracle's 0x6085 write vs the base.
    if (a.mem.read8(SND) === 3 && base.mem.read8(SND) !== 3) opened++; else closed++;
    if (bad) mismatch = { v, bad };
  }
  assert.equal(
    mismatch,
    null,
    mismatch && `mismatch at BOARD=${hx(mismatch.v)}: game-visible RAM diff at ${hx(mismatch.bad.addr)} ` +
      `(oracle=${mismatch.bad.a} idiomatic=${mismatch.bad.b})`,
  );
  assert.equal(count, 256, "must have swept all 256 BOARD values");
  assert.ok(opened > 0 && closed > 0, `sweep must exercise BOTH gate arms (opened=${opened} closed=${closed})`);
  console.log(`  BOARD/exhaustive: 256 values — game-visible RAM identical (gate opened on ${opened}, closed on ${closed})`);
});

// -- 3. A/B/C record (edge crafted) -------------------------------------------

test("A/B/C record (edges): stored bytes + order match the oracle, gate open and closed", () => {
  const base = craftedBase();
  const VALS = [0x00, 0x01, 0x07, 0x55, 0xaa, 0xff];
  let count = 0, mismatch = null;
  // Distinct A/B/C so a swapped-order or wrong-attribute store would diverge; both
  // BOARD arms so the sound write does not mask a record error.
  for (const board of [1, 2]) {
    for (const A of VALS) {
      for (const B of VALS) {
        for (const C of VALS) {
          if (mismatch) break;
          const a = base.clone(); const b = base.clone();
          for (const m of [a, b]) {
            m.mem.write8(BOARD, board);
            m.regs.a = A; m.regs.b = B; m.regs.c = C;
          }
          oracle(a);
          idiomatic(b);
          const { bad } = ramDiffMinusStack(a, b, base.regs.sp);
          count++;
          if (bad) mismatch = { board, A, B, C, bad };
        }
      }
    }
  }
  assert.equal(
    mismatch,
    null,
    mismatch && `mismatch at BOARD=${mismatch.board} A=${hx(mismatch.A)} B=${hx(mismatch.B)} C=${hx(mismatch.C)}: ` +
      `RAM diff at ${hx(mismatch.bad.addr)} (oracle=${mismatch.bad.a} idiomatic=${mismatch.bad.b})`,
  );
  console.log(`  A/B/C edges: ${count} (board,A,B,C) combos — record bytes + order identical to the oracle`);
});

// -- 4. TEETH -----------------------------------------------------------------

/** Twin (a): drops the board gate — writes 0x6085 UNCONDITIONALLY. The record write is
 *  identical, so the ONLY divergence is the sound on a closed board. */
function brokenDropGate(m) {
  const { regs, mem } = m;
  mem.write8(REC + 0, regs.a);
  mem.write8(REC + 1, regs.b);
  mem.write8(REC + 2, 0x07);
  mem.write8(REC + 3, regs.c);
  mem.write8(SND, 0x03); // BUG: no board gate
}

/** Twin (b): stores the record in SWAPPED order (C,B,A). The gate is faithful, so the
 *  only divergence is the record bytes when A != C. */
function brokenSwapOrder(m) {
  const { regs, mem } = m;
  mem.write8(REC + 0, regs.c); // BUG: A and C swapped
  mem.write8(REC + 1, regs.b);
  mem.write8(REC + 2, 0x07);
  mem.write8(REC + 3, regs.a);
  // Faithful gate: re-run the oracle's board test by rotating mask 0x05 by BOARD.
  const board = mem.read8(BOARD) || 256;
  if (((0x05 >> ((board - 1) & 7)) & 1) === 1) mem.write8(SND, 0x03);
}

test("TEETH (drop-gate): the ungated-sound twin is CAUGHT by the BOARD sweep and names 0x6085", () => {
  const base = craftedBase();
  let caught = null;
  for (let v = 0; v < 256 && !caught; v++) {
    const a = base.clone(); const b = base.clone();
    a.mem.write8(BOARD, v);
    b.mem.write8(BOARD, v);
    oracle(a);
    brokenDropGate(b);
    const { bad } = ramDiffMinusStack(a, b, base.regs.sp);
    if (bad) caught = { v, bad };
  }
  assert.notEqual(caught, null, "the BOARD sweep FAILED to catch a dropped board gate — it is worthless");
  assert.equal(caught.bad.addr, SND, `expected the caught diff at 0x6085, got ${hx(caught.bad.addr)}`);
  console.log(`  TEETH/drop-gate: caught at BOARD=${hx(caught.v)} (0x6085 oracle=${caught.bad.a} broken=${caught.bad.b})`);
});

test("TEETH (swap-order): the swapped-record twin is CAUGHT by the A/B/C sweep and names 0x6A30", () => {
  const base = craftedBase();
  const VALS = [0x00, 0x01, 0x07, 0x55, 0xaa, 0xff];
  let caught = null;
  for (const A of VALS) {
    for (const C of VALS) {
      if (caught) break;
      const a = base.clone(); const b = base.clone();
      for (const m of [a, b]) { m.mem.write8(BOARD, 1); m.regs.a = A; m.regs.b = 0x22; m.regs.c = C; }
      oracle(a);
      brokenSwapOrder(b);
      const { bad } = ramDiffMinusStack(a, b, base.regs.sp);
      if (bad) caught = { A, C, bad };
    }
  }
  assert.notEqual(caught, null, "the A/B/C sweep FAILED to catch a swapped record order — it is worthless");
  assert.equal(caught.bad.addr, REC, `expected the caught diff at 0x6A30, got ${hx(caught.bad.addr)}`);
  console.log(`  TEETH/swap-order: caught at A=${hx(caught.A)} C=${hx(caught.C)} (0x6A30 oracle=${caught.bad.a} broken=${caught.bad.b})`);
});
