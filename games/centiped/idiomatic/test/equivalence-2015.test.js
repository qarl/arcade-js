// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for mainLoop (ROM 0x2015), the never-returning per-frame generator.
// FRAME MODEL (same hook both sides): the frame beat fires the four 32V IRQs (vblank [0,0,0,1], handler
// serviceFrameIrq, a direct call as on runIdiomaticIrqGame). Idiomatic: at each yield. Oracle: at the
// `lsr $8a` read at 0x2015 while the latch is empty (the spin that would wait for the IRQ).
// BOUND: a sentinel at the BEATS-th beat, before its IRQs, i.e. the loop top on both sides. The module
// drops the ROM's `bcc $2015` re-spin and its IN0 bit5 `beq $2021` spin; EQUAL pins the latch at 0 at
// every yield (so the re-spin is dead on this engine) and HARNESS checks every entry holds the service switch idle.
// ENTRIES: real loop tops cloned from a clock-free oracle boot driven by tapes/coin_start_play.json (attract,
// coin, play, game over with an EAROM write) every STRIDE beats, plus every loop top whose window holds a
// change of $86 (a wave commit), plus crafted pokes on them for arms the tape never reaches (see POKES).
// COMPARED: RAM minus STACK_SCRATCH, palette, LS259 latch, POKEY regs and the POKEY write trace stamped by
// beat (a write a later frame overwrites still counts), EAROM, RNG reads, watchdog kicks (each stamped by
// beat, exact), the I flag, and the port log: every other write at 0x0800+ (POKEY, palette, EAROM, the 0x1800
// IRQ acknowledge, LS259), stamped by beat, exact.
// SP: the module leaves SP as entered (asserted); the oracle's SP equals its entry SP at the bound (asserted;
// measured 0xff: the loop top with no frame open).
// No register live-out: nothing returns from 0x2015 (only `jmp $2015`/fall-through from 0x200e).
// Run: node --test games/centiped/idiomatic/test/equivalence-2015.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2015 as oracle } from "../../translated/loc_2015.js";
import { loc_3b04 as oracleBoot } from "../../translated/loc_3b04.js";
import { mainLoop } from "../mainLoop.js";
import { serviceFrameIrq } from "../serviceFrameIrq.js";
import { loc_2561 } from "../loc_2561.js";
import { updateSoundChannels } from "../updateSoundChannels.js";
import { loc_2741 } from "../loc_2741.js";
import { tickEaromWriteback } from "../tickEaromWriteback.js";
import { loc_2119 } from "../loc_2119.js";
import { plotObjectCoordinates } from "../plotObjectCoordinates.js";
import { beginCentipedeSegmentSweep } from "../beginCentipedeSegmentSweep.js";
import { serviceTimerBank } from "../serviceTimerBank.js";
import { loc_2ace } from "../loc_2ace.js";
import { advanceColumnHeadingState } from "../advanceColumnHeadingState.js";
import { stepHeadSegment } from "../stepHeadSegment.js";
import { spawnActorOnTimer } from "../spawnActorOnTimer.js";
import { steerHeadAndSeedVelocity } from "../steerHeadAndSeedVelocity.js";
import { loc_2059 } from "../loc_2059.js";
import { advanceDeathRespawnSequence } from "../advanceDeathRespawnSequence.js";
import { scanForRangedCellAndSeed } from "../scanForRangedCellAndSeed.js";
import { Machine } from "../../machine.js";
import { buildRoutines } from "../../routines.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, loc_8a, WATCHDOG, IN0 } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);
const TAPE = JSON.parse(readFileSync(new URL("../../tapes/coin_start_play.json", import.meta.url), "utf8"));

const BEAT_PC = 0x2015;
const IRQ_VBLANK = [0, 0, 0, 1];
const IRQ_HANDLER = 0x3871; // the 0x3ffe vector target
const BEATS = 5; // four whole frames, stopped at the fifth loop top
const CAPTURE_FRAMES = 6000;
const STRIDE = 25;
const BUDGET = 3_000_000; // reads / steps per beat before a run counts as a spin
class Bound extends Error {}
class Spin extends Error {}
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const ROUTINES = ROM_PRESENT ? buildRoutines() : null;
if (ROUTINES) ROUTINES.set(IRQ_HANDLER, serviceFrameIrq);

function rig(m, o) {
  const mem = m.mem, r8 = mem.read8.bind(mem), w8 = mem.write8.bind(mem), st = m.step.bind(m);
  const log = { beats: 0, reads: 0, steps: 0, rng: 0, inBeat: false, at8a: [], trace: [], ports: [], kicks: [], s0: m.regs.s };
  // RNG pinned per beat: constant within a frame (the routine's `$100a ^ $100a` check stays 0, as on the
  // frozen-clock engine), varied across frames; the read COUNT is compared.
  m.io.pokeyRandom = () => { log.rng++; return ((log.beats + 1) * 0x6d + 0x3b) & 0xff; };
  m.routines = o.routines ?? ROUTINES;
  Object.assign(m, { clockFree: true, idiomaticIrq: true, nextIrqCycle: Infinity, nextBoundary: Infinity, maxCycles: Infinity });
  log.beat = () => {
    log.at8a.push(r8(loc_8a));
    log.beats++; log.reads = 0; log.steps = 0;
    if (o.onBeat) o.onBeat(m, log.beats);
    if (log.beats === o.beats) throw new Bound();
    log.inBeat = true;
    try {
      for (const vb of IRQ_VBLANK) { m.io.vblank = vb; m.pcKnown = true; m.fireIrq(); }
      m.io.vblank = 0;
    } finally { log.inBeat = false; }
  };
  mem.read8 = (a) => {
    a &= 0xffff;
    if (++log.reads > BUDGET) throw new Spin();
    if (o.oracleBeat && !log.inBeat && a === loc_8a && m.pc === BEAT_PC && r8(loc_8a) === 0) log.beat();
    return r8(a);
  };
  mem.write8 = (a, v) => {
    a &= 0xffff;
    if ((a & 0xfff0) === 0x1000) log.trace.push(`${log.beats}:${a & 15}=${v & 0xff}`);
    if (a === WATCHDOG) log.kicks.push(log.beats);
    else if (a >= 0x0800) log.ports.push(`${log.beats}:${hx(a)}=${v & 0xff}`);
    return w8(a, v);
  };
  m.step = (n, c) => { if (++log.steps > BUDGET) throw new Spin(); st(n, c); };
  return log;
}

function stopOf(fn) {
  try { fn(); return "returned"; } catch (e) {
    if (e instanceof Bound) return "bound";
    if (e instanceof Spin) return "spin";
    throw e;
  }
}
const driveGen = (gen, log) => stopOf(() => { for (;;) { if (gen.next().done) return; log.beat(); } });

const inDeadStack = (a) => a != null && a >= STACK_SCRATCH.lo && a < STACK_SCRATCH.hi;
function diff(a, b, la, lb) {
  if (b.regs.s !== lb.s0) return `module moved SP ${hx(lb.s0)} -> ${hx(b.regs.s)}`;
  if (a.regs.s !== la.s0) return `oracle SP ${hx(la.s0)} -> ${hx(a.regs.s)}`;
  const d = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off), inDeadStack);
  if (d) return `RAM ${hx(d.addr)}: oracle=${d.a} module=${d.b}`;
  const dev = [
    ["palette", a.mem.paletteRam, b.mem.paletteRam], ["latch", a.io.latch, b.io.latch],
    ["pokey", a.io.pokeyReg, b.io.pokeyReg], ["earom", a.io.earom.cells, b.io.earom.cells],
  ];
  for (const [k, x, y] of dev) for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return `${k}[${i}]: ${x[i]} vs ${y[i]}`;
  if (a.mem.watchdogKicks !== b.mem.watchdogKicks) return `watchdog kicks ${a.mem.watchdogKicks} vs ${b.mem.watchdogKicks}`;
  if (la.kicks.join() !== lb.kicks.join()) return `watchdog kick beats ${la.kicks} vs ${lb.kicks}`;
  if (a.regs.fI !== b.regs.fI) return `I flag ${a.regs.fI} vs ${b.regs.fI}`;
  if (la.rng !== lb.rng) return `RNG reads ${la.rng} vs ${lb.rng}`;
  if (la.trace.join() !== lb.trace.join()) return `POKEY trace ${la.trace.length} vs ${lb.trace.length}`;
  if (la.ports.join() !== lb.ports.join()) return `port log ${la.ports.length} vs ${lb.ports.length}`;
  return null;
}

function applyTape(mm, f) {
  const bits = {};
  for (const t of TAPE) {
    if (!(f >= t.frame && (t.dur == null || f < t.frame + t.dur))) continue;
    if (t.track) mm.io.applyTrackball(t.track[0], t.track[1]);
    else bits[t.port] = (bits[t.port] || 0) | t.bits;
  }
  mm.io.inputAssert = bits;
}

// Clone the clock-free oracle at its loop top (pre-IRQ) every STRIDE beats along the tape, and at every
// loop top whose BEATS-1 frames hold a change of $86 (the last BEATS-1 loop tops, kept in a ring).
function captureEntries() {
  const caps = [], ring = [];
  const m = new Machine(ROM);
  let last86 = null;
  const log = rig(m, {
    oracleBeat: true, beats: CAPTURE_FRAMES,
    onBeat: (mm, n) => {
      applyTape(mm, n);
      const c = { n, m: mm.clone() }, v = mm.mem.read8(0x86);
      ring.push(c); if (ring.length > BEATS) ring.shift();
      if (last86 !== null && v !== last86) for (const r of ring.slice(0, -1)) if (!caps.includes(r)) caps.push(r);
      last86 = v;
      if (n % STRIDE === 0) caps.push(c);
    },
  });
  const stop = stopOf(() => oracleBoot(m));
  return { caps, stop, log, end: m };
}
const CAP = ROM_PRESENT ? captureEntries() : null;

// Crafted arms on real captured loop tops (pokes identical both sides): the spawn gate's skip exit (the
// equivalence-2741 N-tooth pokes) and the post-death field scan (pointer live, frame counter about to hit 8,
// one damaged-mushroom cell in range), a live flea in its descent / velocity-commit bands (the equivalence-
// 2059 seeds), and four arms that order the tail: segTimer ($6b=0: the sweep arms a $34+x countdown the timer
// bank then steps), counter43 ($43=0x0f: the timer bank steps it across its &0xaf test before 0x2ace reads it),
// headSpawn and fleaSteer (inputs on which stepHeadSegment/spawnActorOnTimer and steerHeadAndSeedVelocity/
// loc_2059 see each other's writes); the tape reaches none of them.
const POKES = {
  fleaDescent: { 0x43: 0, 0x40: 0x10, 0xef: 0, 0x70: 0x40, 0xf0: 0, 0x80: 0x02, 0x60: 0x30 },
  fleaCommit: { 0x43: 0, 0x40: 0x31, 0xef: 0, 0x70: 0x40, 0xf0: 0, 0x80: 0x02, 0x60: 0x30 },
  fieldScan: { 0x00: 7, 0xb7: 0, 0xda: 0x00, 0xdb: 0x04, 0x0410: 0x38 },
  idleKick: { 0xc1: 0, 0xc2: 0, 0xee: 0x80, 0xef: 0 },
  respawn: { 0xc1: 0, 0xc2: 0, 0xee: 0x80, 0xef: 0, 0x9a: 0x0c, 0xc0: 2 },
  objectTail: { 0xc1: 1, 0xc2: 1, 0x9a: 0, 0x01: 5, 0x00: 0, 0xb9: 0x10 },
  segTimer: { 0x6b: 0 },
  headSpawn: { 0x64: 0, 0x95: 0, 0x76d: 0x40 },
  fleaSteer: { 0x40: 0x40, 0x9b: 0 },
  counter43: { 0x43: 0x0f, 0x00: 0 },
};
function entries() {
  const out = CAP.caps.map((c) => ({ tag: `real@${c.n}`, m: c.m }));
  CAP.caps.filter((_, i) => i % 8 === 0).forEach((c) => {
    for (const [k, poke] of Object.entries(POKES)) {
      const m = c.m.clone();
      for (const [a, v] of Object.entries(poke)) m.mem.write8(Number(a), v);
      out.push({ tag: `${k}@${c.n}`, m });
    }
  });
  return out;
}
const ENTRIES = ROM_PRESENT ? entries() : null;

// Tally oracle dispatches of the spawn gate (0x2741) and the first tail callee (0x3ac0).
function countingRoutines(tally) {
  const r = new Map(ROUTINES);
  for (const a of [0x2741, 0x3ac0]) { const f = r.get(a); r.set(a, (mm) => { tally[a] = (tally[a] || 0) + 1; return f(mm); }); }
  return r;
}
function replay(cap, which, fn = mainLoop, tally) {
  const m = cap.clone();
  if (which === "oracle") {
    const log = rig(m, { oracleBeat: true, beats: BEATS, routines: tally ? countingRoutines(tally) : ROUTINES });
    return { m, log, stop: stopOf(() => oracle(m)) };
  }
  const log = rig(m, { beats: BEATS });
  return { m, log, stop: driveGen(fn(m), log) };
}

test("HARNESS: the capture boots, banks a coin, reaches play, and every loop top has an empty latch", () => {
  assert.equal(CAP.stop, "bound", `capture stopped by ${CAP.stop}`);
  assert.ok(CAP.caps.length >= 100, `only ${CAP.caps.length} entries`);
  assert.ok(CAP.caps.some((c) => c.m.mem.read8(0xc8) >= 1), "no entry holds a banked credit");
  assert.ok(CAP.caps.some((c) => c.m.mem.read8(0x89) === 1), "no entry is in a live 1P game");
  assert.ok(CAP.caps.some((c) => c.m.mem.read8(0x89) === 0 && c.n > 60), "no attract entry");
  assert.ok(CAP.caps.some((c) => c.m.io.earom.cells.some((v) => v !== 0xff)), "no entry after an EAROM write");
  assert.ok(CAP.caps.some((c) => c.m.mem.read8(0x86) === 0xff && c.n % STRIDE !== 0), "no entry just before a wave commit");
  for (const c of CAP.caps) assert.equal(c.m.pc, BEAT_PC, `entry ${c.n} not at the loop top`);
  for (const e of ENTRIES) assert.ok(e.m.mem.read8(IN0) & 0x20, `${e.tag}: service switch held`);
});

test("EQUAL: mainLoop == oracle 0x2015 from every captured loop top, bounded at the same beat", () => {
  const tally = {};
  for (const e of ENTRIES) {
    const o = replay(e.m, "oracle", undefined, tally), i = replay(e.m, "module");
    assert.equal(o.stop, "bound", `${e.tag}: oracle stopped by ${o.stop}`);
    assert.equal(i.stop, "bound", `${e.tag}: module stopped by ${i.stop}`);
    assert.deepEqual(i.log.at8a, [0, 0, 0, 0, 0], `${e.tag}: latch not empty at a module yield`);
    assert.ok(o.log.ports.length > 0, `${e.tag}: oracle wrote no port (port log not hooked)`);
    const d = diff(o.m, i.m, o.log, i.log);
    assert.equal(d, null, `${e.tag}: ${d}`);
  }
  // Both arms of the `bpl $2015` spawn gate ran: some frames skip the tail, some run it.
  const gate = tally[0x2741] || 0, tail = tally[0x3ac0] || 0;
  assert.ok(tail > 0 && tail < gate, `spawn-gate arms not both reached (gate=${gate}, tail=${tail})`);
  console.log(`  EQUAL: ${ENTRIES.length} entries x ${BEATS - 1} frames; gate ${gate}, tail ${tail}`);
});

// A parameterised copy of the loop for the broken twins.
function* twin(m, opt) {
  const { mem8 } = m;
  for (;;) {
    yield;
    if (!opt.noLsr) mem8[loc_8a] = mem8[loc_8a] >> 1;
    mem8[WATCHDOG] = mem8[IN0];
    if (opt.swapSound) { updateSoundChannels(m); loc_2561(m); } else { loc_2561(m); updateSoundChannels(m); }
    if (!loc_2741(m) && !opt.noGate) continue;
    if (opt.sp) m.regs.s = (m.regs.s - 2) & 0xff;
    if (opt.port) mem8[0x1800] = 0; // an extra IRQ acknowledge: no RAM or device state changes
    const tail = [...TAIL];
    if (opt.swap) { const k = tail.indexOf(opt.swap); [tail[k], tail[k + 1]] = [tail[k + 1], tail[k]]; }
    for (const f of tail) if (!(opt.noScan && f === scanForRangedCellAndSeed)) f(m);
  }
}
const TAIL = [
  tickEaromWriteback, loc_2119, plotObjectCoordinates, beginCentipedeSegmentSweep, serviceTimerBank, loc_2ace,
  advanceColumnHeadingState, stepHeadSegment, spawnActorOnTimer, steerHeadAndSeedVelocity, loc_2059,
  advanceDeathRespawnSequence, scanForRangedCellAndSeed,
];

test("TEETH: broken twins (no heartbeat shift, gate ignored, last callee dropped, sound before 0x2561, tail pairs swapped, SP-2, an extra port write) are CAUGHT", () => {
  const exact = ENTRIES.every((c) => {
    const o = replay(c.m, "oracle"), i = replay(c.m, "twin", (m) => twin(m, {}));
    return diff(o.m, i.m, o.log, i.log) === null;
  });
  assert.ok(exact, "the faithful twin itself diverges: twin harness broken");
  const swaps = [beginCentipedeSegmentSweep, serviceTimerBank, stepHeadSegment, steerHeadAndSeedVelocity].map((swap) => ({ swap }));
  for (const opt of [{ noLsr: true }, { noGate: true }, { noScan: true }, { swapSound: true }, ...swaps, { sp: true }, { port: true }]) {
    const caught = ENTRIES.some((c) => {
      const o = replay(c.m, "oracle"), i = replay(c.m, "twin", (m) => twin(m, opt));
      return i.stop !== "bound" || diff(o.m, i.m, o.log, i.log) !== null || i.log.at8a.some((v) => v !== 0);
    });
    assert.ok(caught, `broken twin ${opt.swap ? `swap ${opt.swap.name}` : JSON.stringify(opt)} NOT caught`);
  }
});
