// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for boot (ROM 0x0000), the cold-boot generator: bootInit, then
 * `yield* mainLoop`. Oracle: translated loc_0000 (bootOnly, then the 0x02BC fall-through
 * into loc_02bd); neither returns.
 *
 * BOUND + FRAME TICK as in equivalence-02bd: one idiomatic `.next()` == one oracle loop trip
 * (`step(0x02bf)` to the next), so pass 1 is boot init + the first main-loop pass. Between
 * passes one service, identical on both sides, fires the oracle engine's NMI (push PC, 0x0066,
 * mask-gated) at runIdiomaticGame's cadence. Per pass: RAM − STACK_SCRATCH, io latches, the port
 * log (every latch/DMA write and every IN2 read = watchdog kick, in program order, the service's own
 * excluded; compared exactly), and SP: the generator's must not move; the oracle's is asserted at
 * 0x6c00, where boot reseats it (0x02b2 ld sp,0x6c00) and every loop trip leaves it.
 * ENTRIES: power-on (the real reset); a mid-attract and a pre-dirtied machine (crafted warm
 * resets, the watchdog's path) proving init overwrites whatever came before.
 * LIVE-OUT: none — the reset vector has no caller and never returns.
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { Machine } from "../../machine.js";
import { loc_0000 as oracle } from "../../translated/loc_0000.js";
import { boot, bootInit } from "../boot.js";
import { mainLoop } from "../mainLoop.js";
import { clearRamAndInitHardware } from "../clearRamAndInitHardware.js";
import { NMI_ENABLE, STACK_SCRATCH, TASK_HEAD, TASK_RING, FRAME_SEEN } from "../names.js";

const ROM_PATH = new URL("../../rom/maincpu.bin", import.meta.url);
const ROM_PRESENT = existsSync(ROM_PATH);
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(ROM_PATH)) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not present at games/dkong/rom/maincpu.bin" }, fn);

const PASSES = 40;
const SCHEDULES = { engine: () => true, spin: (k) => k % 3 === 0 };
const BOUND = Symbol("boot-bound");
const NO_YIELD = Symbol("no-yield");
const GUARD = 4096; // TASK_HEAD reads in one generator pass before it counts as a lost yield
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inStack = (a) => a >= STACK_SCRATCH.lo && a < STACK_SCRATCH.hi;

const ORACLE_SP = 0x6c00;
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

function snap(m) {
  const io = m.io;
  return {
    log: m.portLog.join(" "),
    state: Buffer.from(m.dumpState()),
    sp: m.regs.sp,
    io: [io.nmiMask, io.flipScreen, io.spriteBank, io.paletteBank, io.audioIrq, io.soundLatch3d, ...io.latch6h],
  };
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

function runOracle(entry, schedule) {
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
      if (snaps.length >= PASSES) throw BOUND;
      if (schedule(k)) service(m);
    }
    k++;
  };
  try { oracle(m); } catch (e) { if (e !== BOUND) return { snaps, fault: String(e.message) }; }
  return { snaps, fault: null };
}

function runGenerator(entry, gen, schedule) {
  const m = entry.clone();
  tapPorts(m);
  const read8 = m.mem.read8.bind(m.mem);
  let reads = 0;
  m.mem.read8 = (a) => {
    if (a === TASK_HEAD && ++reads > GUARD) throw NO_YIELD;
    return read8(a);
  };
  const g = gen(m);
  const snaps = [];
  for (let k = 1; k <= PASSES; k++) {
    reads = 0;
    try {
      if (g.next().done) return { snaps, early: `returned at pass ${k}` };
    } catch (e) {
      return { snaps, early: e === NO_YIELD ? `no yield within pass ${k}` : `fault: ${e.message}` };
    }
    snaps.push(snap(m));
    if (k < PASSES && schedule(k)) service(m);
  }
  return { snaps, early: null };
}

function breach(entry, oracleRun, cand) {
  if (oracleRun.fault) return `oracle fault: ${oracleRun.fault}`;
  if (cand.early !== null) return `generator ${cand.early}`;
  const os = oracleRun.snaps;
  for (let p = 0; p < os.length; p++) {
    const o = os[p], c = cand.snaps[p];
    for (let i = 0; i < o.state.length; i++) {
      if (o.state[i] === c.state[i]) continue;
      const addr = entry.stateOffsetToAddr(i);
      if (!inStack(addr)) return `pass ${p + 1} RAM@${hx(addr)} oracle=${o.state[i]} cand=${c.state[i]}`;
    }
    if (o.log !== c.log) return `pass ${p + 1} port log oracle=[${o.log}] cand=[${c.log}]`;
    const io = o.io.findIndex((v, i) => v !== c.io[i]);
    if (io >= 0) return `pass ${p + 1} io[${io}] oracle=${o.io[io]} cand=${c.io[io]}`;
    if (o.sp !== ORACLE_SP) return `pass ${p + 1} oracle SP ${hx(o.sp)}, not ${hx(ORACLE_SP)}`;
    if (c.sp !== entry.regs.sp) return `pass ${p + 1} cand SP moved ${hx(c.sp)}`;
  }
  return null;
}

function attract() {
  const m = new Machine(ROM);
  m.runFrames(300);
  return m.clone();
}

function dirtied() {
  const m = new Machine(ROM).clone();
  for (let a = 0x6000; a <= 0x6bff; a++) m.mem.write8(a, (a * 7 + 0x5a) & 0xff);
  for (let a = 0x7000; a <= 0x77ff; a++) m.mem.write8(a, (a * 3 + 0x21) & 0xff);
  m.io.flipScreen = 0;
  m.io.spriteBank = 1;
  m.io.paletteBank = 3;
  m.io.audioIrq = 1;
  m.io.soundLatch3d = 0xaa;
  for (let i = 0; i < 8; i++) m.io.latch6h[i] = 0xff;
  return m;
}

const ENTRIES = ROM_PRESENT
  ? [["power-on", new Machine(ROM).clone()], ["mid-attract", attract()], ["dirtied", dirtied()]]
  : [];

function breachesOver(gen) {
  const out = [];
  for (const [sname, sch] of Object.entries(SCHEDULES)) {
    for (const [ename, e] of ENTRIES) {
      const b = breach(e, runOracle(e, sch), runGenerator(e, gen, sch));
      if (b) out.push(`${sname}/${ename}: ${b}`);
    }
  }
  return out;
}

test("EQUAL: boot == loc_0000 pass-for-pass from power-on and two warm entries, both schedules", () => {
  const b = breachesOver(boot);
  assert.equal(b.length, 0, `${b.length} breach(es): ${b.slice(0, 3).join(" | ")}`);
  const m = runGenerator(ENTRIES[0][1], boot, SCHEDULES.engine);
  const last = m.snaps.at(-1).state;
  const at = (addr) => last[[...last.keys()].find((i) => ENTRIES[0][1].stateOffsetToAddr(i) === addr)];
  assert.notEqual(at(FRAME_SEEN), 0, "non-vacuity: the loop never ran its frame-advance arm");
  console.log(`  EQUAL: 3 entries x ${PASSES} passes x 2 schedules identical to loc_0000`);
});

// -- TEETH: broken twins of boot ----------------------------------------------------

const TWINS = {
  // the classic coroutine bug: a generator called without yield* silently never runs
  "no yield*": function* (m) { bootInit(m); mainLoop(m); },
  "no clear": function* (m) { m.mem8[NMI_ENABLE] = 0; yield* mainLoop(m); },
  "vblank left masked": function* (m) { bootInit(m); m.mem8[NMI_ENABLE] = 0; yield* mainLoop(m); },
  "ring head off": function* (m) { bootInit(m); m.mem8[TASK_HEAD] = (TASK_RING + 2) & 0xff; yield* mainLoop(m); },
  "extra init yield": function* (m) { bootInit(m); yield; yield* mainLoop(m); },
  "transient tune": function* (m) { m.mem8[0x7c00] = 3; bootInit(m); yield* mainLoop(m); },
  "SP-2": function* (m) { bootInit(m); m.regs.sp -= 2; yield* mainLoop(m); },
  // same value as the latch holds, so only the port log can see it
  "extra flip write": function* (m) { bootInit(m); m.mem8[0x7d82] = m.io.flipScreen; yield* mainLoop(m); },
  "extra kick": function* (m) { bootInit(m); void m.mem8[0x7d00]; yield* mainLoop(m); },
};

for (const [name, gen] of Object.entries(TWINS)) {
  test(`TEETH: the '${name}' twin is CAUGHT`, () => {
    const b = breachesOver(gen);
    assert.ok(b.length > 0, `the '${name}' twin escaped every entry`);
    console.log(`  TEETH/${name}: ${b.length} breaches, first ${b[0]}`);
  });
}

test("TEETH: an equivalent re-spelling (init inlined) passes", () => {
  const same = function* (m) { m.mem8[NMI_ENABLE] = 0; clearRamAndInitHardware(m); yield* mainLoop(m); };
  assert.equal(breachesOver(same).length, 0);
});
