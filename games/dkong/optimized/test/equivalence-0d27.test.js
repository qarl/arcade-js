// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for sub_0d27 (draw the two decorative fill rows of the
 * 75m board: point HL at 0x770D then 0x760D and run the shared VRAM filler sub_0d30
 * twice, laying 0xFD/0xFC tile bands). sub_0d27 is a LEAF reached via m.call from
 * loc_0cf2 (the BOARD==3 arm of the setup cascade loc_0c92), itself dispatched by
 * dispatchGameState (the NMI game-state path).
 *
 * Jobs:
 *   1. EQUAL (whole + unit) -- the idiomatic optimized sub_0d27 reads EQUAL against
 *      its translated oracle in RAM and in the full register file (+ pc).
 *   2. DISPATCH -- the override must actually fire, or EQUAL is vacuous.
 *   3. SINGLE PATH + CYCLE TOTAL -- sub_0d27 is STRAIGHT-LINE (no data-dependent
 *      branch: it always fills both rows in the same order, reading no input), so the
 *      one path is what the whole/unit gates exercise. Because that path is COLLAPSED
 *      (the leading ld folds into the first call: 10+17 -> 27t; the total is 37t of
 *      sub_0d27 proper), the test also pins its cycle TOTAL to the oracle's and shows
 *      a wrong total is caught.
 *   4. TEETH (whole + unit) -- a deliberately-wrong output store is CAUGHT, naming
 *      the diverging VRAM address (0x770D, the first cell sub_0d30 fills).
 *
 * WHY THIS TEST DRIVES INPUT *and* POKES THE BOARD (and uses core/equivalence.js
 * directly, like equivalence-0cf2/0a8a/08f8). sub_0d27 is called ONLY by loc_0cf2,
 * the 75m arm; a coin+start game reaches state-3 gameplay but stays on BOARD 1 (Mario
 * dies and restarts 25m), so loc_0cf2 -- and therefore sub_0d27 -- NEVER dispatches
 * naturally. To exercise it we (a) feed the canonical coin+start tape to start a game,
 * and (b) install an IDENTICAL-BOTH-SIDES driver override on loc_0c92 (0x0C92) that
 * writes BOARD(0x6227)=3 before delegating to the oracle loc_0c92, so its setup cascade
 * dispatches the 75m arm loc_0cf2, whose leading `call 0x0d27` then enters sub_0d27.
 * This is the sanctioned "poke the board state to reach a higher board for validation"
 * method. The driver is installed by the shared makeMachine factory, so BOTH baseline
 * and optimized get it verbatim; only sub_0d27 itself differs between the two, which is
 * exactly what the gate compares. The core engine installs the snapshot override at
 * CONSTRUCTION, so it reaches sub_0d27 as a leaf called through m.call, not just as a
 * dispatch target -- nothing here open-codes a reach-the-routine workaround. With this
 * setup sub_0d27 dispatches EXACTLY ONCE (by frame ~1025, when loc_0cf2 runs);
 * FRAMES = 1100 covers it plus a downstream margin.
 *
 * THE CYCLE FINDING this routine adds: sub_0d27 is ATOMIC and COLLAPSED. It runs
 * INSIDE the vblank NMI (via dispatchGameState, mask cleared) on its ONLY call path
 * (loc_0cf2), and its own callee sub_0d30 is a pure VRAM-fill leaf, so the NMI never
 * lands inside sub_0d27 or sub_0d30 -- its internal cycle distribution is unobservable.
 * Its three own charges (ld 10 + call 17 + ld 10) collapse to two (27 + 10 = 37t, the
 * oracle's exact total); the two sub_0d30 calls' ~1021t each are UNCHANGED (run via
 * m.call to the oracle on both sides). No hardware write in its body (only plain video
 * RAM 0x74xx-0x77xx), so -- unlike loc_0a8a -- there is no write-bus-cycle to preserve
 * and the collapse needs no write-trace test. The TOTAL stays load-bearing (part of the
 * NMI's cost, feeding the main-loop spin count, README §2), so it is preserved exactly
 * and the SINGLE-PATH test pins it with teeth.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { sub_0d27 as translated_0d27 } from "../../translated/state0.js";
import { loc_0c92 as translated_0c92 } from "../../translated/nmi.js";
import { sub_0d27 as optimized_0d27 } from "../sub_0d27.js";
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

const TARGET = 0x0d27;
const FRAMES = 1100; // sub_0d27 dispatches exactly once, by frame ~1025 (when loc_0cf2 runs)

// Canonical coin+start tape (tapes/coin_start.lua contract): pulse IN2 coin (0x80)
// then IN2 start1 (0x04) so the ROM starts a game and reaches state-3 gameplay.
const COIN_START_TAPE = [
  { port: 0x7d00, bits: 0x80, frame: 60, dur: 6 }, // coin
  { port: 0x7d00, bits: 0x04, frame: 90, dur: 6 }, // start1
];

// The IDENTICAL-BOTH-SIDES driver: force BOARD=3 whenever loc_0c92 runs, so its
// per-board setup cascade dispatches the 75m arm loc_0cf2, whose `call 0x0d27` enters
// sub_0d27. Delegates to the oracle loc_0c92 (not itself optimized), so the ONLY
// behavioural change is the board poke -- applied to baseline and optimized alike via
// the shared factory.
const driverEntries = () => [[0x0c92, (mm) => { mm.mem.write8(0x6227, 3); return translated_0c92(mm); }]];

// The engine's factory: a DK Machine on this ROM with the coin+start tape loaded and
// the board-3 driver installed. Called with no argument for the baseline and with the
// wrapped override map for the optimized side (the core engine wraps each override with
// its own invocation counter, so an EQUAL that never dispatched cannot pass vacuously).
const makeMachine = (overrides) => {
  const merged = new Map(driverEntries());
  if (overrides) for (const [k, v] of overrides instanceof Map ? overrides : Object.entries(overrides)) merged.set(typeof k === "number" ? k : parseInt(k, 16), v);
  const m = new Machine(ROM, { overrides: merged });
  m.inputTape = COIN_START_TAPE.map((t) => ({ ...t }));
  return m;
};

// sub_0d27's first output store: sub_0d30 fills 0x770D with the 0xFD tile code. It is
// the routine's own first write (sub_0d27 reads no work RAM; the first write on the
// path is this VRAM cell), sits in the compared state dump (video RAM 0x7400-0x77FF),
// and -- being a static background tile laid down once at board setup -- is not
// rewritten in the run window, so the diff persists. The representative "wrong value to
// one of the routine's own output addresses" bug the gate must catch.
const BROKEN_ADDR = 0x770d;

function broken_0d27(m) {
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
    return optimized_0d27(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

// -- pristine-entry capture (for the isolated single-path / cycle checks) --

/** Capture the machine the instant sub_0d27 is FIRST entered (by frame ~1025). */
function captureEntry() {
  let entry = null;
  const snap = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_0d27(mm);
  }]]);
  const host = makeMachine(snap);
  host.runFrames(FRAMES);
  if (entry === null) throw new Error("sub_0d27 never entered within the run window");
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

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized sub_0d27 matches translated every frame", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, optimized_0d27]]));

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
      `override fired ${r.invocations.get(TARGET)}x (by frame ~1025, board-3 driver)`,
  );
});

test("EQUAL (unit): idiomatic optimized sub_0d27 matches translated in RAM + registers", () => {
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_0d27, optimized_0d27, { maxFrames: FRAMES + 100 });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical");
});

// -- SINGLE PATH + CYCLE TOTAL ------------------------------------------------

test("SINGLE PATH + CYCLE TOTAL: the one straight-line path is EQUAL and preserves the total", () => {
  // sub_0d27 has no data-dependent branch: one path, exercised in isolation here.
  const a = runClone(translated_0d27);
  const b = runClone(optimized_0d27);

  const ram = firstStateDiff(a.m.dumpState(), b.m.dumpState(), (off) => a.m.stateOffsetToAddr(off));
  const regs = firstRegDiff(a.m.regs, b.m.regs);
  assert.equal(ram, null, ram ? `RAM diff at 0x${ram.addr.toString(16)} (t ${ram.a} vs o ${ram.b})` : "");
  assert.equal(regs, null, regs ? `reg diff at ${regs.reg} (t ${regs.a} vs o ${regs.b})` : "");
  assert.equal(a.m.pc, b.m.pc, "pc must match");

  // Committed cycle teeth for the collapsed path: the optimized total equals the
  // oracle's exactly (both run the same sub_0d30 x2 via m.call, so the delta pins
  // sub_0d27 proper = 37t + the callees' identical charges).
  assert.equal(b.cycles, a.cycles, `cycle total drifted: optimized ${b.cycles} vs oracle ${a.cycles}`);

  // ...and the assertion is not vacuous: a 1-cycle error in the collapsed charges
  // (sub_0d27's own m.step(0x0d30, ...) totals) makes the totals disagree.
  const wrong = runClone((m) => {
    const realStep = m.step.bind(m);
    m.step = (addr, cyc) => realStep(addr, addr === 0x0d30 ? cyc - 1 : cyc);
    try { return optimized_0d27(m); } finally { m.step = realStep; }
  });
  assert.notEqual(wrong.cycles, a.cycles, "cycle-total assertion has no teeth");
  console.log(`  CYCLE: optimized total ${b.cycles}t == oracle ${a.cycles}t (sub_0d27 proper 37t); wrong-total caught`);
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong VRAM fill store is CAUGHT and NOT-EQUAL", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, broken_0d27]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong VRAM fill store is CAUGHT and names 0x770D", () => {
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_0d27, broken_0d27, { maxFrames: FRAMES + 100 });

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
