// SPDX-License-Identifier: GPL-3.0-only
/**
 * endForegroundPassAtPaceTail — the pace-tail re-entry, memory-equivalent to the frozen oracle loc_0368.
 * GATE: coroutine re-entry. In the ROM a caller's `jp 0x0368` runs one tail pass (spin, play dispatch or
 * START scan) and then re-enters the loop. In the port the caller returns this module's iterator
 * UNADVANCED and the driver runs the tail next (runOneForegroundPass(m, PACE_TAIL)). So, per entry:
 * oracle loc_0368 runs to its next pass-start (step to 0x0341, or a jp 0x0368), cycle NMI disarmed;
 * the candidate calls the module (must return an iterator, write nothing, and finish on .next() writing
 * nothing — the `function* () {}` stub the sibling spine gates sever 0x0368 with), then runs the tail
 * pass. Compared: RAM (minus stack scratch below the entry SP), the next entry kind (head vs tail), SP (asserted
 * 0x8800 on both sides: the oracle's at its next pass-start, measured balanced; the candidate's after the
 * tail), and the port log: every latch/PPI write (AddressSpace.isHardwareWrite) and every watchdog read
 * (0x8800 mirror) in program order, compared exactly.
 * Live-out: none — loc_0368 never returns; every caller reaches it by a tail jump.
 * Entries: REAL — the oracle's own jp 0x0368 dispatches: in an oracle coin-start run, and on the oracle
 * loop run (after that frame's NMI) from yield states of live idiomatic 1P/2P games, and on 1P live
 * frames 715-725 every one of them (no per-site cap) plus each fall-through into 0x0368 (the game-over
 * pass whose play dispatch writes the flip latches). CRAFTED — the 2P
 * turn-change frame with turn/continue flags poked (reaches 0x04f0/0x0531), and every dispatch with
 * PLAY_FLAG cleared and START/credits poked (the tail's attract arms), each START press again with every
 * cell the new-game seed writes dirtied first. All six jp 0x0368 sites gated.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { makeMachine, romsPresent, STACK_SCRATCH } from "./_harness.js";
import { deadStackBelow } from "../../../../core/equivalence.js";
import { AddressSpace } from "../../../../boards/frogger/memory.js";
import { Machine, resolveAllIdiomatic, withOmittedRet } from "../../machine.js";
import { buildRoutines } from "../../routines.js";
import { runIdiomaticGame } from "../../../../core/frame-stepped.js";
import { loc_0341, loc_0368 as oracle } from "../../translated/loc_0341.js";
import { endForegroundPassAtPaceTail as cand } from "../endForegroundPassAtPaceTail.js";
import { runOneForegroundPass } from "../drainForegroundThenYieldEachVblank.js";
import {
  MAIN_LOOP_HEAD, PACE_TAIL, PLAY_FLAG, CREDIT_BCD, START_LATCH, NUM_PLAYERS, HOLD_FLAG, loc_803d, loc_8071,
  FROG_X, PLAYER_START_DEMO_FLAG, ACTIVE_LANE_PARAM_BLOCK, PLAYER1_DIFFICULTY_INDEX, INPLAY_COUNTDOWN_WORD, SOUND_QUEUE_COUNT,
  SOUND_SEQUENCE_COUNTDOWN, LIVES_COUNT, PLAYER1_LIVES, FROG_TIMER_A, TIME_REMAINING_P1, PLAYER1_EXTRA_LIFE_AWARDED,
  PLAYER2_SCORE, PLAYER1_SCORE, ACTIVE_PLAYER, PLAYER_WORK_SCRATCH_8420, HOME_COLUMN_STATE, SPRITE_OBJECT_RECORD_A_P1,
  WORK_PAGE_SAVE_BANK, VRAM_BASE,
} from "../names.js";

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";
const BOUND = Symbol("0368-bound");
const COIN = 0xe000, IN1 = 0xe002, IN2 = 0xe004;
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const ROUTINES = romsPresent() ? buildRoutines() : null;
const isStart = (a, c) => a === MAIN_LOOP_HEAD || (a === PACE_TAIL && c === 10);

// Wrap m.step: `on(site, a)` at each pass-start, `site` = the pc of the jumping instruction.
function hookStarts(m, on) {
  const step = m.step.bind(m), c0 = m.cycles;
  m.step = (a, c) => {
    const site = m.pc;
    step(a, c);
    if (m.cycles - c0 > 400e6) throw new Error("oracle never reached a pass boundary");
    if (isStart(a, c)) on(site, a);
  };
}

const ENTRIES = [];
const per = new Map();
const sites = new Set();
function keep(m, site, why) {
  const e = m.clone();
  e.routines = ROUTINES; e.regs.sp = 0x8800; e.io.inputAssert = null;
  ENTRIES.push({ name: `${why} site ${hx(site)}`, src: e, site });
  sites.add(site);
}

function tapeOf(bits) {
  const t = [150, 180].map((f) => ({ frame: f, port: COIN, bits: 0x80, dur: 6 }));
  t.push({ frame: 230, port: IN1, bits, dur: 6 });
  for (let f = 340; f < 4000; f += 25) t.push({ frame: f, port: IN2, bits: 0x10, dur: 4 });
  return t;
}

if (romsPresent()) {
  // Oracle coin-start run: every jp 0x0368 after the start (first per site + every 40th).
  const m = makeMachine();
  m.inputTape = [{ frame: 150, port: COIN, bits: 0x80, dur: 6 }, { frame: 230, port: IN1, bits: 0x80, dur: 6 },
    { frame: 340, port: IN2, bits: 0x10, dur: 6 }];
  let n = 0;
  hookStarts(m, (site, a) => { if (a === PACE_TAIL && (!sites.has(site) || ++n % 40 === 0)) keep(m, site, `oracle@${m.frames.length}`); });
  m.runFrames(420);
  // Live idiomatic games: at every yield in play, fire that frame's NMI on a clone and run the oracle
  // loop to its first two pass-starts, keeping its jp 0x0368 dispatches (first per site, then sampled).
  const img = (f) => new Uint8Array(readFileSync(new URL(`../../rom/${f}`, import.meta.url)));
  let p2turn = null;
  for (const [bits, end] of [[0x80, 780], [0x40, 1600]]) {
    const live = await Machine.create(img("maincpu.bin"), { gfx: img("gfx.bin"), proms: img("proms.bin"), overrides: await resolveAllIdiomatic() });
    live.inputTape = tapeOf(bits);
    runIdiomaticGame(live, { nmiReturnPC: PACE_TAIL, maxFrames: end, onFrame: (mm, f) => {
      mm.applyInputs(f);
      if (f < 228) return;
      if (bits === 0x40 && f === 1322) p2turn = mm.clone();
      dispatches(mm, `${bits === 0x80 ? "1P" : "2P"}@${f}`, f % 61 === 0, bits === 0x80 && f >= 715 && f <= 725);
    } });
  }
  // CRAFTED: the 2P turn-change frame with the turn/continue flags poked reaches the remaining sites.
  for (const [fd, c9, ca] of [[2, 0, 0], [2, 1, 0], [1, 0, 1]]) {
    const s = p2turn.clone(); s.mem8[0x83fd] = fd; s.mem8[0x83c9] = c9; s.mem8[0x83ca] = ca;
    dispatches(s, `crafted 2P@1322 83fd=${fd} 83c9=${c9} 83ca=${ca}`, true);
  }
}

// Fire the frame's NMI on a clone, run the oracle loop to its second pass-start, keep its jp 0x0368s.
function dispatches(src, why, sample, all = false) {
  const o = src.clone(); o.routines = ROUTINES; o.regs.sp = 0x8800; o.io.inputAssert = null;
  o.pcKnown = true; o.pc = PACE_TAIL; o.fireNmi();
  let k = 0;
  if (all) { const st = o.step.bind(o); o.step = (a, c) => { if (a === PACE_TAIL && c === 7) { const e = o.clone(); e.routines = ROUTINES; e.io.inputAssert = null; ENTRIES.push({ name: `${why} fall-through`, src: e, site: -1 }); } st(a, c); }; }
  hookStarts(o, (site, a) => {
    const key = `${site}/${o.mem8[PLAY_FLAG]}`, n = per.get(key) ?? 0;
    if (a === PACE_TAIL && (all || n < 2 || (n < 8 && sample))) { per.set(key, n + 1); keep(o, site, why); }
    if (++k === 2) throw BOUND;
  });
  try { loc_0341(o); } catch (e) { if (e !== BOUND) throw e; }
}

const press = (bits, credit, latch = 0) => (mem, io) => {
  mem[PLAY_FLAG] = 0; mem[CREDIT_BCD] = credit; mem[START_LATCH] = latch;
  io.inputAssert = bits ? { [IN1]: bits } : null;
};
// Every cell startNewGame and its callees write, dirtied first (else a skipped wipe or reseed of a cell
// already holding its seed value is silent). [base, length]; the difficulty indices get 1 (read as a
// table index before they are zeroed), HOLD_FLAG 1 (its live nonzero value).
const seeded = (p) => (mem, io) => {
  p(mem, io);
  for (const [lo, n] of [[FROG_X, 0x20], [ACTIVE_LANE_PARAM_BLOCK, 0x21], [SOUND_QUEUE_COUNT, 0x30],
    [PLAYER_WORK_SCRATCH_8420, 0x0e], [SPRITE_OBJECT_RECORD_A_P1, 0x50], [WORK_PAGE_SAVE_BANK, 0x200], [VRAM_BASE, 0x400],
    [loc_803d, 1], [loc_8071, 1], [PLAYER_START_DEMO_FLAG, 1], [INPLAY_COUNTDOWN_WORD, 2], [NUM_PLAYERS, 1],
    [SOUND_SEQUENCE_COUNTDOWN, 2], [LIVES_COUNT, 1], [PLAYER1_LIVES, 2], [FROG_TIMER_A, 2], [TIME_REMAINING_P1, 2],
    [PLAYER1_EXTRA_LIFE_AWARDED, 2], [PLAYER2_SCORE, 2], [PLAYER1_SCORE, 2], [ACTIVE_PLAYER, 1], [HOME_COLUMN_STATE, 1],
  ]) for (let a = lo; a < lo + n; a++) mem[a] = 0x5a;
  mem[PLAYER1_DIFFICULTY_INDEX] = 1; mem[PLAYER1_DIFFICULTY_INDEX + 1] = 1; mem[HOLD_FLAG] = 1;
};
const PRESSES = [["no press", press(0, 1)], ["START1 1cr", press(0x80, 1)], ["START2 1cr", press(0x40, 1)],
  ["START2 2cr", press(0x40, 2)], ["START1 0cr", press(0x80, 0)], ["latched", press(0x80, 1, 1)], ["START2 BCD 10", press(0x40, 0x10)], ["both 2cr", press(0xc0, 2)]];
// Each START craft also runs seeded: the seed must overwrite every dirtied cell exactly as the oracle does.
const CRAFTS = [...PRESSES, ...PRESSES.filter(([n]) => n !== "no press").map(([n, p]) => [`${n} seeded`, seeded(p)])];

function prep(e, poke) { const m = e.src.clone(); if (poke) poke(m.mem8, m.io); hwTap(m); return m; }
function hwTap(m) {
  const log = [], w = m.mem.write8.bind(m.mem), r = m.mem.read8.bind(m.mem);
  m.mem.write8 = (a, v, b) => { if (AddressSpace.isHardwareWrite(a & 0xffff)) log.push(`${hx(a)}=${v & 0xff}`); return w(a, v, b); };
  m.mem.read8 = (a) => { if ((a & 0xf800) === 0x8800) log.push("wd"); return r(a); };
  m.hwLog = log;
}

function runOracle(e, poke) {
  const m = prep(e, poke);
  let next = null;
  hookStarts(m, (site, a) => { next = a; throw BOUND; });
  try { oracle(m); assert.fail("loc_0368 returned"); } catch (x) { if (x !== BOUND) throw x; }
  return { m, next };
}

const same = (A, B, m, floor) => {
  const dead = deadStackBelow(STACK_SCRATCH, floor);
  for (let i = 0; i < A.length; i++) if (A[i] !== B[i] && !dead(m.stateOffsetToAddr(i))) return hx(m.stateOffsetToAddr(i));
  return null;
};

// The port's re-entry: the module's hand-off (inert), then the driver's tail pass.
function runCand(e, poke, fn = cand) {
  const m = prep(e, poke);
  const s0 = m.mem.dumpState();
  const r = fn(m);
  assert.ok(r && typeof r.next === "function" && typeof r.throw === "function", `${e.name}: no iterator hand-off`);
  assert.equal(same(s0, m.mem.dumpState(), m, e.src.regs.sp), null, `${e.name}: the call wrote RAM`);
  assert.equal(r.next().done, true, `${e.name}: the hand-off does not finish at once`);
  assert.equal(same(s0, m.mem.dumpState(), m, e.src.regs.sp), null, `${e.name}: advancing the hand-off wrote RAM`);
  return { m, next: runOneForegroundPass(m, PACE_TAIL) };
}

function diff(e, poke, fn = cand, tail = runCand) {
  const o = runOracle(e, poke);
  let c;
  try { c = tail(e, poke, fn); } catch (x) { if (x instanceof assert.AssertionError) return x.message; throw x; }
  if (o.next !== c.next) return `${e.name}: next entry oracle=${hx(o.next)} cand=${hx(c.next)}`;
  if (o.m.regs.sp !== 0x8800) return `${e.name}: oracle SP ${hx(o.m.regs.sp)} at its next pass-start`;
  if (c.m.regs.sp !== 0x8800) return `${e.name}: candidate moved SP to ${hx(c.m.regs.sp)}`;
  if (o.m.hwLog.join() !== c.m.hwLog.join()) return `${e.name}: port log oracle=[${o.m.hwLog}] cand=[${c.m.hwLog}]`;
  const d = same(o.m.mem.dumpState(), c.m.mem.dumpState(), o.m, e.src.regs.sp);
  return d && `${e.name}: RAM differs at ${d}`;
}

test("HARNESS: dispatches captured from all six jp 0x0368 sites, in 1P and 2P play", { skip }, () => {
  for (const s of [0x454, 0x45e, 0x48c, 0x4f0, 0x531, 0x5d0]) assert.ok(sites.has(s), `jp 0x0368 site ${hx(s)} not reached`);
  assert.ok(ENTRIES.some((e) => e.src.mem8[PLAY_FLAG] === 0) && ENTRIES.some((e) => e.src.mem8[PLAY_FLAG] === 2), "no game-over / 2P entry");
  const kinds = new Set(ENTRIES.flatMap((e) => CRAFTS.map(([, p]) => runOracle(e, p).next)));
  assert.ok(kinds.has(MAIN_LOOP_HEAD) && kinds.has(PACE_TAIL), "the crafted arms do not reach both re-entry kinds");
  const crafted = ENTRIES.filter((e) => e.name.startsWith("crafted")).length;
  console.log(`  HARNESS: ${ENTRIES.length - crafted} real + ${crafted} crafted dispatches, sites ${[...sites].map(hx).join(" ")}`);
});

test("EQUAL: hand-off + tail pass == oracle loc_0368 to its next pass-start (RAM, next entry, SP, port log)", { skip }, () => {
  for (const e of ENTRIES) {
    assert.equal(diff(e), null);
    for (const [name, p] of CRAFTS) assert.equal(diff(e, p), null, name);
  }
  console.log(`  EQUAL: ${ENTRIES.length} dispatches x (as-is + ${CRAFTS.length} crafted tail arms)`);
});

test("SEAM: the shipped module is the empty-generator stub and passes the seam as an iterator", { skip }, () => {
  assert.equal(withOmittedRet(cand, PACE_TAIL), cand, "a spine generator must pass the seam unwrapped");
  console.log("  SEAM: unwrapped generator");
});

test("TEETH: broken twins are caught", { skip }, () => {
  const e = ENTRIES.find((x) => x.src.mem8[PLAY_FLAG] !== 0);
  const start1 = CRAFTS.find(([n]) => n === "START1 1cr")[1];
  const twins = [
    ["stray write", function* (m) { m.mem8[0x8123] ^= 0x5a; }],
    ["yields", function* () { yield; }],
    ["plain function", () => undefined],
    ["SP-2", function* (m) { m.regs.sp -= 2; }],
    // same value as the latch holds, so only the port log can see it
    ["extra flip_x write", function* (m) { m.mem8[0xb810] = m.io.flipX; }],
    ["extra watchdog read", function* (m) { void m.mem8[0x8800]; }],
  ];
  for (const [name, t] of twins) {
    const b = diff(e, undefined, t);
    assert.ok(b, `${name} twin escaped`);
    console.log(`  TEETH/${name}: ${b}`);
  }
  // A second tail pass in play is idempotent; on a START it re-runs the new-game seed and is heard.
  assert.ok(CRAFTS.some(([n, p]) => n.endsWith("seeded") && runOracle(e, p).m.mem8[PLAY_FLAG] !== 0), "no seeded craft starts a game");
  assert.ok(diff(e, start1, function* (m) { runOneForegroundPass(m, PACE_TAIL); }), "runs-the-tail-itself twin escaped");
  const headInstead = (x, p) => { const m = prep(x, p); return { m, next: runOneForegroundPass(m, MAIN_LOOP_HEAD) }; };
  assert.ok(diff(e, undefined, cand, headInstead), "re-entry-at-the-head twin escaped");
  console.log("  TEETH: stray write, yields, plain function, runs-the-tail-itself, head re-entry all caught");
});
