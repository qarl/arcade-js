// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for coldBootReset (ROM 0x3b04, the reset entry): a generator that never returns.
// NORMAL BOOT (service idle): bounded like equivalence-2015 -- the frame beat fires the four 32V IRQs
// (serviceFrameIrq, direct call) at each module yield / at the oracle's `lsr $8a` at 0x2015 on an empty
// latch; a sentinel at the BEATS-th beat stops both sides at the main-loop top.
// SELF-TEST (service held): no yield. One IN0 hook on both sides toggles the vblank bit per read (the
// beep pacing's only clock); a sentinel throws at the K-th IN0 read; K comes from the oracle run.
// IRQS (self-test): the beat (A/X/Y/P restored, as the handler and RTI do) fires only where the ROM has
// interrupts enabled: in the glyph arm's `cli` 0x3c52..`sei` 0x3c6a window on every 2nd IN0/IN1 read (the
// window's port-read counts come from the oracle), and on the checksum screen (after `cli` 0x3d56) at each
// read of an empty $8a, the wait at 0x3d57, as equivalence-2015 does at 0x2015. The beep arms run with I set.
// ENTRIES: the reset vector's real dispatch on power-on machines (DSW / EAROM variants) and on warm
// (watchdog) resets of states cloned from a clock-free oracle tape run; crafted RAM faults (one read hook,
// identical both sides) for the march-error beepers.
// COMPARED: RAM (normal boot: minus STACK_SCRATCH; self-test: all of it), palette, LS259 latch, POKEY regs
// (self-test: the POKEY write trace stamped by IN0-read count), EAROM, RNG reads, watchdog kicks (every kick,
// stamped by beat and IN0 read, exact), and the port log: every other write at 0x0800+ (POKEY, palette, EAROM,
// the 0x1800 IRQ acknowledge, LS259, the ignored `sta $2400`), stamped the same way, exact. A page-1 cell the
// oracle pushed to is compared by its shadow: the last value a plain (non-push) store left there, on both sides.
// SP: the module leaves SP untouched (asserted). The oracle's SP is asserted: 0xff (0x3b05 `ldx #$ff`, 0x3b07
// `txs`), except 0x00 on the checksum arms, whose pass at 0x3d57 reuses S as a row counter (measured).
// I flag: the module never touches it (asserted unchanged). The oracle's is asserted from its last cli/sei:
// clear past `cli` 0x2011 (normal boot), 0x3c52 (glyph wait) or 0x3d56 (checksum); set past `sei` 0x3c6a.
// No register live-out: the reset vector is entered by hardware and nothing returns from it.
// Run: node --test games/centiped/idiomatic/test/equivalence-3b04.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_3b04 as oracle } from "../../translated/loc_3b04.js";
import { coldBootReset } from "../coldBootReset.js";
import { serviceFrameIrq } from "../serviceFrameIrq.js";
import { loadHighScoreTableFromEarom } from "../loadHighScoreTableFromEarom.js";
import { validateOrResetHighScores } from "../validateOrResetHighScores.js";
import { loc_200e } from "../loc_200e.js";
import { Machine } from "../../machine.js";
import { buildRoutines } from "../../routines.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, loc_8a, IN0, IN1 } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);
const TAPE = JSON.parse(readFileSync(new URL("../../tapes/coin_start_play.json", import.meta.url), "utf8"));

const BEAT_PC = 0x2015;
const IRQ_VBLANK = [0, 0, 0, 1];
const IRQ_HANDLER = 0x3871;
const BEATS = 3;
const WARM_AT = [200, 370, 600, 4600]; // attract, credited, in play, after game over (EAROM written)
const BUDGET = 3_000_000;
class Bound extends Error {}
class Spin extends Error {}
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const ROUTINES = ROM_PRESENT ? buildRoutines() : null;
if (ROUTINES) ROUTINES.set(IRQ_HANDLER, serviceFrameIrq);

function rig(m, o) {
  const mem = m.mem, r8 = mem.read8.bind(mem), w8 = mem.write8.bind(mem), st = m.step.bind(m);
  const log = { beats: 0, reads: 0, steps: 0, rng: 0, in0: 0, port: 0, r8a: 0, irqs: 0, bc: 0, inBeat: false, trace: [], kicks: [], ports: [], s0: m.regs.s, i0: m.regs.fI };
  m.io.pokeyRandom = () => { log.rng++; return ((log.beats + 1) * 0x6d + 0x3b) & 0xff; };
  m.routines = ROUTINES;
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
  // A self-test IRQ: the same four-IRQ beat, with the CPU registers and the vblank toggle put back.
  const irq = () => {
    const { a, x, y, p } = m.regs, vb = m.io.vblank;
    log.inBeat = true;
    try {
      for (const v of IRQ_VBLANK) { m.io.vblank = v; m.pcKnown = true; m.fireIrq(); }
    } finally { log.inBeat = false; }
    Object.assign(m.regs, { a, x, y, p }); m.io.vblank = vb; log.irqs++;
  };
  const w = o.irq; // the oracle's interrupt windows (kAt fills them while it runs)
  mem.read8 = (a) => {
    a &= 0xffff;
    if (++log.reads > BUDGET) throw new Spin();
    if (o.oracleBeat && !log.inBeat && a === loc_8a && m.pc === BEAT_PC && r8(loc_8a) === 0) log.beat();
    if (o.boundN && a === o.boundAddr && !log.inBeat && ++log.bc === o.boundN) throw new Bound();
    if (w && !log.inBeat) {
      if ((a === IN0 || a === IN1) && ++log.port > (w.cli ?? Infinity) && log.port <= (w.sei ?? Infinity) && (log.port - w.cli) % 2 === 0) irq();
      if (a === loc_8a && ++log.r8a > (w.latch ?? Infinity) && r8(a) === 0) irq();
    }
    if (a === IN0 && o.selfTest && !log.inBeat) {
      log.in0++;
      const v = r8(a);
      m.io.vblank ^= 1;
      return v;
    }
    const v = r8(a);
    return o.fault && a === o.fault.addr ? o.fault.f(v) : v;
  };
  mem.write8 = (a, v) => {
    a &= 0xffff;
    if ((a & 0xfff0) === 0x1000) log.trace.push(`${log.in0}:${a & 15}=${v & 0xff}`);
    if (a === 0x2000) log.kicks.push(`${log.beats}.${log.in0}`);
    else if (a >= 0x0800) log.ports.push(`${log.beats}.${log.in0}:${hx(a)}=${v & 0xff}`);
    return w8(a, v);
  };
  m.step = (n, c) => { if (++log.steps > BUDGET) throw new Spin(); st(n, c); };
  // Stack shadow: page-1 cells written by push8/push16 (the 0x3d57 pass reuses S as a row counter), each
  // shadowed by its last non-push value (raw read at the first push, then every later plain store).
  log.stackW = new Set(); log.shadow = new Map();
  const p8 = m.push8.bind(m);
  m.push8 = (v) => {
    const at = 0x0100 | m.regs.s;
    if (!log.stackW.has(at)) { log.stackW.add(at); log.shadow.set(at, r8(at)); }
    log.inPush = true;
    try { p8(v); } finally { log.inPush = false; }
  };
  const wHook = mem.write8;
  mem.write8 = (a, v) => { if (!log.inPush && log.stackW.has(a & 0xffff)) log.shadow.set(a & 0xffff, v & 0xff); return wHook(a, v); };
  return log;
}

function stopOf(fn) {
  try { fn(); return "returned"; } catch (e) {
    if (e instanceof Bound) return "bound";
    if (e instanceof Spin) return "spin";
    if (/watchdog hang/.test(e.message)) return "hang"; // serviceFrameIrq's $8a >= 8 guard
    throw e;
  }
}
const driveGen = (gen, log) => stopOf(() => { for (;;) { if (gen.next().done) return; log.beat(); } });

const inDeadStack = (a) => a != null && a >= STACK_SCRATCH.lo && a < STACK_SCRATCH.hi;
function diff(a, b, la, lb, selfTest) {
  if (b.regs.s !== lb.s0) return `module moved SP ${hx(lb.s0)} -> ${hx(b.regs.s)}`;
  const oS = selfTest && selfTest.pc === 0x3d57 ? 0x00 : 0xff; // ldx #$ff; txs at 0x3b05; 0x3d57 counts rows in S
  if (a.regs.s !== oS) return `oracle SP ${hx(a.regs.s)}, expected ${hx(oS)}`;
  // I: the module never touches it. The oracle's last cli/sei decides: normal boot ends past `cli` 0x2011.
  if (b.regs.fI !== lb.i0) return "module changed the I flag";
  const w = selfTest ? selfTest.irq : { latch: 0 };
  const oI = w.latch !== undefined || (w.cli !== undefined && w.sei === undefined) ? false : w.sei !== undefined || la.i0;
  if (a.regs.fI !== oI) return `oracle I flag ${a.regs.fI}, expected ${oI}`;
  // Self-test: no STACK_SCRATCH exclusion; only the oracle's pushed cells, compared by shadow below.
  const pushed = (x) => la.stackW.has(x) || lb.stackW.has(x);
  const skip = (x) => (!selfTest && inDeadStack(x)) || pushed(x);
  const d = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off), skip);
  if (d) return `RAM ${hx(d.addr)}: oracle=${d.a} module=${d.b}`;
  const sh = (m, l, x) => (l.stackW.has(x) ? l.shadow.get(x) : m.mem8[x]);
  for (const x of new Set([...la.stackW, ...lb.stackW])) {
    if (!selfTest && inDeadStack(x)) continue;
    if (sh(a, la, x) !== sh(b, lb, x)) return `stack shadow ${hx(x)}: oracle=${sh(a, la, x)} module=${sh(b, lb, x)}`;
  }
  const dev = [
    ["palette", a.mem.paletteRam, b.mem.paletteRam], ["latch", a.io.latch, b.io.latch],
    ["pokey", a.io.pokeyReg, b.io.pokeyReg], ["earom", a.io.earom.cells, b.io.earom.cells],
  ];
  for (const [k, x, y] of dev) for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return `${k}[${i}]: ${x[i]} vs ${y[i]}`;
  if (la.rng !== lb.rng) return `RNG reads ${la.rng} vs ${lb.rng}`;
  if (selfTest) {
    if (la.trace.join() !== lb.trace.join()) return `POKEY trace ${la.trace.length} vs ${lb.trace.length}`;
    if (la.kicks.join() !== lb.kicks.join()) return `kicks ${la.kicks.length} vs ${lb.kicks.length}`;
  }
  if (a.mem.watchdogKicks !== b.mem.watchdogKicks) return `watchdog kicks ${a.mem.watchdogKicks} vs ${b.mem.watchdogKicks}`;
  if (la.kicks.join() !== lb.kicks.join()) return `kick stamps ${la.kicks.length} vs ${lb.kicks.length}`;
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

// Warm-reset entries: machines cloned mid-run from a clock-free oracle tape run (dirty RAM and devices).
function captureWarm() {
  const out = [];
  const m = new Machine(ROM);
  rig(m, {
    oracleBeat: true, beats: WARM_AT.at(-1) + 1,
    onBeat: (mm, n) => { applyTape(mm, n); if (WARM_AT.includes(n)) out.push({ n, m: mm.clone() }); },
  });
  stopOf(() => oracle(m));
  return out;
}
const WARM = ROM_PRESENT ? captureWarm() : [];

// A reset seats the CPU at the vector; a warm reset keeps RAM, devices and the held inputs.
function powerOn({ dsw1, dsw2, in1, earom, service } = {}) {
  const m = new Machine(ROM);
  if (dsw1 !== undefined) m.io.dsw1 = dsw1;
  if (dsw2 !== undefined) m.io.dsw2 = dsw2;
  if (in1 !== undefined) m.io.in1 = in1;
  if (earom) m.io.earom = earom.clone();
  m.io.inputAssert = service ? { 0: 0x20 } : null;
  return m;
}
function warm(c, extra = {}) {
  const m = c.m.clone();
  m.io.inputAssert = extra.service ? { 0: 0x20 } : null;
  if (extra.in1 !== undefined) m.io.in1 = extra.in1;
  m.regs.s = 0xfd; m.pc = 0x3b04;
  return m;
}

const NORMAL = !ROM_PRESENT ? [] : [
  { tag: "power-on, idle DSW", m: () => powerOn() },
  { tag: "power-on, DSW1=0x00 DSW2=0xff", m: () => powerOn({ dsw1: 0x00, dsw2: 0xff }) },
  { tag: "power-on, DSW1=0xff", m: () => powerOn({ dsw1: 0xff }) },
  { tag: "power-on, DSW1=0x2b DSW2=0x00", m: () => powerOn({ dsw1: 0x2b, dsw2: 0x00 }) },
  { tag: "power-on, EAROM holding a played table", m: () => powerOn({ earom: WARM.at(-1).m.io.earom }) },
  ...WARM.map((c) => ({ tag: `warm reset @${c.n}`, m: () => warm(c) })),
  // crafted: reset while the screen is flipped (a cocktail player-2 turn) and the sound chip is live
  { tag: "warm reset @600, flip latch + POKEY dirty", m: () => { const m = warm(WARM[2]); m.io.latch[7] = 1; m.io.pokeyReg.fill(0x5a); return m; } },
];

function runNormal(mk, fn) {
  const m = mk();
  const log = rig(m, fn === oracle ? { oracleBeat: true, beats: BEATS } : { beats: BEATS });
  const stop = fn === oracle ? stopOf(() => oracle(m)) : driveGen(fn(m), log);
  return { m, log, stop };
}

test("HARNESS: the warm captures span attract, credit, play and a written EAROM", () => {
  assert.deepEqual(WARM.map((c) => c.n), WARM_AT);
  assert.equal(WARM[1].m.mem.read8(0xc8), 1, "no credit banked at the credited capture");
  assert.equal(WARM[2].m.mem.read8(0x89), 1, "not in play at the play capture");
  assert.ok([...WARM[3].m.io.earom.cells].some((v) => v !== 0xff), "EAROM never written");
  for (const c of WARM) assert.ok(c.m.mem.read8(0x0420) | c.m.mem.read8(0x0430) | c.m.mem.read8(0x20), "warm RAM not dirty");
});

test("EQUAL (normal boot): coldBootReset == oracle 0x3b04 to the same main-loop beat", () => {
  for (const e of NORMAL) {
    const o = runNormal(e.m, oracle), i = runNormal(e.m, coldBootReset);
    assert.equal(o.stop, "bound", `${e.tag}: oracle stopped by ${o.stop}`);
    assert.equal(i.stop, "bound", `${e.tag}: module stopped by ${i.stop}`);
    assert.equal(i.m.regs.s, e.m().regs.s, `${e.tag}: module moved SP`);
    const d = diff(o.m, i.m, o.log, i.log, false);
    assert.equal(d, null, `${e.tag}: ${d}`);
  }
  console.log(`  EQUAL normal: ${NORMAL.length} entries, ${BEATS - 1} frames past the hand-off`);
});

// ---- self-test (service held) ---------------------------------------------------------------------
// K: the oracle's count of IN0 reads when it first steps to `pc`, plus `past`; same K both sides.
// The same oracle run records the interrupt windows (s.irq) at the first `cli`/`sei` it steps past.
function kAt(s) {
  const m = mkSelf(s)();
  s.irq = {};
  const o = { selfTest: true, boundAddr: IN0, boundN: 200_000, fault: s.fault, irq: s.irq };
  const log = rig(m, o);
  let k = null;
  const st = m.step;
  m.step = (n, c) => {
    if (k === null && n === s.pc) { k = log.bc; o.boundN = k + s.past; }
    if (n === 0x3c53 && s.irq.cli === undefined) s.irq.cli = log.port; // after cli 0x3c52
    if (n === 0x3c6a && s.irq.sei === undefined) s.irq.sei = log.port; // sei 0x3c6a
    if (n === 0x3d57 && s.irq.latch === undefined) s.irq.latch = log.r8a; // after cli 0x3d56
    st(n, c);
  };
  s.kStop = stopOf(() => oracle(m));
  return k === null ? null : k + s.past;
}
// Stuck-bit faults, identical read hook both sides: OR forces a 1 (fails the zero check), AND forces a 0.
const stuck1 = (addr, bit) => ({ addr, f: (v) => v | bit });
const stuck0 = (addr, bit) => ({ addr, f: (v) => v & ~bit });
const IN1_CHECKSUM = 0xff, IN1_NO_CHECKSUM = 0xef, IN1_CONTROL = 0x6f; // bit4: checksum screen; bit7 low: fire
const SELF = !ROM_PRESENT ? [] : [
  { tag: "checksum screen, input passes", in1: IN1_CHECKSUM, pc: 0x3d57, past: 40 },
  { tag: "glyph grid, waiting for a control", in1: IN1_NO_CHECKSUM, pc: 0x3c53, past: 30 },
  { tag: "control seen: fill + review loop", in1: IN1_CONTROL, pc: 0x3c89, past: 30 },
  { tag: "control seen on IN1 bit5 only", in1: 0xcf, pc: 0x3c89, past: 30 },
  { tag: "glyph, IN1 bit0 low only", in1: 0xee, pc: 0x3c53, past: 30 }, // bit0 is not a control
  { tag: "checksum, IN1 bit6 low", in1: 0xbf, pc: 0x3d57, past: 40 }, // bit4 alone picks the checksum screen
  { tag: "zero page stuck-1 bit6 (>=0x10)", in1: IN1_NO_CHECKSUM, fault: stuck1(0x37, 0x40), pc: 0x3c0d, past: 6 },
  { tag: "zero page stuck-1 bit4 (0x10 edge)", in1: IN1_NO_CHECKSUM, fault: stuck1(0x5c, 0x10), pc: 0x3c0d, past: 6 },
  { tag: "page 4 stuck-1 bit3 (page-4 edge, 0x08)", in1: IN1_NO_CHECKSUM, fault: stuck1(0x04a7, 0x08), pc: 0x3c0d, past: 6 },
  { tag: "page 4 stuck-1 bit4 (page carry edge, 0x10)", in1: IN1_NO_CHECKSUM, fault: stuck1(0x0480, 0x10), pc: 0x3c0d, past: 6 },
  { tag: "zero page stuck-1 bit0 (<0x10)", in1: IN1_NO_CHECKSUM, fault: stuck1(0x90, 0x01), pc: 0x3c0d, past: 6 },
  { tag: "zero page stuck-0 bit5 (readback)", in1: IN1_NO_CHECKSUM, fault: stuck0(0xd1, 0x20), pc: 0x3c0d, past: 6 },
  { tag: "page 1 stuck-0 bit1 (low page)", in1: IN1_NO_CHECKSUM, fault: stuck0(0x0123, 0x02), pc: 0x3c0d, past: 6 },
  { tag: "page 5 stuck-1 bit7 at y=0x35", in1: IN1_NO_CHECKSUM, fault: stuck1(0x0535, 0x80), pc: 0x3c0d, past: 6 },
  { tag: "page 7 stuck-0 bit2 at y=0xe9", in1: IN1_NO_CHECKSUM, fault: stuck0(0x07e9, 0x04), pc: 0x3c0d, past: 6 },
  { tag: "warm reset into self-test (checksum)", in1: IN1_CHECKSUM, warm: 2, pc: 0x3d57, past: 40 },
  { tag: "warm reset into self-test (glyphs)", in1: IN1_NO_CHECKSUM, warm: 1, pc: 0x3c53, past: 30 },
];
const mkSelf = (s) => () => (s.warm !== undefined ? warm(WARM[s.warm], { service: true, in1: s.in1 }) : powerOn({ service: true, in1: s.in1 }));
function runSelf(s, fn, K) {
  const m = mkSelf(s)();
  const log = rig(m, { selfTest: true, boundAddr: IN0, boundN: K, fault: s.fault, irq: s.irq });
  const stop = fn === oracle ? stopOf(() => oracle(m)) : driveGen(fn(m), log);
  return { m, log, stop };
}

test("EQUAL (self-test): coldBootReset == oracle 0x3b04 to the same IN0 read", () => {
  const irqs = [], pushed = [];
  for (const s of SELF) {
    const K = kAt(s);
    assert.ok(K, `${s.tag}: oracle never reached ${hx(s.pc)}`);
    assert.equal(s.kStop, "bound", `${s.tag}: K run stopped by ${s.kStop}`);
    const o = runSelf(s, oracle, K), i = runSelf(s, coldBootReset, K);
    assert.equal(o.stop, "bound", `${s.tag}: oracle stopped by ${o.stop}`);
    assert.equal(i.stop, "bound", `${s.tag}: module stopped by ${i.stop}`);
    assert.equal(i.m.regs.s, mkSelf(s)().regs.s, `${s.tag}: module moved SP`);
    const d = diff(o.m, i.m, o.log, i.log, s);
    assert.equal(d, null, `${s.tag}: ${d}`);
    // The interrupt-enabled arms took IRQs; the beep arms (I still set) took none.
    const open = s.irq.cli !== undefined || s.irq.latch !== undefined;
    assert.ok(open ? o.log.irqs > 0 && o.log.irqs === i.log.irqs : o.log.irqs === 0, `${s.tag}: IRQs ${o.log.irqs} vs ${i.log.irqs}`);
    irqs.push(o.log.irqs); pushed.push(o.log.stackW.size);
  }
  console.log(`  EQUAL self-test: ${SELF.length} entries; IRQ beats ${irqs}; oracle stack cells ${pushed}`);
});

// ---- broken twins ---------------------------------------------------------------------------------
function* twinNormal(m, opt) {
  const { mem8 } = m;
  for (let x = 0; x < 256; x++) {
    mem8[x] = 0; mem8[0x0100 + x] = 0; mem8[0x0400 + x] = 0; mem8[0x0500 + x] = 0;
    mem8[0x0600 + x] = 0; mem8[0x0700 + x] = 0;
  }
  mem8[0x100f] = 0; mem8[0x1008] = 0; if (!opt.no2400) mem8[0x2400] = 0;
  if (!opt.noFlip) mem8[0x1c07] = 0;
  mem8[0xfd] = mem8[0x0800];
  mem8[0x86] = 0xff; mem8[0xc1] = opt.noSeed ? 0 : 0xff; mem8[0xc2] = 0xff; mem8[0xff] = 1;
  loadHighScoreTableFromEarom(m, 1);
  if (opt.sp) m.regs.s = (m.regs.s - 2) & 0xff;
  if (opt.port) mem8[0x1800] = 0; // an extra IRQ acknowledge: no RAM or device state changes
  if (!opt.noValidate) validateOrResetHighScores(m);
  yield* loc_200e(m);
}

test("TEETH: broken normal-boot twins are CAUGHT; the faithful twin is not", () => {
  const twin = (opt) => (m) => twinNormal(m, opt);
  for (const e of NORMAL) {
    const o = runNormal(e.m, oracle), i = runNormal(e.m, twin({}));
    assert.equal(diff(o.m, i.m, o.log, i.log, false), null, `${e.tag}: faithful twin diverges`);
  }
  for (const opt of [{ noSeed: true }, { noFlip: true }, { noValidate: true }, { no2400: true }, { sp: true }, { port: true }]) {
    const caught = NORMAL.some((e) => {
      const o = runNormal(e.m, oracle), i = runNormal(e.m, twin(opt));
      return diff(o.m, i.m, o.log, i.log, false) !== null;
    });
    assert.ok(caught, `twin ${JSON.stringify(opt)} NOT caught`);
  }
});

test("TEETH: self-test twins that lose the acknowledge write, one beep or an `lsr $8a`, move SP or add a port write are CAUGHT", () => {
  const dropWrite = (pred) => function* (m) {
    const w8 = m.mem.write8;
    m.mem.write8 = (a, v) => (pred(a & 0xffff, v & 0xff, m) ? undefined : w8(a, v));
    yield* coldBootReset(m);
  };
  // An `lsr $8a` is the only $8a write whose value is the old value shifted right (the IRQ writes old+1);
  // palette[5] turns 8 at the acknowledge, between the input loop (0x3c5a) and the review loop (0x3c93).
  const lsr8a = (acked) => (a, v, m) => a === loc_8a && v === m.mem8[loc_8a] >> 1 && (m.mem.paletteRam[5] === 8) === acked;
  const by = (tag) => SELF.find((s) => s.tag === tag);
  const cases = [
    { s: by("control seen: fill + review loop"), fn: dropWrite((a, v) => a === 0x1405 && v === 8), want: "palette[5]" },
    { s: by("zero page stuck-1 bit6 (>=0x10)"), fn: dropWrite((a, v) => a === 0x1001 && v === 0xaf), want: "POKEY trace" },
    { s: by("glyph grid, waiting for a control"), fn: dropWrite(lsr8a(false)), want: "stop hang" },
    { s: by("control seen: fill + review loop"), fn: dropWrite(lsr8a(true)), want: "RAM 0x8a" },
  ];
  // Plain stores into cells the oracle pushes to (0x100, 0x1fa on the checksum arms) must not hide.
  const clobber = function* (m) {
    const r8 = m.mem.read8; let done = false;
    m.mem.read8 = (a) => {
      if (!done && (a & 0xffff) === IN1) { done = true; m.mem.write8(0x0100, 0); m.mem.write8(0x01fa, 0); }
      return r8(a);
    };
    yield* coldBootReset(m);
  };
  for (const s of SELF.filter((x) => x.pc === 0x3d57)) cases.push({ s, fn: clobber, want: "stack shadow" });
  // At the first IN0 read: SP-2, or an extra IRQ acknowledge (changes no RAM or device state); every arm.
  const atIn0 = (f) => function* (m) {
    const r8 = m.mem.read8; let done = false;
    m.mem.read8 = (a) => { if (!done && (a & 0xffff) === IN0) { done = true; f(m); } return r8(a); };
    yield* coldBootReset(m);
  };
  for (const s of SELF) {
    cases.push({ s, fn: atIn0((m) => { m.regs.s = (m.regs.s - 2) & 0xff; }), want: "module moved SP" });
    cases.push({ s, fn: atIn0((m) => m.mem.write8(0x1800, 0)), want: "port log" });
  }
  for (const { s, fn, want } of cases) {
    const K = kAt(s);
    const o = runSelf(s, oracle, K), b = runSelf(s, fn, K);
    const d = b.stop !== "bound" ? `stop ${b.stop}` : diff(o.m, b.m, o.log, b.log, s);
    assert.ok(d && d.startsWith(want), `${s.tag}: twin not caught as ${want} (${d})`);
  }
});
