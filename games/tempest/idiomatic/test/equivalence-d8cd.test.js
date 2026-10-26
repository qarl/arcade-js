// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for runPowerOnToneBursts (ROM 0xd8cd, second entry of playPowerOnTone.js) vs the frozen
// loc_d8cd. Inputs are registers Y (stored at SEG_SPREAD_A_LO_1) and A (pass total); its only caller is d931's
// jmp (self-test RAM-fault path, never hit in a normal boot), so the real dispatch is captured by running the
// frozen loc_d931 with 0xd8cd hooked. Contract: RAM minus STACK_SCRATCH, plus a TONE arm comparing the ordered
// POKEY/LED writes and watchdog strobes up to the tail (the pass count is invisible to RAM). No register
// live-out: the routine tail-jumps to da0a, which never returns. The oracle busy-waits on the 3kHz clock and
// never returns, so it runs under a cycle BUDGET until its terminal spin trips FramesComplete (as d8ca's gate).
// Run: node --test games/tempest/idiomatic/test/equivalence-d8cd.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_d8cd as oracle } from "../../translated/loc_d8ca.js";
import { loc_d931 } from "../../translated/loc_d931.js";
import { runPowerOnToneBursts } from "../playPowerOnTone.js";
import { Machine, FramesComplete, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH, MODE_DISPATCH_SEL, SEG_SPREAD_A_LO_1, PENDING_WORK_FLAGS, loc_2e, loc_2f, SEG_SPREAD_A_LO,
  POKEY1_AUDF1, POKEY1_AUDC1, LED_FLIP_LATCH, WATCHDOG_CLEAR,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xd8cd;
const BUDGET = 48000000; // d8ca's 40M plus headroom for up to four tone passes (~1.3M cycles each)
const inDeadStack = (a) => a != null && a >= STACK_SCRATCH.lo && a < STACK_SCRATCH.hi;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
const freezePokey = (m) => { for (const p of m.io.pokeys) p.skctl &= ~0x03; return m; };

// The tail frame seed d8ca's gate uses, so da62 builds a real frame before its exit poll.
function seedTail(m) {
  m.mem.write8(PENDING_WORK_FLAGS, 0x00);
  m.mem.write8(loc_2e, 0x37);
  m.mem.write8(loc_2f, 0x12);
  m.mem.write8(SEG_SPREAD_A_LO + 0x01, 0x01);
  return freezePokey(m);
}

// Log tone writes as [addr, value, watchdog strobes since the last one]; the first write outside the tone
// cells (the checksum tail's pointer seed, both sides) closes the log with ["tail", strobes].
const TONE = new Set([SEG_SPREAD_A_LO_1, POKEY1_AUDF1, POKEY1_AUDC1, LED_FLIP_LATCH, WATCHDOG_CLEAR]);
function toneLog(m) {
  const log = [], write8 = m.mem.write8.bind(m.mem);
  let kicks = 0, open = true;
  m.mem.write8 = (addr, v) => {
    if (open && !TONE.has(addr)) { open = false; log.push(["tail", kicks]); }
    else if (open && addr === WATCHDOG_CLEAR) kicks++;
    else if (open && addr !== SEG_SPREAD_A_LO_1) { log.push([addr, v & 0xff, kicks]); kicks = 0; }
    return write8(addr, v);
  };
  return log;
}

function runBoundedOracle(m) {
  m.nextIrqCycle = Infinity;
  m.maxCycles = m.cycles + BUDGET;
  try { oracle(m); return "returned"; }
  catch (e) {
    if (e instanceof FramesComplete) return "done";
    if (e && e.name === "NotImplemented") return "notimpl";
    throw e;
  }
}
function runIdiomatic(fn, m) {
  try { fn(m); return "returned"; }
  catch (e) { if (e && e.name === "NotImplemented") return "notimpl"; throw e; }
}

// Real dispatch: the frozen caller d931 (A -> Y, $01 & 0x1f -> A) jmps to the hooked 0xd8cd.
const STOP = new Error("captured");
function captureFromCaller(a, sel) {
  const caps = [];
  const hook = new Map([[TARGET, (mm) => { caps.push(mm.clone()); throw STOP; }]]);
  const m = seedTail(new Machine(ROM, { overrides: hook, ...OPTS }));
  m.regs.a = a; m.mem.write8(MODE_DISPATCH_SEL, sel);
  try { loc_d931(m); } catch (e) { if (e !== STOP) throw e; }
  return caps;
}
const CAPS = ROM_PRESENT ? captureFromCaller(0x20, 0x07) : [];

// A crafted entry is the real d931 dispatch with only the Y/A inputs poked.
function crafted(y, a) {
  const m = freezePokey(CAPS[0].clone());
  m.regs.y = y; m.regs.a = a;
  return m;
}
// [label, entry state, expected tone passes = ((A>>2)<<1) + (Y low nibble zero) + 1]
const ARMS = [
  ["caller d931: Y=0x20 A=0x07 (low nibble zero)", () => CAPS[0], 4],
  ["Y=0x05 A=0x04 (low nibble nonzero)", () => crafted(0x05, 0x04), 3],
  ["Y=0x10 A=0x00 (low nibble zero, A adds none)", () => crafted(0x10, 0x00), 2],
  ["Y=0x08 A=0x00 (low nibble nonzero, bit 3 only)", () => crafted(0x08, 0x00), 1],
];
const memo = new Map();
function oracleRun(i) {
  if (!memo.has(i)) {
    const o = ARMS[i][1]().clone(); freezePokey(o);
    const log = toneLog(o);
    memo.set(i, { o, log, status: runBoundedOracle(o) });
  }
  return memo.get(i);
}
function idiomaticRun(i, fn = runPowerOnToneBursts) {
  const c = ARMS[i][1]().clone(); freezePokey(c);
  const log = toneLog(c);
  return { c, log, status: runIdiomatic(fn, c) };
}

test("CAPTURE: real 0xd8cd dispatch from d931 -- positive control + ABI registers", () => {
  assert.equal(CAPS.length, 1, "positive control: d931's jmp to 0xd8cd was not captured");
  assert.equal(CAPS[0].regs.y, 0x20, "d931 hands the stored byte in Y");
  assert.equal(CAPS[0].regs.a, 0x07, "d931 hands the pass seed in A");
});

ARMS.forEach(([label, , passes], i) => {
  test(`ARM (${label}): RAM equal (-stack) and TONE writes equal`, (t) => {
    const { o, log: ol, status } = oracleRun(i);
    if (status === "notimpl") { t.skip("oracle hit a stubbed draw arm"); return; }
    assert.equal(status, "done", "oracle reached its terminal spin");
    const { c, log: cl, status: cs } = idiomaticRun(i);
    if (cs === "notimpl") { t.skip("idiomatic hit a stubbed draw arm"); return; }
    assert.equal(ol.filter((e) => e[0] === POKEY1_AUDC1 && e[1] === 0xa2).length, passes, "oracle burst count");
    assert.deepEqual(cl, ol, "tone write sequence + watchdog strobes");
    assert.equal(ramDiff(o, c), null);
  });
});

test("TEETH: Y/A-swapped twin diverges at SEG_SPREAD_A_LO_1; extra-pass twin diverges in TONE", (t) => {
  const { o, log: ol, status } = oracleRun(1);
  if (status === "notimpl") { t.skip("TEETH: oracle hit a stubbed draw arm"); return; }
  const swapped = idiomaticRun(1, (m) => runPowerOnToneBursts(m, m.regs.a, m.regs.a)); // BUG: stores A, not Y
  if (swapped.status === "notimpl") { t.skip("TEETH: idiomatic hit a stubbed draw arm"); return; }
  assert.equal(ramDiff(o, swapped.c)?.addr, SEG_SPREAD_A_LO_1, "Y/A swap NOT caught at the stored byte");
  const extra = idiomaticRun(1, (m) => runPowerOnToneBursts(m, m.regs.y, m.regs.a + 4)); // BUG: two extra passes
  assert.notDeepEqual(extra.log, ol, "extra tone passes NOT caught by the TONE arm");
});

test("SP-TOOTH: runPowerOnToneBursts (omitted-ret tail-delegator) is seam-placeable", (t) => {
  const probe = crafted(0x10, 0x00);
  if (runIdiomatic(runPowerOnToneBursts, probe) === "notimpl") { t.skip("SP-TOOTH: stubbed draw arm"); return; }
  const m = crafted(0x10, 0x00);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
  const r = seamPlaceable(withOmittedRet, runPowerOnToneBursts, TARGET, m);
  assert.equal(r.placeable, true, `runPowerOnToneBursts must be seam-placeable; got: ${r.error}`);
});
