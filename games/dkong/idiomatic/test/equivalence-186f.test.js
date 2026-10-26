// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_186f (ROM 0x186f) — one timer-gated step of the
 * board-advance render sequence: on the frame SUBSTATE_TIMER (0x6009) expires, copy a
 * 40-byte sprite-object frame from ROM 0x3A1F into SPRITE_OBJ_BLOCK, pulse sound latch
 * SND_TRIGGER[4] (0x6084) to 3, and advance the 0x6388 step selector.
 *
 * loc_186f WRITES memory and is NOT a leaf — it runs the idiomatic leaves tickSubstateTimer
 * (rst 0x18 gate, ROM 0x0018) and loadSpriteObjectBlock (the fixed 0x28-byte copy, ROM
 * 0x004e) — so it is gated by capture / clone / replay (docs/decompiler-pipeline) with a FRESH clone per
 * case. tickSubstateTimer is itself memory-equivalent to the oracle's rst-0x18, so loc_186f's
 * branch decision tracks the oracle; what this test pins is that loc_186f (a) skips the whole
 * body until the timer expires, (b) on the single expiry frame runs the copy + latch + step
 * advance, and (c) matches the oracle byte-for-byte in game-visible RAM either way — with the
 * twins proving the sweep bites.
 *
 * A 6000-frame attract run dispatches 0x186f ZERO times (it is a credited game's
 * board-advance cutscene step, reached only when GAME_SUBSTATE 0x600A == 0x16, which attract
 * never enters), so — exactly as docs/decompiler-pipeline prescribes for arms attract never reaches — the gate
 * is CRAFTED: a real booted attract machine, cloned, with SUBSTATE_TIMER / the step selector
 * surgically poked, then oracle-vs-idiomatic on independent fresh clones. The two inputs that
 * select the behaviour are each a single byte, so the crafted sweeps are EXHAUSTIVE over them:
 *
 *   1. STRUCTURE — expiry arm (0x6009=1): game-visible RAM identical; the body did real work
 *      (the 40 bytes at 0x6908 became the ROM template, 0x6084=3, 0x6388++). The oracle's rst /
 *      call pushes land in STACK_SCRATCH (proven load-bearing by a sentinel). Skip arm
 *      (0x6009=5): RAM identical, the copy target / latch / selector UNTOUCHED, only 0x6009
 *      decremented.
 *
 *   2. TIMER (exhaustive) — sweep SUBSTATE_TIMER 0..255. loc_186f == oracle on game-visible
 *      RAM for every value; exactly the ONE value 0x01 takes the work arm (dec → 0), the other
 *      255 skip — pinning the gate branch (and its polarity) across every possible timer byte.
 *
 *   3. STEP (exhaustive) — on the expiry arm, sweep the 0x6388 selector 0..255; confirm oracle
 *      == idiomatic AND that 0x6388 became (seed+1)&0xFF, pinning the `inc` incl. 0xFF→0x00.
 *
 *   4. TEETH — three twins the sweeps MUST catch: (a) drops the 0x6388 `inc` — caught at
 *      0x6388 on the work arm; (b) drops the 0x6084 sound latch — caught at 0x6084 on the work
 *      arm; (c) inverts the timer-gate polarity (runs the body while ticking, skips on expiry)
 *      — caught on both arms.
 *
 *   5. REALISM — hook 0x186f over a long attract run; replay any real dispatch if one occurs,
 *      else record that attract never reaches it (why crafted is the gate).
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-186f.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_186f as oracle } from "../../translated/loc_186f.js";
import { loc_186f as idiomatic } from "../loc_186f.js";
import { tickSubstateTimer } from "../tickSubstateTimer.js";
import { loadSpriteObjectBlock } from "../loadSpriteObjectBlock.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH, SUBSTATE_TIMER, SPRITE_OBJ_BLOCK, SND_TRIGGER } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x186f;
const STEP_SELECTOR = 0x6388; // the board-advance render-sequence step index (unnamed in names.js)
const SND_LATCH = SND_TRIGGER + 4; // 0x6084 — SND_TRIGGER[4], the 3-frame assert this step arms
const COPY_SOURCE = 0x3a1f; // ROM base of the copied 40-byte sprite-object frame
// The 40-byte copy destination: 0x6908..0x692F (10 records x 4 bytes).
const COPY_DEST = Array.from({ length: 0x28 }, (_, k) => SPRITE_OBJ_BLOCK + k);
// SP inside STACK_SCRATCH with headroom for the oracle's rst/call pushes (down to SP-2) and
// its final unmatched `ret` pop (up to SP+2); the idiomatic side touches the stack not at all.
const SP_CRAFT = 0x6bf8;
const hx = (v) => "0x" + (v & 0xffff).toString(16);

/** First game-visible differing RAM byte, EXCLUDING the dead stack-scratch region. */
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

// A real booted attract machine, built once and reused as the base for every crafted entry
// (cloned per case, never mutated). Genuine work RAM; only the inputs move.
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

/**
 * Two independent fresh clones of the base (docs/decompiler-pipeline fresh clone per case — this routine
 * writes RAM), each with SUBSTATE_TIMER and (optionally) the step selector poked, SP planted
 * in STACK_SCRATCH, and a sentinel laid over the push window so the oracle's pushes provably
 * land in the excluded stack region. Returns [oracleClone, candidateClone].
 */
function craftPair(timer, selector) {
  const a = base().clone(), b = base().clone();
  for (const m of [a, b]) {
    m.mem.write8(SUBSTATE_TIMER, timer);
    if (selector !== undefined) m.mem.write8(STEP_SELECTOR, selector);
    m.regs.sp = SP_CRAFT;
    // Sentinel across [SP-2, SP+2): identical on both sides, distinct from the bytes the
    // oracle's rst/call push (0x1870 / 0x1876), so a genuine stack write shows up as a diff
    // that ramDiffMinusStack must exclude.
    for (let off = -2; off < 2; off++) m.mem.write8((SP_CRAFT + off) & 0xffff, 0x5a);
  }
  return [a, b];
}

// -- 1. STRUCTURE -------------------------------------------------------------

test("STRUCTURE: expiry arm (0x6009=1) does the work; skip arm (0x6009=5) leaves the body untouched", () => {
  // Expiry arm — timer decrements 1 -> 0, so the copy + latch + step advance run.
  const [a, b] = craftPair(1, 0x40);
  const aFloor = a.regs.sp;
  oracle(a);
  idiomatic(b);
  const { bad, stackDiffs } = ramDiffMinusStack(a, b, aFloor);
  assert.equal(bad, null, bad && `game-visible RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b})`);

  // Non-vacuous: the oracle side actually did the work.
  assert.equal(a.mem.read8(SUBSTATE_TIMER), 0, "expiry arm must have decremented the timer to 0");
  assert.equal(a.mem.read8(SND_LATCH), 3, "expiry arm must arm SND_TRIGGER[4] (0x6084) to 3");
  assert.equal(a.mem.read8(STEP_SELECTOR), 0x41, "expiry arm must inc the 0x6388 step selector");
  for (let k = 0; k < COPY_DEST.length; k++) {
    assert.equal(a.mem.read8(COPY_DEST[k]), ROM[COPY_SOURCE + k],
      `expiry arm must copy ROM 0x${(COPY_SOURCE + k).toString(16)} into ${hx(COPY_DEST[k])}`);
  }
  assert.ok(stackDiffs > 0, "the oracle's rst/call pushes must land in STACK_SCRATCH (so the exclusion is load-bearing)");
  assert.ok((SP_CRAFT - 2) >= STACK_SCRATCH.lo && (SP_CRAFT + 2) <= STACK_SCRATCH.hi,
    `oracle push / final-ret targets must stay inside STACK_SCRATCH (SP=${hx(SP_CRAFT)})`);

  // Skip arm — timer decrements 5 -> 4, so the body must NOT run.
  const [c, d] = craftPair(5, 0x40);
  const cFloor = c.regs.sp;
  oracle(c);
  idiomatic(d);
  const skip = ramDiffMinusStack(c, d, cFloor);
  assert.equal(skip.bad, null, skip.bad && `skip-arm RAM diff at ${hx(skip.bad.addr)} (oracle=${skip.bad.a} idiomatic=${skip.bad.b})`);
  assert.equal(c.mem.read8(SUBSTATE_TIMER), 4, "skip arm must decrement the timer to 4");
  assert.equal(c.mem.read8(STEP_SELECTOR), 0x40, "skip arm must leave the step selector untouched");
  assert.equal(c.mem.read8(SND_LATCH), base().mem.read8(SND_LATCH), "skip arm must leave the sound latch untouched");
  for (let k = 0; k < COPY_DEST.length; k++) {
    assert.equal(c.mem.read8(COPY_DEST[k]), base().mem.read8(COPY_DEST[k]),
      `skip arm must leave ${hx(COPY_DEST[k])} untouched`);
  }
  console.log("  STRUCTURE: expiry arm copies+latches+steps (stackDiffs>0); skip arm only decrements 0x6009");
});

// -- 2. TIMER (exhaustive) ----------------------------------------------------

test("TIMER (exhaustive): loc_186f == oracle over all 256 SUBSTATE_TIMER values (gate branch pinned)", () => {
  let count = 0, worked = 0, skipped = 0, mismatch = null;
  for (let timer = 0; timer < 256 && !mismatch; timer++) {
    const [a, b] = craftPair(timer, 0x40);
    const aFloor = a.regs.sp;
    oracle(a);
    idiomatic(b);
    const { bad } = ramDiffMinusStack(a, b, aFloor);
    count++;
    // Classify from the oracle: the work arm advances the step selector.
    if (a.mem.read8(STEP_SELECTOR) !== 0x40) worked++; else skipped++;
    if (bad) mismatch = { timer, bad };
  }
  assert.equal(mismatch, null,
    mismatch && `mismatch at SUBSTATE_TIMER=${hx(mismatch.timer)}: RAM diff at ` +
      `${hx(mismatch.bad.addr)} (oracle=${mismatch.bad.a} idiomatic=${mismatch.bad.b})`);
  assert.equal(count, 256, "must have swept all 256 timer values");
  assert.equal(worked, 1, "exactly one timer value (0x01) must take the work arm (dec -> 0)");
  assert.equal(skipped, 255, "the other 255 timer values must skip the body");
  console.log(`  TIMER/exhaustive: 256 values — RAM identical (1 works, 255 skip)`);
});

// -- 3. STEP (exhaustive) -----------------------------------------------------

test("STEP (exhaustive): on the expiry arm the 0x6388 inc wraps 8-bit, oracle == idiomatic", () => {
  let mismatch = null;
  for (let sel = 0; sel < 256 && !mismatch; sel++) {
    const [a, b] = craftPair(1, sel);
    const aFloor = a.regs.sp;
    oracle(a);
    idiomatic(b);
    const { bad } = ramDiffMinusStack(a, b, aFloor);
    if (bad) { mismatch = { sel, bad }; break; }
    const want = (sel + 1) & 0xff;
    if (a.mem.read8(STEP_SELECTOR) !== want) mismatch = { sel, bad: { addr: STEP_SELECTOR, a: a.mem.read8(STEP_SELECTOR), b: want } };
  }
  assert.equal(mismatch, null,
    mismatch && `mismatch at selector=${hx(mismatch.sel)}: ${hx(mismatch.bad.addr)} ` +
      `(oracle=${mismatch.bad.a} want/idiomatic=${mismatch.bad.b})`);
  console.log("  STEP/exhaustive: 0x6388 -> (seed+1)&0xFF on both sides for all 256 seeds (incl. 0xFF->0x00)");
});

// -- 4. TEETH -----------------------------------------------------------------

/** Twin (a): drops the 0x6388 step `inc`. Everything else faithful. */
function brokenNoStep(m) {
  const { regs, mem } = m;
  if (!tickSubstateTimer(m)) return;
  regs.hl = COPY_SOURCE;
  loadSpriteObjectBlock(m);
  mem.write8(SND_LATCH, 0x03);
  // BUG: no `inc (0x6388)`.
}

/** Twin (b): drops the 0x6084 sound-latch write. Everything else faithful. */
function brokenNoLatch(m) {
  const { regs, mem } = m;
  if (!tickSubstateTimer(m)) return;
  regs.hl = COPY_SOURCE;
  loadSpriteObjectBlock(m);
  // BUG: no `ld (0x6084),a`.
  mem.write8(STEP_SELECTOR, (mem.read8(STEP_SELECTOR) + 1) & 0xff);
}

/** Twin (c): inverts the gate polarity — runs the body while the timer is still ticking and
 *  skips it on expiry (docs/decompiler-pipeline's exact "reading it the other way inverts the routine" trap). */
function brokenGatePolarity(m) {
  const { regs, mem } = m;
  if (tickSubstateTimer(m)) return; // BUG: returns on expiry, runs while counting
  regs.hl = COPY_SOURCE;
  loadSpriteObjectBlock(m);
  mem.write8(SND_LATCH, 0x03);
  mem.write8(STEP_SELECTOR, (mem.read8(STEP_SELECTOR) + 1) & 0xff);
}

test("TEETH (no-step): dropping the 0x6388 inc is CAUGHT and names 0x6388", () => {
  const [a, b] = craftPair(1, 0x40);
  const aFloor = a.regs.sp;
  oracle(a);
  brokenNoStep(b);
  const { bad } = ramDiffMinusStack(a, b, aFloor);
  assert.notEqual(bad, null, "the sweep FAILED to catch a dropped step inc — it is worthless");
  assert.equal(bad.addr, STEP_SELECTOR, `expected the caught diff at 0x6388, got ${hx(bad.addr)}`);
  console.log(`  TEETH/no-step: caught at 0x6388 (oracle=${bad.a} broken=${bad.b})`);
});

test("TEETH (no-latch): dropping the 0x6084 sound latch is CAUGHT and names 0x6084", () => {
  const [a, b] = craftPair(1, 0x40);
  const aFloor = a.regs.sp;
  oracle(a);
  brokenNoLatch(b);
  const { bad } = ramDiffMinusStack(a, b, aFloor);
  assert.notEqual(bad, null, "the sweep FAILED to catch a dropped sound latch — it is worthless");
  assert.equal(bad.addr, SND_LATCH, `expected the caught diff at 0x6084, got ${hx(bad.addr)}`);
  console.log(`  TEETH/no-latch: caught at 0x6084 (oracle=${bad.a} broken=${bad.b})`);
});

test("TEETH (gate-polarity): inverting the timer gate is CAUGHT on the expiry arm", () => {
  const [a, b] = craftPair(1, 0x40);
  const aFloor = a.regs.sp;
  oracle(a);
  brokenGatePolarity(b);
  const { bad } = ramDiffMinusStack(a, b, aFloor);
  assert.notEqual(bad, null, "the sweep FAILED to catch an inverted gate polarity — it is worthless");
  console.log(`  TEETH/gate-polarity: caught at ${hx(bad.addr)} (oracle=${bad.a} broken=${bad.b})`);
});

// -- 5. REALISM (attract capture, if any) -------------------------------------

test("REALISM: replay any real 0x186f dispatch; else record that attract never reaches it", () => {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < 16) caps.push(mm.clone()); return oracle(mm); }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(6000);

  for (const entry of caps) {
    const a = entry.clone(), b = entry.clone();
    const aFloor = a.regs.sp;
    oracle(a);
    idiomatic(b);
    const { bad } = ramDiffMinusStack(a, b, aFloor);
    assert.equal(bad, null, bad && `real-dispatch RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b})`);
  }
  if (caps.length === 0) {
    console.log("  REALISM: 0 real 0x186f dispatches in 6000 attract frames — it is a credited game's board-advance cutscene step (GAME_SUBSTATE 0x16); crafted sweeps are the gate");
  } else {
    console.log(`  REALISM: ${caps.length} real 0x186f dispatch(es) — game-visible RAM identical to the oracle`);
  }
});
