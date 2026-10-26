// SPDX-License-Identifier: GPL-3.0-only
/**
 * drainForegroundThenYieldEachVblank — memory-equivalent to the frozen oracle loop at ROM 0x0341.
 * GATE: coroutine, multi-frame. The generator runs two loop-body passes per yield; the oracle loc_0341 is
 * the never-returning loop (jr 0x0341 / jp 0x0368 re-entries, nested through loc_040b in play). Both run
 * from the head on the same entry with the cycle NMI disarmed. A frame boundary is "two passes done":
 * the generator's yield, and the oracle's third pass-start (step to 0x0341, or a jp 0x0368 = step 10
 * cycles). At each boundary BOTH sides snapshot RAM, then get the SAME service: the tape inputs for the
 * next frame and one NMI fired as runIdiomaticGame does (pc = 0x0368). After F frames a sentinel unwinds
 * the oracle. Per frame: RAM (stack scratch [0x87e0,0x8800) masked); SP, asserted 0x8800 on both sides
 * (measured: the oracle is balanced at every boundary; the generator must not move it); and the port log,
 * every latch/PPI write (AddressSpace.isHardwareWrite) and every watchdog read (0x8800 mirror) in program
 * order, the service's own excluded, compared exactly.
 * Live-out: none — loc_0341 only exits by tail jumps that never return (no caller reads a register).
 * Entries: REAL — the boot dispatch of 0x0341, and pre-NMI yield states of live idiomatic-engine runs
 * (attract modes 0/1/2/3/4/5, coin, 1P/2P start, hops, player hand-offs, game over). CRAFTED — START
 * presses with poked credits on a real post-game attract state (1P/2P, too few, BCD 0x10, both, latch),
 * 1P/2P starts with every cell the new-game seed writes dirtied first, and the mode-1 head gate open.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { makeMachine, romsPresent, isStackScratch } from "./_harness.js";
import { AddressSpace } from "../../../../boards/frogger/memory.js";
import { Machine, resolveAllIdiomatic } from "../../machine.js";
import { buildRoutines } from "../../routines.js";
import { runIdiomaticGame } from "../../../../core/frame-stepped.js";
import { loc_0341 as oracle } from "../../translated/loc_0341.js";
import { drainForegroundThenYieldEachVblank as cand, runOneForegroundPass } from "../drainForegroundThenYieldEachVblank.js";
import {
  MAIN_LOOP_HEAD, PACE_TAIL, PLAY_FLAG, CREDIT_BCD, START_LATCH, NUM_PLAYERS, GAME_MODE, HOLD_FLAG, loc_803d, loc_8071,
  FROG_X, PLAYER_START_DEMO_FLAG, ACTIVE_LANE_PARAM_BLOCK, PLAYER1_DIFFICULTY_INDEX, INPLAY_COUNTDOWN_WORD, SOUND_QUEUE_COUNT,
  SOUND_SEQUENCE_COUNTDOWN, LIVES_COUNT, PLAYER1_LIVES, FROG_TIMER_A, TIME_REMAINING_P1, PLAYER1_EXTRA_LIFE_AWARDED,
  PLAYER2_SCORE, PLAYER1_SCORE, ACTIVE_PLAYER, PLAYER_WORK_SCRATCH_8420, HOME_COLUMN_STATE, SPRITE_OBJECT_RECORD_A_P1,
  WORK_PAGE_SAVE_BANK, VRAM_BASE,
} from "../names.js";

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";
const BOUND = Symbol("0341-bound");
const F = 6;
const COIN = 0xe000, IN1 = 0xe002, IN2 = 0xe004, S1 = 0x80, S2 = 0x40;
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const ORACLE_ROUTINES = romsPresent() ? buildRoutines() : null;

// Live runs whose pre-NMI yield states seed the REAL arms: { tape, frames to clone }.
function tapeOf(start, coins) {
  const t = coins.map((f) => ({ frame: f, port: COIN, bits: 0x80, dur: 6 }));
  if (start) t.push({ frame: 230, port: IN1, bits: start, dur: 6 });
  for (let f = 340; f < 4000; f += 25) t.push({ frame: f, port: IN2, bits: 0x10, dur: 4 });
  return t;
}
const RUNS = [
  { name: "attract", tape: [], at: [2, 3, 900, 2341, 2342, 2343, 2389, 2390, 2391] },
  { name: "1P", tape: tapeOf(S1, [150, 180]), at: [156, 157, 229, 230, 231, 232, 340, 345, 566, 567, 568, 721, 722, 723, 724, 771, 772, 800, 1026, 1027, 1281, 1282, 1283, 1500, 1900, 2300] },
  { name: "2P", tape: tapeOf(S2, [150, 180]), at: [230, 231, 467, 468, 663, 664, 839, 1013, 1014, 1322, 1323, 1538, 1539, 1540, 2097, 2098, 2099, 3187, 3188] },
];

async function captureLive({ tape, at }) {
  const img = (n) => new Uint8Array(readFileSync(new URL(`../../rom/${n}`, import.meta.url)));
  const m = await Machine.create(img("maincpu.bin"), { gfx: img("gfx.bin"), proms: img("proms.bin"), overrides: await resolveAllIdiomatic() });
  m.inputTape = tape;
  const want = new Set(at), out = [];
  const max = Math.max(...at) + 1;
  const r = runIdiomaticGame(m, { nmiReturnPC: PACE_TAIL, maxFrames: max, onFrame: (mm, f) => {
    mm.applyInputs(f);
    if (want.has(f)) out.push({ f, m: mm.clone() });
  } });
  if (r.stopError) throw r.stopError;
  return out;
}

function captureBoot() {
  let e = null;
  const ov = new Map([[MAIN_LOOP_HEAD, (mm) => { if (!e) e = mm.clone(); return oracle(mm); }]]);
  makeMachine(ov).runFrames(120);
  return e;
}

// Arm = { name, src, base, tape, poke }. Fresh clone: oracle routines, SP seated, inputs for frame 1.
function prep(arm) {
  const m = arm.src.clone();
  m.routines = ORACLE_ROUTINES;
  m.regs.sp = 0x8800;
  m.inputTape = arm.tape;
  m.io.inputAssert = null;
  if (arm.tape) m.applyInputs(arm.base);
  if (arm.poke) arm.poke(m.mem8);
  const log = [], w = m.mem.write8.bind(m.mem), r = m.mem.read8.bind(m.mem);
  m.mem.write8 = (a, v, b) => { if (!m.inService && AddressSpace.isHardwareWrite(a & 0xffff)) log.push(`${hx(a)}=${v & 0xff}`); return w(a, v, b); };
  m.mem.read8 = (a) => { if (!m.inService && (a & 0xf800) === 0x8800) log.push("wd"); return r(a); };
  m.hwLog = log;
  return m;
}
function service(m, arm, k) {
  m.inService = true;
  try { service0(m, arm, k); } finally { m.inService = false; }
}
function service0(m, arm, k) {
  m.io.inputAssert = null;
  if (arm.tape) m.applyInputs(arm.base + k);
  m.pcKnown = true;
  m.pc = PACE_TAIL;
  m.fireNmi();
}

function runOracle(arm, frames = F) {
  const m = prep(arm), snaps = [];
  const step = m.step.bind(m), c0 = m.cycles;
  let starts = 1, busy = false;
  // Pass-starts 3, 5, .. are the two-pass frame boundaries.
  m.step = (a, c) => {
    step(a, c);
    if (busy || (a !== MAIN_LOOP_HEAD && !(a === PACE_TAIL && c === 10))) return;
    if (m.cycles - c0 > 400e6) throw new Error(`${arm.name}: oracle never reached a pass boundary`);
    if (++starts % 2 === 0) return;
    snaps.push(m.mem.dumpState()); snaps.at(-1).sp = m.regs.sp; snaps.at(-1).log = m.hwLog.join(" ");
    if (snaps.length === frames) throw BOUND;
    busy = true;
    try { service(m, arm, snaps.length); } finally { busy = false; }
  };
  try { oracle(m); assert.fail(`${arm.name}: oracle returned`); } catch (e) { if (e !== BOUND) throw e; }
  return { m, snaps };
}

function runCand(arm, gen = cand, frames = F) {
  const m = prep(arm), snaps = [];
  const g = gen(m);
  for (let k = 1; k <= frames; k++) {
    assert.equal(g.next().done, false, `${arm.name}: the generator finished`);
    snaps.push(m.mem.dumpState()); snaps.at(-1).sp = m.regs.sp; snaps.at(-1).log = m.hwLog.join(" ");
    if (k < frames) service(m, arm, k);
  }
  return { m, snaps };
}

function diff(arm, gen = cand, frames = F) {
  const o = runOracle(arm, frames), c = runCand(arm, gen, frames);
  for (let k = 0; k < frames; k++) {
    const A = o.snaps[k], B = c.snaps[k];
    if (A.sp !== 0x8800) return `${arm.name} frame ${k + 1}: oracle SP ${hx(A.sp)}`;
    if (B.sp !== 0x8800) return `${arm.name} frame ${k + 1}: candidate moved SP to ${hx(B.sp)}`;
    if (A.log !== B.log) return `${arm.name} frame ${k + 1}: port log oracle=[${A.log}] cand=[${B.log}]`;
    for (let i = 0; i < A.length; i++) {
      if (A[i] === B[i]) continue;
      const addr = o.m.stateOffsetToAddr(i);
      if (isStackScratch(addr)) continue;
      return `${arm.name} frame ${k + 1} ${hx(addr)}: oracle=${A[i]} cand=${B[i]}`;
    }
  }
  return null;
}

const REAL = [];
const CRAFT = [];
if (romsPresent()) {
  REAL.push({ name: "boot dispatch", src: captureBoot(), base: 0, tape: null, frames: 12 });
  for (const run of RUNS) {
    for (const { f, m } of await captureLive(run)) REAL.push({ name: `${run.name}@${f}`, src: m, base: f, tape: run.tape });
  }
  const post = REAL.find((a) => a.name === "1P@800").src; // real attract: game over, latch 0, 1 credit
  const press = (bits) => [{ frame: 0, port: IN1, bits, dur: 3 }];
  const cr = (v, latch = 0) => (mem) => { mem[CREDIT_BCD] = v; mem[START_LATCH] = latch; mem[PLAY_FLAG] = 0; };
  for (const [name, bits, credit, latch, players] of [
    ["START1 no credit", S1, 0x00, 0, 0], ["START1 1 credit", S1, 0x01, 0, 1], ["START2 1 credit", S2, 0x01, 0, 0],
    ["START2 2 credits", S2, 0x02, 0, 2], ["START2 BCD 10", S2, 0x10, 0, 2], ["START1 BCD 10", S1, 0x10, 0, 1],
    ["both, 2 credits", S1 | S2, 0x02, 0, 1], ["START1 latched", S1, 0x01, 1, 0], ["no press, 9 credits", 0, 0x09, 0, 0],
  ]) CRAFT.push({ name, src: post, base: 0, tape: press(bits), poke: cr(credit, latch), players, credit, frames: 48 });
  // Every cell startNewGame and its callees write, dirtied first (else a skipped wipe or reseed of a cell
  // already holding its seed value is silent). [base, length]; the difficulty indices get 1 (read as a
  // table index before they are zeroed), HOLD_FLAG 1 (its live nonzero value).
  const dirty = (credit) => (mem) => {
    cr(credit)(mem);
    for (const [lo, n] of [[FROG_X, 0x20], [ACTIVE_LANE_PARAM_BLOCK, 0x21], [SOUND_QUEUE_COUNT, 0x30],
      [PLAYER_WORK_SCRATCH_8420, 0x0e], [SPRITE_OBJECT_RECORD_A_P1, 0x50], [WORK_PAGE_SAVE_BANK, 0x200], [VRAM_BASE, 0x400],
      [loc_803d, 1], [loc_8071, 1], [PLAYER_START_DEMO_FLAG, 1], [INPLAY_COUNTDOWN_WORD, 2], [NUM_PLAYERS, 1],
      [SOUND_SEQUENCE_COUNTDOWN, 2], [LIVES_COUNT, 1], [PLAYER1_LIVES, 2], [FROG_TIMER_A, 2], [TIME_REMAINING_P1, 2],
      [PLAYER1_EXTRA_LIFE_AWARDED, 2], [PLAYER2_SCORE, 2], [PLAYER1_SCORE, 2], [ACTIVE_PLAYER, 1], [HOME_COLUMN_STATE, 1],
    ]) for (let a = lo; a < lo + n; a++) mem[a] = 0x5a;
    mem[PLAYER1_DIFFICULTY_INDEX] = 1; mem[PLAYER1_DIFFICULTY_INDEX + 1] = 1; mem[HOLD_FLAG] = 1;
  };
  for (const [name, bits, players] of [["START1 dirty", S1, 1], ["START2 dirty", S2, 2]]) {
    CRAFT.push({ name, src: post, base: 0, tape: press(bits), poke: dirty(2), players, frames: 48 });
  }
  // Mode 1, slideshow gate 0x83d8 open, a credit, dirty frog block, board-init guard 0x83ba clear: the
  // head must NOT run the mode dispatcher (it would init the board).
  const mode1 = REAL.find((a) => a.src.mem8[GAME_MODE] === 1).src;
  CRAFT.push({ name: "mode 1 gate open", src: mode1, base: 0, tape: null, players: 0, poke: (mem) => {
    mem[0x83d8] = 0; mem[CREDIT_BCD] = 1; mem[0x83ba] = 0;
    for (let a = 0x8044; a < 0x8064; a++) mem[a] = 0x5a;
  } });
}

test("HARNESS: arms captured; boundaries reached; the arms span the head, tail and start branches", { skip }, () => {
  const modes = new Set(REAL.map((a) => a.src.mem8[GAME_MODE]));
  for (const g of [0, 1, 2, 3, 4, 5]) assert.ok(modes.has(g), `no real arm in GAME_MODE ${g}`);
  assert.ok(REAL.some((a) => a.src.mem8[PLAY_FLAG] === 2) && REAL.some((a) => a.src.mem8[PLAY_FLAG] === 1), "no in-play arm");
  for (const a of CRAFT) {
    const { m } = runOracle(a, a.frames ?? F);
    assert.equal(m.mem8[PLAY_FLAG], a.players, `${a.name}: oracle start outcome (PLAY_FLAG) not as expected`);
    if (a.players) assert.equal(m.mem8[NUM_PLAYERS], a.players, `${a.name}: oracle NUM_PLAYERS`);
  }
  const bcd = runOracle(CRAFT.find((a) => a.name === "START2 BCD 10"), 1).m;
  assert.equal(bcd.mem8[CREDIT_BCD], 0x08, "positive control: BCD 0x10 - 2 must daa to 0x08");
  console.log(`  HARNESS: ${REAL.length} real + ${CRAFT.length} crafted arms`);
});

test("EQUAL: generator == oracle loop, per frame over RAM (stack masked), SP and port log", { skip }, () => {
  for (const a of [...REAL, ...CRAFT]) assert.equal(diff(a, cand, a.frames ?? F), null);
  console.log("  EQUAL: every real and crafted arm matches every frame");
});

// Broken twins built on the shipped pass body.
function* onePass(m) { let e = MAIN_LOOP_HEAD; for (;;) { e = runOneForegroundPass(m, e); yield; } }
function* headEachFrame(m) { for (;;) { runOneForegroundPass(m, runOneForegroundPass(m, MAIN_LOOP_HEAD)); yield; } }
function* threePasses(m) { let e = MAIN_LOOP_HEAD; for (;;) { for (let i = 0; i < 3; i++) e = runOneForegroundPass(m, e); yield; } }
function* stray(m) { m.mem8[0x8123] ^= 0x5a; yield* cand(m); }
function* tailFirst(m) { let e = PACE_TAIL; for (;;) { e = runOneForegroundPass(m, e); e = runOneForegroundPass(m, e); yield; } }
function* spLeak(m) { m.regs.sp -= 2; yield* cand(m); }
// same value as the latch holds, so only the port log can see it
function* extraFlip(m) { m.mem8[0xb810] = m.io.flipX; yield* cand(m); }
function* extraKick(m) { void m.mem8[0x8800]; yield* cand(m); }

test("TEETH: broken twins are caught", { skip }, () => {
  const arm = (n) => REAL.find((a) => a.name === n);
  // onePass: the restart cascade's second pass; threePasses: a third pass moves 0x8019 at a life restart.
  assert.ok(diff(arm("1P@566"), onePass), "one-pass-per-yield twin escaped");
  assert.ok(diff(arm("1P@230"), headEachFrame), "head-every-frame twin escaped");
  assert.ok(diff(arm("1P@722"), threePasses), "three-pass twin escaped");
  assert.ok(diff(arm("attract@900"), stray), "stray-write twin escaped");
  assert.ok(diff(arm("1P@231"), tailFirst), "tail-first twin escaped");
  for (const [name, t] of [["SP-2", spLeak], ["extra flip_x write", extraFlip], ["extra watchdog read", extraKick]]) {
    const b = diff(arm("attract@900"), t);
    assert.ok(b, `${name} twin escaped`);
    console.log(`  TEETH/${name}: ${b}`);
  }
  console.log("  TEETH: one-pass, head-every-frame, three-pass, stray-write, tail-first all caught");
});
