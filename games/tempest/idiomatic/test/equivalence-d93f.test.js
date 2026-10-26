// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for bootMachineFromReset (ROM 0xd93f, the RESET generator) vs the frozen loc_d93f.
// Entry: the real reset-vector dispatch on a power-on Machine (RAM zero), plus crafted priors (RAM pre-filled,
// so the wipe is visible) and the self-test-held fork. Normal boot never returns (it becomes the main loop),
// so it is bounded as equivalence-c7a0 is: the engine's yield service (nine frozen-loc_d704 IRQs through the
// seam) fired IDENTICALLY at each idiomatic yield and at each oracle wait poll that will loop, a sentinel at
// the Nth. The self-test arm is bounded at the fork (the oracle's IN0 read at d983 vs the idiomatic first
// yield): the diagnostic body past it is not ported (spinSelfTest has no RAM effects). RANDOM is one
// deterministic stream per chip on both sides, the device clock pinned. Contract: RAM minus STACK_SCRATCH,
// device latch state, RANDOM read counts and AVG strobes. No register live-out: reached from the reset vector
// and two JMPs (d714, d861), never a JSR.
// Run: node --test games/tempest/idiomatic/test/equivalence-d93f.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_d93f as oracle } from "../../translated/loc_d93f.js";
import { bootMachineFromReset } from "../bootMachineFromReset.js";
import { armEaromReadback } from "../armEaromReadback.js";
import { rebuildControlBlocksFromTemplate } from "../rebuildControlBlocksFromTemplate.js";
import { buildLevelLayout } from "../buildLevelLayout.js";
import { runMainFrameLoop } from "../runMainFrameLoop.js";
import { Machine, RESET_VECTOR } from "../../machine.js";
import manifest from "../../manifest.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, IRQ_HEARTBEAT, IN0_PORT, VG_SCALE, GAME_MODE, STATUS_FLAGS } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const opt = (n) => { const u = new URL(n, ROM_DIR); return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined; };
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xd93f;
const WAIT_PC = 0xc7a7; // runMainFrameLoop's wait poll (lda $53)
const FORK_PC = 0xd983; // the oracle's self-test switch read (lda $0c00)
const SELF_TEST = 0x10; // IN0 bit4, active-low
const BURST = manifest.convergence.idiomatic.irq.irqVblank.length;
const CHECKS = [1, 2, 3, 10, 40, 150];
const LAST = CHECKS[CHECKS.length - 1];
const BOUND = Symbol("d93f-bound");
const inDeadStack = (a) => a != null && a >= STACK_SCRATCH.lo && a < STACK_SCRATCH.hi;

function pin(m, held) {
  m.nextBoundary = Infinity; m.nextIrqCycle = Infinity; m.maxCycles = Infinity;
  m.mem.clock = () => 0;
  m.rng = [0, 0]; m.gos = 0;
  const read = m.io.pokeyRead.bind(m.io), go = m.io.avgGo.bind(m.io);
  m.io.pokeyRead = (c, reg, cy) => ((reg & 0x0f) === 0x0a ? (Math.imul(++m.rng[c] + 0x51 * c, 0x9e3779b1) >>> 24) : read(c, reg, cy));
  m.io.avgGo = () => { m.gos++; go(); };
  m.io.inputAssert = held ? { 0: SELF_TEST } : null;
  return m;
}
// A cold machine with every RAM (and colour RAM) byte at `prior`, or a WARM copy of a running game's state.
function machine(prior, held) {
  const m = new Machine(ROM, OPTS);
  if (typeof prior === "number") {
    m.mem.workRam.fill(prior); m.mem.vectorRam.fill(prior); m.io.colorram.fill(prior);
    // Power-on device latches are undefined: a nonzero prior also dirties the POKEY audio regs and the LED latch.
    if (prior) for (const p of m.io.pokeys) { p.audf.fill(prior); p.audc.fill(prior); p.audctl = prior; }
    if (prior) m.io.playerSelect = 0x04;
    return pin(m, held);
  }
  const s = prior();
  m.mem.workRam.set(s.mem.workRam); m.mem.vectorRam.set(s.mem.vectorRam); m.io.colorram.set(s.io.colorram);
  m.io.flipX = s.io.flipX; m.io.flipY = s.io.flipY; m.io.playerSelect = s.io.playerSelect;
  m.io.earom = s.io.earom.clone(); m.io.mathbox = s.io.mathbox.clone();
  m.io.pokeys = s.io.pokeys.map((p, i) => Object.assign(p.clone(), { potBits: m.io.pokeys[i].potBits, onWrite: m.io.pokeys[i].onWrite }));
  if (m.io.avg) Object.assign(m.io.avg, { flipX: s.io.flipX, flipY: s.io.flipY, doneFlag: s.io.avg?.doneFlag });
  m.regs.copyFrom(s.regs);
  return pin(m, held);
}
function burst(m, n) {
  if (m.tape) m.io.inputAssert = Object.fromEntries(m.tape.filter((t) => n >= t.frame && n < t.frame + t.dur).map((t) => [t.port, t.bits]));
  for (let k = 0; k < BURST; k++) { m.pcKnown = true; m.pc = WAIT_PC; m.regs.fI = false; m.fireIrq(); }
}
const dev = (m) => JSON.stringify({
  pk: m.io.pokeys.map((p) => [[...p.audf], [...p.audc], p.audctl, p.skctl, p.irqen, p.allpot, [...p.pot], p.potCounter]),
  er: m.io.earom, flip: [m.io.flipX, m.io.flipY, m.io.playerSelect], gos: m.gos, rng: m.rng,
});
const snap = (m) => ({ ram: m.dumpState(), dev: dev(m), done: !!m.io.avg?.doneFlag, at: (o) => m.stateOffsetToAddr(o) });

function runOracle(m, held) {
  const snaps = new Map(), read8 = m.mem.read8.bind(m.mem);
  let n = 0;
  m.mem.read8 = (a) => {
    const v = read8(a);
    if (held && a === IN0_PORT && m.pc === FORK_PC) { snaps.set(1, snap(m)); throw BOUND; }
    if (a === IRQ_HEARTBEAT && m.pc === WAIT_PC && v < 9) {
      n++;
      if (CHECKS.includes(n)) snaps.set(n, snap(m));
      if (n === LAST) throw BOUND;
      burst(m, n);
    }
    return v;
  };
  try { oracle(m); } catch (e) { if (e !== BOUND) throw e; }
  return snaps;
}
function runGen(gen, m, held) {
  const snaps = new Map(), last = held ? 1 : LAST;
  for (let n = 1; n <= last; n++) {
    if (gen.next().done) throw new Error("the boot returned");
    if (held || CHECKS.includes(n)) snaps.set(n, snap(m));
    if (n < last) burst(m, n);
  }
  return snaps;
}
function diff(so, si, held, strict = false) {
  for (const n of held ? [1] : CHECKS) {
    const o = so.get(n), c = si.get(n);
    if (!o || !c) return `checkpoint ${n} missing (oracle ${!!o}, idiomatic ${!!c})`;
    const d = firstStateDiff(o.ram, c.ram, o.at, inDeadStack);
    if (d) return `burst ${n}: RAM 0x${d.addr.toString(16)} oracle=${d.a} idiomatic=${d.b}`;
    if (o.dev !== c.dev) return `burst ${n}: device state differs`;
    if (o.done !== c.done) return `burst ${n}: AVG done flag oracle=${o.done} idiomatic=${c.done}`;
  }
  return null;
}

// A warm source for the JMP-to-reset callers (d714 panic, d861 slot underflow): the frozen boot driven by the
// gameplay tape into live play, stopped at the first update with a POKEY voice on, then reset from that state.
const TAPE = JSON.parse(readFileSync(new URL("../../tapes/gameplay.json", import.meta.url))).inputs;
const voiceLive = (m) => m.io.pokeys.some((p) => p.audf.some(Boolean) || p.audc.some(Boolean));
let WARM = null;
function warm() {
  if (!WARM) {
    const m = machine(0x00, false), read8 = m.mem.read8.bind(m.mem);
    m.tape = TAPE;
    let n = 0;
    m.mem.read8 = (a) => {
      const v = read8(a);
      if (a === IRQ_HEARTBEAT && m.pc === WAIT_PC && v < 9) { if ((++n >= 160 && voiceLive(m)) || n === 600) { WARM = m; throw BOUND; } burst(m, n); }
      return v;
    };
    try { oracle(m); } catch (e) { if (e !== BOUND) throw e; }
  }
  return WARM;
}

// [label, RAM prior or warm source, self-test held]
const ARMS = [
  ["power-on (RAM zero), normal boot", 0x00, false],
  ["prior 0x5a, normal boot", 0x5a, false],
  ["prior 0xff, normal boot", 0xff, false],
  ["prior 0x5a, self-test held (to the fork)", 0x5a, true],
  ["prior 0xff, self-test held (to the fork)", 0xff, true],
  ["warm reset from live play, normal boot", warm, false],
  ["warm reset from live play, self-test held (to the fork)", warm, true],
];
const memo = new Map();
const oracleRun = (i) => { if (!memo.has(i)) memo.set(i, runOracle(machine(ARMS[i][1], ARMS[i][2]), ARMS[i][2])); return memo.get(i); };
const genRun = (i, fn = bootMachineFromReset) => { const m = machine(ARMS[i][1], ARMS[i][2]); return runGen(fn(m), m, ARMS[i][2]); };

test("CAPTURE: 0xd93f is the reset-vector dispatch; the bounded oracle boots into a running main loop", () => {
  assert.equal(new Machine(ROM, OPTS).mem.read16(RESET_VECTOR), TARGET, "the reset vector does not land on 0xd93f");
  const o = oracleRun(0), last = JSON.parse(o.get(LAST).dev);
  assert.equal(o.size, CHECKS.length, "the bounded oracle never reached the main loop's checkpoints");
  assert.ok(last.gos >= LAST - 1 && last.rng[0] > 0, `inert run: ${o.get(LAST).dev}`);
  assert.equal(o.get(1).ram[VG_SCALE], 0x10, "the normal-boot arm never seeded VG_SCALE");
  assert.ok(new Set(CHECKS.map((n) => o.get(n).ram[GAME_MODE])).size > 2, "GAME_MODE never moved");
  assert.equal(oracleRun(3).size + oracleRun(4).size, 2, "the held arm never reached the self-test fork");
  const w = warm();
  assert.ok(w && w.mem.read8(STATUS_FLAGS) & 0x80, "the warm source never reached live play");
  assert.ok(voiceLive(w), "no voice live in the warm source");
});

ARMS.forEach(([label, , held], i) => {
  test(`ARM (${label}): RAM (-stack) + devices equal at every checkpoint`, () => {
    assert.equal(diff(oracleRun(i), genRun(i), held), null);
  });
});

const STRICT = { skip: ROM_PRESENT ? false : "ROM not built" };
nodeTest("STRICT: every arm equal with only STACK_SCRATCH excluded", STRICT, () => {
  const red = ARMS.map(([label, , held], i) => [label, diff(oracleRun(i), genRun(i), held, true)]).filter(([, d]) => d);
  assert.deepEqual(red, []);
});

// Broken twins of the boot: each must diverge on some arm.
function* twin(m, { low = 2048, high = 4096, seed = 0x10, mask = SELF_TEST, drop = -1, sk = 7, strobe = true }) {
  const { mem8 } = m;
  if (strobe) mem8[0x5800] = 0;
  for (let a = 0; a < low; a++) mem8[a] = 0;
  for (let a = 0; a < high; a++) mem8[0x2000 + a] = 0;
  mem8[0x01] = 0; mem8[0x60e0] = 0; mem8[0x60cf] = sk; mem8[0x60df] = sk;
  for (let i = 8; i >= 0; i--) { mem8[0x60c0 + i] = 0; mem8[0x60d0 + i] = 0; }
  if ((mem8[IN0_PORT] & mask) === 0) for (;;) yield;
  mem8[VG_SCALE] = seed;
  [armEaromReadback, rebuildControlBlocksFromTemplate, buildLevelLayout].forEach((f, k) => k !== drop && f(m));
  yield* runMainFrameLoop(m);
}
const TWINS = [
  ["wipes 2047 low bytes", { low: 2047 }], ["wipes 4095 vector bytes", { high: 4095 }], ["seeds VG_SCALE=0x11", { seed: 0x11 }],
  ["tests IN0 bit5", { mask: 0x20 }], ["drops armEaromReadback", { drop: 0 }], ["drops rebuildControlBlocks", { drop: 1 }],
  ["drops buildLevelLayout", { drop: 2 }], ["drops the AVG reset strobe", { strobe: false }],
];
test("TEETH: every broken twin of the boot diverges on some arm, and the unbroken twin matches", () => {
  ARMS.forEach(([, , held], i) => assert.equal(diff(oracleRun(i), genRun(i, (m) => twin(m, {})), held), null, "faithful twin"));
  for (const [label, o] of TWINS) {
    const red = ARMS.some(([, , held], i) => diff(oracleRun(i), genRun(i, (m) => twin(m, o)), held) !== null);
    assert.ok(red, `twin "${label}" survived every arm`);
  }
});
