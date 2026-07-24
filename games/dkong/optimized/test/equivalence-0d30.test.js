// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for sub_0d30 (the shared two-band VRAM filler: 17 cells
 * 0xFD, skip 15, 17 cells 0xFC, from a caller-supplied HL). Reached via m.call ONLY
 * from sub_0d27 (twice — a real call then a fall-through tail), itself on the 75m arm
 * (loc_0cf2) of the board-setup cascade, dispatched by dispatchGameState in the NMI.
 *
 * sub_0d30 is ATOMIC (runs only inside the mask-cleared NMI; a leaf) and COLLAPSED to
 * one 1021 t total. There is NO data-dependent branch (both loop counts are the
 * immediate 0x11), so the one path is what all gates exercise.
 *
 * Like equivalence-0d27, it drives a coin+start tape AND installs an identical-both-
 * sides driver that forces BOARD=3 whenever loc_0c92 runs, so the 75m arm dispatches
 * and sub_0d27's `call 0x0d30` enters sub_0d30. Both sides get the driver via the
 * shared factory; only sub_0d30 itself differs between baseline and optimized.
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { sub_0d30 as translated_0d30 } from "../../translated/state0.js";
import { loc_0c92 as translated_0c92 } from "../../translated/nmi.js";
import { sub_0d30 as optimized_0d30 } from "../sub_0d30.js";
import { Machine } from "../../machine.js";
import {
  wholeMachineEquivalence as coreWholeMachineEquivalence,
  unitEquivalence as coreUnitEquivalence,
  firstStateDiff,
  firstRegDiff,
} from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x0d30;
const FRAMES = 1100; // sub_0d30 fires twice, by frame ~1025 (when loc_0cf2 -> sub_0d27 runs)

const COIN_START_TAPE = [
  { port: 0x7d00, bits: 0x80, frame: 60, dur: 6 }, // coin
  { port: 0x7d00, bits: 0x04, frame: 90, dur: 6 }, // start1
];

const driverEntries = () => [[0x0c92, (mm) => { mm.mem.write8(0x6227, 3); return translated_0c92(mm); }]];

const makeMachine = (overrides) => {
  const merged = new Map(driverEntries());
  if (overrides) for (const [k, v] of overrides instanceof Map ? overrides : Object.entries(overrides)) merged.set(typeof k === "number" ? k : parseInt(k, 16), v);
  const m = new Machine(ROM, { overrides: merged });
  m.inputTape = COIN_START_TAPE.map((t) => ({ ...t }));
  return m;
};

// sub_0d30's first write on its first call is HL=0x770D <- 0xFD (a static background
// tile laid once at board setup, in the compared video-RAM dump).
const BROKEN_ADDR = 0x770d;
function broken_0d30(m) {
  const realWrite = m.mem.write8.bind(m.mem);
  let broke = false;
  m.mem.write8 = (addr, value, busOffset) => {
    if (!broke && addr === BROKEN_ADDR) { broke = true; return realWrite(addr, value ^ 0xff, busOffset); }
    return realWrite(addr, value, busOffset);
  };
  try { return optimized_0d30(m); } finally { m.mem.write8 = realWrite; }
}

function captureEntry() {
  let entry = null;
  const snap = new Map([[TARGET, (mm) => { if (entry === null) entry = mm.clone(); return translated_0d30(mm); }]]);
  const host = makeMachine(snap);
  host.runFrames(FRAMES);
  if (entry === null) throw new Error("sub_0d30 never entered within the run window");
  return entry;
}
const ENTRY = ROM_PRESENT ? captureEntry() : null;
function runClone(fn) {
  const c = ENTRY.clone();
  const c0 = c.cycles;
  fn(c);
  return { m: c, cycles: c.cycles - c0 };
}

test("EQUAL (whole-machine): collapsed sub_0d30 matches translated every frame", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, optimized_0d30]]));
  assert.ok(r.invocations.get(TARGET) >= 2, `override never dispatched enough (invocations=${r.invocations.get(TARGET)})`);
  assert.equal(r.equal, true, r.equal ? "" : `diverged at frame ${r.frame}, addr 0x${(r.addr ?? 0).toString(16)} (baseline ${r.baseline} vs optimized ${r.optimized})`);
  assert.equal(r.framesCompared, FRAMES);
  console.log(`  EQUAL/whole: ${r.framesCompared} frames identical, override fired ${r.invocations.get(TARGET)}x`);
});

test("EQUAL (unit): collapsed sub_0d30 matches translated in RAM + registers", () => {
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_0d30, optimized_0d30, { maxFrames: FRAMES + 100 });
  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical");
});

test("SINGLE PATH + CYCLE TOTAL: the one path is EQUAL and preserves the 1021 t total", () => {
  const a = runClone(translated_0d30);
  const b = runClone(optimized_0d30);
  const ram = firstStateDiff(a.m.dumpState(), b.m.dumpState(), (off) => a.m.stateOffsetToAddr(off));
  const regs = firstRegDiff(a.m.regs, b.m.regs);
  assert.equal(ram, null, ram ? `RAM diff at 0x${ram.addr.toString(16)} (t ${ram.a} vs o ${ram.b})` : "");
  assert.equal(regs, null, regs ? `reg diff at ${regs.reg} (t ${regs.a} vs o ${regs.b})` : "");
  assert.equal(a.m.pc, b.m.pc, "pc must match");
  assert.equal(b.cycles, a.cycles, `cycle total drifted: optimized ${b.cycles} vs oracle ${a.cycles}`);
  // teeth: a 1-cycle error in the collapsed ret total makes the totals disagree.
  const wrong = runClone((mm) => {
    const realRet = mm.ret.bind(mm);
    mm.ret = (cyc = 10) => realRet(cyc - 1);
    try { return optimized_0d30(mm); } finally { mm.ret = realRet; }
  });
  assert.notEqual(wrong.cycles, a.cycles, "cycle-total assertion has no teeth");
  console.log(`  CYCLE: optimized total ${b.cycles}t == oracle ${a.cycles}t; wrong-total caught`);
});

test("TEETH (whole-machine): a wrong VRAM fill store is CAUGHT and NOT-EQUAL", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, broken_0d30]]));
  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(`  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)}`);
});

test("TEETH (unit): a wrong VRAM fill store is CAUGHT and names 0x770D", () => {
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_0d30, broken_0d30, { maxFrames: FRAMES + 100 });
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.ok(r.ram != null, "a caught divergence must name a RAM address");
  assert.equal(r.ram.addr, BROKEN_ADDR, `expected first diff at 0x${BROKEN_ADDR.toString(16)}, got 0x${r.ram.addr.toString(16)}`);
  console.log(`  TEETH/unit: caught at 0x${r.ram.addr.toString(16)} (translated ${r.ram.a} vs broken ${r.ram.b})`);
});
