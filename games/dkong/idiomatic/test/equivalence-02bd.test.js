// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for mainLoop (ROM 0x02BD), a never-returning generator.
 *
 * PASSES. The loop carries no register across passes (0x02BD reloads H, A, L from RAM), so a
 * pass is the unit: one idiomatic `.next()` (each path ends in its yield) == one oracle trip
 * from loop top (`step(0x02bf)`) to the next. Per pass the gate compares RAM − the stack scratch below the entry SP,
 * the io latches, the port log (every latch/DMA write and IN2 read = watchdog kick, in program order,
 * the service's own excluded; compared exactly), and SP (oracle balanced at its entry SP, idiomatic
 * inert). The bound is the pass count.
 * FRAME TICK: between passes ONE service, identical on both sides: the oracle engine's NMI
 * (push PC 0x02BD, translated 0x0066; mask-gated as tick() gates it). The idiomatic NMI needs
 * the full override map, which would also rewire the oracle's callees. Schedules: "engine"
 * services every pass (runIdiomaticGame's cadence); "spin" every third, so the frame-unchanged
 * arm runs. A generator pass reading TASK_HEAD > GUARD times has lost its yield: a breach.
 * ENTRIES: the real boot fall-through, plus real loop-top states captured in a stock attract
 * run and a coin+start run (first per arm/opcode, then one per 100 frames per arm). CRAFTED on real
 * loop-top states: task byte 0x80 at the head (bit 7 set, bit 6 clear: the mask constant has teeth),
 * FRAME_SEEN = FRAME ^ 0x80 (the full-byte compare has teeth), and P1's score at the DIP bonus-life
 * threshold with the award still open (the award fires inside the window). Also every real dispatch
 * entry with a credited game (ATTRACT bit 0 clear), with FRAME poked to 0x10 and to 0x20: the
 * player-up redraw acts only on such frames, which no real dispatch entry lands on.
 * LIVE-OUT: none — loc_02bd is reached only by the 0x02BC fall-through and never returns.
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { Machine } from "../../machine.js";
import { bootOnly } from "../../translated/bootOnly.js";
import { loc_02bd as oracle } from "../../translated/loc_02bd.js";
import { mainLoop } from "../mainLoop.js";
import { loc_02e3 } from "../loc_02e3.js";
import { rampDifficulty } from "../rampDifficulty.js";
import { awardBonusLifeAtThreshold } from "../awardBonusLifeAtThreshold.js";
import { animateFixedHazardAndReleaseFire } from "../animateFixedHazardAndReleaseFire.js";
import { redrawPlayerUpIndicator } from "../redrawPlayerUpIndicator.js";
import {
  ATTRACT, FRAME, FRAME_SEEN, SPIN_COUNT, STACK_SCRATCH, TASK_HEAD, WORK_RAM_BASE,
  BONUS_LIFE_AWARDED, CURRENT_PLAYER, DIP_BONUS_LIFE, LIVES, P1_SCORE,
} from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_PATH = new URL("../../rom/maincpu.bin", import.meta.url);
const ROM_PRESENT = existsSync(ROM_PATH);
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(ROM_PATH)) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not present at games/dkong/rom/maincpu.bin" }, fn);

const PASSES = 8;
const SCHEDULES = { engine: () => true, spin: (k) => k % 3 === 0 };
const COIN_START_TAPE = [
  { port: 0x7d00, bits: 0x80, frame: 90, dur: 6 },
  { port: 0x7d00, bits: 0x04, frame: 150, dur: 6 },
];
const BOUND = Symbol("mainLoop-bound");
const hx = (v) => "0x" + (v & 0xffff).toString(16);

/** Which arm the next pass takes, read from the pre-pass state. */
function armOf(m) {
  const t = m.mem.read8(WORK_RAM_BASE | m.mem.read8(TASK_HEAD));
  if ((t & 0x80) === 0) return `dispatch:${t}`;
  return m.mem.read8(FRAME) === m.mem.read8(FRAME_SEEN) ? "spin" : "advance";
}

const PORT_WRITES = ["writeSoundLatch3d", "writeSoundLatch6h", "writeAudioIrq", "writeNmiMask", "writeFlipScreen",
  "writeSpriteBank", "writePaletteBank", "writeDmaDrq", "writeGridColor", "writeGridEnable"];
/** Log every latch/DMA write and IN2 read (the watchdog kick) in program order, the service's own excluded. */
function tapPorts(m) {
  const log = [];
  const tap = (obj, k, tag) => {
    const f = obj[k].bind(obj);
    obj[k] = (...a) => { if (!m.inService) log.push(`${tag}(${a})`); return f(...a); };
  };
  for (const k of PORT_WRITES) tap(m.io, k, k);
  tap(m.io.dma, "write", "dma");
  tap(m.io, "readIn2", "kick");
  m.portLog = log;
}

function service(m) {
  m.inService = true;
  try { service0(m); } finally { m.inService = false; }
}
function service0(m) {
  if (!m.io.nmiMask) return;
  const sp = m.regs.sp; // seated at the stack top so the push lands in STACK_SCRATCH, then restored:
  m.regs.sp = STACK_SCRATCH.hi; // the idiomatic boot never seats SP (runbook "Retiring SP")
  m.pc = 0x02bd;
  m.pcKnown = true;
  m.fireNmi();
  m.regs.sp = sp;
}

const GUARD = 4096;
const NO_YIELD = Symbol("no-yield");

function snap(m) {
  const io = m.io;
  return {
    log: m.portLog.join(" "),
    state: Buffer.from(m.dumpState()),
    sp: m.regs.sp,
    io: [io.nmiMask, io.flipScreen, io.spriteBank, io.paletteBank, io.audioIrq, io.soundLatch3d, ...io.latch6h],
  };
}

/** Drive an oracle from `entry` until PASSES loop trips have completed, servicing between them. */
function runOracle(entry, fn, schedule, passes = PASSES) {
  const m = entry.clone();
  tapPorts(m);
  const snaps = [];
  let k = 0;
  const base = m.step.bind(m);
  m.step = (a, c) => {
    base(a, c);
    if (a !== 0x02bf) return;
    if (k > 0) {
      snaps.push(snap(m));
      if (snaps.length >= passes) throw BOUND;
      if (schedule(k)) service(m);
    }
    k++;
  };
  try { fn(m); } catch (e) { if (e !== BOUND) return { snaps, fault: String(e.message) }; }
  return { snaps, fault: null };
}

/** Drive a generator from `entry` for PASSES `.next()`s with the same service between them. */
function runGenerator(entry, gen, schedule, passes = PASSES) {
  const m = entry.clone();
  tapPorts(m);
  const g = gen(m);
  const snaps = [];
  const read8 = m.mem.read8.bind(m.mem);
  let reads = 0;
  m.mem.read8 = (a) => {
    if (a === TASK_HEAD && ++reads > GUARD) throw NO_YIELD;
    return read8(a);
  };
  for (let k = 1; k <= passes; k++) {
    reads = 0;
    try {
      if (g.next().done) return { snaps, early: `returned at pass ${k}` };
    } catch (e) {
      return { snaps, early: e === NO_YIELD ? `no yield within pass ${k}` : `fault: ${e.message}` };
    }
    snaps.push(snap(m));
    if (k < passes && schedule(k)) service(m);
  }
  return { snaps, early: null };
}

/** First breach between the two pass traces, or null. */
function breach(entry, oracleRun, cand) {
  const dead = deadStackBelow(STACK_SCRATCH, entry.regs.sp); // each pass starts at the loop head with entry SP
  if (oracleRun.fault) return `oracle fault: ${oracleRun.fault}`;
  if (cand.early !== null) return `generator ${cand.early}`;
  const os = oracleRun.snaps;
  for (let p = 0; p < os.length; p++) {
    const o = os[p], c = cand.snaps[p];
    for (let i = 0; i < o.state.length; i++) {
      if (o.state[i] === c.state[i]) continue;
      const addr = entry.stateOffsetToAddr(i);
      if (!dead(addr)) return `pass ${p + 1} RAM@${hx(addr)} oracle=${o.state[i]} cand=${c.state[i]}`;
    }
    if (o.log !== c.log) return `pass ${p + 1} port log oracle=[${o.log}] cand=[${c.log}]`;
    const io = o.io.findIndex((v, i) => v !== c.io[i]);
    if (io >= 0) return `pass ${p + 1} io[${io}] oracle=${o.io[io]} cand=${c.io[io]}`;
    if (o.sp !== entry.regs.sp) return `pass ${p + 1} oracle SP unbalanced ${hx(o.sp)}`;
    if (c.sp !== entry.regs.sp) return `pass ${p + 1} cand SP moved ${hx(c.sp)}`;
  }
  return null;
}

function capture(frames, tape) {
  const kept = [];
  const seen = new Set();
  const m = new Machine(ROM);
  if (tape) m.inputTape = tape;
  const base = m.step.bind(m);
  m.step = (a, c) => {
    base(a, c);
    if (a !== 0x02bf) return;
    const arm = armOf(m);
    const key = `${arm}@${Math.floor(m.frames.length / 100)}`;
    if (!seen.has(arm) || !seen.has(key)) kept.push({ arm, state: m.clone() });
    seen.add(arm).add(key);
  };
  m.runFrames(frames);
  return kept;
}

function bootEntry() {
  const m = new Machine(ROM).clone();
  bootOnly(m);
  return { arm: armOf(m), state: m.clone() };
}

const REAL = ROM_PRESENT ? [bootEntry(), ...capture(3000, null), ...capture(1200, COIN_START_TAPE)] : [];

/** A real loop-top state of `arm`, cloned, with `poke(mem)` applied. */
function craft(name, arm, poke) {
  const src = REAL.filter((e) => e.arm === arm).at(-1).state.clone();
  poke(src.mem);
  return { arm: `${armOf(src)}:${name}`, state: src };
}
const CRAFTED = ROM_PRESENT ? [
  craft("head0x80", "advance", (mem) => mem.write8(WORK_RAM_BASE | mem.read8(TASK_HEAD), 0x80)),
  craft("seen^0x80", "spin", (mem) => mem.write8(FRAME_SEEN, mem.read8(FRAME) ^ 0x80)),
  craft("award", "advance", (mem) => {
    const dip = mem.read8(DIP_BONUS_LIFE);
    mem.write8(CURRENT_PLAYER, 0);
    mem.write8(BONUS_LIFE_AWARDED, 0);
    mem.write8(P1_SCORE + 1, (dip & 0x0f) << 4);
    mem.write8(P1_SCORE + 2, dip >> 4);
  }),
] : [];
const DISPATCH_FRAMES = REAL.filter((e) => e.arm.startsWith("dispatch") && (e.state.mem.read8(ATTRACT) & 1) === 0)
  .flatMap((e) => [0x10, 0x20].map((f) => {
    const s = e.state.clone();
    s.mem.write8(FRAME, f);
    return { arm: `${armOf(s)}:frame${hx(f)}`, state: s };
  }));
const ENTRIES = [...REAL, ...CRAFTED, ...DISPATCH_FRAMES];

function breachesOver(gen) {
  const out = [];
  for (const [sname, sch] of Object.entries(SCHEDULES)) {
    for (const e of ENTRIES) {
      const b = breach(e.state, runOracle(e.state, oracle, sch), runGenerator(e.state, gen, sch));
      if (b) out.push(`${sname}/${e.arm}: ${b}`);
    }
  }
  return out;
}

test("EQUAL: mainLoop == loc_02bd pass-for-pass over real and crafted entries, both schedules", () => {
  const arms = new Set(REAL.map((e) => e.arm.split(":")[0]));
  assert.deepEqual([...arms].sort(), ["advance", "dispatch", "spin"], "an arm has no real entry");
  const b = breachesOver(mainLoop);
  assert.equal(b.length, 0, `${b.length} breach(es): ${b.slice(0, 3).join(" | ")}`);
  const ops = [...new Set(REAL.map((e) => e.arm).filter((a) => a.startsWith("dispatch")))];
  console.log(`  EQUAL: ${REAL.length} real + ${CRAFTED.length + DISPATCH_FRAMES.length} crafted entries x ${PASSES} passes x 2 schedules; dispatch ${ops.join(",")}`);
});

test("CRAFTED: each crafted entry reaches the arm it was built for, on the oracle", () => {
  const [head, seen, award] = CRAFTED;
  assert.equal(head.arm, "advance:head0x80", "task 0x80 at the head must take the non-dispatch arm");
  assert.equal(seen.arm, "advance:seen^0x80", "FRAME != FRAME_SEEN by 0x80 must advance");
  const off = (addr) => { for (let i = 0; ; i++) if (award.state.stateOffsetToAddr(i) === addr) return i; };
  const last = runOracle(award.state, oracle, SCHEDULES.engine).snaps.at(-1).state;
  assert.equal(last[off(BONUS_LIFE_AWARDED)], 1, "non-vacuity: the bonus life was not awarded");
  assert.equal(last[off(LIVES)], award.state.mem.read8(LIVES) + 1, "non-vacuity: LIVES did not go up");
  assert.ok(DISPATCH_FRAMES.length > 0, "no credited-game dispatch entry to craft from");
  for (const e of DISPATCH_FRAMES) assert.match(e.arm, /^dispatch:\d+:frame0x[12]0$/, e.arm);
});

// -- TEETH: broken twins, each a copy of mainLoop with one defect ------------------

function twin(defect) {
  return function* (m) {
    const { mem8 } = m;
    for (;;) {
      const slot = (defect === "slot" ? 0x6100 : WORK_RAM_BASE) | mem8[TASK_HEAD];
      const t = mem8[slot];
      if (defect === "redrawOnDispatch" && (t & 0x80) === 0) redrawPlayerUpIndicator(m);
      if ((t & (defect === "mask" ? 0x04 : defect === "bit6" ? 0x40 : 0x80)) === 0) {
        loc_02e3(m, slot, defect === "double" ? t : (t << 1) & 0xff);
        yield;
        continue;
      }
      if (defect === "swapAward") awardBonusLifeAtThreshold(m);
      if (defect !== "redraw") redrawPlayerUpIndicator(m);
      if (defect !== "swapAward") awardBonusLifeAtThreshold(m);
      mem8[SPIN_COUNT] = mem8[SPIN_COUNT] + (defect === "spin+2" ? 2 : 1);
      const frame = mem8[FRAME];
      if (defect === "frame7f" ? (frame & 0x7f) === (mem8[FRAME_SEEN] & 0x7f) : frame === mem8[FRAME_SEEN]) {
        if (defect !== "spinYield") yield;
        continue;
      }
      if (defect !== "seen") mem8[FRAME_SEEN] = frame;
      if (defect === "swapRamp") animateFixedHazardAndReleaseFire(m);
      rampDifficulty(m);
      if (defect !== "hazard" && defect !== "swapRamp") animateFixedHazardAndReleaseFire(m);
      yield;
    }
  };
}

for (const d of ["slot", "mask", "bit6", "double", "redraw", "spin+2", "spinYield", "seen", "frame7f", "hazard", "redrawOnDispatch"]) {
  test(`TEETH: the '${d}' twin is CAUGHT`, () => {
    const b = breachesOver(twin(d));
    assert.ok(b.length > 0, `the '${d}' twin escaped every entry`);
    console.log(`  TEETH/${d}: ${b.length} breaches, first ${b[0]}`);
  });
}

const WRAPPED = {
  "SP-2": function* (m) { m.regs.sp -= 2; yield* mainLoop(m); },
  // same value as the latch holds, so only the port log can see it
  "extra flip write": function* (m) { m.mem8[0x7d82] = m.io.flipScreen; yield* mainLoop(m); },
  "extra kick": function* (m) { void m.mem8[0x7d00]; yield* mainLoop(m); },
};
for (const [name, gen] of Object.entries(WRAPPED)) {
  test(`TEETH: the '${name}' twin is CAUGHT`, () => {
    const b = breachesOver(gen);
    assert.ok(b.length > 0, `the '${name}' twin escaped every entry`);
    console.log(`  TEETH/${name}: ${b.length} breaches, first ${b[0]}`);
  });
}

test("TEETH: the defect-free twin passes (the twin harness is not the variable)", () => {
  assert.equal(breachesOver(twin(null)).length, 0);
});

// Equivalent by footprint, not missed: the swapped callees touch disjoint cells (redraw: 0x7700-0x7740 /
// 0x74a0-0x74e0 indicator; award: 0x622d, 0x6228, lives/level HUD at +3), (ramp: 0x6380-0x6384;
// hazard: 0x62b8-0x62ba, 0x66a9-a, 0x6a29, 0x63a0), so no input distinguishes either order. The
// "award" crafted entry makes the award fire inside the window, so swapAward is tested live.
test("EQUIVALENT: the disjoint-footprint call reorders pass", () => {
  for (const d of ["swapAward", "swapRamp"]) assert.equal(breachesOver(twin(d)).length, 0, d);
});
