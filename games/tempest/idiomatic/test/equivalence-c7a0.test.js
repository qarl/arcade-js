// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for runMainFrameLoop (ROM 0xc7a0, a never-returning generator) vs the frozen loc_c7a0.
// Entry: the real JMP from the boot (d9a5) captured on the frozen boot, plus crafted arms on captured attract
// states, IRQ_HEARTBEAT boundary seeds, and the gameplay tape (with and without tilt raised). Frame tick, modelled IDENTICALLY on both sides as the engine does
// (manifest irqVblank): a burst of nine frozen-loc_d704 IRQs fired through the seam, at each idiomatic yield
// and at each oracle wait poll that will loop (the busy-wait's yield point). The run is bounded at the same
// logical point, the Nth burst, by a sentinel throw. RANDOM is one deterministic stream per chip on both sides
// and the device clock is pinned, so neither arm's cycle count leaks in. Contract: RAM minus stack scratch below the entry SP,
// device latch state, per-chip RANDOM read counts and AVG go strobes at every checkpoint, and the X/Y every
// sound-loader entry stashes (STASH; the loop threads each pass's exit X/Y into the next pass). No register
// live-out: the routine never returns (its one caller, d9a5, is a JMP).
// Run: node --test games/tempest/idiomatic/test/equivalence-c7a0.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_c7a0 as oracle } from "../../translated/loc_c7a0.js";
import { loc_d93f } from "../../translated/loc_d93f.js";
import { runMainFrameLoop } from "../runMainFrameLoop.js";
import { resetBothPokeyChips } from "../resetBothPokeyChips.js";
import { dispatchFramePhaseHandler } from "../dispatchFramePhaseHandler.js";
import { seedFramePhaseAndTick } from "../seedFramePhaseAndTick.js";
import { buildFrameVectors } from "../buildFrameVectors.js";
import { Machine } from "../../machine.js";
import manifest from "../../manifest.js";
import { firstStateDiff, deadStackBelow } from "../../../../core/equivalence.js";
import { stackFloor } from "./_entryFloor.js";
import {
  STACK_SCRATCH, IRQ_HEARTBEAT, GAME_MODE, STATUS_FLAGS, SOUND_STEP_GATE, loc_31, loc_32, SOUND_VOICE_TABLE,
  EAROM_REGION_PENDING, EAROM_REGION_DIR, EAROM_MODE, VEC_LIST_HEADER_LO, VECHEAD0_LEVEL, LEVEL_LAYOUT_TRIGGER,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const opt = (n) => { const u = new URL(n, ROM_DIR); return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined; };
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xc7a0;
const WAIT_PC = 0xc7a7; // the oracle's wait poll (lda $53)
const BURST = manifest.convergence.idiomatic.irq.irqVblank.length; // IRQs the engine fires per yield
const CHECKS = [1, 2, 3, 10, 40, 150, 450, 900];
const LAST = CHECKS[CHECKS.length - 1];
const BOUND = Symbol("c7a0-bound");

function pin(m) {
  m.nextBoundary = Infinity; m.nextIrqCycle = Infinity; m.maxCycles = Infinity;
  m.mem.clock = () => 0;
  m.rng = [0, 0]; m.gos = 0;
  const read = m.io.pokeyRead.bind(m.io), go = m.io.avgGo.bind(m.io);
  m.io.pokeyRead = (c, reg, cy) => ((reg & 0x0f) === 0x0a ? (Math.imul(++m.rng[c] + 0x51 * c, 0x9e3779b1) >>> 24) : read(c, reg, cy));
  m.io.avgGo = () => { m.gos++; go(); };
  return m;
}
function fork(s) {
  const d = new Machine(ROM, OPTS);
  d.mem.workRam.set(s.mem.workRam); d.mem.vectorRam.set(s.mem.vectorRam); d.io.colorram.set(s.io.colorram);
  d.io.flipX = s.io.flipX; d.io.flipY = s.io.flipY; d.io.playerSelect = s.io.playerSelect;
  d.io.earom = s.io.earom.clone(); d.io.mathbox = s.io.mathbox.clone();
  // Pokey.clone keeps the SOURCE io's pot closure; rebind it so this fork's own inputs reach the pots.
  d.io.pokeys = s.io.pokeys.map((p, i) => Object.assign(p.clone(), { potBits: d.io.pokeys[i].potBits, onWrite: d.io.pokeys[i].onWrite }));
  if (d.io.avg) Object.assign(d.io.avg, { flipX: s.io.flipX, flipY: s.io.flipY, doneFlag: s.io.avg?.doneFlag });
  d.regs.copyFrom(s.regs); d.cycles = s.cycles; d.pc = s.pc;
  return pin(d);
}
// The engine's per-yield service: the tape's inputs for update n, then nine IRQs.
function burst(m, n) {
  if (m.tape) m.io.inputAssert = Object.fromEntries(m.tape.filter((t) => t.port !== undefined && n >= t.frame && n < t.frame + t.dur).map((t) => [t.port, t.bits]));
  if (m.tape) m.io.dsw1 = m.tape.find((t) => t.dsw1 !== undefined && n >= t.frame && n < t.frame + t.dur)?.dsw1 ?? 0; // DSW1 entries drive the coinage dips
  for (let k = 0; k < BURST; k++) { m.pcKnown = true; m.pc = WAIT_PC; m.regs.fI = false; m.fireIrq(); }
}
const dev = (m) => JSON.stringify({
  pk: m.io.pokeys.map((p) => [[...p.audf], [...p.audc], p.audctl, p.skctl, p.irqen, p.allpot, [...p.pot], p.potCounter]),
  er: m.io.earom, flip: [m.io.flipX, m.io.flipY, m.io.playerSelect], gos: m.gos, rng: m.rng,
});
const snap = (m) => ({ ram: m.dumpState(), dev: dev(m), done: !!m.io.avg?.doneFlag, at: (o) => m.stateOffsetToAddr(o) });
// The sound loader stashes the X/Y it is entered with in loc_31/loc_32 and then reads the voice table. Those
// cells are scratch other routines overwrite before most checkpoints, so a stale X/Y reaching the loader can
// hide from the RAM snapshots; log every loader entry on both sides instead (the same write-write-read
// signature in the oracle and the port) and compare the sequences.
function logStashes(m) {
  const log = [], w = m.mem.write8.bind(m.mem), r = m.mem.read8.bind(m.mem);
  let pend = null;
  m.mem.write8 = (a, v) => {
    pend = a === loc_31 ? [v & 0xff] : a === loc_32 && pend?.length === 1 ? [pend[0], v & 0xff] : null;
    return w(a, v);
  };
  m.mem.read8 = (a) => {
    if (pend?.length === 2 && a >= SOUND_VOICE_TABLE && a < SOUND_VOICE_TABLE + 0x100) log.push(pend);
    pend = null;
    return r(a);
  };
  return log;
}

// Oracle: a busy-wait poll that will loop is its yield point; burst there, snapshot/stop at the Nth.
function runOracle(m) {
  const snaps = new Map(); snaps.floor = stackFloor(m);
  snaps.stash = logStashes(m);
  const read8 = m.mem.read8.bind(m.mem);
  let n = 0;
  m.mem.read8 = (a) => {
    const v = read8(a);
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
function runGen(gen, m) {
  const snaps = new Map(); snaps.floor = stackFloor(m);
  snaps.stash = logStashes(m);
  for (let n = 1; n <= LAST; n++) {
    if (gen.next().done) throw new Error("the main loop returned");
    if (CHECKS.includes(n)) snaps.set(n, snap(m));
    if (n < LAST) burst(m, n);
  }
  return snaps;
}
function diff(so, si) {
  for (const n of CHECKS) {
    const o = so.get(n), c = si.get(n);
    if (!o || !c) return `checkpoint ${n} missing (oracle ${!!o}, idiomatic ${!!c})`;
    const d = firstStateDiff(o.ram, c.ram, o.at, deadStackBelow(STACK_SCRATCH, Math.min(so.floor, si.floor)));
    if (d) return `burst ${n}: RAM 0x${d.addr.toString(16)} oracle=${d.a} idiomatic=${d.b}`;
    if (o.dev !== c.dev) return `burst ${n}: device state differs`;
    if (o.done !== c.done) return `burst ${n}: AVG done flag oracle=${o.done} idiomatic=${c.done}`;
  }
  return null;
}

// The real dispatch (d9a5's JMP) on the frozen boot, plus attract states the oracle loop reaches.
function capture() {
  const out = {};
  const m = pin(new Machine(ROM, { overrides: new Map([[TARGET, (mm) => { out.real = fork(mm); return oracle(mm); }]]), ...OPTS }));
  const read8 = m.mem.read8.bind(m.mem);
  let n = 0;
  m.mem.read8 = (a) => {
    const v = read8(a);
    if (a === IRQ_HEARTBEAT && m.pc === WAIT_PC && v < 9) {
      n++;
      if (n === 120) out.attract120 = fork(m);
      if (n === 400) { out.attract400 = fork(m); throw BOUND; }
      burst(m, n);
    }
    return v;
  };
  try { loc_d93f(m); } catch (e) { if (e !== BOUND) throw e; }
  return out;
}
const CAP = ROM_PRESENT ? capture() : {};
const TAPE = JSON.parse(readFileSync(new URL("../../tapes/gameplay.json", import.meta.url))).inputs;
const taped = () => Object.assign(fork(CAP.real), { tape: TAPE });
// Tilt (IN0 bit 3) held for 300 updates from update `from`, over the gameplay tape: tickHeartbeatCounters then
// primes SOUND_STEP_GATE, so seedFramePhaseAndTick voices the held cue every update with the X/Y it was entered
// with (the mode handler's exit registers, or its own setup's), and the loader stashes them.
const tilted = (from) => () => {
  const m = fork(CAP.real);
  m.tape = [...TAPE, { port: 0, bits: 0x08, frame: from, dur: 300 }];
  m.regs.x = 0x5a; m.regs.y = 0xa5;
  return m;
};
const seeded = (base, v) => () => { const m = fork(CAP[base]); m.mem.write8(IRQ_HEARTBEAT, v); return m; };
const TILT = { port: 0, bits: 0x08, frame: 0, dur: 9999 };
// (DSW1 & 0x83) == 0x82 makes the dispatcher skip its pass, so seedFramePhaseAndTick is entered with the X/Y
// the previous build left (resetBothPokeyChips' on the first update); under tilt it voices them.
const dswSkip = (from, dur) => () => {
  const m = fork(CAP.real);
  m.tape = [{ dsw1: 0x82, frame: from, dur }, TILT];
  m.regs.x = 0x5a; m.regs.y = 0xa5;
  return m;
};
// A settled frame feeding a Y consumer: the attract state at frame 120 enters with an EAROM write pending and
// tilt raised. Update 2's phase tick runs the EAROM step, which leaves Y nonzero; update 2's build takes the
// settled-frame early return and hands that Y back; update 3's handler (seedModeParamsMinimal) passes it
// through, and update 3's phase tick voices the held cue with it (the loader stashes it in loc_32). With
// `skip`, update 3's dispatch is skipped by the DSW gate instead, so the build's Y reaches the cue directly.
const settledEarom = (skip) => () => {
  const m = fork(CAP.attract120);
  m.tape = skip ? [{ dsw1: 0x82, frame: 3, dur: 1 }, TILT] : [TILT];
  m.mem.write8(EAROM_REGION_PENDING, 0x07); m.mem.write8(EAROM_REGION_DIR, 0x07); m.mem.write8(EAROM_MODE, 0x00);
  m.regs.x = 0x5a; m.regs.y = 0xa5;
  return m;
};
const ARMS = [
  ["real d9a5 dispatch", () => fork(CAP.real)],
  ["real dispatch, $53=8 (waits one burst)", seeded("real", 8)],
  ["real dispatch, $53=9 (no first wait)", seeded("real", 9)],
  ["real dispatch, $53=0xff", seeded("real", 0xff)],
  ["attract state at frame 120", () => fork(CAP.attract120)],
  ["attract state at frame 400, $53=5", seeded("attract400", 5)],
  ["real dispatch + gameplay tape (coin, start, fire)", taped],
  // The oracle's cd95 overwrites entry X/Y (X=0xff, Y=RANDOM) before the first update; on the port side
  // they are what any stale m.regs default would read, so unusual values expose one.
  ["gameplay tape, entry X/Y = 0x5a/0xa5", () => { const m = taped(); m.regs.x = 0x5a; m.regs.y = 0xa5; return m; }],
  ["gameplay tape + tilt from update 20", tilted(20)],
  ["gameplay tape + tilt from update 200", tilted(200)],
  ["gameplay tape + tilt from update 400", tilted(400)],
  ["DSW skip on every update + tilt", dswSkip(0, 9999)],
  ["DSW skip on the first update + tilt", dswSkip(0, 2)],
  ["settled frame feeds the next handler's Y (EAROM write + tilt)", settledEarom(false)],
  ["settled frame feeds a DSW-skipped update's Y (EAROM write + tilt)", settledEarom(true)],
];
const PLAY = ARMS.findIndex(([label]) => label.startsWith("gameplay tape, entry X/Y"));
const TILTS = ARMS.map(([label], i) => (label.startsWith("gameplay tape + tilt") ? i : -1)).filter((i) => i >= 0);
const SETTLED = ARMS.map(([label], i) => (label.startsWith("settled frame") ? i : -1)).filter((i) => i >= 0);
const memo = new Map();
const oracleRun = (i) => { if (!memo.has(i)) memo.set(i, runOracle(ARMS[i][1]())); return memo.get(i); };
const genRun = (i, fn = runMainFrameLoop) => { const m = ARMS[i][1](); return runGen(fn(m), m); };

test("CAPTURE: real 0xc7a0 dispatch reached; the bounded runs build frames, draw RANDOM and reach play", () => {
  assert.ok(CAP.real && CAP.attract120 && CAP.attract400, "positive control: boot never reached the main loop");
  const o = oracleRun(0), last = JSON.parse(o.get(LAST).dev);
  assert.equal(o.size, CHECKS.length, "the bounded oracle run did not reach every checkpoint");
  assert.ok(last.gos >= LAST - 1 && last.rng[0] > 0 && last.rng[1] > 0, `inert run: ${o.get(LAST).dev}`);
  assert.ok(new Set(CHECKS.map((n) => o.get(n).ram[GAME_MODE])).size > 2, "GAME_MODE never moved");
  const play = oracleRun(PLAY);
  assert.ok(CHECKS.some((n) => play.get(n).ram[STATUS_FLAGS] & 0x80), "the gameplay tape never reached play");
  assert.ok(!CHECKS.some((n) => o.get(n).ram[STATUS_FLAGS] & 0x80), "attract reached play untaped");
});

ARMS.forEach(([label], i) => {
  test(`ARM (${label}): RAM (-stack) + devices equal at every checkpoint`, () => {
    assert.equal(diff(oracleRun(i), genRun(i)), null);
  });
});

// Every RAM cell but stack scratch below the entry SP, the register stash cells loc_31/loc_32 (sound loader) and 0x39 included.
test("STRICT: every arm equal with only stack scratch below the entry SP excluded", () => {
  const red = ARMS.map(([label], i) => [label, diff(oracleRun(i), genRun(i))]).filter(([, d]) => d);
  assert.deepEqual(red, []);
});

test("STASH: every arm's sound-loader entries see the oracle's X/Y, in order", () => {
  const red = ARMS.map(([label], i) => {
    const o = oracleRun(i).stash, c = genRun(i).stash;
    const k = o.findIndex((e, j) => !c[j] || e[0] !== c[j][0] || e[1] !== c[j][1]);
    return [label, k < 0 && o.length === c.length ? null : `entry ${k < 0 ? o.length : k} of ${o.length}: oracle ${JSON.stringify(o[k])} idiomatic ${JSON.stringify(c[k])}`];
  }).filter(([, d]) => d);
  assert.deepEqual(red, []);
  assert.ok(oracleRun(PLAY).stash.length > 0, "positive control: the gameplay arm never entered the sound loader");
  for (const i of TILTS) {
    const o = oracleRun(i);
    assert.ok(CHECKS.some((n) => o.get(n).ram[SOUND_STEP_GATE] !== 0), `positive control: ${ARMS[i][0]} never primed SOUND_STEP_GATE`);
    assert.ok(o.stash.length > oracleRun(PLAY).stash.length, `positive control: ${ARMS[i][0]} voiced no extra cue`);
  }
});

// Broken twins of the loop: each must diverge somewhere on the arms. The twin threads X/Y as the loop does
// (a skipped pass hands on the X/Y it was given; without the POKEY reset the entry registers stand in).
function* twin(m, { wait = 9, skip = -1, seed = 0, init = true }) {
  const { mem8 } = m;
  let [x, y] = init ? resetBothPokeyChips(m) : [m.regs.x, m.regs.y];
  mem8[GAME_MODE] = seed;
  const passes = [(xx, yy) => dispatchFramePhaseHandler(m, yy, xx), (xx, yy) => seedFramePhaseAndTick(m, xx, yy), (xx, yy) => buildFrameVectors(m, xx, yy)];
  for (;;) {
    while (mem8[IRQ_HEARTBEAT] < wait) yield;
    mem8[IRQ_HEARTBEAT] = 0;
    passes.forEach((p, k) => { if (k !== skip) [x, y] = p(x, y); });
  }
}
const TWINS = [
  ["waits for 8", { wait: 8 }], ["waits for 10", { wait: 10 }], ["skips the mode dispatch", { skip: 0 }],
  ["skips the phase tick", { skip: 1 }], ["skips the vector build", { skip: 2 }], ["seeds GAME_MODE=2", { seed: 2 }],
  ["skips the POKEY reset", { init: false }],
];
test("TEETH: every broken twin of the loop diverges on some arm, and the unbroken twin matches", () => {
  assert.equal(diff(oracleRun(0), genRun(0, (m) => twin(m, {}))), null, "the faithful twin must match");
  for (const [label, o] of TWINS) {
    const red = ARMS.some((_, i) => diff(oracleRun(i), genRun(i, (m) => twin(m, o))) !== null);
    assert.ok(red, `twin "${label}" survived every arm`);
  }
});

// Positive control for the settled-frame arms: on the oracle, some build takes the settled-frame early return
// with a Y that no drawing path leaves (not 1), and the next sound-loader entry stashes exactly that Y, so the
// STASH comparison above sees the Y the settled return hands back.
test("SETTLED-Y: a settled build's exit Y reaches the next stash on the settled-frame arms (oracle)", () => {
  for (const i of SETTLED) {
    const m = ARMS[i][1]();
    const call = m.call.bind(m);
    let settledY = null, carried = 0;
    m.call = (addr, ...a) => {
      if (addr === 0xb1b6) {
        const settled = m.mem.read8(VEC_LIST_HEADER_LO) === m.mem.read8(VECHEAD0_LEVEL) && m.mem.read8(LEVEL_LAYOUT_TRIGGER) === 0;
        const r = call(addr, ...a);
        if (settled && m.regs.y !== 0x01) settledY = m.regs.y;
        return r;
      }
      if (addr === 0xccc7 && settledY !== null) { if (m.regs.y === settledY) carried++; settledY = null; }
      return call(addr, ...a);
    };
    const read8 = m.mem.read8.bind(m.mem);
    let n = 0;
    m.mem.read8 = (a) => {
      const v = read8(a);
      if (a === IRQ_HEARTBEAT && m.pc === WAIT_PC && v < 9) { if (++n === 40) throw BOUND; burst(m, n); }
      return v;
    };
    try { oracle(m); } catch (e) { if (e !== BOUND) throw e; }
    assert.ok(carried > 0, `${ARMS[i][0]}: no settled build's Y reached a stash`);
  }
});
