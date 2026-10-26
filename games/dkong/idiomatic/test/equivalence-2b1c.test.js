// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_2b1c (ROM 0x2b1c) — point the descent probe at Mario's context block,
 * run it, and on a normal probe result run the 0x29AF object-collision follow-up and hand back a
 * zeroed result pair.
 *
 * THE CONTRACT: RAM minus the stack scratch below the entry SP, plus the two result bytes loc_1c05 reads back (`dec a`,
 * then `dec b` on the arm that takes), plus the return value — the idiomatic loc_2b1c now RETURNS
 * the descent verdict (equal to the first result byte A) that loc_1c05 formerly read from A; the
 * frozen oracle still returns undefined, so the candidate return is checked against the oracle's A.
 * pc and SP are NOT compared. The idiomatic routine models no stack, and on
 * 0x29AF's two skip exits the ORACLE's own pc/SP are wrong by construction: 0x29AF discards its
 * return address and returns a level further up, `translated/loc_2b1c.js` ignores that and returns
 * again, so the oracle pops one word too many and lands at whatever the extra word held (0x03A6 on
 * this test's staged stack, SP +4 instead of +2). That artifact is not a property to reproduce.
 * The same discarded caller-skip is why the crafted BOARD-3 skip-exit cases below expect a ZEROED
 * result pair even though the hardware would leave 1 there — the oracle is the spec here, and this
 * test pins the oracle's behaviour so a later change to it cannot pass silently.
 *
 *   1. CAPTURED — 0x2B1C is naturally reached: an 8000-frame attract run dispatches it 443x
 *      (loc_1c05 -> here). Attract plays 25m only, and on 25m the probe ALWAYS takes its unwind, so
 *      all 443 exercise the early-return path and NOT ONE of them reaches 0x29AF. The test asserts
 *      that reachability fact directly (it records every address each side dispatches through
 *      `m.call`), so this section cannot be read as covering the follow-up. Sampling: every 20th
 *      capture plus the first of each distinct entry shape (BOARD, object pointer) — 23 of 443
 *      replayed, with an in-test assertion that the sample covers every shape the run produced
 *      (one: BOARD 1, pointer 0x6200).
 *
 *   2. CRAFTED — everything attract cannot reach, on a real attract base with surgical pokes: the
 *      25m landing arm (the only path where the result pair is non-zero), BOARD 2 and BOARD 4 with
 *      0x29AF's rst-0x30 board gate shut, and BOARD 3 with it open, driving all four of 0x29AF's
 *      terminal paths — object search exhausted, and each of its three hit exits, all three of
 *      which write work RAM (MARIO_Y + EDGE_REPOSITION_FLAG; MARIO_X + the sprite record X;
 *      MARIO_ACTIVE cleared). Every crafted entry poisons the object pointer and both result bytes
 *      on entry, so a rewrite that fails to set the pointer or to write a result byte cannot pass
 *      by inheriting the base machine's value. Each case carries an oracle post-condition proving
 *      the intended path was taken.
 *
 *   3. TEETH — six deliberately-broken twins, each MUST be caught:
 *      (a) wrong-object-pointer — threads a pointer that is NOT Mario's context block, so the
 *          classifier tail reads the wrong record's +5 field instead of Mario's Y.
 *      (b) no-unwind-propagate — runs the follow-up and the result pair even on the probe's unwind.
 *      (c) inverted-unwind     — returns early on the NORMAL result and continues on the unwind.
 *      (d) no-followup         — never calls 0x29AF.
 *      (e) drop-first-result   — omits the first result byte.
 *      (f) drop-second-result  — omits the second result byte.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-2b1c.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { u8, u16 } from "../../../../core/int.js";
import { loc_2b1c as oracle } from "../../translated/loc_2b1c.js";
import { loc_2b1c } from "../loc_2b1c.js";
import { probeMarioDescentLanding } from "../probeMarioDescentLanding.js";
import { Machine } from "../../machine.js";
import {
  STACK_SCRATCH,
  BOARD,
  MARIO_ACTIVE,
  MARIO_X,
  MARIO_Y,
  MARIO_AIR_PREV_Y,
  MARIO_AIR_VX_HI,
  MARIO_SPRITE_RECORD,
  SPRITE_X,
  EDGE_REPOSITION_FLAG,
  OBJ_ARRAY_66,
} from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x2b1c;
const FOLLOWUP = 0x29af;                                        // the still-frozen follow-up
const SPRITE_X_ADDR = (MARIO_SPRITE_RECORD + SPRITE_X) & 0xffff; // 0x694c — Mario's sprite record +0 (X)
const OBJECT_BASE = MARIO_ACTIVE;                                // 0x6200 — the pointer loc_2b1c must load
const RET_ADDR = 0x1c08;                                         // loc_1c05's continuation
const SP_TOP = 0x6bfa;                                           // inside STACK_SCRATCH, with RET_ADDR staged above
const POISON_A = 0xaa;                                           // entry first result byte
const POISON_B = 0x55;                                           // entry second result byte
const IX_POISON = 0x6b00;                                        // a pointer that is NOT Mario's block
const IX_POISON_Y = 0xff;                                        // its +5 field, so a missing pointer load shows

const hx = (v) => "0x" + (v & 0xffff).toString(16);

// tileAddrForPixel (ROM 0x2FF0), replicated to poke the tile cell under a probe point.
const tileAddr = (y, x) => (0x7400 + (((~y) & 0xff) >> 3) * 32 + ((x >> 3) & 0x1f)) & 0xffff;

// -- the memory-equivalence contract ------------------------------------------

/** First RAM byte that differs between two machines, skipping the stack scratch below the entry SP (the dead stack
 *  region excluded by contract — the oracle's push/pop/return churn lives there). */
function firstRamDiff(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState(), db = b.dumpState();
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) continue;
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

/** All non-stack RAM addresses that changed between two machines (for non-vacuity). */
function changedAddrs(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState(), db = b.dumpState();
  const out = [];
  for (let i = 0; i < Math.min(da.length, db.length); i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) continue;
    out.push(addr);
  }
  return out;
}

/** Run `fn` on a fresh clone, recording every address it dispatches through the registry — the
 *  direct, non-vacuous record of whether the 0x29AF follow-up was reached. */
function run(entry, fn) {
  const c = entry.clone();
  const dispatched = [];
  const realCall = c.call.bind(c);
  c.call = (addr, ...rest) => { dispatched.push(addr); return realCall(addr, ...rest); };
  const ret = fn(c);
  c.call = realCall;
  return { c, ret, dispatched };
}

/** Compare a candidate against the oracle over the contract: RAM − the stack scratch below the entry SP, both result
 *  bytes, and the return value. pc and SP are excluded (see the header). */
function contractDiffs(entry, fn) {
  const { c: o, ret: oret } = run(entry, oracle);
  const { c, ret } = run(entry, fn);
  const diffs = [];
  const ram = firstRamDiff(o, c, entry.regs.sp);
  if (ram) diffs.push(`RAM@${hx(ram.addr)} oracle=0x${(ram.a & 0xff).toString(16)} cand=0x${(ram.b & 0xff).toString(16)}`);
  if (o.regs.a !== c.regs.a) diffs.push(`first result byte oracle=0x${(o.regs.a & 0xff).toString(16)} cand=0x${(c.regs.a & 0xff).toString(16)}`);
  if (o.regs.b !== c.regs.b) diffs.push(`second result byte oracle=0x${(o.regs.b & 0xff).toString(16)} cand=0x${(c.regs.b & 0xff).toString(16)}`);
  // The candidate now RETURNS the descent verdict; it must equal the value the oracle leaves in A
  // (the byte loc_1c05 formerly read back). The frozen oracle itself still returns undefined.
  if (ret !== o.regs.a) diffs.push(`return (verdict) oracle-A=0x${(o.regs.a & 0xff).toString(16)} cand=${String(ret)}`);
  return diffs;
}

// A real booted attract machine, built once and reused as the base for every crafted entry
// (cloned per case, never mutated).
let _base = null;
function base() {
  if (!_base) {
    const host = new Machine(ROM);
    host.runFrames(200);
    assert.equal(host.stoppedBy, null, "attract base run must reach the vblank spin cleanly");
    _base = host.clone();
  }
  return _base;
}

// -- crafted geometry ----------------------------------------------------------
//
// Descent probe: X = 0x50 with a CLEAR_TILE under every probe cell makes the probe reject, and on
// a non-25m board that reject is the NORMAL return that reaches the follow-up. SURFACE_TILE plus a
// low previous-frame Y makes the classifier land Mario instead (MARIO_Y snapped to LANDED_Y), the
// one path whose result pair is non-zero.
//
// Follow-up (BOARD 3 only): its object search is bound to the six-record array at OBJ_ARRAY_66 with
// base tolerances 8 (against MARIO_Y) and 4 (against MARIO_X), so a record whose +5 equals MARIO_Y,
// whose +3 equals MARIO_X and whose flag byte has bit 0 set is a hit at index 0. It then compares
// MARIO_AIR_PREV_Y against (that record's +5) − 4 = FOLLOWUP_REF, and the three previous-frame Y
// values below select its three hit exits.
const X = 0x50;
const Y_CLEAR = 0x43;                     // probe rejects on a clear tile
const Y_LAND = 0x44;                      // with SURFACE_TILE + PREV_Y_LANDED the classifier lands
const SURFACE_TILE = 0xb0;                // lands in the classifier's "silent" hit band
const CLEAR_TILE = 0x00;                  // below the surface band -> the classifier rejects
const LANDED_Y = 0x40;                    // MARIO_Y after the 25m landing
const PREV_Y_LANDED = 0x10;               // probe at/behind the boundary -> the classifier lands Mario
const PREV_Y_CLEAR = 0x50;                // probe stays past the boundary -> the classifier rejects

const FOLLOWUP_REF = u8(Y_CLEAR - 4);     // 0x3f — the value the follow-up compares against
const PREV_Y_EXIT_Y = 0x20;               // + 5 < ref            -> the MARIO_Y / edge-flag exit
const PREV_Y_EXIT_X = 0x3c;               // + 5 >= ref, − 14 < ref -> the MARIO_X exit
const PREV_Y_EXIT_CLEAR = 0x50;           // − 14 >= ref          -> the clear-MARIO_ACTIVE exit
const EXIT_Y_VALUE = u8(FOLLOWUP_REF - 8);      // 0x37 — MARIO_Y after the first hit exit
const EXIT_X_VALUE = u8(u8(X - 8) | 0x07) + 4;  // 0x53 — MARIO_X after the second hit exit
const SPRITE_X_SENTINEL = 0x11;           // != EXIT_X_VALUE, so the sprite-record write shows
const ORACLE_SKIP_EXIT_PC = 0x03a6;       // the word above RET_ADDR on the staged stack (see the header)

/** A fresh crafted entry on a real attract base: the board, Mario's position, the previous-frame
 *  airborne Y and the horizontal velocity poked; the tile under all three probe cells set; the
 *  six-record object array cleared and (optionally) record 0 armed on top of Mario; the object
 *  pointer and both result bytes POISONED; and RET_ADDR staged on the stack inside STACK_SCRATCH. */
function craftEntry({ board, y, tile, prevY, vxHi = 0, objectActive = false }) {
  const e = base().clone();
  e.nextNmi = Infinity;      // neutralise the frame machinery so the oracle's `m.step`
  e.nextBoundary = Infinity; // cannot fire an NMI or push a frame while running isolated
  e.mem.write8(BOARD, board);
  e.mem.write8(MARIO_ACTIVE, 1);
  e.mem.write8(MARIO_X, X);
  e.mem.write8(MARIO_Y, y);
  e.mem.write8(MARIO_AIR_PREV_Y, prevY);
  e.mem.write8(MARIO_AIR_VX_HI, vxHi);
  e.mem.write8(EDGE_REPOSITION_FLAG, 0);
  e.mem.write8(SPRITE_X_ADDR, SPRITE_X_SENTINEL);

  // All three probe cells (the 25m arm's single point, and the two-point arm's pair).
  for (const cell of [tileAddr(X, u8(y + 7)), tileAddr(u8(X - 3), u8(y + 7)), tileAddr(u8(X + 4), u8(y + 7))]) {
    e.mem.write8(cell, tile);
  }

  // The follow-up's object array: all six records inactive, then record 0 armed on Mario.
  for (let i = 0; i < 6; i++) e.mem.write8(OBJ_ARRAY_66 + i * 0x10, 0);
  if (objectActive) {
    e.mem.write8(OBJ_ARRAY_66 + 0x00, 1); // bit 0 = active
    e.mem.write8(OBJ_ARRAY_66 + 0x03, X); // +3 vs MARIO_X, tolerance 4
    e.mem.write8(OBJ_ARRAY_66 + 0x05, y); // +5 vs MARIO_Y, tolerance 8
  }

  e.mem.write8(IX_POISON + 5, IX_POISON_Y);
  e.regs.ix = IX_POISON;
  e.regs.a = POISON_A;
  e.regs.b = POISON_B;
  e.regs.sp = 0x6bfc;
  e.push16(RET_ADDR); // -> 0x6bfa
  assert.equal(e.regs.sp, SP_TOP, "staged SP must be SP_TOP");
  return e;
}

// The terminal paths, each pinned by an oracle post-condition (non-vacuity). `a`/`b` are the two
// live result bytes; `followup` is whether 0x29AF must have been dispatched; `quiet` marks the
// paths that must write no work RAM at all.
const CASES = [
  {
    name: "25m reject — the probe's unwind, zeroed pair",
    opts: { board: 1, y: Y_CLEAR, tile: CLEAR_TILE, prevY: PREV_Y_CLEAR },
    a: 0, b: 0, followup: false, quiet: true,
    check: (o) => o.mem.read8(MARIO_Y) === Y_CLEAR,
  },
  {
    name: "25m landing — the unwind carrying the landed pair",
    opts: { board: 1, y: Y_LAND, tile: SURFACE_TILE, prevY: PREV_Y_LANDED },
    a: 1, b: 1, followup: false,
    check: (o) => o.mem.read8(MARIO_Y) === LANDED_Y,
  },
  {
    name: "25m too far to land — the unwind, zeroed pair",
    opts: { board: 1, y: Y_LAND, tile: SURFACE_TILE, prevY: PREV_Y_CLEAR },
    a: 0, b: 0, followup: false, quiet: true,
    check: (o) => o.mem.read8(MARIO_Y) === Y_LAND,
  },
  {
    name: "board 2 — normal result; the follow-up's board gate is shut",
    opts: { board: 2, y: Y_CLEAR, tile: CLEAR_TILE, prevY: PREV_Y_CLEAR },
    a: 0, b: 0, followup: true, quiet: true,
    check: (o) => o.mem.read8(MARIO_Y) === Y_CLEAR && o.mem.read8(MARIO_X) === X,
  },
  {
    name: "board 4 — normal result; the follow-up's board gate is shut",
    opts: { board: 4, y: Y_CLEAR, tile: CLEAR_TILE, prevY: PREV_Y_CLEAR },
    a: 0, b: 0, followup: true, quiet: true,
    check: (o) => o.mem.read8(MARIO_Y) === Y_CLEAR && o.mem.read8(MARIO_X) === X,
  },
  {
    name: "board 3 — the follow-up runs; its object search finds nothing",
    opts: { board: 3, y: Y_CLEAR, tile: CLEAR_TILE, prevY: PREV_Y_CLEAR, objectActive: false },
    a: 0, b: 0, followup: true, quiet: true,
    check: (o) => o.mem.read8(MARIO_Y) === Y_CLEAR && o.mem.read8(MARIO_ACTIVE) === 1,
  },
  {
    name: "board 3 — the follow-up's hit exit that repositions MARIO_Y",
    opts: { board: 3, y: Y_CLEAR, tile: CLEAR_TILE, prevY: PREV_Y_EXIT_Y, objectActive: true },
    a: 0, b: 0, followup: true, skipExit: true,
    check: (o) => o.mem.read8(MARIO_Y) === EXIT_Y_VALUE && o.mem.read8(EDGE_REPOSITION_FLAG) === 1,
  },
  {
    name: "board 3 — the follow-up's hit exit that repositions MARIO_X",
    opts: { board: 3, y: Y_CLEAR, tile: CLEAR_TILE, prevY: PREV_Y_EXIT_X, objectActive: true },
    a: 0, b: 0, followup: true, skipExit: true,
    check: (o) => o.mem.read8(MARIO_X) === EXIT_X_VALUE && o.mem.read8(SPRITE_X_ADDR) === EXIT_X_VALUE,
  },
  {
    name: "board 3 — the follow-up's hit exit that clears MARIO_ACTIVE",
    opts: { board: 3, y: Y_CLEAR, tile: CLEAR_TILE, prevY: PREV_Y_EXIT_CLEAR, objectActive: true },
    a: 0, b: 0, followup: true,
    check: (o) => o.mem.read8(MARIO_ACTIVE) === 0,
  },
];

// -- 1. CAPTURED (real attract dispatches) ------------------------------------

const ATTRACT_FRAMES = 8000;
const SAMPLE_EVERY = 20;

/** Capture real entry states at 0x2B1C over an attract run (the game runs undisturbed — the hook
 *  clones, then lets the oracle run). Sampling: every SAMPLE_EVERY-th dispatch plus the first of
 *  each distinct entry shape (BOARD, object pointer). */
function captureDispatches() {
  const caps = [];
  const shapes = new Map();
  let dispatches = 0;
  const shapeOf = (mm) => `board=${mm.mem.read8(BOARD)} pointer=${hx(mm.regs.ix)}`;
  const snapMap = new Map([[TARGET, (mm) => {
    const shape = shapeOf(mm);
    const first = !shapes.has(shape);
    shapes.set(shape, (shapes.get(shape) ?? 0) + 1);
    if (first || dispatches % SAMPLE_EVERY === 0) caps.push({ entry: mm.clone(), shape });
    dispatches++;
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snapMap });
  host.runFrames(ATTRACT_FRAMES);
  return { caps, dispatches, shapes };
}

test("CAPTURED: loc_2b1c == oracle on RAM + both result bytes + return across real attract dispatches", () => {
  const { caps, dispatches, shapes } = captureDispatches();
  assert.ok(dispatches > 0, "0x2b1c must be naturally dispatched in attract — reachability claim in the header");

  const sampled = new Set(caps.map((c) => c.shape));
  for (const shape of shapes.keys()) {
    assert.ok(sampled.has(shape), `entry shape ${shape} occurred but was never sampled`);
  }

  let reachedFollowup = 0;
  for (const { entry } of caps) {
    entry.nextNmi = Infinity;
    entry.nextBoundary = Infinity;
    const diffs = contractDiffs(entry, loc_2b1c);
    assert.equal(diffs.length, 0, diffs.join("; "));
    if (run(entry, oracle).dispatched.includes(FOLLOWUP)) reachedFollowup++;
  }

  // The reachability record this section rests on: attract is 25m only, where the probe always
  // unwinds, so the follow-up arm is NOT covered here (the crafted section carries it). If a
  // reachability change ever makes attract reach it, this assertion fires and the header is wrong.
  assert.equal(reachedFollowup, 0, "attract now reaches 0x29AF — the header's coverage split is stale");

  console.log(
    `  CAPTURED: ${dispatches} real 0x2b1c dispatches in ${ATTRACT_FRAMES} attract frames, ` +
      `${caps.length} replayed (every ${SAMPLE_EVERY}th + first of each shape) — RAM + both result bytes + ` +
      `return identical to the oracle; shapes ${JSON.stringify([...shapes])}; 0 reached ${hx(FOLLOWUP)}`,
  );
});

// -- 2. CRAFTED (the arms attract never reaches) -------------------------------

test("CRAFTED: loc_2b1c == oracle on RAM + both result bytes + return across all nine terminal paths", () => {
  for (const { name, opts, a, b, followup, quiet, skipExit, check } of CASES) {
    const entry = craftEntry(opts);

    // Non-vacuity: the oracle really took the expected path, reached (or did not reach) the
    // follow-up, and left the expected result bytes.
    const { c: o, ret: oret, dispatched } = run(entry, oracle);
    assert.equal(oret, undefined, `${name}: oracle return should be undefined`);
    assert.equal(o.regs.a, a, `${name}: oracle first result byte`);
    assert.equal(o.regs.b, b, `${name}: oracle second result byte`);
    assert.equal(dispatched.includes(FOLLOWUP), followup, `${name}: oracle follow-up reached?`);
    assert.ok(check(o), `${name}: oracle did not take the expected path (post-condition failed)`);

    // Equivalence: candidate identical to the oracle over the contract. The idiomatic reaches the
    // follow-up by a DIRECT call to loc_29af (the m.call seam is dissolved), so it never dispatches
    // 0x29AF through the registry — its reach is proven by RAM equivalence on the board-3 hit exits
    // and by the no-followup teeth, not by an m.call record.
    const diffs = contractDiffs(entry, loc_2b1c);
    assert.equal(diffs.length, 0, `${name}: ${diffs.join("; ")}`);
    const cand = run(entry, loc_2b1c);
    assert.equal(cand.ret, a, `${name}: idiomatic return should be the descent verdict ${a}`);

    // The paths that touch nothing must write no work RAM at all.
    if (quiet) {
      const wrote = changedAddrs(entry, o, entry.regs.sp);
      assert.deepEqual(wrote, [], `${name}: this path must write no non-stack RAM (wrote ${wrote.map(hx).join(" ")})`);
    }

    // The header's account of why pc/SP are out of the contract, made checkable: on 0x29AF's two
    // skip exits the ORACLE pops one word too many, so it ends up +4 on the stack pointer and at
    // whatever address that extra word held on this test's staged stack.
    if (skipExit) {
      assert.equal(o.regs.sp, u16(SP_TOP + 4), `${name}: oracle SP should be SP_TOP + 4 (the extra pop)`);
      assert.equal(o.pc, ORACLE_SKIP_EXIT_PC, `${name}: oracle pc after the extra pop`);
    }
  }

  console.log(
    `  CRAFTED: ${CASES.length} paths (25m reject/landing/too-far; boards 2 and 4 gate-shut; board 3 ` +
      `search-exhausted + all three hit exits) — RAM + both result bytes + return identical to the ` +
      `oracle; LANDED_Y=${hx(LANDED_Y)}, follow-up ref=${hx(FOLLOWUP_REF)}, ` +
      `MARIO_Y exit=${hx(EXIT_Y_VALUE)}, MARIO_X exit=${hx(EXIT_X_VALUE)}`,
  );
});

// -- 3. TEETH -----------------------------------------------------------------

// The twins consume probeMarioDescentLanding's { skip, verdict } return and return the descent
// verdict, exactly as the real loc_2b1c does — each carries one injected defect.

/** (a) wrong-object-pointer — threads a pointer that is NOT Mario's context block, so the
 *  classifier tail reads the wrong record's +5 field instead of Mario's Y. */
function brokenWrongObjectPointer(m) {
  const { regs } = m;
  const { skip, verdict } = probeMarioDescentLanding(m, IX_POISON); // BUG: wrong pointer threaded
  if (!skip) return verdict;
  m.call(FOLLOWUP);
  regs.a = 0;
  regs.b = 0;
  return 0;
}

/** (b) no-unwind-propagate — runs the follow-up and the result pair even on the probe's unwind. */
function brokenNoUnwindPropagate(m) {
  const { regs } = m;
  regs.ix = OBJECT_BASE;
  probeMarioDescentLanding(m); // BUG: no `if (!skip) return verdict`
  m.call(FOLLOWUP);
  regs.a = 0;
  regs.b = 0;
  return 0;
}

/** (c) inverted-unwind — returns early on the normal result and continues on the unwind. */
function brokenInvertedUnwind(m) {
  const { regs } = m;
  regs.ix = OBJECT_BASE;
  const { skip, verdict } = probeMarioDescentLanding(m);
  if (skip) return verdict; // BUG: polarity inverted
  m.call(FOLLOWUP);
  regs.a = 0;
  regs.b = 0;
  return 0;
}

/** (d) no-followup — never calls the object-collision follow-up. */
function brokenNoFollowup(m) {
  const { regs } = m;
  regs.ix = OBJECT_BASE;
  const { skip, verdict } = probeMarioDescentLanding(m);
  if (!skip) return verdict;
  // BUG: the 0x29AF call is missing
  regs.a = 0;
  regs.b = 0;
  return 0;
}

/** (e) drop-first-result — omits the first result byte. */
function brokenDropFirstResult(m) {
  const { regs } = m;
  regs.ix = OBJECT_BASE;
  const { skip, verdict } = probeMarioDescentLanding(m);
  if (!skip) return verdict;
  m.call(FOLLOWUP);
  regs.b = 0; // BUG: the first result byte is never written
  return 0;
}

/** (f) drop-second-result — omits the second result byte. */
function brokenDropSecondResult(m) {
  const { regs } = m;
  regs.ix = OBJECT_BASE;
  const { skip, verdict } = probeMarioDescentLanding(m);
  if (!skip) return verdict;
  m.call(FOLLOWUP);
  regs.a = 0; // BUG: the second result byte is never written
  return 0;
}

/** First crafted case (by name) where `candidate` diverges from the oracle, or null. */
function firstCatch(candidate) {
  for (const { name, opts } of CASES) {
    const diffs = contractDiffs(craftEntry(opts), candidate);
    if (diffs.length) return { name, diffs };
  }
  return null;
}

test("TEETH: all six broken twins are CAUGHT", () => {
  const twins = [
    ["wrong-object-pointer", brokenWrongObjectPointer, "the threaded object pointer is untested"],
    ["no-unwind-propagate", brokenNoUnwindPropagate, "the probe's caller-skip propagation is untested"],
    ["inverted-unwind", brokenInvertedUnwind, "the polarity of the caller-skip test is untested"],
    ["no-followup", brokenNoFollowup, "the 0x29AF follow-up call is untested"],
    ["drop-first-result", brokenDropFirstResult, "the first result byte is untested"],
    ["drop-second-result", brokenDropSecondResult, "the second result byte is untested"],
  ];

  const caught = [];
  for (const [name, fn, why] of twins) {
    const hit = firstCatch(fn);
    assert.notEqual(hit, null, `the ${name} twin escaped — ${why}`);
    caught.push(`${name} caught @"${hit.name}" (${hit.diffs[0]})`);
  }

  console.log(`  TEETH: ${caught.join("; ")}`);
});
