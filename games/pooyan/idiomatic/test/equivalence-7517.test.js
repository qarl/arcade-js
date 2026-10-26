// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for runDisplayListAndAdvanceToGameplay (ROM 0x7517) — display dispatch state 1 (dispatchSelfTestState's table,
 * selector 0x8921 & 3). It runs the display-list interpreter (paintDisplayListRunToVram), then increments the mod
 * counter 0x88b7 and returns until it reaches 0x1c; on that tick it reads/increments the one-shot
 * 0x8920, copies the pre-increment value into 0x88b7, and returns on the first pass (pre-inc 0).
 * Otherwise it column-sums two 14-tile video-RAM strips (0x82bc and 0x86bc, walking up stride 0x20)
 * into a 16-bit accumulator and requires the total to be exactly 0x014f (E=0x4f, D=1); any other
 * total is a hard integrity trap (the oracle jumps to 0x43e1 / 0x462c, modelled as a throw). On a
 * clean sum it advances the selector 0x8921 to state 2 and enqueues two sound commands (queueSoundCommands27And15).
 *
 * CYCLE-FREE / memory-equivalence gate. The routine WRITES RAM (and delegates to already-gated
 * leaves), so every case uses a FRESH clone per side. Contract: RAM (dumpState minus stack scratch below the entry SP)
 * ONLY — runDisplayListAndAdvanceToGameplay is a table-dispatched state handler and no caller consumes a result register, so
 * there is NO declared register live-out. pc/SP/cycles are NOT compared.
 *
 * paintDisplayListRunToVram runs on EVERY path and can otherwise perturb 0x88b7 and the pointer pairs, so craft()
 * seats a harmless display list: both the primary (0x8f43/0x8f45) and alternate (0x88b8/0x88ba)
 * pointer pairs point their source at a two-byte skip program (0x10, 0x1d) whose skip count equals
 * the byte budget, so paintDisplayListRunToVram performs a single skip that writes NO cells and never touches 0x88b7.
 * That makes the crafted counter/one-shot/strip values the only things that select the path.
 *
 * The good-sum craft mirrors the translated test's seedGoodStrips: zero all 28 summed cells, then
 * 0x82bc := 0xff and 0x829c := 0x50 (one carry -> D=1, E=0x4f = total 0x014f).
 *
 * Jobs:
 *   1. EQUAL — counter-not-yet, first-pass, and good-sum full paths: runDisplayListAndAdvanceToGameplay == oracle (RAM −stack).
 *   2. CRAFTED (trap) — a zeroed sum (0 != 0x4f): BOTH throw, and the RAM after the trap still agrees.
 *   3. WRITE-SET — the full path advances 0x8921, writes 0x88b7 := pre-inc, 0x8920 += 1, and does NOT
 *      write the read-only strip cells.
 *   4. TEETH — a twin that mis-advances the selector 0x8921 on the full path MUST be caught; a twin
 *      that mis-writes 0x88b7 on the first-pass path MUST be caught.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-7517.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_7517 as oracle } from "../../translated/loc_7517.js";
import { runDisplayListAndAdvanceToGameplay } from "../runDisplayListAndAdvanceToGameplay.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const TICK = 0x88b7;      // mod-0x1c counter
const ONESHOT = 0x8920;   // sub-phase one-shot / paintDisplayListRunToVram primary-vs-alt selector
const SELECTOR = 0x8921;  // dispatchSelfTestState dispatch selector, advanced to state 2 here
const STRIP_A = 0x82bc;   // first summed strip base
const STRIP_B = 0x86bc;   // second summed strip base
const ROW_STRIDE = 0x20;
const STRIP_TILES = 0x0e;
const PRIM_DST = 0x8f43, PRIM_SRC = 0x8f45; // display-list primary pointer pair
const ALT_DST = 0x88b8, ALT_SRC = 0x88ba;   // display-list alternate pointer pair
const SKIP_PROG = 0x8b00; // where the harmless {skip, 0x1d} program lives
const SAFE_DST = 0x8400;  // dst the harmless skip advances over (no writes land)
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const inDeadStack = deadStackBelow(STACK_SCRATCH, STACK_SCRATCH.hi - 0x20);

function ramDiffMinusStack(ma, mb) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** The 28 cells the sum reads (both strips, walking up stride 0x20). */
function strippedCells() {
  const cells = [];
  for (const base of [STRIP_A, STRIP_B]) {
    let cell = base;
    for (let i = 0; i < STRIP_TILES; i++) { cells.push(cell); cell = (cell - ROW_STRIDE) & 0xffff; }
  }
  return cells;
}
const STRIP_CELLS = strippedCells();

/** A fresh clone: harmless display list seated, selector zeroed, SP in scratch. */
function craft(scn) {
  const m = BASE.clone();
  // A skip program that consumes the whole byte budget in one step -> paintDisplayListRunToVram writes no cells and
  // leaves 0x88b7 alone, whichever pointer pair it picks.
  m.mem.write8(SKIP_PROG, 0x10);     // CMD_SKIP
  m.mem.write8(SKIP_PROG + 1, 0x1d); // skip == the interpreter's byte budget
  m.mem.write16(PRIM_DST, SAFE_DST);
  m.mem.write16(PRIM_SRC, SKIP_PROG);
  m.mem.write16(ALT_DST, SAFE_DST);
  m.mem.write16(ALT_SRC, SKIP_PROG);
  m.mem.write8(SELECTOR, 0x00);
  m.mem.write8(TICK, scn.tick);
  m.mem.write8(ONESHOT, scn.oneshot);
  if (scn.strips === "good" || scn.strips === "zero") {
    for (const a of STRIP_CELLS) m.mem.write8(a, 0x00);
    if (scn.strips === "good") { m.mem.write8(STRIP_A, 0xff); m.mem.write8(STRIP_A - ROW_STRIDE, 0x50); }
  }
  m.regs.sp = STACK_SCRATCH.hi - 0x20; // the delegated callees push/pop here (dead-stack scratch)
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

const EQUAL_CASES = [
  { name: "counter-not-yet", tick: 0x00, oneshot: 0x00 },                 // inc -> 0x01 != 0x1c -> ret nz
  { name: "first-pass",      tick: 0x1b, oneshot: 0x00 },                 // -> 0x1c, pre-inc 0 -> ret z
  { name: "good-sum",        tick: 0x1b, oneshot: 0x05, strips: "good" }, // full path, sum 0x014f
];

test("EQUAL: counter-not-yet + first-pass + good-sum — runDisplayListAndAdvanceToGameplay == oracle in RAM (−stack)", () => {
  for (const scn of EQUAL_CASES) {
    const o = craft(scn);
    const c = craft(scn);
    oracle(o);
    runDisplayListAndAdvanceToGameplay(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${scn.name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${EQUAL_CASES.length} crafted paths identical (RAM −stack)`);
});

// -- 2. CRAFTED (trap) --------------------------------------------------------

test("CRAFTED: a zeroed sum traps — BOTH throw, RAM after the trap still agrees", () => {
  const scn = { name: "trap", tick: 0x1b, oneshot: 0x05, strips: "zero" }; // sum 0 -> E=0 != 0x4f
  const o = craft(scn);
  const c = craft(scn);
  assert.throws(() => oracle(o), "oracle must trap on a bad HUD sum");
  assert.throws(() => runDisplayListAndAdvanceToGameplay(c), "module must trap on a bad HUD sum");

  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `trap: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  assert.equal(c.mem.read8(SELECTOR), 0x00, "trap: the selector is NOT advanced (throw precedes the advance)");
  console.log("  CRAFTED/trap: both throw identically, selector left unadvanced");
});

// -- 3. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the full path advances the selector, writes the tick/one-shot, and leaves the strips", () => {
  const scn = { name: "good-sum", tick: 0x1b, oneshot: 0x05, strips: "good" };
  const before = craft(scn);
  const after = craft(scn);
  const snapshot = STRIP_CELLS.map((a) => before.mem.read8(a));
  oracle(after);

  assert.equal(after.mem.read8(SELECTOR), 0x01, "selector advanced 0 -> 1 (state 2)");
  assert.equal(after.mem.read8(TICK), 0x05, "0x88b7 := the pre-increment one-shot value (5)");
  assert.equal(after.mem.read8(ONESHOT), 0x06, "one-shot incremented 5 -> 6");
  for (let i = 0; i < STRIP_CELLS.length; i++) {
    assert.equal(after.mem.read8(STRIP_CELLS[i]), snapshot[i], `strip cell ${hx(STRIP_CELLS[i])} is read-only`);
  }
  console.log("  WRITE-SET: selector->1, tick->5, one-shot->6, strips untouched");
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: a mis-advanced selector on the full path is CAUGHT at 0x8921", () => {
  const scn = { name: "good-sum", tick: 0x1b, oneshot: 0x05, strips: "good" };
  const o = craft(scn);
  const c = craft(scn);
  oracle(o);
  runDisplayListAndAdvanceToGameplay(c);
  assert.equal(o.mem.read8(SELECTOR), 0x01, "control: oracle advanced the selector to 1");
  c.mem.write8(SELECTOR, 0x00); // BUG: selector not advanced to state 2

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a mis-advanced selector — it is worthless");
  assert.equal(d.addr, SELECTOR, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/full: mis-advanced selector caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong 0x88b7 on the first-pass path is CAUGHT", () => {
  const scn = { name: "first-pass", tick: 0x1b, oneshot: 0x00 };
  const o = craft(scn);
  const c = craft(scn);
  oracle(o);
  runDisplayListAndAdvanceToGameplay(c);
  assert.equal(o.mem.read8(TICK), 0x00, "control: oracle wrote the pre-inc one-shot (0) into 0x88b7");
  c.mem.write8(TICK, 0x1c); // BUG: left 0x88b7 at 0x1c instead of the pre-inc value

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong 0x88b7 — it is worthless");
  assert.equal(d.addr, TICK, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/first-pass: wrong 0x88b7 caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
