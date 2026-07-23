// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for sub_011c ("silence the sound hardware": zero the
 * eight ls259.6h sound-trigger latches + their work-RAM shadow, the 0x6088-0x608B
 * sound-control block, the audio IRQ line, and the ls175.3d latch). It is a LEAF
 * (no calls) reached via m.call, first during BOOT -- bootInit calls it at ROM
 * 0x02B5 while the vblank NMI is still masked -- so it dispatches from a plain run
 * with no coin/start input, unlike loc_0a8a.
 *
 * Jobs:
 *   1. EQUAL (whole + unit) -- the idiomatic optimized sub_011c reads EQUAL against
 *      its translated oracle in RAM and in the full register file (+ pc). The
 *      override routes through the m.call registry (installed at construction), so
 *      the boot call at 0x02B5 dispatches it.
 *   2. DISPATCH -- the override must actually fire, or EQUAL is vacuous. sub_011c
 *      dispatches during boot; the run window covers it.
 *   3. SINGLE PATH + CYCLE TOTAL -- sub_011c is STRAIGHT-LINE (two fixed-count djnz
 *      loops, 8 and 4; no data-dependent branch), so the one path is what the gates
 *      exercise. Because its charges are collapsed, the test also pins the cycle
 *      TOTAL (440t) to the oracle's and shows a wrong total is caught.
 *   4. WRITE-TRACE -- sub_011c makes TEN hardware writes (eight ls259.6h latches
 *      staggered through loop 1, then AUDIO_IRQ + the 3d latch). The RAM+regs gate
 *      cannot see the emit.js --writes cycle column, so this proves each lands at
 *      the oracle's exact write-bus cycle -- and that a flat-collapsed variant that
 *      moves them is caught (teeth).
 *   5. TEETH (whole + unit) -- a deliberately-wrong output store is CAUGHT, naming
 *      the diverging address (0x6080, SND_TRIGGER[0]).
 *
 * WHY 0x6080 PERSISTS (whole-machine teeth). sub_011c zeroes the sound shadow at
 * 0x6080-0x608B during boot; the per-NMI sound driver sub_00e0 early-returns
 * (`ret nz` on ATTRACT 0x6007) throughout attract and never rewrites those bytes,
 * so a wrong value there survives every attract frame in the window -- the
 * representative "wrong value to one of the routine's own output addresses" bug.
 *
 * THE CYCLE FINDING this routine adds: sub_011c is ATOMIC, and PARTIALLY collapsed
 * like loc_0a8a. It is a boot.js-style routine that maintains no m.pc (uses m.tick,
 * not m.step, and ends `pop16`+tick rather than m.ret), so if the NMI ever landed
 * inside it fireNmi would THROW on pcKnown=false -- the game running is proof the
 * NMI never lands here, i.e. it is atomic on every call path. Its distribution
 * would therefore be free EXCEPT for the ten hardware writes, whose bus cycles the
 * write-trace test pins; so each loop-1 latch write is issued at the oracle's exact
 * cumulative cycle and the rest of the iteration collapses to one tick. The TOTAL
 * (440t) is still load-bearing: it is part of boot's cycle budget, so a wrong total
 * shifts the first post-boot NMI landing / spin count and the whole-machine gate
 * diverges.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { sub_011c as translated_011c } from "../../translated/boot.js";
import { sub_011c as optimized_011c } from "../sub_011c.js";
import { Machine } from "../../machine.js";
import { unitEquivalence, wholeMachineEquivalence } from "../harness.js";
import { firstStateDiff, firstRegDiff } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT
  ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR)))
  : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x011c;
const FRAMES = 12; // sub_011c dispatches during boot; window leaves downstream room

// sub_011c's own output store the teeth corrupt: 0x6080 (SND_TRIGGER[0], written
// 0). It sits in the compared work-RAM dump and the attract sound driver never
// rewrites it (see header), so a wrong value persists across the window.
const BROKEN_ADDR = 0x6080;

/**
 * Deliberately-broken twin: behaviourally the optimized handler EXCEPT the first
 * store to 0x6080 lands a wrong value (correct value XOR 0xFF, guaranteed to
 * differ). Intercepting exactly that one write lets the rest run verbatim -- the
 * representative "wrong value to one of the routine's own outputs" bug.
 */
function broken_011c(m) {
  const realWrite = m.mem.write8.bind(m.mem);
  let broke = false;
  m.mem.write8 = (addr, value, busOffset) => {
    if (!broke && addr === BROKEN_ADDR) {
      broke = true;
      return realWrite(addr, value ^ 0xff, busOffset);
    }
    return realWrite(addr, value, busOffset);
  };
  try {
    return optimized_011c(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

// -- pristine-entry capture (for the isolated single-path / cycle / trace checks) --

/** Capture the machine the instant sub_011c is FIRST entered (during boot). */
function captureEntry() {
  let entry = null;
  const snap = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_011c(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(FRAMES);
  if (entry === null) throw new Error("sub_011c never entered within the run window");
  return entry;
}

const ENTRY = ROM_PRESENT ? captureEntry() : null;

/** Run `fn` on a fresh clone of the entry; return {m, cycles spent}. */
function runClone(fn) {
  const c = ENTRY.clone();
  const c0 = c.cycles;
  fn(c);
  return { m: c, cycles: c.cycles - c0 };
}

/** Run `fn` on a fresh clone with hardware write-trace recording; return the
 *  trace as entry-relative {rel, addr, value} rows. */
function traceClone(fn) {
  const c = ENTRY.clone();
  c.mem.writeTrace = []; // clock is () => c.cycles from the constructor
  const c0 = c.cycles;
  fn(c);
  return c.mem.writeTrace.map((w) => ({ rel: w.cycle - c0, addr: w.addr, value: w.value }));
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized sub_011c matches translated every frame", () => {
  const r = wholeMachineEquivalence(ROM, {}, FRAMES, new Map([[TARGET, optimized_011c]]));

  // The override must actually have run, or EQUAL would be vacuous.
  assert.ok(
    r.invocations.get(TARGET) >= 1,
    `override at 0x${TARGET.toString(16)} never dispatched (invocations=${r.invocations.get(TARGET)})`,
  );
  assert.equal(
    r.equal,
    true,
    r.equal ? "" : `diverged at frame ${r.frame}, addr 0x${(r.addr ?? 0).toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
  assert.equal(r.framesCompared, FRAMES);
  console.log(
    `  EQUAL/whole: ${r.framesCompared} frames identical, ` +
      `override fired ${r.invocations.get(TARGET)}x (boot)`,
  );
});

test("EQUAL (unit): idiomatic optimized sub_011c matches translated in RAM + registers", () => {
  const r = unitEquivalence(ROM, {}, TARGET, translated_011c, optimized_011c, { maxFrames: FRAMES });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical");
});

// -- SINGLE PATH + CYCLE TOTAL ------------------------------------------------

test("SINGLE PATH + CYCLE TOTAL: the one straight-line path is EQUAL and preserves the total", () => {
  // sub_011c has no data-dependent branch (fixed loop counts 8 and 4): one path,
  // exercised in isolation here.
  const a = runClone(translated_011c);
  const b = runClone(optimized_011c);

  const ram = firstStateDiff(a.m.dumpState(), b.m.dumpState(), (off) => a.m.stateOffsetToAddr(off));
  const regs = firstRegDiff(a.m.regs, b.m.regs);
  assert.equal(ram, null, ram ? `RAM diff at 0x${ram.addr.toString(16)} (t ${ram.a} vs o ${ram.b})` : "");
  assert.equal(regs, null, regs ? `reg diff at ${regs.reg} (t ${regs.a} vs o ${regs.b})` : "");
  assert.equal(a.m.pc, b.m.pc, "pc must match");

  // Committed cycle teeth for the collapsed routine: the optimized total equals
  // the oracle's exactly.
  assert.equal(a.cycles, 440, `oracle total unexpectedly ${a.cycles}t (expected 440)`);
  assert.equal(b.cycles, a.cycles, `cycle total drifted: optimized ${b.cycles} vs oracle ${a.cycles}`);

  // ...and the assertion is not vacuous: a 1-cycle error in a collapsed charge
  // makes the totals disagree.
  const wrong = runClone((m) => {
    const realTick = m.tick.bind(m);
    let bumped = false;
    m.tick = (n) => { if (!bumped) { bumped = true; n -= 1; } return realTick(n); };
    try { return optimized_011c(m); } finally { m.tick = realTick; }
  });
  assert.notEqual(wrong.cycles, a.cycles, "cycle-total assertion has no teeth");
  console.log(`  CYCLE: optimized total ${b.cycles}t == oracle ${a.cycles}t; wrong-total caught`);
});

// -- WRITE-TRACE (the hardware-write bus cycles the RAM gate cannot see) -------

test("WRITE-TRACE: all ten hardware writes land at the oracle's exact bus cycle", () => {
  const oracleTrace = traceClone(translated_011c);
  const optTrace = traceClone(optimized_011c);

  // Eight ls259.6h latch writes staggered 35t apart (each `ld (hl),a` bus +4t, one
  // per 35t loop iteration: 0x7D00 @ +35, 0x7D01 @ +70, ... 0x7D07 @ +280), then
  // AUDIO_IRQ (0x7D80) @ +414 and the 3d latch (0x7C00) @ +427 (each `ld (nn),a`
  // bus +10t). All value 0.
  const expected = [];
  for (let k = 0; k < 8; k++) expected.push({ rel: 35 + 35 * k, addr: 0x7d00 + k, value: 0 });
  expected.push({ rel: 414, addr: 0x7d80, value: 0 });
  expected.push({ rel: 427, addr: 0x7c00, value: 0 });

  assert.deepEqual(oracleTrace, expected, "oracle hardware-write trace is not the expected ten writes");
  assert.deepEqual(optTrace, oracleTrace, "optimized hardware-write bus cycles differ from the oracle");

  // Teeth: a FLAT variant that issues the eight latch writes before charging any
  // cycle records them all at +4t -- proving the staggered charge is what pins the
  // trace.
  const flat = traceClone((m) => {
    const { regs, mem } = m;
    regs.b = 0x08; regs.xor(regs.a); regs.hl = 0x7d00; regs.de = 0x6080;
    for (let k = 0; k < 8; k++) {
      mem.write8(0x7d00 + k, regs.a, 4); // all at +4t, not staggered
      mem.write8(0x6080 + k, regs.a);
      regs.l = regs.inc8(regs.l); regs.e = regs.inc8(regs.e); regs.djnz();
    }
    m.tick(306); // prologue + loop 1 in one lump, AFTER the writes
    regs.b = 0x04;
    for (let j = 0; j < 4; j++) { mem.write8(regs.de, regs.a); regs.e = regs.inc8(regs.e); regs.djnz(); }
    m.tick(98);
    mem.write8(0x7d80, regs.a, 10);
    mem.write8(0x7c00, regs.a, 10);
    m.tick(36);
    m.pop16();
  });
  assert.notDeepEqual(flat, oracleTrace, "write-trace check has no teeth");
  console.log("  WRITE-TRACE: ten writes at +35..+280 / +414 / +427 identical to oracle; flat variant caught");
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong shadow store is CAUGHT and NOT-EQUAL", () => {
  const r = wholeMachineEquivalence(ROM, {}, FRAMES, new Map([[TARGET, broken_011c]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong shadow store is CAUGHT and names 0x6080", () => {
  const r = unitEquivalence(ROM, {}, TARGET, translated_011c, broken_011c, { maxFrames: FRAMES });

  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.ok(r.ram != null, "a caught divergence must name a RAM address");
  assert.equal(
    r.ram.addr,
    BROKEN_ADDR,
    `expected first diff at the broken address 0x${BROKEN_ADDR.toString(16)}, got 0x${r.ram.addr.toString(16)}`,
  );
  console.log(
    `  TEETH/unit: caught at 0x${r.ram.addr.toString(16)} ` +
      `(translated ${r.ram.a} vs broken ${r.ram.b})`,
  );
});
