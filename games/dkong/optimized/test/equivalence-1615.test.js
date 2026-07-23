// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for loc_1615 (the L2 board-advance sub-state entry at
 * ROM 0x1615). It is a game-state dispatch target -- entry 0x16 of loc_06fe's
 * 0x0702 rst-0x28 table -- reached from INSIDE the NMI while GAME_STATE(0x6005)==3
 * and GAME_SUBSTATE(0x600A)==0x16. It calls sub_30bd (sprite-scratch clear), then
 * routes on BOARD(0x6227)'s low two bits to one of three board-advance sub-
 * dispatchers, each indexed by the 0x6388 sequence byte:
 *   - BOARD bit0 set              -> rst 0x28 table @0x1623
 *   - BOARD bit0 clear, bit1 set  -> rst 0x28 table @0x1637
 *   - BOARD bits 0+1 both clear   -> sub_1641 (-> its own rst 0x28 table @0x1648)
 *
 * Six jobs (mirrors equivalence-18c6.test.js -- the routine one hop past this
 * one's fall-through arm):
 *   1. EQUAL (whole-machine) -- optimized loc_1615 reads EQUAL against its oracle
 *      every frame, override firing many times.
 *   2. EQUAL (unit) -- EQUAL in RAM + every register (F included) + pc.
 *   3/4. TEETH (whole + unit) -- a deliberately-broken twin that lands a wrong
 *      value at 0x6A25 (the blink flag loc_18c6's proceed arm -- reached through
 *      loc_1615's fall-through arm -- writes; a plain work-RAM cell in the diffed
 *      dump, NOT a dispatch index) is CAUGHT.
 *   5/6. FULL BRANCH COVERAGE -- each of the three data-dependent arms is
 *      synthesised from a real captured entry and proven EQUAL (RAM + all
 *      registers + pc) AND proven to carry the SAME cycle TOTAL on both sides
 *      (teeth against a wrong/over-collapsed total). Non-vacuous: a routing probe
 *      asserts each arm actually dispatched to its intended callee/table (bit0 ->
 *      rst 0x28 @0x1623, bit1 -> rst 0x28 @0x1637, both-clear -> sub_1641), with A
 *      = the 0x6388 index on the two rst arms.
 *
 * WHY THIS TEST DRIVES A POKE (like 18c6/127c/084b). loc_1615 is deep in the board-
 * advance sub-state and NEVER dispatches from boot attract. An IDENTICAL-BOTH-
 * SIDES poke (Karl's sanctioned "poke the board state to reach a state for
 * validation") forces it from frame 100 -- the SAME poke set the loc_18c6 test
 * uses, since loc_1615 -> sub_1641 -> (0x6388==5) loc_18c6 is that very chain:
 * 0x6005=3, 0x600A=0x16 (-> loc_1615), 0x6227=0 (bits 0+1 clear -> fall to
 * sub_1641), 0x6340=0 (sub_1dbd idle-ret arm), 0x6388=5 (rst-0x28 @0x1648 idx 5 ->
 * loc_18c6), 0x62AF=0x41 (loc_18c6's proceed arm -> the 0x6A25 the teeth corrupt).
 * The state holds after frame 100, so loc_1615 fires every frame (~31x). The poke
 * is threaded via a makeMachine factory (m.pokes) driving the game-agnostic CORE
 * engine, applied to baseline and optimized alike so equivalence is preserved.
 *
 * THE CYCLE FINDING this routine adds: loc_1615 is ATOMIC (NMI-path, non-reentrant)
 * so its per-instruction m.step charges collapse to one total per straight-line
 * segment between the sub_30bd call and the tail dispatch (bit0 40t, bit1 54t,
 * fall-through 41t) -- and whole-machine EQUAL confirms the collapse is safe (a
 * wrong total diverges at the spin count / pushed-PC stack region). No hardware
 * (0x7Dxx) write anywhere, so no write-bus-cycle trace is at stake.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1615 as translated_1615 } from "../../translated/state0.js";
import { loc_1615 as optimized_1615 } from "../loc_1615.js";
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

const TARGET = 0x1615;
const FRAMES = 130; // loc_1615 is forced to dispatch from frame 100 on
const POKE_FRAME = 100;

const BOARD_ADDR = 0x6227; // ram.js BOARD -- the low two bits loc_1615 routes on
const SEQ_ADDR = 0x6388; // the rst-0x28 sub-dispatch index (deliberately unnamed)

// The blink flag loc_18c6's proceed arm toggles -- reached through loc_1615's
// fall-through arm on the poke path. A plain work-RAM data cell in the diffed
// dump (0x6000-0x6BFF), NOT a dispatch index, so a wrong value there gives a
// clean, persistent diff and never routes the run into an unimplemented handler.
const BROKEN_ADDR = 0x6a25;

// Identical-both-sides poke forcing the board-advance path (the loc_18c6 poke
// set): state 3 / sub-state 0x16 / BOARD bits clear / sub_1dbd idle / 0x6388 seq
// idx 5, with the 0x62AF counter seeded so frame 100 takes loc_18c6's proceed arm.
const FORCE_1615_POKE = [
  { addr: 0x6005, val: 0x03, frame: POKE_FRAME, dur: 1 }, // GAME_STATE = 3
  { addr: 0x600a, val: 0x16, frame: POKE_FRAME, dur: 1 }, // GAME_SUBSTATE = 0x16 -> loc_1615
  { addr: 0x6227, val: 0x00, frame: POKE_FRAME, dur: 1 }, // BOARD bits 0+1 clear -> sub_1641
  { addr: 0x6340, val: 0x00, frame: POKE_FRAME, dur: 1 }, // sub_1dbd -> idle ret (0x1E49)
  { addr: 0x6388, val: 0x05, frame: POKE_FRAME, dur: 1 }, // 0x1648 table idx 5 -> loc_18c6
  { addr: 0x62af, val: 0x41, frame: POKE_FRAME, dur: 1 }, // dec 0x40 -> loc_18c6 proceed arm
];

const makeMachine = (overrides) => {
  const m = new Machine(ROM, overrides ? { overrides } : {});
  m.pokes = FORCE_1615_POKE.map((p) => ({ ...p }));
  return m;
};

// Broken twin: behaviourally the optimized routine EXCEPT the first store to
// 0x6A25 (landed by the downstream loc_18c6, intercepted for the whole call
// chain) lands a wrong value (XOR 0xFF, guaranteed to differ) -- the
// representative "wrong value to an address the routine's path writes" bug.
function broken_1615(m) {
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
    return optimized_1615(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized loc_1615 matches translated every frame", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, optimized_1615]]));

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

test("EQUAL (unit): idiomatic optimized loc_1615 matches translated in RAM + registers", () => {
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_1615, optimized_1615, { maxFrames: 150 });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical");
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong 0x6A25 store is CAUGHT and NOT-EQUAL", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, broken_1615]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong 0x6A25 store is CAUGHT and names 0x6A25", () => {
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_1615, broken_1615, { maxFrames: 150 });

  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.ok(r.ram != null, "a caught divergence must name a RAM address");
  assert.equal(
    r.ram.addr,
    BROKEN_ADDR,
    `expected first diff at 0x${BROKEN_ADDR.toString(16)}, got 0x${r.ram.addr.toString(16)}`,
  );
  console.log(
    `  TEETH/unit: caught at 0x${r.ram.addr.toString(16)} ` +
      `(translated ${r.ram.a} vs broken ${r.ram.b})`,
  );
});

// -- FULL BRANCH COVERAGE (synthesised per-arm teeth incl. cycle totals) -------

/** Capture ONE real entry to loc_1615 (via the engine's construction-time
 * snapshot override on the poke-driven host), so the synthesised arms inherit a
 * valid stack and realistic board RAM (sub_30bd runs on entry; the arms then re-
 * poke only BOARD + the 0x6388 index). */
function captureEntry() {
  let entry = null;
  const snapshot = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_1615(mm);
  }]]);
  const host = makeMachine(snapshot);
  host.runFrames(150);
  assert.ok(entry !== null, "failed to capture a loc_1615 entry to synthesise arms from");
  return entry;
}

/** Run a fn on a clone and return the T-states it consumed (clone() neutralises
 * the NMI/frame machinery, so the count is exactly the routine's own -- here,
 * sub_30bd + loc_1615's own charges + the tail callee, identical on both sides). */
function cyclesOf(seed, fn) {
  const c = seed.clone();
  const before = c.cycles;
  fn(c);
  return c.cycles - before;
}

/** Non-vacuous routing probe: run the ORACLE on a clone whose tail callees
 * (0x0028 = rst 0x28, 0x1641 = sub_1641) are replaced by recorders that capture
 * WHICH dispatch fired, the rst-0x28 inline-table base (the pushed return addr on
 * the stack), and the A register (the 0x6388 index), then stop. Proves the arm
 * took its intended path -- so the EQUAL result is not two identical no-ops. */
function routeOf(seed) {
  const c = seed.clone();
  let rec = null;
  c.routines.set(0x0028, (mm) => {
    rec = {
      via: "rst28",
      table: mm.mem.read8(mm.regs.sp) | (mm.mem.read8((mm.regs.sp + 1) & 0xffff) << 8),
      a: mm.regs.a,
    };
    return undefined;
  });
  c.routines.set(0x1641, () => {
    rec = { via: "1641" };
    return undefined;
  });
  translated_1615(c);
  assert.ok(rec !== null, "routing probe: no tail dispatch fired");
  return rec;
}

/** Prove one arm EQUAL. Sets the deciding RAM on a clone of a captured entry,
 * runs oracle vs optimized on two further clones, and asserts: RAM + every
 * register + pc identical, the SAME cycle total on both sides (teeth against a
 * wrong total), and -- via the routing probe -- that the arm actually took its
 * intended dispatch. */
function proveArm(entry, name, board, seq, expectRoute) {
  const seed = entry.clone();
  seed.mem.write8(BOARD_ADDR, board);
  seed.mem.write8(SEQ_ADDR, seq);

  const a = seed.clone(); // translated oracle
  const b = seed.clone(); // optimized
  translated_1615(a);
  optimized_1615(b);

  const ram = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
  const regs = firstRegDiff(a.regs, b.regs);
  assert.equal(ram, null, ram ? `${name}: RAM diff at 0x${ram.addr.toString(16)} (${ram.a} vs ${ram.b})` : "");
  assert.equal(regs, null, regs ? `${name}: reg diff at ${regs.reg} (${regs.a} vs ${regs.b})` : "");
  assert.equal(a.pc, b.pc, `${name}: pc must match`);

  const cycT = cyclesOf(seed, translated_1615);
  const cycO = cyclesOf(seed, optimized_1615);
  assert.ok(cycT > 0, `${name}: oracle must consume cycles`);
  assert.equal(cycO, cycT, `${name}: cycle total ${cycO} != oracle ${cycT}`);

  // Non-vacuous: the arm actually dispatched where it should have.
  const route = routeOf(seed);
  assert.equal(route.via, expectRoute.via, `${name}: dispatched via ${route.via}, expected ${expectRoute.via}`);
  if (expectRoute.via === "rst28") {
    assert.equal(route.table, expectRoute.table,
      `${name}: rst 0x28 table 0x${route.table.toString(16)}, expected 0x${expectRoute.table.toString(16)}`);
    assert.equal(route.a, seq, `${name}: rst 0x28 index A=${route.a}, expected 0x6388 value ${seq}`);
  }
  console.log(`  ARM ${name}: EQUAL (RAM+regs+pc); cycle total ${cycO}; route ${JSON.stringify(route)}`);
}

test("BRANCH bit0 set (BOARD & 1): dispatches rst 0x28 table @0x1623 — EQUAL", () => {
  const entry = captureEntry();
  // BOARD=0x01 -> first rrca carry set -> table 0x1623 indexed by 0x6388 (idx 3 -> 0x1732).
  proveArm(entry, "bit0 (BOARD=0x01, seq=3)", 0x01, 3, { via: "rst28", table: 0x1623 });
});

test("BRANCH bit1 set (BOARD & 2, bit0 clear): dispatches rst 0x28 table @0x1637 — EQUAL", () => {
  const entry = captureEntry();
  // BOARD=0x02 -> bit0 clear, second rrca carry set -> table 0x1637 (idx 2 -> 0x1732).
  proveArm(entry, "bit1 (BOARD=0x02, seq=2)", 0x02, 2, { via: "rst28", table: 0x1637 });
});

test("BRANCH bits 0+1 clear (BOARD & 3 == 0): falls through to sub_1641 — EQUAL", () => {
  const entry = captureEntry();
  // BOARD=0x00 -> both rrca carry clear -> sub_1641 (which reloads 0x6388; idx 5 -> loc_18c6).
  proveArm(entry, "fall-through (BOARD=0x00, seq=5)", 0x00, 5, { via: "1641" });
});
