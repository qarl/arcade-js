// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for loc_141e (0x0702 table idx20, ROM 0x141E): a
 * per-frame in-game substate handler. It is a game-state dispatch target -- entry
 * 20 (0x14) of loc_06fe's 0x0702 rst-0x28 table -- reached from INSIDE the NMI while
 * GAME_STATE(0x6005)==3 and GAME_SUBSTATE(0x600A)==0x14. It calls sub_0616 (string-5
 * draw), gates on SUBSTATE_TIMER(0x6009) via rst 0x18, and on expiry clears the
 * playfield (sub_0874) + player index (0x600E) + score-slot selector (0x600D), then
 * scans the five 0x611C-based records (stride 0x22) for a byte == 1 (-> loc_1459),
 * else == 3 (-> loc_144f), else neither (-> loc_1475).
 *
 * Jobs (mirrors equivalence-138f -- the same NMI-path, rst-0x18-gated shape, one
 * table index along):
 *
 *   1. EQUAL (whole-machine) -- optimized loc_141e reads EQUAL against its oracle
 *      every frame, override firing many times, on a driven run that forces a real
 *      record==1 body (not just the gate-skip). The override routes through
 *      dispatchGameState's consult (nmi.js), inert when the map is empty.
 *
 *   2. EQUAL (unit) -- EQUAL in RAM + every register (F included) + pc, on the
 *      naturally-captured first entry (a gate-EXPIRE that takes the record==1 tail
 *      into loc_1459).
 *
 *   3. TEETH (whole-machine) -- a deliberately-broken twin whose clear of the player
 *      index (0x600E) lands a wrong value is CAUGHT: NOT-EQUAL, naming a diverging
 *      address. 0x600E is loc_141e's OWN output, is NOT held by any poke, is control-
 *      flow-safe (it does not steer the dispatch), and -- because the run forces the
 *      record==1 branch, which never re-writes it -- the corruption persists.
 *
 *   4. TEETH (unit) -- the same broken clear is caught and names 0x600E on the
 *      naturally-captured entry.
 *
 *   5-9. FULL BRANCH COVERAGE -- loc_141e's data-dependent branches each proven
 *      EQUAL on a synthesised entry (RAM + registers + pc), AND -- because the scan
 *      segment's cycles are COLLAPSED to one charge per branch -- each branch's CYCLE
 *      TOTAL is asserted equal to the oracle's, so a wrong collapsed total has teeth
 *      even for an arm the driven whole-machine run never reaches. A non-vacuous
 *      output probe pins each arm's distinctive effect:
 *        A  gate-skip     (SUBSTATE_TIMER != 1)          -> early return; 0x600E
 *                                                           preset marker survives
 *        B  record==1 @0  (0x611C == 1)                  -> loc_1459: 0x600A inc'd,
 *                                                           0x600E stays 0 (cleared)
 *        C  record==1 @1  (0x611C != 1, 0x613E == 1)     -> loc_1459 one slot later
 *                                                           (a +41t scan cost)
 *        D  record==3     (no 1; a 3)                     -> loc_144f: 0x600E := 1
 *        E  neither       (no 1, no 3)                    -> loc_1475: 0x600A := 0,
 *                                                           GAME_STATE/ATTRACT := 1
 *
 * NO WRITE-TRACE TEST, deliberately. loc_141e makes NO hardware (0x7Dxx) write of its
 * own -- its only stores are work RAM (0x600D/0x600E). The flip-screen latch (0x7D82)
 * is written by the tails loc_1459 / loc_1475, which run UNCHANGED via m.call; the
 * oracle does not tag those writes with a bus-cycle offset, so enabling the trace
 * through them would throw. Their bus cycle is instead pinned transitively by the
 * per-branch CYCLE-TOTAL teeth: equal totals across the (identical) tail imply an
 * equal cumulative cycle at the tail m.call, hence an identical downstream write
 * cycle. loc_141e keeps each intermediate call site's own charge (0x0616 = 17, rst
 * 0x18 = 11, 0x0874 = 17) precisely so that cumulative is preserved.
 *
 * THE CYCLE FINDING this routine shares with loc_138f: loc_141e is ATOMIC and its
 * scan segment is COLLAPSED to one charge per branch (prologue 67t; miss 41t; loop-
 * exhaust miss 36t; hit 17t; loop-2 setup 24t; final jp 10t). It runs inside the NMI
 * handler (mask cleared, non-reentrant), so no nested NMI lands inside it OR any
 * callee -- its internal cycle DISTRIBUTION is unobservable. The TOTAL is still load-
 * bearing (the NMI handler's cost sets the main-loop spin count that seeds the PRNG,
 * README §2); preserving each branch's total keeps the whole-machine trace identical,
 * which tests 1 and 5-9 both prove.
 *
 * WHY THIS TEST DRIVES A POKE (like 138f/1615/127c). loc_141e's substate 0x14 is a
 * deep in-game phase that never dispatches from a short boot/attract window. An
 * IDENTICAL-BOTH-SIDES poke (Karl's sanctioned "poke the board state to reach a state
 * for validation") forces it from frame 100: GAME_STATE=3 and GAME_SUBSTATE=0x14 held
 * (loc_141e's tails move 0x600A, so it must be re-pinned to re-dispatch), 0x611C=1
 * held (forces the record==1 branch so the whole-machine teeth target 0x600E is not
 * re-written by loc_144f), and SUBSTATE_TIMER=1 kicked once so the rst-0x18 gate
 * expires exactly once. The poke is threaded via a makeMachine factory (m.pokes)
 * driving the game-agnostic CORE engine, applied to baseline and optimized alike so
 * equivalence is preserved.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_141e as translated_141e } from "../../translated/state0.js";
import { loc_141e as optimized_141e } from "../loc_141e.js";
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

const TARGET = 0x141e;
const POKE_FRAME = 100;
const FRAMES = 130; // loc_141e is forced to dispatch from frame 101 on (~30x)
const MAXFRAMES_UNIT = 150; // enough to reach the first (frame-101) entry

const GAME_STATE = 0x6005; // ram.js GAME_STATE (=3 selects the 0x0702 dispatch)
const GAME_SUBSTATE = 0x600a; // ram.js GAME_SUBSTATE (=0x14 -> loc_141e)
const SUBSTATE_TIMER = 0x6009; // ram.js SUBSTATE_TIMER (the rst-0x18 gate counter)
const ATTRACT = 0x6007; // ram.js ATTRACT (loc_1475 forces it to 1)
const PLAYER_INDEX = 0x600e; // loc_141e's own clear (unnamed scratch in ram.js)
const SCAN_BASE = 0x611c; // scan table base (unnamed scratch in ram.js)
const SCAN_STRIDE = 0x22;

// Identical-both-sides poke forcing loc_141e's substate + a record==1 body once.
// GAME_STATE + GAME_SUBSTATE are HELD (loc_141e's tails move 0x600A, so it must be
// re-pinned to re-dispatch); 0x611C is held == 1 (forces record==1); SUBSTATE_TIMER
// is kicked to 1 for one frame (the gate expires once, then the tail clears it).
const FORCE_141E_POKE = [
  { addr: GAME_STATE, val: 0x03, frame: POKE_FRAME, dur: null }, // GAME_STATE = 3 (held)
  { addr: GAME_SUBSTATE, val: 0x14, frame: POKE_FRAME, dur: null }, // GAME_SUBSTATE = 0x14 (held)
  { addr: SCAN_BASE, val: 0x01, frame: POKE_FRAME, dur: null }, // 0x611C = 1 -> record==1 (held)
  { addr: SUBSTATE_TIMER, val: 0x01, frame: POKE_FRAME, dur: 1 }, // gate expires (kick once)
];

const makeMachine = (overrides) => {
  const m = new Machine(ROM, overrides ? { overrides } : {});
  m.pokes = FORCE_141E_POKE.map((p) => ({ ...p }));
  return m;
};

/**
 * Deliberately-broken twin: behaviourally the optimized handler EXCEPT the first
 * store to `addr` lands a wrong value (the correct byte XOR 0xFF, guaranteed to
 * differ). Intercepting exactly that one write lets the rest of the routine and every
 * subroutine it calls run verbatim -- the representative "wrong value to one of the
 * routine's own output addresses" bug the gate must catch.
 */
function makeBroken(addr) {
  return function broken(m) {
    const realWrite = m.mem.write8.bind(m.mem);
    let broke = false;
    m.mem.write8 = (a, value, busOffset) => {
      if (!broke && a === addr) {
        broke = true;
        return realWrite(a, value ^ 0xff, busOffset);
      }
      return realWrite(a, value, busOffset);
    };
    try {
      return optimized_141e(m);
    } finally {
      m.mem.write8 = realWrite;
    }
  };
}

const brokenPlayerIndex = makeBroken(PLAYER_INDEX); // loc_141e's own clear of 0x600E

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized loc_141e matches translated every frame", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, optimized_141e]]));

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
    `  EQUAL/whole: ${r.framesCompared} frames identical, override fired ${r.invocations.get(TARGET)}x`,
  );
});

test("EQUAL (unit): idiomatic optimized loc_141e matches translated in RAM + registers", () => {
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_141e, optimized_141e, { maxFrames: MAXFRAMES_UNIT });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical (first entry = record==1 tail)");
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong player-index clear is CAUGHT and NOT-EQUAL", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, brokenPlayerIndex]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong player-index clear is CAUGHT and names 0x600E", () => {
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_141e, brokenPlayerIndex, { maxFrames: MAXFRAMES_UNIT });

  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.ok(r.ram != null, "a caught divergence must name a RAM address");
  assert.equal(
    r.ram.addr,
    PLAYER_INDEX,
    `expected first diff at the broken address 0x${PLAYER_INDEX.toString(16)}, got 0x${r.ram.addr.toString(16)}`,
  );
  console.log(
    `  TEETH/unit: caught at 0x${r.ram.addr.toString(16)} (translated ${r.ram.a} vs broken ${r.ram.b})`,
  );
});

// -- FULL BRANCH COVERAGE (synthesised per-arm teeth incl. cycle totals) -------

/** Capture ONE real entry to loc_141e (via the engine's construction-time snapshot
 * override on the poke-driven host), so the synthesised arms inherit a valid stack
 * and realistic RAM. The arms then re-poke only SUBSTATE_TIMER (the gate) and the
 * 0x611C scan records (the branch selector). */
let ENTRY = null;
function capturedEntry() {
  if (ENTRY) return ENTRY;
  let entry = null;
  const snapshot = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_141e(mm);
  }]]);
  const host = makeMachine(snapshot);
  host.runFrames(MAXFRAMES_UNIT);
  assert.ok(entry !== null, "loc_141e never entered — cannot synthesise branches");
  ENTRY = entry;
  return ENTRY;
}

/** Preset the five 0x611C scan records on a machine. */
function setScan(m, values) {
  for (let i = 0; i < values.length; i++) m.mem.write8(SCAN_BASE + i * SCAN_STRIDE, values[i]);
}

/** Run oracle and optimized from an identical synthesised entry (`setup` presets the
 * gate + scan records to force a branch), returning the RAM/reg/pc diffs, each side's
 * cycle delta across the routine, and the oracle machine (for the non-vacuous output
 * probe). clone() neutralises the frame machinery, so the cycle count is exactly the
 * routine's own + its identical callees'. */
function runBranch(setup) {
  const seed = capturedEntry().clone();
  setup(seed);

  const a = seed.clone(); // translated oracle
  const b = seed.clone(); // optimized
  const ca0 = a.cycles;
  const cb0 = b.cycles;
  translated_141e(a);
  optimized_141e(b);

  return {
    ram: firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off)),
    regs: firstRegDiff(a.regs, b.regs),
    pcEqual: a.pc === b.pc,
    cyclesOracle: a.cycles - ca0,
    cyclesOptimized: b.cycles - cb0,
    oracle: a,
    substateAtEntry: seed.mem.read8(GAME_SUBSTATE),
  };
}

function assertEqualBranch(r, label) {
  assert.equal(r.ram, null, r.ram ? `${label}: RAM diff at 0x${r.ram.addr.toString(16)} (t ${r.ram.a} vs o ${r.ram.b})` : "");
  assert.equal(r.regs, null, r.regs ? `${label}: reg diff at ${r.regs.reg} (t ${r.regs.a} vs o ${r.regs.b})` : "");
  assert.ok(r.pcEqual, `${label}: pc must match`);
  assert.equal(r.cyclesOptimized, r.cyclesOracle, `${label}: cycle total must equal the oracle's`);
}

test("BRANCH A (gate-skip): EQUAL RAM + regs + pc + cycle total; body never runs", () => {
  // SUBSTATE_TIMER != 1 -> rst 0x18 decrements it but never hits 0 -> skip + early
  // return. A 0x99 marker in the player index must survive (the clear never runs).
  const r = runBranch((m) => {
    m.mem.write8(SUBSTATE_TIMER, 0x08);
    m.mem.write8(PLAYER_INDEX, 0x99);
  });
  assertEqualBranch(r, "BRANCH A");
  assert.equal(r.oracle.mem.read8(PLAYER_INDEX), 0x99, "gate-skip must NOT clear the player index");
  console.log(`  BRANCH A: EQUAL, cycles ${r.cyclesOptimized} (== oracle); 0x600E marker survives (gate-skip)`);
});

test("BRANCH B (record==1 @ slot0): EQUAL RAM + regs + pc + cycle total; loc_1459 tail", () => {
  const r = runBranch((m) => {
    m.mem.write8(SUBSTATE_TIMER, 0x01); // gate expires
    setScan(m, [0x01, 0x00, 0x00, 0x00, 0x00]); // slot 0 == 1
  });
  assertEqualBranch(r, "BRANCH B");
  // loc_1459 ran (advanced GAME_SUBSTATE) and loc_144f did NOT (player index stays 0).
  assert.equal(r.oracle.mem.read8(GAME_SUBSTATE), (r.substateAtEntry + 1) & 0xff, "record==1 must inc GAME_SUBSTATE via loc_1459");
  assert.equal(r.oracle.mem.read8(PLAYER_INDEX), 0x00, "record==1 path leaves the player index cleared to 0");
  console.log(`  BRANCH B: EQUAL, cycles ${r.cyclesOptimized} (== oracle); loc_1459 tail, 0x600E==0`);
});

test("BRANCH C (record==1 @ slot1): EQUAL RAM + regs + pc + cycle total; +41t scan", () => {
  const r = runBranch((m) => {
    m.mem.write8(SUBSTATE_TIMER, 0x01);
    setScan(m, [0x00, 0x01, 0x00, 0x00, 0x00]); // slot 0 misses, slot 1 == 1
  });
  assertEqualBranch(r, "BRANCH C");
  assert.equal(r.oracle.mem.read8(GAME_SUBSTATE), (r.substateAtEntry + 1) & 0xff, "record==1 must inc GAME_SUBSTATE");
  assert.equal(r.oracle.mem.read8(PLAYER_INDEX), 0x00, "record==1 path leaves the player index cleared");
  console.log(`  BRANCH C: EQUAL, cycles ${r.cyclesOptimized} (== oracle; one extra 41t scan slot vs B); loc_1459 tail`);
});

test("BRANCH D (record==3): EQUAL RAM + regs + pc + cycle total; loc_144f tail sets 0x600E=1", () => {
  const r = runBranch((m) => {
    m.mem.write8(SUBSTATE_TIMER, 0x01);
    setScan(m, [0x03, 0x03, 0x03, 0x03, 0x03]); // no 1 anywhere; a 3 at slot 0
  });
  assertEqualBranch(r, "BRANCH D");
  // loc_144f set the player index to 1 (its distinctive effect vs the record==1 path).
  assert.equal(r.oracle.mem.read8(PLAYER_INDEX), 0x01, "record==3 tail (loc_144f) must set the player index to 1");
  console.log(`  BRANCH D: EQUAL, cycles ${r.cyclesOptimized} (== oracle; full loop-1 miss + loop-2 hit); 0x600E==1`);
});

test("BRANCH E (neither): EQUAL RAM + regs + pc + cycle total; loc_1475 tail", () => {
  const r = runBranch((m) => {
    m.mem.write8(SUBSTATE_TIMER, 0x01);
    setScan(m, [0x00, 0x00, 0x00, 0x00, 0x00]); // no 1, no 3
  });
  assertEqualBranch(r, "BRANCH E");
  // loc_1475's distinctive effects: GAME_SUBSTATE cleared to 0, ATTRACT forced to 1.
  assert.equal(r.oracle.mem.read8(GAME_SUBSTATE), 0x00, "neither-found tail (loc_1475) must clear GAME_SUBSTATE");
  assert.equal(r.oracle.mem.read8(ATTRACT), 0x01, "neither-found tail (loc_1475) must force ATTRACT = 1");
  console.log(`  BRANCH E: EQUAL, cycles ${r.cyclesOptimized} (== oracle; both loops exhausted -> 501t scan segment); loc_1475 tail`);
});
