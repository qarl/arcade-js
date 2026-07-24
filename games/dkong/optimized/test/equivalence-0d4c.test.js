// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence tests for sub_0d4c (the shared 4-cell two-band VRAM filler: 4 cells 0xFD,
 * skip 28, 4 cells 0xFC, from a caller-supplied HL). Reached via m.call ONLY from
 * sub_0d43 (twice), on the 100m board-4 setup path, dispatched by dispatchGameState in
 * the NMI. ATOMIC + COLLAPSED to one 267 t total; no data-dependent branch (loop
 * counts are the immediate 0x04).
 *
 * Driven like equivalence-0d43: coin+start + an identical-both-sides BOARD=4 driver on
 * loc_0c92, so its board-4 arm -> sub_0d43 -> sub_0d4c.
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { sub_0d4c as translated_0d4c } from "../../translated/state0.js";
import { loc_0c92 as translated_0c92 } from "../../translated/nmi.js";
import { sub_0d4c as optimized_0d4c } from "../sub_0d4c.js";
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

const TARGET = 0x0d4c;
const FRAMES = 1100;
const COIN_START_TAPE = [
  { port: 0x7d00, bits: 0x80, frame: 60, dur: 6 },
  { port: 0x7d00, bits: 0x04, frame: 90, dur: 6 },
];
const driverEntries = () => [[0x0c92, (mm) => { mm.mem.write8(0x6227, 4); return translated_0c92(mm); }]];
const makeMachine = (overrides) => {
  const merged = new Map(driverEntries());
  if (overrides) for (const [k, v] of overrides instanceof Map ? overrides : Object.entries(overrides)) merged.set(typeof k === "number" ? k : parseInt(k, 16), v);
  const m = new Machine(ROM, { overrides: merged });
  m.inputTape = COIN_START_TAPE.map((t) => ({ ...t }));
  return m;
};

const BROKEN_ADDR = 0x7687; // sub_0d4c's first write on its first call (HL=0x7687)
function broken_0d4c(m) {
  const realWrite = m.mem.write8.bind(m.mem);
  let broke = false;
  m.mem.write8 = (addr, value, busOffset) => {
    if (!broke && addr === BROKEN_ADDR) { broke = true; return realWrite(addr, value ^ 0xff, busOffset); }
    return realWrite(addr, value, busOffset);
  };
  try { return optimized_0d4c(m); } finally { m.mem.write8 = realWrite; }
}

function captureEntry() {
  let entry = null;
  const snap = new Map([[TARGET, (mm) => { if (entry === null) entry = mm.clone(); return translated_0d4c(mm); }]]);
  const host = makeMachine(snap);
  host.runFrames(FRAMES);
  if (entry === null) throw new Error("sub_0d4c never entered within the run window");
  return entry;
}
const ENTRY = ROM_PRESENT ? captureEntry() : null;
function runClone(fn) {
  const c = ENTRY.clone();
  const c0 = c.cycles;
  fn(c);
  return { m: c, cycles: c.cycles - c0 };
}

test("EQUAL (whole-machine): collapsed sub_0d4c matches translated every frame", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, optimized_0d4c]]));
  assert.ok(r.invocations.get(TARGET) >= 2, `override never dispatched enough (invocations=${r.invocations.get(TARGET)})`);
  assert.equal(r.equal, true, r.equal ? "" : `diverged at frame ${r.frame}, addr 0x${(r.addr ?? 0).toString(16)} (baseline ${r.baseline} vs optimized ${r.optimized})`);
  assert.equal(r.framesCompared, FRAMES);
  console.log(`  EQUAL/whole: ${r.framesCompared} frames identical, override fired ${r.invocations.get(TARGET)}x`);
});

test("EQUAL (unit): collapsed sub_0d4c matches translated in RAM + registers", () => {
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_0d4c, optimized_0d4c, { maxFrames: FRAMES + 100 });
  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical");
});

test("SINGLE PATH + CYCLE TOTAL: the one path is EQUAL and preserves the 267 t total", () => {
  const a = runClone(translated_0d4c);
  const b = runClone(optimized_0d4c);
  const ram = firstStateDiff(a.m.dumpState(), b.m.dumpState(), (off) => a.m.stateOffsetToAddr(off));
  const regs = firstRegDiff(a.m.regs, b.m.regs);
  assert.equal(ram, null, ram ? `RAM diff at 0x${ram.addr.toString(16)}` : "");
  assert.equal(regs, null, regs ? `reg diff at ${regs.reg}` : "");
  assert.equal(a.m.pc, b.m.pc, "pc must match");
  assert.equal(b.cycles, a.cycles, `cycle total drifted: optimized ${b.cycles} vs oracle ${a.cycles}`);
  const wrong = runClone((mm) => {
    const realRet = mm.ret.bind(mm);
    mm.ret = (cyc = 10) => realRet(cyc - 1);
    try { return optimized_0d4c(mm); } finally { mm.ret = realRet; }
  });
  assert.notEqual(wrong.cycles, a.cycles, "cycle-total assertion has no teeth");
  console.log(`  CYCLE: optimized total ${b.cycles}t == oracle ${a.cycles}t; wrong-total caught`);
});

test("TEETH (whole-machine): a wrong VRAM fill store is CAUGHT and NOT-EQUAL", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, broken_0d4c]]));
  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(`  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)}`);
});

test("TEETH (unit): a wrong VRAM fill store is CAUGHT and names 0x7687", () => {
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_0d4c, broken_0d4c, { maxFrames: FRAMES + 100 });
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store");
  assert.ok(r.ram != null, "a caught divergence must name a RAM address");
  assert.equal(r.ram.addr, BROKEN_ADDR, `expected first diff at 0x${BROKEN_ADDR.toString(16)}, got 0x${r.ram.addr.toString(16)}`);
  console.log(`  TEETH/unit: caught at 0x${r.ram.addr.toString(16)}`);
});
