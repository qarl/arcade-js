// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_2ed4 (ROM 0x2ED4) — the per-frame hammer sprite / background-tune
 * dispatcher (rst 0x30 board gate, rst 0x10 alive gate, object select, then a hand-off to
 * buildPendingHammerSprite when no hammer is held or updateActiveHammer when one is).
 *
 * loc_2ed4 is CALLED every serviced frame (loc_197a `call 0x2ed4`). The oracle brackets the
 * two rst gates with `push16` and threads its multi-way tail `jp`s; loc_2ed4 DIRECT-calls the
 * four idiomatic callees (boardBitGate, marioActiveGuard, buildPendingHammerSprite,
 * updateActiveHammer — each memory-equivalent to its oracle) and models no stack. Both sides
 * therefore reach identical work RAM; the ONLY residual difference is the dead STACK_SCRATCH
 * the oracle's dissolved rst push16/ret churn writes — excluded by the memory-equivalence
 * contract (mirrors equivalence-03a2.test.js). The two rst pushes are the oracle's only stack
 * WRITES, and captured dispatches sit at SP ~0x6bec so both land inside STACK_SCRATCH.
 *
 * THE STACK NETS UNIFORMLY. Every exit path of the oracle nets exactly ONE caller-return pop:
 * the two rst gates skip via the callee's double-pop, and every build-arm tail `jp` reaches a
 * record write whose `ret` pops the one caller return. So the candidate is run then given ONE
 * m.ret() to line pc + SP up with the oracle — the same shim equivalence-03a2 uses.
 *
 *   0. REACHABILITY — 0x2ED4 is dispatched during attract, hitting BOTH arms (hammer active
 *      and inactive).
 *   1. EQUAL (captured) — hook 0x2ED4 in a real attract run (bucketed by arm so both are
 *      captured), clone at each dispatch, and confirm loc_2ed4 == oracle (RAM − the stack scratch below the entry SP,
 *      pc, SP) on every real state.
 *   2. EQUAL (crafted) — poke the gates / selector / hammer cells identically on both sides to
 *      drive every path: the board and alive skips, the inactive early-return and build (both
 *      objects, both facings), and the active update with the swing phase clear and set (with
 *      and without the high-bit displacement nudge, both objects).
 *   3. TEETH — three broken twins, each MUST be caught by the crafted comparison:
 *      (a) inverted object selection — writes to the wrong object record; caught at 0x668E.
 *      (b) wrong hammer tune (0x08 not 0x04) — caught at SND_BGM (0x6089) on an active case.
 *      (c) dropped facing bit on the object tile — caught at the record code byte on a
 *          facing-right active case.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-2ed4.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2ed4 as oracle } from "../../translated/loc_2ed4.js";
import { driveHammerSprite as loc_2ed4 } from "../driveHammerSprite.js";
import { Machine } from "../../machine.js";
import {
  STACK_SCRATCH,
  BOARD,
  MARIO_ACTIVE,
  MARIO_HAMMER_ACTIVE,
  MARIO_HAMMER_PENDING,
  HAMMER_TIMER_LO,
  HAMMER_TIMER_HI,
  MARIO_SPRITE_CODE,
  MARIO_SPRITE_RECORD,
  SPRITE_CODE,
  MARIO_X,
  MARIO_Y,
  SND_BGM,
  HAMMER_SAVED_BGM,
  OBJ_PAIR_6680,
  HAMMER_IN_PLAY,
  OBJ_HIT_EXTENT_X,
  OBJ_HIT_EXTENT_Y,
  FRAME,
} from "../names.js";
import { u8 } from "../../../../core/int.js";
// The teeth twins reuse the real callees (their faithfulness is proven by their own gates,
// not under test here) so only the loc_2ed4-level logic error is what diverges.
import { boardBitGate } from "../boardBitGate.js";
import { marioActiveGuard } from "../marioActiveGuard.js";
import { buildPendingHammerSprite } from "../buildPendingHammerSprite.js";
import { updateActiveHammer } from "../updateActiveHammer.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x2ed4;
const RET_ADDR = 0x199b; // the loc_197a site right after `call 0x2ed4`

// The pair's object bases + their sprite-record slots (no names.js name — kept hex).
const OBJ1_BASE = OBJ_PAIR_6680;        // 0x6680
const OBJ2_BASE = OBJ_PAIR_6680 + 0x10; // 0x6690
const OBJ1_RECORD = 0x6a18;
const OBJ2_RECORD = 0x6a1c;
const SELECTOR = OBJ_PAIR_6680 + HAMMER_IN_PLAY; // 0x6681 — bit0 picks the object

// Object-record field offsets with no names.js name (the two collision half-extents this routine
// stamps DO have one — OBJ_HIT_EXTENT_X/Y, imported above).
const OBJ_XDISP = 0x0e;
const OBJ_YDISP = 0x0f;

const HAMMER_TUNE = 0x04;
const HAMMER_TILE_BASE = 0x1e;
const SENTINEL = 0x5a;
const MARIO_RECORD_CODE = (MARIO_SPRITE_RECORD + SPRITE_CODE) & 0xffff; // 0x694D
const recordCode = (record) => (record + SPRITE_CODE) & 0xffff;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const recordOf = (sel) => (sel ? OBJ1_RECORD : OBJ2_RECORD);
const objTileFor = (marioCode) => HAMMER_TILE_BASE | (marioCode & 0x80);

// First RAM byte that differs between two machines, skipping the stack scratch below the entry SP
// (the memory-equivalence contract is RAM − the stack scratch below the entry SP). { addr, a, b } | null.
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

// All non-stack RAM addresses that changed between two machines (for the no-write / exact-write
// checks on the skip and early-out paths).
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

/** Run the ORACLE on a fresh clone. It performs its own terminal `ret`(s). */
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

/**
 * Run a candidate on a fresh clone, then model its terminal `ret` with one m.ret() so pc + SP
 * match the oracle's (loc_2ed4 replaces the Z80 stack with the JS call stack). The oracle nets
 * exactly one caller-return pop on every path.
 */
function runCandidate(entry, fn) {
  const c = entry.clone();
  fn(c);
  c.ret();
  return c;
}

/** Full contract diff: RAM − the stack scratch below the entry SP, pc, SP. Live-out is memory-only. */
function contractDiffs(entry, fn) {
  const o = runOracle(entry);
  const c = runCandidate(entry, fn);
  const diffs = [];
  const ram = firstRamDiff(o, c, entry.regs.sp);
  if (ram) diffs.push(`RAM@${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
  if (o.pc !== c.pc) diffs.push(`pc oracle=${hx(o.pc)} cand=${hx(c.pc)}`);
  if (o.regs.sp !== c.regs.sp) diffs.push(`SP oracle=${hx(o.regs.sp)} cand=${hx(c.regs.sp)}`);
  return diffs;
}

// A real, self-consistent machine: boot + a stretch of attract so work RAM holds realistic
// values. The specific paths are crafted by poking on top of this.
function attractBase(frames = 300) {
  const m = new Machine(ROM);
  m.runFrames(frames);
  return m.clone(); // clone neutralises the frame machinery (nextNmi/nextBoundary = Infinity)
}

// Stamp a crafted 0x2ed4 dispatch onto a clone of the base: a stack with a plausible caller
// return (so the terminal `ret` has a sane target), the two gate inputs, the object selector,
// the hammer state cells, Mario's pose/position, and the tune cells. Every write-target that
// distinguishes a path is pre-seeded with a sentinel identically on both sides.
function craft(base, {
  board = 1, alive = 1, sel = 1, active = 0, pending = 0,
  timerLo = 0x00, timerHi = 0x00, marioCode = 0x03,
  marioX = 0x40, marioY = 0x50, bgm = 0xee, savedBgm = 0x08, frame = 0x00,
} = {}) {
  const m = base.clone();
  m.regs.sp = 0x6c00;
  m.push16(RET_ADDR);
  m.mem.write8(BOARD, board);
  m.mem.write8(MARIO_ACTIVE, alive);
  m.mem.write8(SELECTOR, sel ? 0x01 : 0x00);
  m.mem.write8(MARIO_HAMMER_ACTIVE, active);
  m.mem.write8(MARIO_HAMMER_PENDING, pending);
  m.mem.write8(HAMMER_TIMER_LO, timerLo);
  m.mem.write8(HAMMER_TIMER_HI, timerHi);
  m.mem.write8(MARIO_SPRITE_CODE, marioCode);
  m.mem.write8(MARIO_X, marioX);
  m.mem.write8(MARIO_Y, marioY);
  m.mem.write8(SND_BGM, bgm);
  m.mem.write8(HAMMER_SAVED_BGM, savedBgm);
  m.mem.write8(FRAME, frame);
  // Sentinels on the object displacement/state bytes of BOTH objects, so a mis-selected or
  // dropped store is visible and cannot hide behind a coincidentally-equal prior byte.
  for (const b of [OBJ1_BASE, OBJ2_BASE]) {
    for (const off of [OBJ_HIT_EXTENT_X, OBJ_HIT_EXTENT_Y, OBJ_XDISP, OBJ_YDISP]) {
      m.mem.write8((b + off) & 0xffff, SENTINEL);
    }
  }
  // Sentinel on Mario's on-screen record code byte (only the active arm stamps it).
  m.mem.write8(MARIO_RECORD_CODE, SENTINEL); // 0x694D
  return m;
}

// -- 0. reachability ----------------------------------------------------------

test("REACHABILITY: 0x2ED4 is dispatched during attract (both arms)", () => {
  let total = 0, active = 0, inactive = 0;
  const snap = new Map([[TARGET, (mm) => {
    total++;
    if (mm.mem.read8(MARIO_HAMMER_ACTIVE) & 0x01) active++; else inactive++;
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(2500);
  assert.ok(total > 0, "0x2ED4 should be dispatched — loc_197a calls it every serviced frame");
  assert.ok(active > 0 && inactive > 0, "expected both the hammer-active and hammer-inactive arms in attract");
  console.log(`  REACHABILITY: ${total} natural 0x2ED4 dispatches in 2500 frames (${active} active, ${inactive} inactive)`);
});

// -- 1. EQUAL (captured) ------------------------------------------------------

test("EQUAL (captured): loc_2ed4 == oracle on every real dispatch", () => {
  // Bucket by arm so the rarer active path is captured too, not just the inactive dispatches.
  const active = [], inactive = [];
  const snap = new Map([[TARGET, (mm) => {
    const bucket = (mm.mem.read8(MARIO_HAMMER_ACTIVE) & 0x01) ? active : inactive;
    if (bucket.length < 100) bucket.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(2500);
  const caps = [...inactive, ...active];
  assert.ok(caps.length >= 1, "expected at least one real 0x2ED4 dispatch during attract");
  assert.ok(active.length >= 1, "expected at least one real ACTIVE dispatch (hammer held) during attract");

  let sawActive = 0, sawInactive = 0;
  for (const entry of caps) {
    // The oracle's rst pushes (its only stack writes) must land inside STACK_SCRATCH, so
    // excluding that region cannot mask a real diff.
    assert.ok(
      (entry.regs.sp - 2) >= STACK_SCRATCH.lo && entry.regs.sp <= STACK_SCRATCH.hi,
      `oracle's push target must sit inside STACK_SCRATCH (SP=${hx(entry.regs.sp)})`,
    );
    const diffs = contractDiffs(entry, loc_2ed4);
    assert.equal(diffs.length, 0, `captured dispatch: ${diffs.join("; ")}`);
    if (entry.mem.read8(MARIO_HAMMER_ACTIVE) & 0x01) sawActive++; else sawInactive++;
  }
  console.log(`  EQUAL/captured: ${caps.length} real dispatches identical to the oracle (${sawActive} active, ${sawInactive} inactive)`);
});

// -- 2. EQUAL (crafted, all arms) ---------------------------------------------

test("EQUAL (crafted): every gate / selector / hammer path matches the oracle", () => {
  const base = attractBase();

  const cases = [
    // two skip gates -> nothing written at all
    { name: "board gate closed (75m)", opts: { board: 3 }, writes: [] },
    { name: "mario dead", opts: { alive: 0 }, writes: [] },
    // inactive + pending clear -> early return in the build arm; only the seeded displacement
    // (+0x0E = 0, +0x0F = 0xF0) is written, on the selected object.
    { name: "inactive early-return obj1", opts: { sel: 1, active: 0, pending: 0 },
      writes: [(OBJ1_BASE + OBJ_XDISP) & 0xffff, (OBJ1_BASE + OBJ_YDISP) & 0xffff] },
    { name: "inactive early-return obj2", opts: { sel: 0, active: 0, pending: 0 },
      writes: [(OBJ2_BASE + OBJ_XDISP) & 0xffff, (OBJ2_BASE + OBJ_YDISP) & 0xffff] },
    // inactive + pending set -> build hand-off, both facings / both objects
    { name: "inactive build obj1 facing-right", opts: { sel: 1, active: 0, pending: 1, marioCode: 0x8e }, body: "build" },
    { name: "inactive build obj2 facing-left", opts: { sel: 0, active: 0, pending: 1, marioCode: 0x03 }, body: "build" },
    // active + swing phase clear -> update directly, both facings / both objects
    { name: "active swing-clear obj1 facing-left", opts: { sel: 1, active: 1, timerLo: 0x00, marioCode: 0x03 }, body: "active" },
    { name: "active swing-clear obj2 facing-right", opts: { sel: 0, active: 1, timerLo: 0x00, marioCode: 0x8e }, body: "active" },
    // active + swing phase set, on-screen code high bit CLEAR (mario code bits 6/7 clear) ->
    // no displacement nudge
    { name: "active swing-set obj1 no-nudge", opts: { sel: 1, active: 1, timerLo: 0x08, marioCode: 0x03 }, body: "active" },
    // active + swing phase set, high bit SET via facing (bit7) -> displacement nudge
    { name: "active swing-set obj2 nudge (facing)", opts: { sel: 0, active: 1, timerLo: 0x08, marioCode: 0x8e }, body: "active" },
    // active + swing phase set, high bit SET via mario code bit6 propagating into bit7
    { name: "active swing-set obj1 nudge (bit6)", opts: { sel: 1, active: 1, timerLo: 0x08, marioCode: 0x40 }, body: "active" },
  ];

  for (const { name, opts, writes, body } of cases) {
    const entry = craft(base, opts);
    const diffs = contractDiffs(entry, loc_2ed4);
    assert.equal(diffs.length, 0, `${name}: ${diffs.join("; ")}`);

    const after = runOracle(entry);
    if (writes) {
      // Exact non-stack write set — proves the path was genuinely the skip / early-out one.
      assert.deepEqual(changedAddrs(entry, after, entry.regs.sp).sort(), [...writes].sort(),
        `${name}: unexpected non-stack write set`);
    } else if (body === "build") {
      // Non-vacuity: the build arm saved SND_BGM into the scratch and stamped the record code.
      const sel = opts.sel;
      assert.equal(after.mem.read8(HAMMER_SAVED_BGM), (opts.bgm ?? 0xee),
        `${name}: build did not save SND_BGM`);
      assert.equal(after.mem.read8(recordCode(recordOf(sel))), objTileFor(opts.marioCode),
        `${name}: build did not stamp the object tile into the record`);
    } else {
      // Non-vacuity for the active arm: the hammer tune was switched, the counter ticked, and
      // Mario's on-screen record code (seeded sentinel) was replaced.
      assert.equal(after.mem.read8(SND_BGM), HAMMER_TUNE, `${name}: hammer tune not set`);
      assert.equal(after.mem.read8(HAMMER_TIMER_LO), u8((opts.timerLo ?? 0) + 1), `${name}: duration counter not ticked`);
      assert.notEqual(after.mem.read8(MARIO_RECORD_CODE), SENTINEL, `${name}: Mario record code not stamped`);
    }
  }
  console.log(`  EQUAL/crafted: ${cases.length} paths (2 skips, 2 early-outs, 2 builds, 5 active) identical`);
});

// -- 3. TEETH -----------------------------------------------------------------

/**
 * A broken re-implementation of loc_2ed4 for the teeth. `bug` plants a SINGLE error; every
 * other line mirrors the routine and reuses the real (proven) callees, so only the planted
 * error can make the comparison diverge.
 */
function brokenLoc2ed4(m, bug) {
  const { regs, mem } = m;
  regs.a = 0x0b;
  if (!boardBitGate(m)) return;
  if (!marioActiveGuard(m)) return;
  let sel = (mem.read8(SELECTOR) & 0x01) !== 0;
  if (bug === "selector") sel = !sel; // BUG (a): inverted object selection
  const objBase = sel ? OBJ1_BASE : OBJ2_BASE;
  regs.ix = objBase;
  regs.de = sel ? OBJ1_RECORD : OBJ2_RECORD;
  mem.write8((objBase + OBJ_XDISP) & 0xffff, 0x00);
  mem.write8((objBase + OBJ_YDISP) & 0xffff, 0xf0);
  if ((mem.read8(MARIO_HAMMER_ACTIVE) & 0x01) === 0) { buildPendingHammerSprite(m); return; }
  mem.write8(MARIO_HAMMER_PENDING, 0x00);
  mem.write8(SND_BGM, bug === "tune" ? 0x08 : HAMMER_TUNE); // BUG (b): wrong hammer tune
  mem.write8((objBase + OBJ_HIT_EXTENT_X) & 0xffff, 0x06);
  mem.write8((objBase + OBJ_HIT_EXTENT_Y) & 0xffff, 0x03);
  const marioCode = mem.read8(MARIO_SPRITE_CODE);
  const facing = marioCode & 0x80;
  let objTile = (bug === "facing") ? HAMMER_TILE_BASE : (HAMMER_TILE_BASE | facing); // BUG (c): dropped facing
  let hammerCode = u8(marioCode << 1) | facing | 0x08;
  if ((mem.read8(HAMMER_TIMER_LO) & 0x08) === 0) {
    regs.b = objTile; regs.c = hammerCode; updateActiveHammer(m); return;
  }
  objTile |= 0x01; hammerCode |= 0x01;
  mem.write8((objBase + OBJ_HIT_EXTENT_X) & 0xffff, 0x05);
  mem.write8((objBase + OBJ_HIT_EXTENT_Y) & 0xffff, 0x06);
  mem.write8((objBase + OBJ_YDISP) & 0xffff, 0x00);
  mem.write8((objBase + OBJ_XDISP) & 0xffff, 0xf0);
  if ((hammerCode & 0x80) !== 0) mem.write8((objBase + OBJ_XDISP) & 0xffff, 0x10);
  regs.b = objTile; regs.c = hammerCode; updateActiveHammer(m);
}

test("TEETH: inverted-selection, wrong-tune, and dropped-facing twins are CAUGHT", () => {
  const base = attractBase();

  // (a) inverted object selection — on an inactive/selector-clear early-return case only the
  // object displacement is written, so the wrong object diverges cleanly at 0x668E.
  const selEntry = craft(base, { sel: 0, active: 0, pending: 0 });
  const selDiffs = contractDiffs(selEntry, (m) => brokenLoc2ed4(m, "selector"));
  assert.ok(selDiffs.length > 0, "the inverted-selection twin escaped — the gate is worthless");
  assert.ok(selDiffs[0].startsWith(`RAM@${hx((OBJ1_BASE + OBJ_XDISP) & 0xffff)}`),
    `expected the selection diff at ${hx((OBJ1_BASE + OBJ_XDISP) & 0xffff)}, got ${selDiffs[0]}`);

  // (b) wrong hammer tune — an active case; SND_BGM diverges (oracle 0x04 vs twin 0x08).
  const tuneEntry = craft(base, { sel: 1, active: 1, timerLo: 0x00, marioCode: 0x03 });
  const tuneDiffs = contractDiffs(tuneEntry, (m) => brokenLoc2ed4(m, "tune"));
  assert.ok(tuneDiffs.length > 0, "the wrong-tune twin escaped — the gate is worthless");
  assert.ok(tuneDiffs[0].startsWith(`RAM@${hx(SND_BGM)}`),
    `expected the tune diff at ${hx(SND_BGM)}, got ${tuneDiffs[0]}`);

  // (c) dropped facing bit — a facing-right, swing-clear active case: the object tile flows to
  // the record code byte, so it diverges there (oracle 0x9e vs twin 0x1e).
  const faceEntry = craft(base, { sel: 1, active: 1, timerLo: 0x00, marioCode: 0x8e });
  const faceDiffs = contractDiffs(faceEntry, (m) => brokenLoc2ed4(m, "facing"));
  assert.ok(faceDiffs.length > 0, "the dropped-facing twin escaped — the gate is worthless");
  assert.ok(faceDiffs[0].startsWith(`RAM@${hx(recordCode(OBJ1_RECORD))}`),
    `expected the facing diff at the record code byte ${hx(recordCode(OBJ1_RECORD))}, got ${faceDiffs[0]}`);

  console.log(`  TEETH: inverted-selection caught (${selDiffs[0]}); wrong-tune caught (${tuneDiffs[0]}); dropped-facing caught (${faceDiffs[0]})`);
});
