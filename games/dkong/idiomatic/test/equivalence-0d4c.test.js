// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for stampTwoTileBands (ROM 0x0D4C) — "stamp two 4-cell tile
 * bands into a video-RAM row": from the row base handed in HL, write tile 0xFD across
 * four cells (base..base+3), skip a 28-cell gap (DE=0x001C), then write tile 0xFC across
 * four cells (base+0x20..base+0x23) — eight video-RAM writes, ending base+36.
 *
 * This is the CYCLE-FREE / memory-equivalence gate (docs/decompiler-pipeline), not the retired strict
 * whole-machine one. The routine WRITES video RAM, so every case uses a FRESH clone per
 * side. The oracle runs on one clone, stampTwoTileBands on another, and they are compared
 * on the go-forward contract:
 *
 *     RAM (dumpState, minus the stack scratch below the entry SP) only.
 *
 * pc and SP are deliberately NOT compared. The oracle uses m.step + m.ret, so it advances
 * pc to its return target and pops SP+2; both are the modelled step/stack ABI the direct-
 * call layer replaces with a JS return — comparing them would test the control-flow model
 * we drop, not the routine. Memory (the eight video-RAM bytes) is the only live-out: both
 * return sites overwrite HL before reading it (sub_0d43's first call returns to
 * `ld hl,0x7547`; its fall-through return — this routine's second return — lands in
 * loc_0c92 at `ld hl,0x7d86`), B/DE are reloaded and no flag is tested, so HL/B/DE and
 * all flags are dead.
 *
 * REACHABILITY. stampTwoTileBands is board-4-only (100m rivet setup: loc_0c92's board-4
 * arm at 0x0CB6 calls sub_0d43, which calls this routine twice) and attract only plays
 * 25m, so it NEVER dispatches in a plain run. Following the sibling gate (0x0D00), the
 * test forces the real dispatches with an IDENTICAL-BOTH-SIDES board poke (Karl-sanctioned
 * "poke the board state to reach a state for validation"): at frame 100 set GAME_STATE=3,
 * GAME_SUBSTATE=10 (board setup), SUBSTATE_TIMER=1, BOARD=4 (100m rivet). sub_0d43 then
 * fires this routine twice under the vblank NMI (~frame 102) with its two real row bases
 * 0x7687 then 0x7547 — REAL captured entries (real register file, real stack, real board).
 *
 * Jobs:
 *   1. EQUAL (real forced dispatches) — oracle vs stampTwoTileBands on fresh clones of
 *      each captured entry leave identical RAM (−STACK_SCRATCH). Covers both real bases.
 *   2. WRITE-SET (captured) — the oracle's ONLY writes are the eight cells computed from
 *      the captured HL: 0xFD at base..base+3, 0xFC at base+0x20..base+0x23. Documents the
 *      exact footprint (and that nothing else is touched).
 *   3. CRAFTED (generality over the base) — repoint HL to several other video-RAM bases
 *      identically on both sides; oracle == candidate at every base, and the candidate is
 *      read back to prove it genuinely stamped the two bands there (not merely agreed).
 *   4. CRAFTED (overwrite + register/far-RAM independence) — pre-dirty the eight
 *      destination cells to 0xAA identically both sides and confirm both overwrite them;
 *      and poke garbage into B/DE/A and far RAM identically to show the output depends only
 *      on HL. Straight-line, one path — these craft prior contents, not an arm.
 *   5. TEETH — a twin with a WRONG gap (0x20 instead of 0x1C, a plausible "row is 0x20
 *      wide" mistake) shifts the whole second band and MUST be caught, naming base+0x20,
 *      on both a captured and a crafted-dirtied state.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-0d4c.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0d4c as oracle } from "../../translated/loc_0d4c.js";
import { stampTwoTileBands } from "../stampTwoTileBands.js";
import { Machine } from "../../machine.js";
import { firstStateDiff, deadStackBelow } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x0d4c;
const hx = (v) => "0x" + (v & 0xffff).toString(16);

// The eight cells a base stamps: 0xFD at base..base+3, 0xFC at base+0x20..base+0x23.
function writeSetFor(base) {
  const cells = [];
  for (let i = 0; i < 4; i++) cells.push({ addr: (base + i) & 0xffff, val: 0xfd });
  for (let i = 0; i < 4; i++) cells.push({ addr: (base + 0x20 + i) & 0xffff, val: 0xfc });
  return cells;
}

/**
 * First RAM difference between two machines on the go-forward contract: the whole state
 * dump minus the stack scratch below the entry SP (dead scratch — masked per the contract).
 * Returns {addr,a,b,offset} or null.
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

// Identical-both-sides one-shot poke that forces board-4 (100m rivet) setup; loc_0c92's
// board-4 arm calls sub_0d43, which fires this routine twice. dur 1 so the game manages
// state from frame 101.
const POKE_FRAME = 100;
const FORCE_0D4C_POKE = [
  { addr: 0x6005, val: 0x03, frame: POKE_FRAME, dur: 1 }, // GAME_STATE = 3 (in-game dispatch)
  { addr: 0x600a, val: 0x0a, frame: POKE_FRAME, dur: 1 }, // GAME_SUBSTATE = 10 -> board setup
  { addr: 0x6009, val: 0x01, frame: POKE_FRAME, dur: 1 }, // SUBSTATE_TIMER = 1 (proceeds this frame)
  { addr: 0x6227, val: 0x04, frame: POKE_FRAME, dur: 1 }, // BOARD = 4 (100m rivet -> sub_0d43)
];
const FRAMES = 110; // the forced dispatches land ~frame 102

/**
 * Force the real dispatches of 0x0D4C via the board-4 poke and clone the machine at up to
 * K true entries. The wrapper snapshots the entry state, then runs the oracle so the host
 * proceeds. A fresh copy of the poke per machine keeps runs independent.
 */
function captureDispatches(K) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.pokes = FORCE_0D4C_POKE.map((p) => ({ ...p }));
  host.runFrames(FRAMES);
  return caps;
}

const CAPS = ROM_PRESENT ? captureDispatches(8) : [];

// -- 1. EQUAL (real forced dispatches) ----------------------------------------

test("EQUAL: real forced board-4 dispatches — stampTwoTileBands == oracle in RAM (−stack)", () => {
  assert.ok(CAPS.length >= 2, `expected >=2 real 0x0D4C dispatches after the board-4 poke, got ${CAPS.length}`);

  const bases = new Set();
  for (const cap of CAPS) {
    bases.add(cap.regs.hl & 0xffff);
    const o = cap.clone();
    const c = cap.clone();
    oracle(o);
    stampTwoTileBands(c);

    const d = ramDiffMinusStack(o, c, cap.regs.sp);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} stamp=${d.b}`);
  }
  // The two real row bases sub_0d43 uses.
  assert.ok(bases.has(0x7687) && bases.has(0x7547), `expected both real bases 0x7687/0x7547, saw ${[...bases].map(hx).join(",")}`);
  console.log(`  EQUAL: ${CAPS.length} real board-4 dispatch(es) identical (RAM −stack); bases ${[...bases].map(hx).join(",")}`);
});

// -- 2. WRITE-SET (captured) --------------------------------------------------

test("WRITE-SET: the oracle's only writes are 0xFD at base..base+3 and 0xFC at base+0x20..base+0x23", () => {
  for (const cap of CAPS) {
    const base = cap.regs.hl & 0xffff;
    const before = cap.clone();
    const after = cap.clone();
    const b0 = before.dumpState();
    oracle(after);
    const a1 = after.dumpState();

    const changed = [];
    for (let off = 0; off < b0.length; off++) {
      if (b0[off] !== a1[off]) changed.push({ addr: after.stateOffsetToAddr(off), from: b0[off], to: a1[off] });
    }
    const want = new Map(writeSetFor(base).map((c) => [c.addr, c.val]));
    assert.equal(changed.length, 8, `base ${hx(base)}: expected 8 changed bytes, got ${changed.length}`);
    for (const ch of changed) {
      assert.ok(want.has(ch.addr), `oracle wrote unexpected addr ${hx(ch.addr)} (${ch.from}->${ch.to})`);
      assert.equal(ch.to, want.get(ch.addr), `wrong value ${hx(ch.to)} at ${hx(ch.addr)}`);
    }
    console.log(`  WRITE-SET: base ${hx(base)} -> 8 video-RAM bytes (0xFD x4, 0xFC x4)`);
  }
});

// -- 3. CRAFTED (generality over the base) ------------------------------------

// Extra video-RAM bases beyond the two real ones; each keeps all eight cells inside
// 0x7400-0x77FF (base+0x23 <= 0x77FF). Repointed identically on both sides.
const CRAFTED_BASES = [0x7400, 0x7500, 0x7620, 0x76f0, 0x7780];

test("CRAFTED: repointed to other video-RAM bases — stampTwoTileBands == oracle, and it really stamped", () => {
  for (const base of CRAFTED_BASES) {
    const o = CAPS[0].clone();
    const oFloor = o.regs.sp;
    const c = CAPS[0].clone();
    o.regs.hl = base;
    c.regs.hl = base;
    oracle(o);
    stampTwoTileBands(c);

    const d = ramDiffMinusStack(o, c, oFloor);
    assert.equal(d, null, d && `base ${hx(base)}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} stamp=${d.b}`);
    // ...and the candidate genuinely laid both bands at THIS base (not merely agreed).
    for (const cell of writeSetFor(base)) {
      assert.equal(
        c.mem.read8(cell.addr), cell.val,
        `base ${hx(base)}: stamp left ${hx(cell.addr)} = ${hx(c.mem.read8(cell.addr))} (expected ${hx(cell.val)})`,
      );
    }
  }
  console.log(`  CRAFTED: ${CRAFTED_BASES.length} extra bases stamped identically to the oracle`);
});

// -- 4. CRAFTED (overwrite + register/far-RAM independence) -------------------

test("CRAFTED: pre-dirtied destination cells are overwritten identically by both sides", () => {
  const base = CAPS[0].regs.hl & 0xffff;
  const cells = writeSetFor(base);
  const o = CAPS[0].clone();
  const oFloor = o.regs.sp;
  const c = CAPS[0].clone();
  // Identical surgical nudge on BOTH sides: dirty every destination byte to 0xAA.
  for (const cell of cells) {
    o.mem.write8(cell.addr, 0xaa);
    c.mem.write8(cell.addr, 0xaa);
  }
  oracle(o);
  stampTwoTileBands(c);

  const d = ramDiffMinusStack(o, c, oFloor);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} stamp=${d.b}`);
  for (const cell of cells) {
    assert.equal(c.mem.read8(cell.addr), cell.val, `stamp left ${hx(cell.addr)} = ${hx(c.mem.read8(cell.addr))} (expected ${hx(cell.val)})`);
  }
  console.log(`  CRAFTED: 8 destination bytes dirtied to 0xAA at base ${hx(base)} -> both stamp 0xFD/0xFC, RAM identical`);
});

test("CRAFTED: garbage in B/DE/A and far RAM (identical both sides) does not change the output", () => {
  const base = CAPS[0].regs.hl & 0xffff;
  const o = CAPS[0].clone();
  const oFloor = o.regs.sp;
  const c = CAPS[0].clone();
  // Identical unrelated nudge on both sides: the routine reads only HL, so garbage in the
  // register file (except HL) and in RAM it never touches must not move the output.
  for (const mm of [o, c]) {
    mm.regs.b = 0x22; mm.regs.c = 0x33;
    mm.regs.d = 0x44; mm.regs.e = 0x55; mm.regs.a = 0x11;
    mm.mem.write8(0x6300, 0x99); // a work-RAM byte outside the write set
  }
  oracle(o);
  stampTwoTileBands(c);

  const d = ramDiffMinusStack(o, c, oFloor);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} stamp=${d.b}`);
  for (const cell of writeSetFor(base)) {
    assert.equal(c.mem.read8(cell.addr), cell.val, `stamp left ${hx(cell.addr)} = ${hx(c.mem.read8(cell.addr))} (expected ${hx(cell.val)})`);
  }
  console.log("  CRAFTED: garbage B/DE/A + far RAM identical both sides -> output unchanged (HL is the only input)");
});

// -- 5. TEETH -----------------------------------------------------------------

/**
 * Broken twin: steps the gap by 0x20 (a plausible "the tilemap row is 0x20 wide" mistake)
 * instead of the oracle's 0x1C, shifting the whole second band four cells forward. The
 * first band and the band-1 fills agree, so the first divergence is at base+0x20 — the
 * cell the oracle fills 0xFC that this twin skips.
 */
function brokenGapStamp(m) {
  const { regs, mem } = m;
  let addr = regs.hl;
  for (let i = 0; i < 4; i++) { mem.write8(addr, 0xfd); addr = (addr + 1) & 0xffff; }
  addr = (addr + 0x20) & 0xffff; // BUG: the gap must be 0x1C, not 0x20
  for (let i = 0; i < 4; i++) { mem.write8(addr, 0xfc); addr = (addr + 1) & 0xffff; }
}

test("TEETH: a wrong second-band gap is CAUGHT and names base+0x20", () => {
  const base = CAPS[0].regs.hl & 0xffff;
  const wantAddr = (base + 0x20) & 0xffff;

  // Captured state.
  const o = CAPS[0].clone();
  const oFloor = o.regs.sp;
  const c = CAPS[0].clone();
  oracle(o);
  brokenGapStamp(c);
  const d = ramDiffMinusStack(o, c, oFloor);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong gap — it is worthless");
  assert.equal(d.addr, wantAddr, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(wantAddr)})`);

  // Crafted dirtied state too (must be caught regardless of prior contents).
  const o2 = CAPS[0].clone();
  const o2Floor = o2.regs.sp;
  const c2 = CAPS[0].clone();
  for (const cell of writeSetFor(base)) {
    o2.mem.write8(cell.addr, 0xaa);
    c2.mem.write8(cell.addr, 0xaa);
  }
  oracle(o2);
  brokenGapStamp(c2);
  const d2 = ramDiffMinusStack(o2, c2, o2Floor);
  assert.notEqual(d2, null, "the gate FAILED to catch the wrong gap on the crafted state");
  assert.equal(d2.addr, wantAddr, `crafted teeth caught the wrong address ${hx(d2.addr ?? 0)} (expected ${hx(wantAddr)})`);

  console.log(`  TEETH: wrong gap caught at ${hx(d.addr)} (oracle=${hx(d.a)} broken=${hx(d.b)})`);
});
