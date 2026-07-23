// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for sub_0141 (program the i8257 and kick the sprite
 * blit). Called unconditionally once per vblank from the NMI handler entry_0066
 * (ROM 0x0080, m.call 0x0141 with HL=0x0138), so it dispatches EVERY frame from
 * boot — no coin/start tape is needed to reach it (unlike loc_0a8a).
 *
 * Jobs:
 *   1. EQUAL (whole + unit) -- the idiomatic optimized sub_0141 reads EQUAL
 *      against its translated oracle in RAM and the full register file (+ pc).
 *   2. DISPATCH -- the override must actually fire, or EQUAL is vacuous. sub_0141
 *      fires once per frame, so a 30-frame window dispatches it ~30 times.
 *   3. SINGLE PATH + CYCLE TOTAL -- sub_0141 is STRAIGHT-LINE (no data-dependent
 *      branch): one path, exercised by the whole/unit gates. Its cycle total
 *      (3413 t = 292 t of instructions + ~3121 t the 8257 steals for the blit) is
 *      still load-bearing — as part of the NMI's cost it sets the main-loop spin
 *      count (README §2) — so the total is pinned to the oracle's, with teeth.
 *   4. WRITE-TRACE -- THE POINT OF THIS ROUTINE. EVERY store here is a HARDWARE
 *      write: ten i8257 programming writes (0x7800-0x7808) and three DRQ pulses
 *      (0x7D85). Their write-bus-cycle column in the emit.js --writes trace is
 *      invisible to the RAM+regs gate, so this test proves all twelve land at the
 *      oracle's exact bus cycle and that a flattened variant (writes clustered
 *      before one lump charge) is caught. This is why sub_0141's cycles are kept
 *      PER-INSTRUCTION and NOT collapsed, despite the routine being atomic.
 *   5. TEETH (whole + unit) -- a wrong blit output is CAUGHT, naming the diverging
 *      address (0x7000, the first byte the DMA blits into sprite RAM).
 *
 * ATOMIC, NOT COLLAPSED. sub_0141's sole caller is the NMI handler, which cleared
 * the NMI mask on entry, so the vblank NMI cannot fire inside it — atomic. That
 * would normally license collapsing the per-instruction charges to one total, but
 * the hardware-write caveat forbids it here: a collapse would shift the twelve
 * traced write bus cycles the RAM gate cannot police. So this routine keeps its
 * charges per-instruction and proves the trace separately (job 4). The whole
 * point of the optimized rewrite is names + structure + docs, not a cycle
 * collapse.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { sub_0141 as translated_0141 } from "../../translated/nmi.js";
import { sub_0141 as optimized_0141 } from "../sub_0141.js";
import { Machine } from "../../machine.js";
import {
  wholeMachineEquivalence as coreWholeMachineEquivalence,
  unitEquivalence as coreUnitEquivalence,
  firstStateDiff,
  firstRegDiff,
} from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT
  ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR)))
  : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x0141;
const FRAMES = 30; // sub_0141 fires once per frame, so ~30 dispatches here

// No input tape: sub_0141 runs unconditionally in the NMI, so it dispatches from
// the very first frame. Baseline gets no overrides; the optimized side gets the
// wrapped map (the core engine wraps each override with an invocation counter, so
// an EQUAL that never dispatched cannot pass vacuously).
const makeMachine = (overrides) => new Machine(ROM, overrides ? { overrides } : {});

// The teeth corrupt the DMA blit's first byte, 0x7000 (sprite RAM, the routine's
// primary OUTPUT — the whole reason it exists). It is written by the i8257
// transfer that DRQ's rising edge triggers, lands in the compared sprite-RAM
// dump, and is re-blitted every frame, so a first-write flip diverges the trace.
// (A hardware-register write — 0x7800.. — does NOT land in the RAM dump, so it
// would not be a "wrong value in a compared output address" the RAM gate catches.)
const BROKEN_ADDR = 0x7000;

/**
 * Deliberately-broken twin: behaviourally the optimized routine EXCEPT the first
 * store to 0x7000 lands the wrong value (correct byte XOR 0xFF). The DMA moves
 * data through the SAME AddressSpace whose write8 this wraps (io.dma.mem === mem),
 * so intercepting exactly that one write lets the rest run verbatim.
 */
function broken_0141(m) {
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
    return optimized_0141(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

// -- pristine-entry capture (for the isolated single-path / cycle / trace checks) --

/** Capture the machine the instant sub_0141 is FIRST entered (frame 1). */
function captureEntry() {
  let entry = null;
  const snap = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_0141(mm);
  }]]);
  makeMachine(snap).runFrames(FRAMES);
  if (entry === null) throw new Error("sub_0141 never entered within the run window");
  return entry;
}

const ENTRY = ROM_PRESENT ? captureEntry() : null;

/** Run `fn` on a fresh clone of the entry; return {m, cycles}. */
function runClone(fn) {
  const c = ENTRY.clone();
  const c0 = c.cycles;
  fn(c);
  return { m: c, cycles: c.cycles - c0 };
}

/** Run `fn` on a fresh clone with the hardware write-trace recording. */
function traceClone(fn) {
  const c = ENTRY.clone();
  c.mem.writeTrace = []; // clock is () => c.cycles from the constructor
  const c0 = c.cycles;
  fn(c);
  // Report each write's cycle RELATIVE to entry so it is base-independent.
  return c.mem.writeTrace.map((w) => ({ rel: w.cycle - c0, addr: w.addr, value: w.value }));
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized sub_0141 matches translated every frame", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, optimized_0141]]));

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
      `override fired ${r.invocations.get(TARGET)}x`,
  );
});

test("EQUAL (unit): idiomatic optimized sub_0141 matches translated in RAM + registers", () => {
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_0141, optimized_0141, { maxFrames: FRAMES });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical");
});

// -- SINGLE PATH + CYCLE TOTAL ------------------------------------------------

test("SINGLE PATH + CYCLE TOTAL: the one straight-line path is EQUAL and preserves the total", () => {
  const a = runClone(translated_0141);
  const b = runClone(optimized_0141);

  const ram = firstStateDiff(a.m.dumpState(), b.m.dumpState(), (off) => a.m.stateOffsetToAddr(off));
  const regs = firstRegDiff(a.m.regs, b.m.regs);
  assert.equal(ram, null, ram ? `RAM diff at 0x${ram.addr.toString(16)} (t ${ram.a} vs o ${ram.b})` : "");
  assert.equal(regs, null, regs ? `reg diff at ${regs.reg} (t ${regs.a} vs o ${regs.b})` : "");
  assert.equal(a.m.pc, b.m.pc, "pc must match");

  // The optimized total equals the oracle's exactly (both charge the same DMA
  // stolen cycles via m.io.dma.cyclesStolen).
  assert.equal(b.cycles, a.cycles, `cycle total drifted: optimized ${b.cycles} vs oracle ${a.cycles}`);

  // ...and that assertion is not vacuous: a 1-cycle error in any charge makes the
  // totals disagree.
  const wrong = runClone((m) => {
    const realStep = m.step.bind(m);
    m.step = (addr, cyc) => realStep(addr, addr === 0x017a ? cyc - 1 : cyc);
    try { return optimized_0141(m); } finally { m.step = realStep; }
  });
  assert.notEqual(wrong.cycles, a.cycles, "cycle-total assertion has no teeth");
  console.log(`  CYCLE: optimized total ${b.cycles}t == oracle ${a.cycles}t (292t instructions + DMA stolen); wrong-total caught`);
});

// -- WRITE-TRACE (the hardware-write bus cycles the RAM gate cannot see) -------

test("WRITE-TRACE: all twelve hardware writes land at the oracle's exact bus cycle", () => {
  const oracleTrace = traceClone(translated_0141);
  const optTrace = traceClone(optimized_0141);

  // Twelve hardware writes, in ROM order: DRQ low, then the nine 8257 register
  // bytes (mode, ch0 addr lo/hi, ch0 count lo/hi, ch1 addr lo/hi, ch1 count lo/hi
  // -- last count-hi shares the port, so ten writes to 0x7800-0x7808), then DRQ
  // rising (the blit) and DRQ low. The register bytes decode to mode 0x53,
  // ch0 src 0x6900 count 0x4180, ch1 dst 0x7000 count 0x8180.
  const EXPECTED = [
    { rel: 14, addr: 0x7d85, value: 0x00 },
    { rel: 34, addr: 0x7808, value: 0x53 },
    { rel: 60, addr: 0x7800, value: 0x00 },
    { rel: 86, addr: 0x7800, value: 0x69 },
    { rel: 112, addr: 0x7801, value: 0x80 },
    { rel: 138, addr: 0x7801, value: 0x41 },
    { rel: 164, addr: 0x7802, value: 0x00 },
    { rel: 190, addr: 0x7802, value: 0x70 },
    { rel: 216, addr: 0x7803, value: 0x80 },
    { rel: 242, addr: 0x7803, value: 0x81 },
    { rel: 262, addr: 0x7d85, value: 0x01 }, // THE BLIT
    // final DRQ low lands after the store retires + the 8257's stolen bus cycles
    { rel: oracleTrace[11].rel, addr: 0x7d85, value: 0x00 },
  ];
  assert.deepEqual(oracleTrace, EXPECTED, "oracle hardware-write trace is not the expected twelve writes");
  assert.ok(oracleTrace[11].rel > 3000, "final DRQ-low should follow the ~3121t DMA burst");
  assert.deepEqual(optTrace, oracleTrace, "optimized hardware-write bus cycles differ from the oracle");

  // Teeth: a FLATTENED variant that issues every programming write back-to-back
  // before one lump charge collapses their bus cycles toward +0 -- proving the
  // per-instruction granularity is what preserves the staggered trace.
  const PORTS = [0x7808, 0x7800, 0x7800, 0x7801, 0x7801, 0x7802, 0x7802, 0x7803, 0x7803];
  const flat = traceClone((m) => {
    const { regs, mem } = m;
    regs.xor(regs.a);
    mem.write8(0x7d85, regs.a, 10); // now at +0, not +14
    for (let i = 0; i < 9; i++) {
      regs.a = mem.read8(regs.hl);
      mem.write8(PORTS[i], regs.a, 10); // clustered at +0, not 34..242
      if (i < 8) regs.hl = (regs.hl + 1) & 0xffff;
    }
    m.step(0x0173, 282); // the instruction cycles in one lump
    regs.a = 0x01;
    mem.write8(0x7d85, regs.a, 10);
    m.tick(m.io.dma.cyclesStolen);
    m.io.dma.cyclesStolen = 0;
    regs.xor(regs.a);
    mem.write8(0x7d85, regs.a, 10);
    m.ret();
  });
  assert.notDeepEqual(flat, oracleTrace, "write-trace check has no teeth");
  console.log("  WRITE-TRACE: 12 hardware writes @ 14/34/60/86/112/138/164/190/216/242/262/blit+DMA identical to oracle; flat variant caught");
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong blit store is CAUGHT and NOT-EQUAL", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, broken_0141]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong blit store is CAUGHT and names 0x7000", () => {
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_0141, broken_0141, { maxFrames: FRAMES });

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
