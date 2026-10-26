// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for loc_3fd6 (ROM 0x3fd6, `jmp $3d57`): the tail-jump back into the endless self-test
// input loop. Entry is a REAL dispatch: the oracle loc_3d57 runs from crafted service-mode seeds and is cloned
// the moment it jumps to 0x3fd6 (a live run never gets there -- UNREACHED proves it, with positive controls).
// Neither side returns, so both are bounded identically: an instrumented write8 throws a sentinel at the
// second watchdog kick after entry (one whole loop pass, then the next pass's pacing walk), and a read budget
// throws if either side spins. Compared: RAM minus STACK_SCRATCH; no register live-out (it never returns).
// TEETH: a twin that eats one pacing phase is caught at $8a; the dispatch counter fires on a crafted run.
// Run: node --test games/centiped/idiomatic/test/equivalence-3fd6.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_3fd6 as oracle } from "../../translated/loc_3fd6.js";
import { loc_3d57 as oracleCaller } from "../../translated/loc_3d57.js";
import { loc_3fd6 } from "../loc_3fd6.js";
import { loc_3d57 } from "../loc_3d57.js";
import { Machine } from "../../machine.js";
import { buildRoutines } from "../../routines.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, WATCHDOG, loc_8a } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);
const TAPE = JSON.parse(readFileSync(new URL("../../tapes/coin_start_play.json", import.meta.url), "utf8"));

const TARGET = 0x3fd6;
const HEAD = 0x3d57; // input-test loop head: the only code that jumps here
const CHECKSUM_SCREEN = 0x3c97; // the only code that falls into HEAD
const RESET = 0x3b04; // reads the service switch and picks self-test vs game
const GAME_ENTRY = 0x200e; // the normal (service-released) exit of RESET
const LIVE_FRAMES = 720;
const READ_BUDGET = 2_000_000;

class Sentinel extends Error {}
class Spin extends Error {}

const inDeadStack = (a) => a != null && a >= STACK_SCRATCH.lo && a < STACK_SCRATCH.hi;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);

// Instrument one machine: the `kicks`-th watchdog write throws Sentinel, the read budget throws Spin.
function bound(m, kicks) {
  const mem = m.mem, w8 = mem.write8.bind(mem), r8 = mem.read8.bind(mem);
  const log = { first: null, kicks: 0, reads: 0 };
  mem.write8 = (a, v) => {
    if ((a & 0xffff) === WATCHDOG && ++log.kicks === kicks) throw new Sentinel();
    if (log.first === null) log.first = a & 0xffff;
    return w8(a, v);
  };
  mem.read8 = (a) => {
    if (++log.reads > READ_BUDGET) throw new Spin();
    return r8(a);
  };
  return log;
}

function stopOf(fn) {
  try { fn(); return "returned"; } catch (e) {
    if (e instanceof Sentinel) return "sentinel";
    if (e instanceof Spin) return "spin";
    throw e;
  }
}

// The 3d57 gate's service-mode seeds; $8a = 0x0f leaves a set pacing bit for each of three passes.
function commonRam(extra) {
  const r = {
    0xef: 0, 0xf3: 0, 0x91: 0x00, 0x92: 0x05,
    0xe6: 0, 0xe7: 0, 0xe8: 0, 0xe9: 0, 0xea: 0, 0xeb: 0, 0xec: 0, 0xed: 0,
    0xb9: 0x03, 0xbb: 0x02, 0x8d: 0x47, 0x8e: 0, 0x8f: 0, 0x90: 0, 0x93: 0, 0x94: 0,
    0x54: 0x10, 0x64: 0x20,
  };
  return Object.assign(r, extra || {});
}
function zeroTable(extra) {
  const r = commonRam(extra);
  for (let a = 0x0178; a <= 0x01b4; a++) r[a] = 0;
  return r;
}
const SEEDS = [
  { tag: "checksum changed: plots the delta", dsw1: 0x40, dsw2: 0x35, in1: 0x5a, ram: commonRam({ 0x01b5: 0x00, 0x0178: 0x11, 0x0190: 0x22 }) },
  { tag: "checksum stable: plots the score", dsw1: 0x00, dsw2: 0x00, in1: 0xff, ram: zeroTable({ 0x01b5: 0xff, 0x018b: 0x12, 0x018c: 0x34, 0x018d: 0x56 }) },
  { tag: "checksum stable, debounce edge on IN1 bit0", dsw1: 0x0c, dsw2: 0x10, in1: 0x01, ram: zeroTable({ 0xea: 0x01, 0x01b5: 0xff }) },
];

function seeded(s, overrides) {
  const m = new Machine(ROM, { overrides });
  m.io.pokeyRandom = () => 0xff;
  m.clockFree = true;
  m.io.dsw1 = s.dsw1; m.io.dsw2 = s.dsw2; m.io.in1 = s.in1;
  m.io.inputAssert = { 0: 0x20 }; // service held -> IN0 bit5 clear
  m.regs.s = 0xfa;
  for (const [a, v] of Object.entries(s.ram)) m.mem.write8(Number(a), v);
  m.mem.write8(loc_8a, 0x0f);
  return m;
}

// Clone the oracle loc_3d57 at its real jump to 0x3fd6, then give the clone a clean routine table.
function capture(s) {
  let cap = null;
  const m = seeded(s, new Map([[TARGET, (mm) => { cap = mm.clone(); throw new Sentinel(); }]]));
  bound(m, Infinity);
  assert.equal(stopOf(() => oracleCaller(m)), "sentinel", `${s.tag}: loc_3d57 never jumped to 0x3fd6`);
  cap.routines = buildRoutines();
  return cap;
}

function replay(cap, fn) {
  const m = cap.clone();
  m.io.pokeyRandom = () => 0xff;
  m.clockFree = true; // hold IN0's vblank bit at its captured value on both sides (the rewrite never ticks)
  const log = bound(m, 2);
  return { m, log, stop: stopOf(() => fn(m)) };
}

test("CAPTURE-REPLAY: from a real 0x3fd6 dispatch, loc_3fd6 == oracle in RAM (-stack) at the same bound", () => {
  for (const s of SEEDS) {
    const cap = capture(s);
    const o = replay(cap, oracle), c = replay(cap, loc_3fd6);
    assert.equal(o.stop, "sentinel", `${s.tag}: oracle stopped by ${o.stop}`);
    assert.equal(c.stop, "sentinel", `${s.tag}: rewrite stopped by ${c.stop}`);
    // Both tail-transfer into the 0x3d57 head: its pacing `lsr $8a` is the first write on each side.
    assert.equal(o.log.first, loc_8a, `${s.tag}: oracle did not enter 0x3d57`);
    assert.equal(c.log.first, loc_8a, `${s.tag}: rewrite did not enter 0x3d57`);
    assert.equal(ramDiff(o.m, c.m), null, `RAM: ${s.tag}`);
  }
  console.log(`  CAPTURE-REPLAY: ${SEEDS.length} real dispatches, one full pass + next pacing walk each`);
});

test("TEETH: a trampoline that eats one pacing phase is caught at $8a", () => {
  const broken = (m) => { m.mem8[loc_8a] = m.mem8[loc_8a] >> 1; return loc_3d57(m); };
  const cap = capture(SEEDS[0]);
  const o = replay(cap, oracle), b = replay(cap, broken);
  assert.equal(b.stop, "sentinel", `broken twin stopped by ${b.stop}`);
  const d = ramDiff(o.m, b.m);
  assert.notEqual(d, null, "the RAM diff FAILED to catch the broken twin");
  assert.equal(d.addr, loc_8a, `caught at 0x${(d.addr ?? 0).toString(16)}, expected $8a`);
});

// Count dispatches at the listed addresses; TARGET is counted then run (the caller bounds the run).
function counting(addrs) {
  const base = buildRoutines(), seen = {};
  const overrides = new Map(addrs.map((a) => {
    seen[a] = 0;
    const f = base.get(a);
    return [a, (mm, ...x) => { seen[a]++; return f(mm, ...x); }];
  }));
  return { seen, overrides };
}

test("UNREACHED: live runs take the game exit of reset and never dispatch 0x3fd6 or its callers", () => {
  for (const [label, tape] of [["undriven", null], ["coin-start-play", TAPE]]) {
    const { seen, overrides } = counting([TARGET, HEAD, CHECKSUM_SCREEN, RESET, GAME_ENTRY]);
    const m = new Machine(ROM, { overrides });
    if (tape) m.inputTape = tape;
    m.runFrames(LIVE_FRAMES);
    assert.equal(m.stoppedBy, null, `${label} run stopped early: ${m.stoppedBy}`);
    assert.equal(seen[RESET], 1, `${label}: reset did not run once`);
    assert.ok(seen[GAME_ENTRY] > 0, `${label}: reset never took the game exit, so the zeros prove nothing`);
    for (const a of [TARGET, HEAD, CHECKSUM_SCREEN]) {
      assert.equal(seen[a], 0, `${label}: 0x${a.toString(16)} was dispatched on a genuine live run`);
    }
    console.log(`  UNREACHED: ${label} -- reset 1, game exit ${seen[GAME_ENTRY]}, 0x3fd6/0x3d57/0x3c97 0`);
  }
  // Positive control: the same counter DOES see 0x3fd6 when loc_3d57 actually runs.
  const { seen, overrides } = counting([TARGET]);
  const m = seeded(SEEDS[1], overrides);
  bound(m, 2);
  assert.equal(stopOf(() => oracleCaller(m)), "sentinel");
  assert.equal(seen[TARGET], 1, "the counter missed a real 0x3fd6 dispatch");
});
