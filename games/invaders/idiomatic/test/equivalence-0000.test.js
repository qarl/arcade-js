// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for resetEntry (ROM 0x0000): three NOPs, jmp 0x18d4 (bootInit). Entry is CAPTURED at
// the real reset dispatch (Machine.reset's m.call(0x0000)) on a fresh Machine. BOUND: the oracle runs the
// translated boot through to 0x18df (the never-returning attract loop), where a registry hook records
// (pc, SP) and throws a sentinel; the idiomatic side returns bootInit's unstarted generator. Compared: RAM
// minus STACK_SCRATCH at that hand-off; SP is not compared (stack-free idiomatic spine, gated whole-game).
// HAND-OFF: the return is an enterAttractCycle generator. TEETH: a twin that jumps straight to the attract
// join (no boot init) is caught in work RAM; a twin that drops the hand-off fails the hand-off check.
// Run: node --test games/invaders/idiomatic/test/equivalence-0000.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0000 as oracle } from "../../translated/loc_0000.js";
import { resetEntry } from "../resetEntry.js";
import { bootInit } from "../bootInit.js";
import { enterAttractCycle } from "../enterAttractCycle.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, ALIEN_DRAW_PENDING, loc_20cf } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x0000;
const HANDOFF = 0x18df;
const BOOT_SP = 0x2400;
const STOP = Symbol("resetEntry-bound");
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = (a) => a != null && a >= STACK_SCRATCH.lo && a < STACK_SCRATCH.hi;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);

// Clone at the real dispatch, then stop the boot. The registry is shared by every clone, so the 0x18df
// hook also bounds each oracle replay (0x18d4 stays the translated oracle).
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

function runOracle() {
  const o = ENTRY.clone();
  let minSp = 0x10000;
  const push16 = o.push16.bind(o);
  o.push16 = (v) => { push16(v); minSp = Math.min(minSp, o.regs.sp); };
  assert.throws(() => oracle(o), (e) => e === STOP, "oracle did not stop at the 0x18df hand-off");
  return { o, minSp };
}

const isAttractJoin = (g) =>
  g != null && typeof g.next === "function" && Object.getPrototypeOf(g) === enterAttractCycle.prototype;

test("HARNESS: real reset entry captured; oracle boots through to 0x18df once; stack fits the exclusion", () => {
  assert.ok(ENTRY, "0x0000 was never dispatched by reset");
  assert.equal(ENTRY.regs.sp, 0, "entry is not the reset register state");
  const { o, minSp } = runOracle();
  assert.deepEqual(o.handoff, { pc: HANDOFF, sp: BOOT_SP, hits: 1 });
  assert.ok(minSp >= STACK_SCRATCH.lo, `oracle stack reached ${hx(minSp)}, below STACK_SCRATCH`);
  assert.notEqual(o.mem.read8(ALIEN_DRAW_PENDING), 0, "positive control: boot init did not run on the oracle");
});

test("EQUAL: resetEntry == oracle in RAM (-stack) at the 0x18df hand-off; returns the unstarted attract join", () => {
  const { o } = runOracle();
  const c = ENTRY.clone();
  const g = resetEntry(c);
  const d = ramDiff(o, c);
  assert.equal(d, null, d && `RAM diverged at ${hx(d.addr ?? 0)} (oracle=${d.a} idiomatic=${d.b})`);
  assert.ok(isAttractJoin(g), "resetEntry did not hand off to enterAttractCycle");
  assert.notEqual(c.mem.read8(loc_20cf), 0x08, "the attract join ran eagerly (0x20cf seeded before hand-off)");
});

test("TEETH: a twin that jumps straight to the attract join (no boot init) is caught in work RAM", () => {
  const twin = (m) => enterAttractCycle(m);
  const { o } = runOracle();
  const c = ENTRY.clone();
  assert.ok(isAttractJoin(twin(c)), "control: the twin's hand-off is right, so only the RAM diff can catch it");
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a skipped boot init");
  assert.ok(d.addr >= ALIEN_DRAW_PENDING && d.addr < ALIEN_DRAW_PENDING + 0x100, `caught at ${hx(d.addr ?? 0)}`);
});

test("TEETH: a twin that runs boot init but drops the hand-off fails the hand-off check", () => {
  const twin = (m) => { bootInit(m); };
  const { o } = runOracle();
  const c = ENTRY.clone();
  const g = twin(c);
  assert.equal(ramDiff(o, c), null, "control: the twin's RAM matches, so only the hand-off check can catch it");
  assert.equal(isAttractJoin(g), false, "the hand-off check FAILED to catch the dropped hand-off");
});
