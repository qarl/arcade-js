// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for fillTileRowPair (ROM 0x0D30) — "stamp a fixed two-row
 * tile motif from HL": 17 cells of 0xFD along one tilemap row, then 17 cells of 0xFC on
 * the row directly below (HL + 0x20, the map being 0x20 cells wide).
 *
 * This is the CYCLE-FREE / memory-equivalence gate (docs/decompiler-pipeline), not the retired strict
 * whole-machine one. The routine WRITES video RAM, so every case uses a FRESH clone per
 * side. The oracle runs on one clone, fillTileRowPair on another, and they are compared
 * on the go-forward contract:
 *
 *     RAM (dumpState, minus the stack scratch below the entry SP) only.
 *
 * pc and SP are deliberately NOT compared. The oracle ends in m.ret, so it pops the
 * caller's return address (pc→target, SP+2); both are the modelled step/stack ABI the
 * direct-call layer replaces with a JS return — comparing them would test the control-
 * flow model we drop, not the routine. The 34 stamped tilemap bytes are the only
 * live-out: HL/DE/B and all flags are dead ABI (sub_0d27's two call sites overwrite or
 * ignore HL; loc_0cf2 reloads DE) so they are neither reproduced nor compared, and the
 * whole-machine RAM gate backstops that.
 *
 * REACHABILITY. fillTileRowPair is 75m-only: the elevator-board setup arm loc_0cf2
 * (BOARD(0x6227)==3, via loc_0c92's dec-cascade) calls sub_0d27, which invokes 0x0D30
 * twice (HL=0x770D then 0x760D). Attract only plays 25m, so it NEVER dispatches in a
 * plain run (verified: 0 dispatches in 1500 attract frames). Following the sanctioned
 * "poke the board state to reach a state for validation", the test forces the two real
 * dispatches with an IDENTICAL-BOTH-SIDES board-3 poke at frame 100 (GAME_STATE=3,
 * GAME_SUBSTATE=0x0A board-setup, SUBSTATE_TIMER=1, BOARD=3); the 75m setup arm then
 * runs under the vblank NMI and its sub_0d27 fires 0x0D30 twice (~frame 102), giving
 * REAL captured entries (real register file, real stack, real HL = 0x770D / 0x760D).
 *
 * Jobs:
 *   1. EQUAL (real forced dispatches) — oracle vs fillTileRowPair on fresh clones of the
 *      two real board-3 entries leave identical RAM (−STACK_SCRATCH).
 *   2. WRITE-SET (captured) — over pre-dirtied destinations, the oracle's ONLY writes are
 *      the 34 bytes: 0xFD at HL..HL+0x10, 0xFC at HL+0x20..HL+0x30. Documents the exact
 *      footprint and that nothing else moves.
 *   3. CRAFTED (varied HL + dirty overwrite + input-independence) — re-point HL across
 *      the tilemap identically on both sides (the routine's only real input), pre-dirty
 *      the destinations, and poke unrelated registers/RAM; both stamp the same motif and
 *      RAM stays identical, proving the address arithmetic and input-independence.
 *   4. TEETH — a twin that writes a WRONG tile value (0xFF) to the first cell (HL) MUST
 *      be caught, naming that cell, on both a captured and a crafted state.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-0d30.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0d30 as oracle } from "../../translated/loc_0d30.js";
import { fillTileRowPair } from "../fillTileRowPair.js";
import { Machine } from "../../machine.js";
import { firstStateDiff, deadStackBelow } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x0d30;
const hx = (v) => "0x" + (v & 0xffff).toString(16);

/**
 * First RAM difference between two machines on the go-forward contract: the whole state
 * dump minus the stack scratch below the entry SP (dead scratch — masked per the contract). Returns
 * {addr,a,b,offset} or null.
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

/** The 34 cells the motif stamps from a given HL: 0xFD at HL..HL+0x10, 0xFC at HL+0x20..HL+0x30. */
function expectedWrites(hl) {
  const w = new Map();
  for (let i = 0; i < 0x11; i++) w.set((hl + i) & 0xffff, 0xfd);
  const second = (hl + 0x20) & 0xffff;
  for (let i = 0; i < 0x11; i++) w.set((second + i) & 0xffff, 0xfc);
  return w;
}

// Identical-both-sides one-shot poke that forces 75m (BOARD==3) board setup, whose
// elevator arm loc_0cf2 -> sub_0d27 fires 0x0D30 twice. dur 1 so the game manages state
// from frame 101.
const POKE_FRAME = 100;
const FORCE_0D30_POKE = [
  { addr: 0x6005, val: 0x03, frame: POKE_FRAME, dur: 1 }, // GAME_STATE = 3 (in-game dispatch)
  { addr: 0x600a, val: 0x0a, frame: POKE_FRAME, dur: 1 }, // GAME_SUBSTATE = 0x0A -> board setup
  { addr: 0x6009, val: 0x01, frame: POKE_FRAME, dur: 1 }, // SUBSTATE_TIMER = 1 (proceeds this frame)
  { addr: 0x6227, val: 0x03, frame: POKE_FRAME, dur: 1 }, // BOARD = 3 (75m elevator -> loc_0cf2)
];
const FRAMES = 140; // the two forced dispatches land ~frame 102

/**
 * Force the two real dispatches of 0x0D30 via the board-3 poke and clone the machine at
 * each true entry. The wrapper snapshots the entry state, then runs the oracle so the
 * host proceeds. A fresh copy of the poke per machine keeps runs independent.
 */
function captureDispatches(K) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.pokes = FORCE_0D30_POKE.map((p) => ({ ...p }));
  host.runFrames(FRAMES);
  return caps;
}

const CAPS = ROM_PRESENT ? captureDispatches(8) : [];

// -- 1. EQUAL (real forced dispatches) ----------------------------------------

test("EQUAL: real forced board-3 dispatches — fillTileRowPair == oracle in RAM (−stack)", () => {
  assert.ok(CAPS.length >= 2, `expected the two real 0x0D30 dispatches (HL=0x770D,0x760D); got ${CAPS.length}`);

  const seen = [];
  for (const cap of CAPS) {
    seen.push(cap.regs.hl);
    const o = cap.clone();
    const c = cap.clone();
    oracle(o);
    fillTileRowPair(c);

    const d = ramDiffMinusStack(o, c, cap.regs.sp);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiomatic=${d.b} (HL=${hx(cap.regs.hl)})`);
  }
  // Confirm we actually saw the real board-3 write pointers, not some incidental entry.
  assert.ok(seen.includes(0x770d) && seen.includes(0x760d), `captured HLs ${seen.map(hx).join(",")} != the board-3 values`);
  console.log(`  EQUAL: ${CAPS.length} real board-3 dispatch(es) identical (RAM −stack); HLs=${seen.map(hx).join(",")}`);
});

// -- 2. WRITE-SET (captured) --------------------------------------------------

test("WRITE-SET: the oracle's only writes are 0xFD at HL..HL+0x10 and 0xFC at HL+0x20..HL+0x30", () => {
  const cap = CAPS[0];
  const hl = cap.regs.hl;
  const want = expectedWrites(hl);

  // Pre-dirty every destination to 0xAA so each of the 34 writes registers as a change.
  const m = cap.clone();
  for (const addr of want.keys()) m.mem.write8(addr, 0xaa);
  const before = m.dumpState();
  oracle(m);
  const after = m.dumpState();

  const changed = [];
  for (let off = 0; off < before.length; off++) {
    if (before[off] !== after[off]) changed.push({ addr: m.stateOffsetToAddr(off), from: before[off], to: after[off] });
  }
  assert.equal(changed.length, 34, `expected 34 changed bytes, got ${changed.length}`);
  for (const ch of changed) {
    assert.ok(want.has(ch.addr), `oracle wrote unexpected addr ${hx(ch.addr)} (${ch.from}->${ch.to})`);
    assert.equal(ch.to, want.get(ch.addr), `wrong value ${hx(ch.to)} at ${hx(ch.addr)}`);
  }
  console.log(`  WRITE-SET: ${changed.length} tilemap bytes changed — 17×0xFD from ${hx(hl)}, 17×0xFC from ${hx((hl + 0x20) & 0xffff)}`);
});

// -- 3. CRAFTED (varied HL + dirty overwrite + input-independence) ------------

// HL positions across the tilemap (each keeps HL+0x30 <= 0x77FF, the VRAM top).
const HL_VARIANTS = [0x7400, 0x7415, 0x76c0, 0x77cf, 0x760d, 0x770d];

test("CRAFTED: varied HL over dirtied cells — both stamp the motif, RAM identical", () => {
  const base = CAPS[0];
  for (const hl of HL_VARIANTS) {
    const want = expectedWrites(hl);
    const o = base.clone();
    const c = base.clone();
    // Identical surgical nudge on BOTH sides: point HL here and dirty every destination.
    o.regs.hl = hl; c.regs.hl = hl;
    for (const addr of want.keys()) { o.mem.write8(addr, 0xaa); c.mem.write8(addr, 0xaa); }

    oracle(o);
    fillTileRowPair(c);

    const d = ramDiffMinusStack(o, c, base.regs.sp);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiomatic=${d.b} (HL=${hx(hl)})`);
    // ...and the idiomatic side genuinely stamped the motif over the dirt (not merely agreed).
    for (const [addr, val] of want) {
      assert.equal(c.mem.read8(addr), val, `idiomatic left ${hx(addr)} = ${hx(c.mem.read8(addr))} (expected ${hx(val)}), HL=${hx(hl)}`);
    }
  }
  console.log(`  CRAFTED: ${HL_VARIANTS.length} HL positions dirtied to 0xAA -> both stamp 0xFD/0xFC, RAM identical`);
});

test("CRAFTED: unrelated entry state (registers + far RAM) does not change the output", () => {
  const base = CAPS[0];
  const o = base.clone();
  const c = base.clone();
  // Identical unrelated nudge on both sides: garbage register file (leaving HL, the one
  // real input) and a far work-RAM byte the routine never touches.
  for (const mm of [o, c]) {
    mm.regs.a = 0x11; mm.regs.b = 0x22; mm.regs.c = 0x33;
    mm.regs.de = 0x4455; mm.regs.bc = 0x6677;
    mm.mem.write8(0x6300, 0x99); // work-RAM byte outside the write set
  }
  oracle(o);
  fillTileRowPair(c);

  const d = ramDiffMinusStack(o, c, base.regs.sp);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiomatic=${d.b}`);
  for (const [addr, val] of expectedWrites(base.regs.hl)) {
    assert.equal(c.mem.read8(addr), val, `idiomatic left ${hx(addr)} = ${hx(c.mem.read8(addr))} (expected ${hx(val)})`);
  }
  console.log("  CRAFTED: garbage registers + far RAM identical both sides -> output unchanged");
});

// -- 4. TEETH -----------------------------------------------------------------

/** Broken twin: writes a WRONG value (0xFF) to the first cell (HL). */
function brokenFill(m) {
  fillTileRowPair(m);
  m.mem.write8(m.regs.hl, 0xff); // BUG: the first cell must hold 0xFD
}

test("TEETH: a wrong tile value at the first cell (HL) is CAUGHT and names that cell", () => {
  // Captured state.
  const cap = CAPS[0];
  const firstCell = cap.regs.hl;
  const o = cap.clone();
  const c = cap.clone();
  oracle(o);
  brokenFill(c);
  const d = ramDiffMinusStack(o, c, cap.regs.sp);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong tile store — it is worthless");
  assert.equal(d.addr, firstCell, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(firstCell)})`);

  // Crafted dirtied state too (must be caught regardless of prior contents).
  const hl = 0x7400;
  const o2 = cap.clone();
  const c2 = cap.clone();
  o2.regs.hl = hl; c2.regs.hl = hl;
  for (const addr of expectedWrites(hl).keys()) { o2.mem.write8(addr, 0xaa); c2.mem.write8(addr, 0xaa); }
  oracle(o2);
  brokenFill(c2);
  const d2 = ramDiffMinusStack(o2, c2, cap.regs.sp);
  assert.notEqual(d2, null, "the gate FAILED to catch the wrong store on the crafted state");
  assert.equal(d2.addr, hl, `crafted teeth caught the wrong address ${hx(d2.addr ?? 0)} (expected ${hx(hl)})`);

  console.log(`  TEETH: wrong first-cell store caught at ${hx(d.addr)} (oracle=${hx(d.a)} broken=${hx(d.b)})`);
});
