// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for sub_1486 (the on-board BONUS-ITEM mover + value-digit
 * display -- GAME_SUBSTATE(0x600A) phase 21). It is dispatched from INSIDE the vblank
 * NMI: while a credited game is in phase 21 (GAME_STATE 0x6005 == 3, GAME_SUBSTATE
 * 0x600A == 0x15), dispatchGameState vectors to loc_06fe, whose 0x0702 rst-0x28 table
 * lands on sub_1486 at index 21. It is the LARGEST routine in the sweep (ROM 0x1486-
 * 0x15F9, 372 bytes, an irreducible label-dispatch CFG with a single ret at 0x15F9).
 *
 * Jobs:
 *   1. EQUAL (whole-machine) -- the idiomatic optimized sub_1486 reads EQUAL against
 *      its translated oracle every frame. Driven by a coin+start inputTape (credits +
 *      starts a game) PLUS an identical-both-sides poke that forces phase 21 from
 *      frame 70; it then dispatches ~131x over the window, walking the item across the
 *      board through many position-index / display-timer / sprite-animate branches.
 *   2. EQUAL (unit) -- EQUAL in RAM + every register (F, A, SP, IX, IY included) + pc.
 *   3/4. TEETH (whole + unit) -- a deliberately-broken twin lands a wrong value at the
 *      value-digit cell 0x7572 (a pure display cell in the compared VRAM dump, written
 *      on a display-timer wrap; no control-flow effect) and is CAUGHT, naming 0x7572.
 *      The teeth poke additionally holds the display timer at 1 so EVERY dispatch wraps
 *      and writes 0x7572 -- including the first captured unit entry.
 *   5. BRANCH COVERAGE -- sub_1486's data-dependent arms are each synthesised from a
 *      real captured entry (main-loop arms from a post-INIT seed, so the item-slot
 *      pointers 0x6038/0x603A are valid) and proven EQUAL (RAM + all registers + pc)
 *      AND carrying the oracle's exact cycle total: INIT, timer-no-wrap, timer-wrap,
 *      value==0 EXIT, position column-walk (bit7) + its 0x1C / 0x1D arms, position
 *      low-bits inc / dec / divider-hold, and sprite-animate toggle-set / toggle-clear.
 *      Their distinct cycle totals are themselves proof the arms take distinct paths.
 *   6. WRITE-TRACE -- sub_1486's INIT branch makes two HARDWARE writes (the palette-bank
 *      latches 0x7D86/0x7D87). UNLIKE loc_0a8a's, the ORACLE leaves them UNTAGGED (no
 *      write-bus-cycle offset), so under the emit `--writes` trace BOTH the oracle and
 *      the optimized routine THROW identically (memory.js refuses an untagged hardware
 *      write) -- the optimized reproduces that exactly. Teeth: a busOffset-TAGGED variant
 *      does NOT throw (it records the two writes), so it is distinguishable -- proving
 *      the optimized did not silently "fix" the oracle's untagged writes (which would be
 *      a divergence under a trace).
 *
 * CYCLE DECISION -- PER-INSTRUCTION (not collapsed). sub_1486 IS atomic in the usual
 * sense (it runs inside the vblank NMI, entered mask-cleared, so no second NMI lands
 * inside it or its callees), so a per-segment collapse would very probably also read
 * EQUAL. It is deliberately kept byte-identical to the oracle, matching the choice
 * loc_06fe -- this routine's OWN in-game dispatcher -- documents for the state-3 family:
 * on a routine this large, with untagged HARDWARE writes and a stack push straddling the
 * cycle charges at every m.call, the marginal win (fewer m.step lines) is not worth
 * departing from a byte-identical transcription. Per-instruction preserves every path's
 * TOTAL, every stack write and every hardware write at the oracle's exact cumulative
 * cycle for free; the branch-arm cycle assertions below still pin each path's total.
 *
 * WHY THE CORE ENGINE + A CUSTOM FACTORY (not harness.js's wrappers). harness.js bakes a
 * `makeMachine` on `{}` assets that drives no input and applies no poke, so it never
 * reaches a credited game's phase 21 and never dispatches sub_1486. This test therefore
 * calls the SAME core unitEquivalence / wholeMachineEquivalence directly, passing a
 * factory that adds an identical coin+start inputTape AND an identical phase-21 poke to
 * BOTH sides (the snapshot override is still installed at CONSTRUCTION, which is what
 * reaches sub_1486 however it is entered). Same pattern as equivalence-1839/0a76/06fe.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { sub_1486 as translated_1486 } from "../../translated/state0.js";
import { sub_1486 as optimized_1486 } from "../sub_1486.js";
import { Machine } from "../../machine.js";
import {
  wholeMachineEquivalence,
  unitEquivalence,
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

const TARGET = 0x1486;
const FRAMES = 200; // phase 21 forced from frame 70; ~131 dispatches across the window
const MAX_FRAMES = 120; // sub_1486 first dispatches at frame 70

// Credit + start a game (identical to loc_1839/0a76's tape).
const COIN_START_TAPE = [
  { port: 0x7d00, bits: 0x80, frame: 10, dur: 6 }, // coin  (IN2 bit7)
  { port: 0x7d00, bits: 0x04, frame: 30, dur: 6 }, // start (IN2 bit2)
];

// Force phase 21: hold GAME_STATE(0x6005)=3 (in-game) and GAME_SUBSTATE(0x600A)=0x15
// (sub_1486) from frame 70. Applied by the SHARED factory, so both sides see it.
const PHASE21_POKE = [
  { addr: 0x6005, val: 0x03, frame: 70, dur: null },
  { addr: 0x600a, val: 0x15, frame: 70, dur: null },
];

// Teeth poke: phase 21 PLUS the display timer held at 1, so EVERY dispatch wraps and
// writes the value-digit cells -- so the very first captured unit entry writes 0x7572.
const TEETH_POKE = [
  { addr: 0x6005, val: 0x03, frame: 70, dur: null },
  { addr: 0x600a, val: 0x15, frame: 70, dur: null },
  { addr: 0x6034, val: 0x01, frame: 70, dur: null }, // display timer -> wrap every frame
];

function makeFactory(poke) {
  return (overrides) => {
    const m = new Machine(ROM, overrides ? { overrides } : {});
    m.inputTape = COIN_START_TAPE.map((t) => ({ ...t }));
    m.pokes = poke.map((p) => ({ ...p }));
    return m;
  };
}
const makeMachine = makeFactory(PHASE21_POKE);
const makeTeethMachine = makeFactory(TEETH_POKE);

// sub_1486's value-digit tens cell (VRAM, in the compared 0x7400-0x77FF dump), written
// once per display-timer wrap with no same-frame overwrite -- a pure display cell, so a
// wrong value gives a clean diff and never steers dispatch into a stub.
const BROKEN_ADDR = 0x7572;

/**
 * Deliberately-broken twin: behaviourally optimized_1486 EXCEPT the FIRST store to
 * 0x7572 lands a wrong value (the correct byte XOR 0xFF). Every other write and every
 * subroutine runs verbatim -- the representative "wrong value to one of the routine's
 * own output addresses" bug the gate must catch.
 */
function broken_1486(m) {
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
    return optimized_1486(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized sub_1486 matches translated every frame", () => {
  const r = wholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, optimized_1486]]));

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
    `  EQUAL/whole: ${r.framesCompared} frames identical, override fired ` +
      `${r.invocations.get(TARGET)}x (phase 21, item walk across the board)`,
  );
});

test("EQUAL (unit): idiomatic optimized sub_1486 matches translated in RAM + registers", () => {
  const r = unitEquivalence(makeMachine, TARGET, translated_1486, optimized_1486, { maxFrames: MAX_FRAMES });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg} (${r.regs.a} vs ${r.regs.b})` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F, A, SP, IX, IY) + pc identical (first entry frame 70)");
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong value-digit store is CAUGHT and NOT-EQUAL", () => {
  const r = wholeMachineEquivalence(makeTeethMachine, MAX_FRAMES, new Map([[TARGET, broken_1486]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong value-digit store is CAUGHT and names 0x7572", () => {
  const r = unitEquivalence(makeTeethMachine, TARGET, translated_1486, broken_1486, { maxFrames: MAX_FRAMES });

  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.ok(r.ram != null, "a caught divergence must name a RAM address");
  assert.equal(
    r.ram.addr,
    BROKEN_ADDR,
    `expected first diff at 0x${BROKEN_ADDR.toString(16)}, got 0x${r.ram.addr.toString(16)}`,
  );
  console.log(
    `  TEETH/unit: caught at 0x${r.ram.addr.toString(16)} (translated ${r.ram.a} vs broken ${r.ram.b})`,
  );
});

// -- BRANCH COVERAGE (synthesised per-arm teeth incl. cycle totals) -----------

/**
 * Capture ONE real entry to sub_1486 (the first dispatch, frame 70) via the core unit
 * gate's construction-time snapshot override, so synthesised arms inherit a valid stack
 * and realistic RAM. The captured entry has SUBSTATE_TIMER(0x6009) != 0, i.e. the
 * MAIN-LOOP path (the item-slot pointers are NOT yet set on this raw entry).
 */
function captureEntry() {
  let entry = null;
  const snap = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_1486(mm); // let the host run proceed to a clean stop
  }]]);
  const host = makeMachine(snap);
  host.runFrames(MAX_FRAMES);
  if (entry === null) throw new Error(`sub_1486 never dispatched within ${MAX_FRAMES} frames`);
  return entry;
}

/**
 * A post-INIT seed: run the translated INIT branch once (SUBSTATE_TIMER := 0 forces it)
 * so the item-slot pointers 0x6038/0x603A hold valid WORK-RAM addresses. Main-loop and
 * EXIT arms synthesise from this seed, so their slot-clear / column-copy / render writes
 * land in RAM (a raw-entry EXIT would write through a null 0x6038 into ROM and throw --
 * on BOTH sides, so it is not a divergence, but it is not a useful EQUAL either).
 */
function postInitSeed(entry) {
  const s = entry.clone();
  s.mem.write8(0x6009, 0x00); // SUBSTATE_TIMER == 0 -> INIT branch
  translated_1486(s); // establishes 0x6038/0x603A + seeds the item-state block
  return s;
}

/** T-states a fn consumes on a fresh clone (clone() neutralises the frame machinery). */
function cyclesOf(seed, fn) {
  const c = seed.clone();
  const before = c.cycles;
  fn(c);
  return c.cycles - before;
}

/**
 * Prove one arm EQUAL. Poke the deciding RAM on a clone of `seed`, run oracle vs
 * optimized on two further clones, and assert RAM + every register + pc identical, and
 * the SAME (nonzero) cycle total on both sides. The arms' distinct totals are what make
 * the coverage non-vacuous -- a wrong path would consume a different number of T-states.
 * `check` optionally asserts a distinctive post-condition on the oracle's result.
 */
function proveArm(seed, name, setup, check) {
  const s = seed.clone();
  setup(s);

  const a = s.clone(); // translated oracle
  const b = s.clone(); // optimized
  translated_1486(a);
  optimized_1486(b);

  const ram = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
  const regs = firstRegDiff(a.regs, b.regs);
  assert.equal(ram, null, ram ? `${name}: RAM diff at 0x${ram.addr.toString(16)} (${ram.a} vs ${ram.b})` : "");
  assert.equal(regs, null, regs ? `${name}: reg diff at ${regs.reg} (${regs.a} vs ${regs.b})` : "");
  assert.equal(a.pc, b.pc, `${name}: pc must match`);

  const cycT = cyclesOf(s, translated_1486);
  const cycO = cyclesOf(s, optimized_1486);
  assert.ok(cycT > 0, `${name}: oracle must consume cycles`);
  assert.equal(cycO, cycT, `${name}: cycle total ${cycO} != oracle ${cycT}`);

  if (check) check(a, name);
  console.log(`  ARM ${name}: EQUAL (RAM+regs+pc); cycle total ${cycO}`);
}

const rd = (m, addr) => m.mem.read8(addr);

test("BRANCH COVERAGE: INIT + main-loop timer arms + EXIT dispatch EQUAL (RAM + regs + pc + cycle)", () => {
  const entry = captureEntry();
  const seed = postInitSeed(entry);

  // INIT (SUBSTATE_TIMER == 0): clears the palette latches, seeds the item-state block,
  // scans 0x611C for the slot, renders (sub_15fa) and falls into the main loop. From the
  // RAW entry (before INIT ran). Post-condition: SUBSTATE_TIMER := 1 (running).
  proveArm(entry, "INIT (0x6009==0)",
    (s) => { s.mem.write8(0x6009, 0x00); },
    (a, name) => assert.equal(rd(a, 0x6009), 0x01, `${name}: expected SUBSTATE_TIMER := 1 (running)`));

  // timer NO-wrap: display timer still counting -> value untouched, jump to stage 2.
  proveArm(seed, "timer no-wrap (0x6034=0x3e)",
    (s) => { s.mem.write8(0x6034, 0x3e); },
    (a, name) => assert.equal(rd(a, 0x6034), 0x3d, `${name}: expected display timer decremented 0x3e->0x3d, not reloaded`));

  // timer WRAP, value > 0: reload 0x3E, value 5->4, BCD-split to 0x7552/0x7572.
  proveArm(seed, "timer wrap value>0 (0x6034=1,0x6033=5)",
    (s) => { s.mem.write8(0x6034, 0x01); s.mem.write8(0x6033, 0x05); },
    (a, name) => {
      assert.equal(rd(a, 0x6034), 0x3e, `${name}: expected display timer reloaded to 0x3E`);
      assert.equal(rd(a, 0x6033), 0x04, `${name}: expected value decremented 5->4`);
    });

  // value == 0 -> EXIT / cleanup: SUBSTATE_TIMER := 0x80, dec GAME_SUBSTATE, task enqueue.
  proveArm(seed, "EXIT value==0 (0x6034=1,0x6033=1)",
    (s) => { s.mem.write8(0x6034, 0x01); s.mem.write8(0x6033, 0x01); },
    (a, name) => assert.equal(rd(a, 0x6009), 0x80, `${name}: expected SUBSTATE_TIMER := 0x80 (done)`));
});

test("BRANCH COVERAGE: position-step arms (bit7 column-walk + low-bits) dispatch EQUAL", () => {
  const entry = captureEntry();
  const seed = postInitSeed(entry);
  // Keep the display timer from wrapping so the position step is the branch under test.
  const holdTimer = (s) => s.mem.write8(0x6034, 0x3e);

  // P1_INPUT bit7 set -> the video-column walk (0x1546), index not at a sentinel.
  proveArm(seed, "bit7 column-walk (0x6010=0x80,0x6035=5)",
    (s) => { holdTimer(s); s.mem.write8(0x6010, 0x80); s.mem.write8(0x6035, 0x05); });
  // bit7 + index == 0x1C -> the 0x156D lower-sentinel arm.
  proveArm(seed, "bit7 index==0x1C (0x6035=0x1c)",
    (s) => { holdTimer(s); s.mem.write8(0x6010, 0x80); s.mem.write8(0x6035, 0x1c); });
  // bit7 + index == 0x1D -> EXIT via the column walk.
  proveArm(seed, "bit7 index==0x1D EXIT (0x6035=0x1d)",
    (s) => { holdTimer(s); s.mem.write8(0x6010, 0x80); s.mem.write8(0x6035, 0x1d); },
    (a, name) => assert.equal(rd(a, 0x6009), 0x80, `${name}: expected EXIT (SUBSTATE_TIMER := 0x80)`));

  // bit7 clear, low bits set, divider EXPIRES (0x6030=1 -> dec to 0): step the index.
  // bit1 clear -> increment path (0x152D); bit1 set -> signed decrement path (0x1539).
  proveArm(seed, "low-bits inc, divider expires (0x6010=1,0x6030=1)",
    (s) => { holdTimer(s); s.mem.write8(0x6010, 0x01); s.mem.write8(0x6030, 0x01); s.mem.write8(0x6035, 0x05); });
  proveArm(seed, "low-bits dec, divider expires (0x6010=2,0x6030=1)",
    (s) => { holdTimer(s); s.mem.write8(0x6010, 0x02); s.mem.write8(0x6030, 0x01); s.mem.write8(0x6035, 0x05); });
  // low bits set, divider does NOT expire (0x6030=5 -> dec to 4, stored, straight to animate).
  proveArm(seed, "low-bits divider hold (0x6010=1,0x6030=5)",
    (s) => { holdTimer(s); s.mem.write8(0x6010, 0x01); s.mem.write8(0x6030, 0x05); s.mem.write8(0x6035, 0x05); },
    (a, name) => assert.equal(rd(a, 0x6030), 0x04, `${name}: expected divider stored 5->4 (not expired)`));
});

test("BRANCH COVERAGE: sprite-animate arms (anim timer expires, toggle set/clear) dispatch EQUAL", () => {
  const entry = captureEntry();
  const seed = postInitSeed(entry);
  const holdTimer = (s) => s.mem.write8(0x6034, 0x3e);

  // Anim timer expires (0x6032=1 -> dec to 0). Toggle clear (0x6031=0) -> render via
  // 0x15A0 with DE=0x01BF; toggle set (0x6031=1) -> 0x15B8, toggle:=0, DE=(0x6038)+3.
  proveArm(seed, "anim expires, toggle clear (0x6032=1,0x6031=0)",
    (s) => { holdTimer(s); s.mem.write8(0x6032, 0x01); s.mem.write8(0x6031, 0x00); },
    (a, name) => assert.equal(rd(a, 0x6032), 0x10, `${name}: expected anim timer reloaded to 0x10`));
  proveArm(seed, "anim expires, toggle set (0x6032=1,0x6031=1)",
    (s) => { holdTimer(s); s.mem.write8(0x6032, 0x01); s.mem.write8(0x6031, 0x01); },
    (a, name) => assert.equal(rd(a, 0x6031), 0x00, `${name}: expected toggle cleared 1->0`));
});

// -- WRITE-TRACE (the INIT branch's UNTAGGED hardware writes) ------------------

/** Run `fn` on a clone forced into the INIT branch (SUBSTATE_TIMER := 0) with the
 * hardware write-trace recording; return either the recorded trace or the throw message. */
function initUnderTrace(seed, fn) {
  const c = seed.clone();
  c.mem.write8(0x6009, 0x00); // force the INIT branch
  c.mem.writeTrace = [];
  try {
    fn(c);
    return { threw: false, trace: c.mem.writeTrace.map((w) => ({ addr: w.addr, value: w.value })) };
  } catch (e) {
    return { threw: true, message: e.message };
  }
}

test("WRITE-TRACE: the INIT palette writes are UNTAGGED — oracle and optimized throw identically", () => {
  const entry = captureEntry();

  const oracle = initUnderTrace(entry, translated_1486);
  const opt = initUnderTrace(entry, optimized_1486);

  // The oracle leaves the two 0x7D86/0x7D87 writes untagged, so tracing them throws.
  assert.equal(oracle.threw, true, "oracle INIT should throw under writeTrace (untagged hardware write)");
  assert.match(oracle.message, /0x7d86 has no write-bus-cycle offset/, "oracle throw should name the untagged palette write");
  // The optimized routine reproduces that byte-for-byte: same throw, same message.
  assert.equal(opt.threw, true, "optimized INIT must reproduce the oracle's untagged-write throw");
  assert.equal(opt.message, oracle.message, "optimized throw message must match the oracle's exactly");

  // Teeth: a busOffset-TAGGED variant does NOT throw (it records the two palette writes),
  // so it is distinguishable -- proving the check would catch an optimized that silently
  // "fixed" the oracle's untagged writes (a divergence under a trace).
  const tagged = initUnderTrace(entry, (m) => {
    const { regs, mem } = m;
    regs.a = 0x00;
    mem.write8(0x7d86, regs.a, 10); // TAGGED: records instead of throwing
    mem.write8(0x7d87, regs.a, 10);
  });
  assert.equal(tagged.threw, false, "a tagged variant should not throw");
  assert.deepEqual(
    tagged.trace,
    [{ addr: 0x7d86, value: 0 }, { addr: 0x7d87, value: 0 }],
    "a tagged variant records the two palette-bank writes",
  );
  console.log("  WRITE-TRACE: oracle + optimized both throw on the untagged palette write; tagged variant distinguishable");
});
