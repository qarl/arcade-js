// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for sub_0d00 (100m-rivet board-4 decoration: stamp the
 * two tile codes 0xB8/0xB7 into eight video-RAM cell pairs listed in the ROM table
 * at 0x0D17). Like loc_0c91/loc_0a8a it is reached from INSIDE the vblank NMI:
 * loc_0cc6's `call z,0x0D00`, guarded by BOARD(0x6227)==4, itself reached only from
 * the board-setup dispatch (loc_0c92's board-4 arm) run under dispatchGameState while
 * GAME_STATE(0x6005)==3 and GAME_SUBSTATE(0x600A)==10.
 *
 * Five jobs:
 *
 *   1/2. EQUAL (whole + unit) -- the idiomatic optimized sub_0d00 (optimized/
 *      sub_0d00.js) reads EQUAL against its translated oracle in RAM (the 16 video-RAM
 *      bytes it stamps are inside the compared 0x7400-0x77FF dump) and in the full
 *      register file (+ pc).
 *
 *   3/4. TEETH (whole + unit) -- a deliberately-broken twin (the first tile store to
 *      0x76CA lands the wrong value) must be CAUGHT: NOT-EQUAL, naming 0x76CA.
 *
 *   5. SINGLE-PATH CYCLE TOTAL -- sub_0d00 has NO data-dependent branch (its loops are
 *      fixed B=8 x C=2), so there is exactly one path to cover. It is proven EQUAL
 *      (RAM+regs+pc) on the captured entry AND its collapsed CYCLE TOTAL is pinned to
 *      the oracle's 942 t, with a wrong-total variant shown to be caught -- the teeth
 *      the collapse rests on.
 *
 * WHY THIS TEST DRIVES A POKE (and, like 0c91/0a8a, cannot use the DK harness.js
 * wrapper directly). sub_0d00 NEVER dispatches from boot -- it is board-4-only, and no
 * tape on hand reaches 100m. So these tests force it with an IDENTICAL-BOTH-SIDES poke
 * (Karl's sanctioned "poke the board state to reach a state for validation" -- applied
 * to baseline and optimized alike, so equivalence is preserved): a one-shot poke at
 * frame 100 sets GAME_STATE=3, GAME_SUBSTATE=10 (board setup), SUBSTATE_TIMER=1
 * (loc_0c91 PROCEEDs immediately) and BOARD=4 (100m rivet). The board-4 setup arm then
 * runs and its `call z,0x0D00` fires sub_0d00 exactly once (measured: frame 102). The
 * poke is threaded via a custom `makeMachine` factory (m.pokes) driving the game-
 * agnostic CORE engine (core/equivalence.js) -- the SAME construction-time snapshot
 * override the DK harness wrapper uses, just with a factory that can carry the poke.
 *
 * THE CYCLE FINDING this routine adds: sub_0d00 is ATOMIC by CALL PATH -- its single
 * caller runs inside the NMI (mask held cleared; perFrame cannot re-enter), and it
 * makes no call of its own, so the NMI can never land inside it. Its loops are fixed-
 * count (one straight path). So the ~90 per-instruction m.step charges collapse to ONE
 * 942 t total, charged via m.ret. The total stays load-bearing: a wrong total diverges
 * at SPIN_COUNT 0x6019 (the vblank-spin/PRNG count, README §2) -- shown in the cycle
 * teeth. sub_0d00 writes ONLY video RAM (no 0x7Dxx latch), so -- exactly like loc_0a8a's
 * video-RAM epilogue -- there is no --writes bus-cycle trace to preserve and no write-
 * trace test is needed.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { sub_0d00 as translated_0d00 } from "../../translated/state0.js";
import { sub_0d00 as optimized_0d00 } from "../sub_0d00.js";
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

const TARGET = 0x0d00;
const FRAMES = 110; // sub_0d00 forced to dispatch once, at frame 102
const FIRST_TILE = 0x76ca; // the first of the 8 destinations (table[0]); its first stamp is 0xB8
const ORACLE_CYCLES = 942; // the whole collapsed path total
const POKE_FRAME = 100;

// Identical-both-sides one-shot poke that forces board-4 (100m rivet) setup, whose
// `call z,0x0D00` fires sub_0d00. dur 1 so the game's own code manages state from
// frame 101 on; BOARD=4 is read by loc_0c92's dec-a cascade during the setup NMI.
const FORCE_0D00_POKE = [
  { addr: 0x6005, val: 0x03, frame: POKE_FRAME, dur: 1 }, // GAME_STATE = 3 (in-game -> loc_06fe dispatch)
  { addr: 0x600a, val: 0x0a, frame: POKE_FRAME, dur: 1 }, // GAME_SUBSTATE = 10 -> board setup (loc_0c91/loc_0c92)
  { addr: 0x6009, val: 0x01, frame: POKE_FRAME, dur: 1 }, // SUBSTATE_TIMER = 1 (loc_0c91 PROCEEDs this frame)
  { addr: 0x6227, val: 0x04, frame: POKE_FRAME, dur: 1 }, // BOARD = 4 (100m rivet -> board-4 arm -> call z,0x0D00)
];

// The engine's factory: a DK Machine on this ROM with the force-0d00 poke loaded.
// Called with no argument for the baseline and with the wrapped override map for the
// optimized side (the core engine wraps each override with its own invocation counter,
// so an EQUAL that never dispatched cannot pass vacuously). A fresh copy of the poke
// per machine keeps each run independent.
const makeMachine = (overrides) => {
  const m = new Machine(ROM, overrides ? { overrides } : {});
  m.pokes = FORCE_0D00_POKE.map((p) => ({ ...p }));
  return m;
};

// Broken twin: behaviourally the optimized routine EXCEPT the first tile store to
// 0x76CA lands a wrong value (correct ^ 0xFF, guaranteed to differ). Intercepting
// exactly that one write lets the rest of the routine run verbatim -- the "wrong value
// to one of the routine's own output addresses" bug the gate must catch.
function broken_0d00(m) {
  const realWrite = m.mem.write8.bind(m.mem);
  let broke = false;
  m.mem.write8 = (addr, value, busOffset) => {
    if (!broke && addr === FIRST_TILE) {
      broke = true;
      return realWrite(addr, value ^ 0xff, busOffset);
    }
    return realWrite(addr, value, busOffset);
  };
  try {
    return optimized_0d00(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized sub_0d00 matches translated every frame", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, optimized_0d00]]));

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
      `override fired ${r.invocations.get(TARGET)}x (board-4 setup, frame 102)`,
  );
});

test("EQUAL (unit): idiomatic optimized sub_0d00 matches translated in RAM + registers", () => {
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_0d00, optimized_0d00, { maxFrames: FRAMES });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical");
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong tile store is CAUGHT and NOT-EQUAL", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, broken_0d00]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong tile store is CAUGHT and names 0x76CA", () => {
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_0d00, broken_0d00, { maxFrames: FRAMES });

  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.ok(r.ram != null, "a caught divergence must name a RAM address");
  assert.equal(
    r.ram.addr,
    FIRST_TILE,
    `expected first diff at the broken address 0x${FIRST_TILE.toString(16)}, got 0x${r.ram.addr.toString(16)}`,
  );
  console.log(
    `  TEETH/unit: caught at 0x${r.ram.addr.toString(16)} ` +
      `(translated ${r.ram.a} vs broken ${r.ram.b})`,
  );
});

// -- SINGLE-PATH COVERAGE + COLLAPSED CYCLE TOTAL (with teeth) -----------------

/**
 * Capture the one real entry to sub_0d00 (via the engine's construction-time snapshot
 * override on the poke-driven host), giving a valid stack (the ret pops it) and
 * realistic board state to run the oracle and the rewrite against.
 */
function captureEntry() {
  let entry = null;
  const snapshot = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_0d00(mm);
  }]]);
  const host = makeMachine(snapshot);
  host.runFrames(FRAMES);
  assert.ok(entry !== null, "failed to capture a sub_0d00 entry");
  return entry;
}

test("SINGLE PATH: EQUAL (RAM+regs+pc) and collapsed cycle total == oracle (942 t)", () => {
  const entry = captureEntry();

  // sub_0d00 has no data-dependent branch (fixed B=8 x C=2 loops), so the captured
  // entry IS the whole coverage. Prove RAM + every register + pc identical, and the
  // collapsed total equals the oracle's.
  const a = entry.clone(); // translated oracle
  const b = entry.clone(); // optimized
  const a0 = a.cycles;
  const b0 = b.cycles;
  translated_0d00(a);
  optimized_0d00(b);
  const aCyc = a.cycles - a0;
  const bCyc = b.cycles - b0;

  const ram = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
  const regs = firstRegDiff(a.regs, b.regs);
  assert.equal(ram, null, ram ? `RAM diff at 0x${ram.addr.toString(16)} (${ram.a} vs ${ram.b})` : "");
  assert.equal(regs, null, regs ? `reg diff at ${regs.reg} (${regs.a} vs ${regs.b})` : "");
  assert.equal(a.pc, b.pc, "pc must match");

  // Committed cycle teeth: the collapsed optimized total equals the oracle's exactly.
  assert.equal(aCyc, ORACLE_CYCLES, `oracle total drifted from ${ORACLE_CYCLES} (got ${aCyc})`);
  assert.equal(bCyc, aCyc, `collapsed total drifted (oracle ${aCyc} vs optimized ${bCyc})`);

  // Non-vacuous: a wrong collapsed total must be caught (it is load-bearing -- as part
  // of the NMI cost it feeds the vblank-spin/PRNG count, diverging at SPIN_COUNT 0x6019).
  const w = entry.clone();
  const w0 = w.cycles;
  const realRet = w.ret.bind(w);
  w.ret = (c) => realRet(c - 1);
  try { optimized_0d00(w); } finally { w.ret = realRet; }
  const wrongCyc = w.cycles - w0;
  assert.notEqual(wrongCyc, aCyc, "cycle-total assertion has no teeth");

  console.log(
    `  SINGLE PATH: EQUAL (RAM+regs+pc); cycles ${aCyc} t (oracle==optimized), ` +
      `wrong-total ${wrongCyc} t caught`,
  );
});
