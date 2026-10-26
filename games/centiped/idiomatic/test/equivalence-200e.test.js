// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for loc_200e (ROM 0x200e, the game entry): a generator that seeds the round, draws the
// record field, then becomes mainLoop; it never returns.
// FRAME MODEL / BOUND: as equivalence-2015 -- the four 32V IRQs (serviceFrameIrq, direct call) fire at each
// module yield and at the oracle's `lsr $8a` at 0x2015 on an empty latch; a sentinel at the BEATS-th beat
// stops both sides at the main-loop top.
// ENTRIES: real dispatches -- the oracle reset entry (0x3b04) is run on power-on machines (DSW / EAROM
// variants) and on warm resets of states cloned from a clock-free oracle tape run, and cloned at its
// `jmp $200e`.
// COMPARED: RAM minus STACK_SCRATCH, palette, LS259 latch, POKEY regs, EAROM, RNG reads, watchdog kicks
// (each stamped by beat, exact), and the port log: every other write at 0x0800+ (POKEY, palette, EAROM, the
// 0x1800 IRQ acknowledge, LS259, the ignored ROM-space stores), stamped by beat, exact.
// SP: the module leaves SP as entered (asserted); the oracle's SP equals its entry SP at the bound (asserted;
// measured 0xff: the loop top with no frame open). I flag: the module never touches it (asserted unchanged);
// the oracle's `cli` at 0x2011 leaves it clear (asserted). The clock-free beat fires the IRQs either way.
// No register live-out: 0x200e is reached only by `jmp $200e` (0x3b47) and never returns.
// Run: node --test games/centiped/idiomatic/test/equivalence-200e.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_200e as oracle } from "../../translated/loc_200e.js";
import { loc_3b04 as oracleReset } from "../../translated/loc_3b04.js";
import { loc_200e } from "../loc_200e.js";
import { initRoundState } from "../initRoundState.js";
import { plotRecordFieldColumns } from "../plotRecordFieldColumns.js";
import { mainLoop } from "../mainLoop.js";
import { serviceFrameIrq } from "../serviceFrameIrq.js";
import { Machine } from "../../machine.js";
import { buildRoutines } from "../../routines.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, loc_8a, WATCHDOG } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);
const TAPE = JSON.parse(readFileSync(new URL("../../tapes/coin_start_play.json", import.meta.url), "utf8"));

const TARGET = 0x200e;
const BEAT_PC = 0x2015;
const IRQ_VBLANK = [0, 0, 0, 1];
const IRQ_HANDLER = 0x3871;
const BEATS = 4; // three whole frames past the hand-off
const WARM_AT = [200, 370, 600, 4600]; // attract, credited, in play, after game over (EAROM written)
const BUDGET = 3_000_000;
class Bound extends Error {}
class Spin extends Error {}
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const ROUTINES = ROM_PRESENT ? buildRoutines() : null;
if (ROUTINES) ROUTINES.set(IRQ_HANDLER, serviceFrameIrq);

function rig(m, o) {
  const mem = m.mem, r8 = mem.read8.bind(mem), w8 = mem.write8.bind(mem), st = m.step.bind(m);
  const log = { beats: 0, reads: 0, steps: 0, rng: 0, inBeat: false, ports: [], kicks: [], s0: m.regs.s, i0: m.regs.fI };
  m.io.pokeyRandom = () => { log.rng++; return ((log.beats + 1) * 0x6d + 0x3b) & 0xff; };
  m.routines = o.routines ?? ROUTINES;
  Object.assign(m, { clockFree: true, idiomaticIrq: true, nextIrqCycle: Infinity, nextBoundary: Infinity, maxCycles: Infinity });
  log.beat = () => {
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
  if (b.regs.fI !== lb.i0) return `module changed the I flag`;
  if (a.regs.fI !== false) return `oracle left I set (no cli 0x2011)`;
  if (la.rng !== lb.rng) return `RNG reads ${la.rng} vs ${lb.rng}`;
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

function captureWarm() {
  const out = [];
  const m = new Machine(ROM);
  rig(m, {
    oracleBeat: true, beats: WARM_AT.at(-1) + 1,
    onBeat: (mm, n) => { applyTape(mm, n); if (WARM_AT.includes(n)) out.push({ n, m: mm.clone() }); },
  });
  stopOf(() => oracleReset(m));
  return out;
}

// Run the oracle reset entry on `m` and clone it at its real `jmp $200e`.
function captureAtJump(tag, m) {
  let cap = null;
  const routines = new Map(ROUTINES);
  routines.set(TARGET, (mm) => { cap = mm.clone(); throw new Bound(); });
  rig(m, { routines });
  const stop = stopOf(() => oracleReset(m));
  return { tag, stop, m: cap };
}
function powerOn(dsw1, dsw2, earom) {
  const m = new Machine(ROM);
  if (dsw1 !== undefined) m.io.dsw1 = dsw1;
  if (dsw2 !== undefined) m.io.dsw2 = dsw2;
  if (earom) m.io.earom = earom.clone();
  return m;
}
function entries() {
  const warmCaps = captureWarm();
  const out = [
    captureAtJump("power-on, idle DSW", powerOn()),
    captureAtJump("power-on, DSW1=0x00 DSW2=0xff", powerOn(0x00, 0xff)),
    captureAtJump("power-on, DSW1=0xff", powerOn(0xff)),
    captureAtJump("power-on, DSW1=0x2b DSW2=0x00", powerOn(0x2b, 0x00)),
    captureAtJump("power-on, EAROM holding a played table", powerOn(undefined, undefined, warmCaps.at(-1).m.io.earom)),
  ];
  for (const c of warmCaps) {
    const m = c.m.clone();
    m.io.inputAssert = null; m.regs.s = 0xfd; m.pc = 0x3b04;
    out.push(captureAtJump(`warm reset @${c.n}`, m));
  }
  return out;
}
const ENTRIES = ROM_PRESENT ? entries() : [];

function run(cap, fn) {
  const m = cap.clone();
  if (fn === oracle) {
    const log = rig(m, { oracleBeat: true, beats: BEATS });
    return { m, log, stop: stopOf(() => oracle(m)) };
  }
  const log = rig(m, { beats: BEATS });
  return { m, log, stop: driveGen(fn(m), log) };
}

test("HARNESS: every entry is a real `jmp $200e` dispatch, and the entries differ", () => {
  for (const e of ENTRIES) {
    assert.equal(e.stop, "bound", `${e.tag}: reset entry never jumped to 0x200e (${e.stop})`);
    assert.equal(e.m.pc, TARGET, `${e.tag}: captured off the jump`);
  }
  const fds = new Set(ENTRIES.map((e) => e.m.mem.read8(0xfd)));
  assert.ok(fds.size >= 4, "the DIP snapshot $fd does not vary across entries");
  assert.ok(ENTRIES.some((e) => e.m.mem.paletteRam.some((v) => v !== 0)), "no entry carries a dirty palette");
});

test("EQUAL: loc_200e == oracle 0x200e from every real dispatch, bounded at the same beat", () => {
  for (const e of ENTRIES) {
    const o = run(e.m, oracle), i = run(e.m, loc_200e);
    assert.equal(o.stop, "bound", `${e.tag}: oracle stopped by ${o.stop}`);
    assert.equal(i.stop, "bound", `${e.tag}: module stopped by ${i.stop}`);
    assert.ok(o.log.ports.length > 0, `${e.tag}: oracle wrote no port (port log not hooked)`);
    const d = diff(o.m, i.m, o.log, i.log);
    assert.equal(d, null, `${e.tag}: ${d}`);
  }
  console.log(`  EQUAL: ${ENTRIES.length} real dispatches, ${BEATS - 1} frames past the hand-off`);
});

function* twin(m, opt) {
  if (!opt.noInit) initRoundState(m);
  if (opt.sp) m.regs.s = (m.regs.s - 2) & 0xff;
  if (opt.port) m.mem8[0x1800] = 0; // an extra IRQ acknowledge: no RAM or device state changes
  if (!opt.noField) plotRecordFieldColumns(m);
  if (opt.noDelegate) { mainLoop(m); return; }
  yield* mainLoop(m);
}

test("TEETH: twins that skip the round seed, the field draw, or the yield* delegation, move SP, or add a port write are CAUGHT", () => {
  for (const e of ENTRIES) {
    const o = run(e.m, oracle), i = run(e.m, (m) => twin(m, {}));
    assert.equal(diff(o.m, i.m, o.log, i.log), null, `${e.tag}: faithful twin diverges`);
  }
  for (const opt of [{ noInit: true }, { noField: true }, { noDelegate: true }, { sp: true }, { port: true }]) {
    const caught = ENTRIES.some((e) => {
      const o = run(e.m, oracle), i = run(e.m, (m) => twin(m, opt));
      return i.stop !== "bound" || diff(o.m, i.m, o.log, i.log) !== null;
    });
    assert.ok(caught, `twin ${JSON.stringify(opt)} NOT caught`);
  }
});
