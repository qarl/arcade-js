// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for bootInit (ROM 0x18d4): lxi sp / mvi b,0 / initWorkRam (0x01e6) / redrawScorePanel
// (0x1956) / fall into enterAttractCycle (0x18df). Entry is CAPTURED at the real reset dispatch (loc_0000's
// m.call(0x18d4)) on a fresh Machine. BOUND: 0x18df is the never-returning attract loop, so a registry hook
// there records (pc, SP) and throws a sentinel; the idiomatic side returns its unstarted generator. Compared:
// RAM minus stack scratch below the seated SP at that hand-off. SP (oracle seats 0x2400) is not compared: the idiomatic spine is
// stack-free and the whole-game tape gates it. HAND-OFF: the return is an enterAttractCycle generator.
// CRAFTED: B poisoned at entry on both sides (the ROM seats B=0 itself). TEETH: twins skipping initWorkRam /
// redrawScorePanel diverge at real cells; a twin handing to runAttractCycle fails the hand-off check.
// Run: node --test games/invaders/idiomatic/test/equivalence-18d4.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_18d4 as oracle } from "../../translated/loc_18d4.js";
import { bootInit } from "../bootInit.js";
import { initWorkRam } from "../initWorkRam.js";
import { redrawScorePanel } from "../redrawScorePanel.js";
import { enterAttractCycle } from "../enterAttractCycle.js";
import { runAttractCycle } from "../runAttractCycle.js";
import { Machine } from "../../machine.js";
import { firstStateDiff, deadStackBelow } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, ALIEN_DRAW_PENDING, VIDEO_RAM_BASE, VIDEO_RAM_END, loc_20cf } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x18d4;
const HANDOFF = 0x18df;
const BOOT_SP = 0x2400; // the routine's own `lxi sp`: no caller frame survives it, so this is the live floor
const STOP = Symbol("bootInit-bound");
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, BOOT_SP);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);

// Clone at the real dispatch, then stop the boot. The registry is shared by every clone, so the 0x18df
// hook also bounds each oracle replay, recording where it handed off.
function captureEntry() {
  let entry = null;
  const hooks = new Map([
    [TARGET, (mm) => { entry = mm.clone(); throw STOP; }],
    [HANDOFF, (mm) => { mm.handoff = { pc: mm.pc, sp: mm.regs.sp, hits: (mm.handoff?.hits ?? 0) + 1 }; throw STOP; }],
  ]);
  try { new Machine(ROM, { overrides: hooks }).runFrames(2); } catch (e) { if (e !== STOP) throw e; }
  return entry;
}
const ENTRY = ROM_PRESENT ? captureEntry() : null;

// Oracle replay bounded at 0x18df; also tracks the deepest stack write to prove the exclusion covers it.
function runOracle(entry = ENTRY) {
  const o = entry.clone();
  let minSp = 0x10000;
  const push16 = o.push16.bind(o);
  o.push16 = (v) => { push16(v); minSp = Math.min(minSp, o.regs.sp); };
  assert.throws(() => oracle(o), (e) => e === STOP, "oracle did not stop at the 0x18df hand-off");
  return { o, minSp };
}

const isAttractJoin = (g) =>
  g != null && typeof g.next === "function" && Object.getPrototypeOf(g) === enterAttractCycle.prototype;

test("HARNESS: real reset entry captured; oracle reaches 0x18df once with SP seated; stack fits the exclusion", () => {
  assert.ok(ENTRY, "0x18d4 was never dispatched by the reset vector");
  assert.equal(ENTRY.regs.sp, 0, "entry is not the reset register state");
  const { o, minSp } = runOracle();
  assert.deepEqual(o.handoff, { pc: HANDOFF, sp: BOOT_SP, hits: 1 });
  assert.ok(minSp >= STACK_SCRATCH.lo, `oracle stack reached ${hx(minSp)}, below STACK_SCRATCH`);
  // positive control: both callees left output (template byte 0 is 1; the panel paints video RAM)
  assert.notEqual(o.mem.read8(ALIEN_DRAW_PENDING), 0, "initWorkRam did not run on the oracle");
  let painted = 0;
  for (let a = VIDEO_RAM_BASE; a < VIDEO_RAM_END; a++) painted |= o.mem.read8(a);
  assert.notEqual(painted, 0, "redrawScorePanel did not paint on the oracle");
});

test("EQUAL: bootInit == oracle in RAM (-stack) at the 0x18df hand-off; returns the unstarted attract join", () => {
  const { o } = runOracle();
  const c = ENTRY.clone();
  const g = bootInit(c);
  const d = ramDiff(o, c);
  assert.equal(d, null, d && `RAM diverged at ${hx(d.addr ?? 0)} (oracle=${d.a} idiomatic=${d.b})`);
  assert.ok(isAttractJoin(g), "bootInit did not hand off to enterAttractCycle");
  assert.notEqual(c.mem.read8(loc_20cf), 0x08, "the attract join ran eagerly (0x20cf seeded before hand-off)");
});

// The ROM seats B=0 itself (mvi b,0), so the boot must not depend on the B it is entered with.
test("EQUAL (crafted): B poisoned at entry on both sides, bootInit still == oracle", () => {
  for (const b of [0x05, 0xc0]) {
    const entry = ENTRY.clone(); entry.regs.b = b;
    const { o } = runOracle(entry);
    const c = entry.clone(); bootInit(c);
    const d = ramDiff(o, c);
    assert.equal(d, null, d && `B=${hx(b)}: RAM diverged at ${hx(d.addr ?? 0)} (oracle=${d.a} idiomatic=${d.b})`);
  }
});

test("TEETH: a twin that skips initWorkRam is caught in work RAM", () => {
  const twin = (m) => { redrawScorePanel(m); return enterAttractCycle(m); };
  const { o } = runOracle();
  const c = ENTRY.clone(); twin(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a skipped initWorkRam");
  assert.ok(d.addr >= ALIEN_DRAW_PENDING && d.addr < ALIEN_DRAW_PENDING + 0x100, `caught at ${hx(d.addr ?? 0)}`);
});

test("TEETH: a twin that skips redrawScorePanel is caught at a real cell", () => {
  const twin = (m) => { initWorkRam(m, 0); return enterAttractCycle(m); };
  const { o } = runOracle();
  const c = ENTRY.clone(); twin(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a skipped redrawScorePanel");
  assert.ok(d.addr != null && !inDeadStack(d.addr), `caught at ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH: skipped panel caught at ${hx(d.addr)}`);
});

test("TEETH: a twin that hands off to runAttractCycle (skipping the join) fails the hand-off check", () => {
  const twin = (m) => { initWorkRam(m, 0); redrawScorePanel(m); return runAttractCycle(m); };
  const { o } = runOracle();
  const c = ENTRY.clone();
  const g = twin(c);
  assert.equal(ramDiff(o, c), null, "control: the twin's RAM matches, so only the hand-off check can catch it");
  assert.equal(isAttractJoin(g), false, "the hand-off check FAILED to catch the wrong successor");
});
