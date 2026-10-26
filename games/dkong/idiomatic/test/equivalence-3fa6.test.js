// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for stamp50mBoardTiles (ROM 0x3FA6) — "on the 50m board
 * only, stamp four tilemap cells": gate on BOARD == 2 via boardBitGate (mask 0x02),
 * and on the open arm write 0x10/0xC0 into the cell pairs 0x776C/0x776E and
 * 0x748C/0x748E; off the 50m board, write nothing.
 *
 * This is the CYCLE-FREE / memory-equivalence gate (docs/decompiler-pipeline), not the retired strict
 * whole-machine one. The routine WRITES video RAM on the open arm, so every case uses
 * a FRESH clone per side. The oracle runs on one clone, stamp50mBoardTiles on another,
 * and they are compared on the go-forward contract:
 *
 *     RAM (dumpState, minus the stack scratch below the entry SP) only.
 *
 * pc and SP are deliberately NOT compared. The oracle uses m.step/m.push16/m.call/
 * m.ret, so it advances pc to the return target and moves SP; both are the modelled
 * step/stack ABI the direct-call layer replaces with a JS return + boolean gate.
 * Memory is the only live-out: loc_3fa0's next act after `call 0x3FA6` is `jp 0x0D5F`,
 * with no flag branch and no read of any register this leaves. (The gate's own
 * caller-skip `pop hl` on the closed arm lands in the dead STACK_SCRATCH region, which
 * the contract masks — so the closed arm's only oracle writes vanish under the mask.)
 *
 * REACHABILITY — BOTH arms are hit by REAL captured dispatches:
 *   - CLOSED arm: plain 25m attract. loc_3fa0 dispatches 0x3FA6 during the boot board
 *     setup (frame 0) with BOARD == 1; the gate (mask bit1) is closed, so the oracle
 *     writes only dead stack and the routine stamps nothing.
 *   - OPEN arm: attract only ever plays 25m, so board 2 is forced with an IDENTICAL-
 *     BOTH-SIDES board poke (Karl-sanctioned "poke the board state to reach a state for
 *     validation"): at frame 100 set GAME_STATE=3, GAME_SUBSTATE=10 (board setup),
 *     SUBSTATE_TIMER=1, BOARD=2 (50m). The 50m setup pass then dispatches 0x3FA6 once
 *     with the gate OPEN, giving a REAL captured entry (real registers, stack, board).
 *
 * Jobs:
 *   1. EQUAL (closed arm, real attract) — oracle vs stamp50mBoardTiles on fresh clones
 *      of the real board-1 entry leave identical RAM (−stack); neither touches the four
 *      target cells (documents the "writes nothing off 50m" arm).
 *   2. EQUAL (open arm, real forced board-2) — identical RAM (−stack); both leave the
 *      four cells holding 0x10/0xC0/0x10/0xC0.
 *   3. WRITE-SET (open arm) — the oracle's ONLY non-stack writes are exactly the four
 *      cells with the exact values. Documents the footprint.
 *   4. CRAFTED (board-2 poke on a real board-1 entry) — flip the gate open by poking
 *      BOARD=2 identically both sides; (a) pre-dirty the four cells to 0xAA and confirm
 *      both stamp the motif over the dirt, (b) garbage registers + far RAM identically
 *      to show the constant output is input-independent.
 *   5. TEETH — the documented sub_3fa6 hoist trap: a twin that (loop-invariant-hoists
 *      the HL reload and so) writes the 0x748C pair twice and NEVER writes the 0x776C
 *      pair MUST be caught, naming 0x776C, on both a real and a crafted-dirtied state.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-3fa6.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_3fa6 as oracle } from "../../translated/loc_3fa6.js";
import { stamp50mBoardTiles } from "../stamp50mBoardTiles.js";
import { boardBitGate } from "../boardBitGate.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH, BOARD } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x3fa6;
const hx = (v) => "0x" + (v & 0xffff).toString(16);

// The four tilemap cells stamped on the open arm, with the exact value each gets.
const WRITES = [
  [0x776c, 0x10],
  [0x776e, 0xc0],
  [0x748c, 0x10],
  [0x748e, 0xc0],
];
const CELLS = WRITES.map(([a]) => a);

/**
 * First RAM difference between two machines on the go-forward contract: the whole
 * state dump minus the stack scratch below the entry SP (dead scratch — masked per the contract).
 * The closed-arm gate's `pop hl` and the open-arm `ret`'s pops land there, so masking
 * it is what lets the boolean-gate rewrite match the stack-manipulating oracle — and,
 * unlike the closed-arm-free routines, this routine ALWAYS leaves a dead-stack diff, so
 * the mask must genuinely be exercised. A single absolute-offset pass (no relative-
 * offset recursion) so the scan can never revisit a masked byte. Returns {addr,a,b} or null.
 */
function ramDiffMinusStack(ma, mb, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const a = ma.dumpState();
  const b = mb.dumpState();
  const n = Math.min(a.length, b.length);
  for (let off = 0; off < n; off++) {
    if (a[off] === b[off]) continue;
    const addr = ma.stateOffsetToAddr(off);
    if (dead(addr)) continue;
    return { addr, a: a[off], b: b[off], offset: off };
  }
  return null;
}

/** All changed bytes (addr,from,to) when `fn` runs on a clone of `m`, EXCLUDING dead stack. */
function changedMinusStack(m, fn) {
  const c = m.clone();
  const before = c.dumpState();
  const dead = deadStackBelow(STACK_SCRATCH, m.regs.sp);
  fn(c);
  const after = c.dumpState();
  const changed = [];
  for (let off = 0; off < before.length; off++) {
    if (before[off] === after[off]) continue;
    const addr = c.stateOffsetToAddr(off);
    if (dead(addr)) continue;
    changed.push({ addr, from: before[off], to: after[off] });
  }
  return changed;
}

/**
 * Hook 0x3FA6 and clone the machine at up to K real entries, optionally driving a
 * one-shot board poke first. The wrapper snapshots the entry state, then runs the
 * oracle so the host proceeds. A fresh copy of the poke per host keeps runs independent.
 */
function capture(K, frames, pokes) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  if (pokes) host.pokes = pokes.map((p) => ({ ...p }));
  host.runFrames(frames);
  return caps;
}

// CLOSED arm: real board-1 attract dispatch (gate closed). The 25m board's setup
// pass dispatches 0x3FA6 once during attract, ~frame 500-700; 800 frames is margin.
const CLOSED = ROM_PRESENT ? capture(4, 800, null) : [];

// OPEN arm: force 50m (board 2) setup so the setup pass dispatches 0x3FA6 gate-open.
const POKE_FRAME = 100;
const FORCE_BOARD2 = [
  { addr: 0x6005, val: 0x03, frame: POKE_FRAME, dur: 1 }, // GAME_STATE = 3 (in-game dispatch)
  { addr: 0x600a, val: 0x0a, frame: POKE_FRAME, dur: 1 }, // GAME_SUBSTATE = 10 -> board setup
  { addr: 0x6009, val: 0x01, frame: POKE_FRAME, dur: 1 }, // SUBSTATE_TIMER = 1 (proceeds this frame)
  { addr: 0x6227, val: 0x02, frame: POKE_FRAME, dur: 1 }, // BOARD = 2 (50m -> gate open)
];
const OPEN = ROM_PRESENT ? capture(4, 140, FORCE_BOARD2) : [];

// -- 1. EQUAL (closed arm, real attract) --------------------------------------

test("EQUAL (closed arm): real board-1 attract dispatch — writes nothing, RAM identical (−stack)", () => {
  assert.ok(CLOSED.length >= 1, "expected at least one real 0x3FA6 dispatch during 25m attract");
  for (const cap of CLOSED) {
    assert.equal(cap.mem.read8(BOARD), 1, "closed-arm capture should be board 1 (25m)");
    // Sanity: the gate really is closed on this captured state (mask 0x02 vs board 1).
    const g = cap.clone(); g.regs.a = 0x02;
    assert.equal(boardBitGate(g), false, "gate must be CLOSED on board 1");

    const o = cap.clone();
    const c = cap.clone();
    oracle(o);
    stamp50mBoardTiles(c);
    const d = ramDiffMinusStack(o, c, cap.regs.sp);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} stamp=${d.b}`);

    // The closed arm stamps nothing: the oracle's only writes are dead stack.
    assert.equal(changedMinusStack(cap, oracle).length, 0, "closed-arm oracle wrote a non-stack byte");
    assert.equal(changedMinusStack(cap, stamp50mBoardTiles).length, 0, "closed-arm stamp wrote a byte");
  }
  console.log(`  EQUAL/closed: ${CLOSED.length} real board-1 dispatch(es) — nothing stamped, RAM identical`);
});

// -- 2. EQUAL (open arm, real forced board-2) ---------------------------------

test("EQUAL (open arm): real forced board-2 dispatch — stamp == oracle in RAM (−stack)", () => {
  assert.ok(OPEN.length >= 1, "expected at least one real 0x3FA6 dispatch after the board-2 poke");
  for (const cap of OPEN) {
    assert.equal(cap.mem.read8(BOARD), 2, "open-arm capture should be board 2 (50m)");
    const g = cap.clone(); g.regs.a = 0x02;
    assert.equal(boardBitGate(g), true, "gate must be OPEN on board 2");

    const o = cap.clone();
    const c = cap.clone();
    oracle(o);
    stamp50mBoardTiles(c);
    const d = ramDiffMinusStack(o, c, cap.regs.sp);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} stamp=${d.b}`);

    for (const [addr, val] of WRITES) {
      assert.equal(c.mem.read8(addr), val, `stamp left ${hx(addr)} = ${hx(c.mem.read8(addr))} (expected ${hx(val)})`);
    }
  }
  console.log(`  EQUAL/open: ${OPEN.length} real board-2 dispatch(es) identical — four cells stamped`);
});

// -- 3. WRITE-SET (open arm) --------------------------------------------------

test("WRITE-SET: the oracle's only non-stack writes are the four cells 0x10/0xC0", () => {
  const cap = OPEN[0];
  const changed = changedMinusStack(cap, oracle);
  const want = new Map(WRITES);
  assert.equal(changed.length, want.size, `expected ${want.size} non-stack writes, got ${changed.length}`);
  for (const ch of changed) {
    assert.ok(want.has(ch.addr), `oracle wrote unexpected addr ${hx(ch.addr)} (${ch.from}->${ch.to})`);
    assert.equal(ch.to, want.get(ch.addr), `wrong value ${hx(ch.to)} at ${hx(ch.addr)}`);
  }
  console.log(`  WRITE-SET: ${changed.length} non-stack bytes — 0x10/0xC0 at 0x776C/E and 0x748C/E`);
});

// -- 4. CRAFTED (board-2 poke on a real board-1 entry) ------------------------

test("CRAFTED: gate poked open on a board-1 entry — pre-dirtied cells stamped identically", () => {
  const base = CLOSED[0];
  const o = base.clone();
  const c = base.clone();
  // Identical surgical nudge on BOTH sides: flip the gate open, then dirty all four cells.
  for (const mm of [o, c]) {
    mm.mem.write8(BOARD, 0x02);
    for (const addr of CELLS) mm.mem.write8(addr, 0xaa);
  }
  oracle(o);
  stamp50mBoardTiles(c);
  const d = ramDiffMinusStack(o, c, base.regs.sp);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} stamp=${d.b}`);
  for (const [addr, val] of WRITES) {
    assert.equal(c.mem.read8(addr), val, `stamp left ${hx(addr)} = ${hx(c.mem.read8(addr))} (expected ${hx(val)})`);
  }
  console.log("  CRAFTED: BOARD poked to 2 + cells dirtied 0xAA -> both stamp 0x10/0xC0, RAM identical");
});

test("CRAFTED: unrelated entry state (registers + far RAM) does not change the output", () => {
  const base = CLOSED[0];
  const o = base.clone();
  const c = base.clone();
  for (const mm of [o, c]) {
    mm.mem.write8(BOARD, 0x02);          // gate open
    mm.regs.a = 0x11; mm.regs.b = 0x22; mm.regs.c = 0x33;
    mm.regs.d = 0x44; mm.regs.e = 0x55; mm.regs.hl = 0x1234;
    mm.mem.write8(0x6300, 0x99);         // a work-RAM byte outside the write set
  }
  oracle(o);
  stamp50mBoardTiles(c);
  const d = ramDiffMinusStack(o, c, base.regs.sp);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} stamp=${d.b}`);
  for (const [addr, val] of WRITES) {
    assert.equal(c.mem.read8(addr), val, `stamp left ${hx(addr)} = ${hx(c.mem.read8(addr))} (expected ${hx(val)})`);
  }
  console.log("  CRAFTED: garbage registers + far RAM identical both sides -> output unchanged");
});

// -- 5. TEETH (the documented sub_3fa6 hoist trap) ----------------------------

/**
 * Broken twin: hoists the `ld hl,0x748C` out of the loop, so BOTH passes write the
 * 0x748C pair and the 0x776C pair is NEVER written — the exact trap the oracle's
 * header warns about. It agrees with the oracle on 0x748C/0x748E but leaves 0x776C
 * untouched, so any state where 0x776C != 0x10 catches it.
 */
function brokenHoist(m) {
  const { regs, mem } = m;
  regs.a = 0x02;
  if (!boardBitGate(m)) return;
  mem.write8(0x748c, 0x10);
  mem.write8(0x748e, 0xc0);
  mem.write8(0x748c, 0x10); // BUG: hoisted HL -> writes 0x748C pair again,
  mem.write8(0x748e, 0xc0); //      never writing the 0x776C pair
}

test("TEETH: the hoist-trap twin (never writes 0x776C) is CAUGHT and names 0x776C", () => {
  // Real captured open-arm state (0x776C held 0xC0 pre-write, so the miss shows).
  const cap = OPEN[0];
  const o = cap.clone();
  const c = cap.clone();
  oracle(o);
  brokenHoist(c);
  const d = ramDiffMinusStack(o, c, cap.regs.sp);
  assert.notEqual(d, null, "the gate FAILED to catch the hoist trap — it is worthless");
  assert.equal(d.addr, 0x776c, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);

  // Crafted-dirtied state: guarantee the miss shows regardless of prior cell contents.
  const base = CLOSED[0];
  const o2 = base.clone();
  const c2 = base.clone();
  for (const mm of [o2, c2]) {
    mm.mem.write8(BOARD, 0x02);
    for (const addr of CELLS) mm.mem.write8(addr, 0xaa);
  }
  oracle(o2);
  brokenHoist(c2);
  const d2 = ramDiffMinusStack(o2, c2, base.regs.sp);
  assert.notEqual(d2, null, "the gate FAILED to catch the hoist trap on the crafted state");
  assert.equal(d2.addr, 0x776c, `crafted teeth caught the wrong address ${hx(d2.addr ?? 0)}`);

  console.log(`  TEETH: hoist trap caught at ${hx(d.addr)} (oracle=${hx(d.a)} broken=${hx(d.b)})`);
});
