// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for sub_017b (coin input / credit accounting, ROM
 * 0x017B-0x01B9). Called ONCE per vblank from perFrame (ROM 0x00B5), the NMI body,
 * so it runs INSIDE the vblank NMI with the mask cleared -- atomic on its only
 * call path (grep of the oracle: the sole `m.call(0x017b)` is in perFrame).
 *
 * Jobs:
 *   1. EQUAL (whole + unit) -- idiomatic optimized sub_017b reads EQUAL against its
 *      translated oracle in RAM and the full register file (+ pc). Two whole-machine
 *      runs: attract (the no-coin arm fires every frame) and a coin tape (the
 *      accepted arm runs LIVE, driving sub_011c + the credit path end-to-end).
 *   2. DISPATCH -- the override must actually fire, or EQUAL is vacuous (asserted).
 *   3. FULL BRANCH COVERAGE -- sub_017b has six data-dependent exits (no-coin,
 *      latch-already-counted ret-z, and the accepted arm's state==3/!=3 fork crossed
 *      with ret-nz / ret-nc / full-credit). The whole-machine runs reach only some,
 *      so each is SYNTHESISED from a captured entry (set the coin line + the deciding
 *      RAM) and proven EQUAL in RAM+regs+pc AND in CYCLE TOTAL (the collapsed lumps
 *      have no teeth otherwise). A wrong lump total is shown to be caught.
 *   4. WRITE-TRACE -- the accepted, not-in-game arm calls sub_011c, which writes the
 *      ls259.6h sound latches (0x7D00-07 @+4t, 0x7D80/0x7C00 @+10t) -- hardware
 *      writes the RAM gate cannot see. sub_017b makes NO hardware write of its own,
 *      but its COLLAPSE must still enter sub_011c at the oracle's exact cumulative
 *      cycle or those ten writes shift in the emit.js --writes trace. This pins them
 *      to the oracle's cycles and shows a flat-collapse (call at cycle 0) is caught.
 *   5. TEETH (whole + unit) -- a wrong output store (COIN_EDGE, 0x6003) is CAUGHT,
 *      naming the diverging address.
 *
 * THE CYCLE FINDING this routine adds: sub_017b is ATOMIC (NMI, mask cleared) so the
 * RAM/reg diff makes its internal cycle DISTRIBUTION free -- each branch's charges
 * collapse to lumps. But it is only PARTIALLY collapsed: it reaches a hardware-
 * writing callee (sub_011c), so the collapse is chunked at each `m.call` to keep the
 * callee's entry cycle -- and thus its --writes trace -- identical to the oracle.
 * The total is load-bearing regardless (as NMI cost it sets the main-loop spin count,
 * README §2), which the whole-machine gate confirms.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { sub_017b as translated_017b } from "../../translated/nmi.js";
import { sub_017b as optimized_017b } from "../sub_017b.js";
import { COIN_EDGE, GAME_STATE, SND_TRIGGER } from "../ram.js";
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

const TARGET = 0x017b;
const IN2 = 0x7d00; // IN2 port; bit 7 (0x80) = COIN1
const COIN1 = 0x80;

// Work-RAM the branch synthesiser pokes (hex here on purpose: the DIP mirrors have
// names in ram.js, but this is test scaffolding, so a couple stay literal).
const COINS_PARTIAL = 0x6002; // coin-pulse counter (COINS_PARTIAL in ram.js)
const CREDITS = 0x6001; // credit count (CREDITS in ram.js)
const DIP_COINS_PER_CREDIT = 0x6024;
const DIP_CREDITS_PER_COIN = 0x6025;

// -- machine factories --------------------------------------------------------

/** Plain attract factory: the no-coin arm dispatches every frame. */
const makeMachine = (overrides) =>
  new Machine(ROM, overrides ? { overrides } : {});

// A coin pulse on IN2 bit 7 during attract (MAME's 6-frame hold), so the ROM's own
// credit logic runs the ACCEPTED arm live (sub_011c + the pulse/credit path). A
// fresh copy per machine keeps each run's tape independent.
const COIN_TAPE = [{ port: IN2, bits: COIN1, frame: 12, dur: 6 }];
const makeCoinMachine = (overrides) => {
  const m = new Machine(ROM, overrides ? { overrides } : {});
  m.inputTape = COIN_TAPE.map((t) => ({ ...t }));
  return m;
};

// sub_017b's own output store the teeth corrupt: COIN_EDGE (0x6003). It is written
// on the no-coin arm every frame and sits in the compared work-RAM dump; a first-
// write flip is not corrected until the NEXT frame's write, so it is captured at the
// boundary in between -- the representative "wrong value to one of the routine's own
// output addresses" bug the gate must catch.
const BROKEN_ADDR = COIN_EDGE;

function broken_017b(m) {
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
    return optimized_017b(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

// -- pristine-entry capture (for the isolated branch / cycle / trace checks) ---

/** Capture the machine the instant sub_017b is FIRST entered (an early NMI). */
function captureEntry() {
  let entry = null;
  const snap = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_017b(mm);
  }]]);
  const host = makeMachine(snap);
  host.runFrames(20);
  if (entry === null) throw new Error("sub_017b never entered within the run window");
  return entry;
}

const ENTRY = ROM_PRESENT ? captureEntry() : null;

/**
 * A synthetic entry that forces one branch: clone the captured entry, drive the
 * coin line via io.inputAssert (what readIn2 ORs into 0x7D00 bit 7), and poke the
 * deciding work RAM. Applied to a fresh clone, then cloned again per side so oracle
 * and optimized start byte-identical.
 */
function branchEntry(spec) {
  const c = ENTRY.clone();
  c.io.inputAssert = spec.coin ? { [IN2]: COIN1 } : null;
  if (spec.latch !== undefined) c.mem.write8(COIN_EDGE, spec.latch);
  if (spec.state !== undefined) c.mem.write8(GAME_STATE, spec.state);
  if (spec.coinsPerCredit !== undefined) c.mem.write8(DIP_COINS_PER_CREDIT, spec.coinsPerCredit);
  if (spec.creditsPerCoin !== undefined) c.mem.write8(DIP_CREDITS_PER_COIN, spec.creditsPerCoin);
  if (spec.pulses !== undefined) c.mem.write8(COINS_PARTIAL, spec.pulses);
  if (spec.credits !== undefined) c.mem.write8(CREDITS, spec.credits);
  return c;
}

/** Run `fn` on a fresh clone of `entry`; return {machine, cyclesSpent}. */
function runClone(entry, fn) {
  const c = entry.clone();
  const c0 = c.cycles;
  fn(c);
  return { m: c, cycles: c.cycles - c0 };
}

/** Run `fn` on a fresh clone with hardware write-trace recording; cycles are relative. */
function traceClone(entry, fn) {
  const c = entry.clone();
  c.mem.writeTrace = []; // clock is () => c.cycles from the constructor
  const c0 = c.cycles;
  fn(c);
  return c.mem.writeTrace.map((w) => ({ rel: w.cycle - c0, addr: w.addr, value: w.value }));
}

// The six data-dependent exits of sub_017b.
const BRANCHES = [
  { name: "no-coin (arm the latch)", spec: { coin: false }, total: 61, pc: 0x00bf },
  { name: "coin, already-counted (ret z)", spec: { coin: true, latch: 0 }, total: 63, pc: 0x00bf },
  { name: "accepted, state!=3 sound, ret nz", spec: { coin: true, latch: 1, state: 1, coinsPerCredit: 2, pulses: 0 }, pc: 0x00bf },
  { name: "accepted, state==3 skip, ret nc", spec: { coin: true, latch: 1, state: 3, coinsPerCredit: 1, pulses: 0, credits: 0x90 }, pc: 0x00bf },
  { name: "accepted, state==3 skip, full credit", spec: { coin: true, latch: 1, state: 3, coinsPerCredit: 1, creditsPerCoin: 1, pulses: 0, credits: 0 }, pc: 0x00bf },
  { name: "accepted, state!=3 sound, full credit", spec: { coin: true, latch: 1, state: 1, coinsPerCredit: 1, creditsPerCoin: 1, pulses: 0, credits: 0 }, pc: 0x00bf },
];

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine, attract): optimized sub_017b matches translated every frame", () => {
  const FRAMES = 30;
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, optimized_017b]]));

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
  console.log(`  EQUAL/whole(attract): ${r.framesCompared} frames identical, override fired ${r.invocations.get(TARGET)}x (no-coin arm)`);
});

test("EQUAL (whole-machine, coin): the accepted arm (sub_011c + credit) runs live and matches", () => {
  const FRAMES = 40;
  const r = coreWholeMachineEquivalence(makeCoinMachine, FRAMES, new Map([[TARGET, optimized_017b]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "override never dispatched under the coin tape");
  assert.equal(
    r.equal,
    true,
    r.equal ? "" : `diverged at frame ${r.frame}, addr 0x${(r.addr ?? 0).toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
  assert.equal(r.framesCompared, FRAMES);
  console.log(`  EQUAL/whole(coin): ${r.framesCompared} frames identical, override fired ${r.invocations.get(TARGET)}x (accepted arm live)`);
});

test("EQUAL (unit): optimized sub_017b matches translated in RAM + registers", () => {
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_017b, optimized_017b, { maxFrames: 20 });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical");
});

// -- FULL BRANCH COVERAGE + CYCLE TOTALS --------------------------------------

test("BRANCH COVERAGE: every data-dependent exit is EQUAL in RAM+regs+pc and cycle total", () => {
  for (const b of BRANCHES) {
    const entry = branchEntry(b.spec);
    const a = runClone(entry, translated_017b);
    const o = runClone(entry, optimized_017b);

    const ram = firstStateDiff(a.m.dumpState(), o.m.dumpState(), (off) => a.m.stateOffsetToAddr(off));
    const regs = firstRegDiff(a.m.regs, o.m.regs);
    assert.equal(ram, null, ram ? `[${b.name}] RAM diff at 0x${ram.addr.toString(16)} (t ${ram.a} vs o ${ram.b})` : "");
    assert.equal(regs, null, regs ? `[${b.name}] reg diff at ${regs.reg} (t ${regs.a} vs o ${regs.b})` : "");
    assert.equal(a.m.pc, o.m.pc, `[${b.name}] pc must match`);
    assert.equal(a.m.pc, b.pc, `[${b.name}] returns to perFrame (0x00bf)`);

    // Cycle teeth for the collapsed branch: optimized total == oracle total (both
    // run identical oracle callees via m.call, so the delta pins sub_017b proper).
    assert.equal(o.cycles, a.cycles, `[${b.name}] cycle total drifted: optimized ${o.cycles} vs oracle ${a.cycles}`);
    if (b.total !== undefined) {
      assert.equal(a.cycles, b.total, `[${b.name}] oracle total ${a.cycles} != expected ${b.total}`);
    }
    console.log(`  BRANCH ${b.name}: EQUAL, total ${a.cycles}t, pc 0x${a.m.pc.toString(16)}`);
  }
});

test("CYCLE teeth: a wrong collapsed lump total is CAUGHT (assertion is not vacuous)", () => {
  const entry = branchEntry({ coin: false }); // 61t no-coin arm, one lump to 0x0188
  const a = runClone(entry, translated_017b);
  const wrong = runClone(entry, (m) => {
    const realStep = m.step.bind(m);
    m.step = (addr, cyc) => realStep(addr, addr === 0x0188 ? cyc - 1 : cyc);
    try { return optimized_017b(m); } finally { m.step = realStep; }
  });
  assert.notEqual(wrong.cycles, a.cycles, "cycle-total assertion has no teeth");
  console.log(`  CYCLE teeth: oracle ${a.cycles}t vs wrong-lump ${wrong.cycles}t caught`);
});

// -- WRITE-TRACE (the hardware-write bus cycle the RAM gate cannot see) --------

test("WRITE-TRACE: sub_011c's ten latch writes land at the oracle's exact bus cycle", () => {
  // Accepted, state != 3 -> calls sub_011c, whose eight ls259.6h writes (0x7D00-07,
  // @+4t) plus 0x7D80 and 0x7C00 (@+10t) are the only hardware writes on any path.
  const specD = { coin: true, latch: 1, state: 1, coinsPerCredit: 2, pulses: 0 };
  const entry = branchEntry(specD);

  const oracleTrace = traceClone(entry, translated_017b);
  const optTrace = traceClone(entry, optimized_017b);

  assert.equal(oracleTrace.length, 10, `expected sub_011c's 10 hardware writes, got ${oracleTrace.length}`);
  assert.equal(oracleTrace[0].addr, 0x7d00, "first hardware write should be the 0x7D00 latch");
  assert.deepEqual(optTrace, oracleTrace, "optimized latch-write bus cycles differ from the oracle");

  // Teeth: a FLAT collapse (charge nothing before the call) enters sub_011c ~115t
  // early, shifting every one of its writes -- proving the chunked collapse is what
  // preserves the trace. (Runs only through the call; the trace is complete there.)
  const flat = traceClone(entry, (m) => {
    const { regs, mem } = m;
    regs.a = mem.read8(IN2);
    regs.bit(7, regs.a);
    regs.hl = COIN_EDGE;
    regs.a = mem.read8(regs.hl);
    regs.and(regs.a);
    m.push16(regs.hl);
    regs.a = mem.read8(GAME_STATE);
    regs.cp(0x03);
    m.push16(0x0198);
    m.step(0x011c, 0); // BUG: sub_011c enters at cycle 0, not 115
    m.call(0x011c);
    regs.a = 0x03;
    mem.write8(SND_TRIGGER + 3, regs.a);
  });
  assert.notDeepEqual(flat, oracleTrace, "write-trace check has no teeth");
  console.log(`  WRITE-TRACE: 10 latch writes @ +${oracleTrace[0].rel}t.. identical to oracle; flat-collapse (@ +${flat[0].rel}t) caught`);
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong COIN_EDGE store is CAUGHT and NOT-EQUAL", () => {
  const FRAMES = 30;
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, broken_017b]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(`  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} (baseline ${r.baseline} vs optimized ${r.optimized})`);
});

test("TEETH (unit): a wrong COIN_EDGE store is CAUGHT and names 0x6003", () => {
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_017b, broken_017b, { maxFrames: 20 });

  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.ok(r.ram != null, "a caught divergence must name a RAM address");
  assert.equal(
    r.ram.addr,
    BROKEN_ADDR,
    `expected first diff at the broken address 0x${BROKEN_ADDR.toString(16)}, got 0x${r.ram.addr.toString(16)}`,
  );
  console.log(`  TEETH/unit: caught at 0x${r.ram.addr.toString(16)} (translated ${r.ram.a} vs broken ${r.ram.b})`);
});
