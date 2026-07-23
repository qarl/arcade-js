// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for loc_18c6 (the "how-high" board-advance staging
 * routine at ROM 0x18C6 -- a 0x62AF-counter-paced state machine). It is
 * dispatched from INSIDE the NMI, as entry 5 of loc_1644's rst-0x28 table @0x1648
 * (0x6388==5), reached while GAME_STATE(0x6005)==3, GAME_SUBSTATE(0x600A)==0x16,
 * and BOARD(0x6227) bits 0+1 clear -> loc_1615 -> sub_1641.
 *
 * THE WRAP FRAGMENT. loc_18c6's `jp z,0x193d` falls into loc_18c6_wrap, a tail
 * the translator split out but which is NOT a registry entry (0x18c6 in the swap
 * table is loc_18c6 itself). The optimized routine reuses it exactly as the
 * oracle does -- imported from translated/ and called DIRECTLY -- so both sides
 * run the identical fragment and the wrap arm is trivially EQUAL. It is still
 * exercised (synthesised, with cycle-total teeth) so the DELEGATION itself (my
 * `if (fZ) return loc_18c6_wrap(m)` routing + the 21t pre-charge) is proven.
 *
 * Six jobs:
 *   1. EQUAL (whole-machine) -- optimized loc_18c6 reads EQUAL against its oracle
 *      every frame, override firing many times.
 *   2. EQUAL (unit) -- EQUAL in RAM + every register (F included) + pc.
 *   3/4. TEETH (whole + unit) -- a deliberately-broken twin that lands a wrong
 *      value at 0x6A25 (the blink flag the proceed arm toggles -- a plain work-RAM
 *      cell in the diffed dump, NOT a dispatch index, so a clean persistent diff
 *      that never routes the run into an unimplemented handler) is CAUGHT.
 *   5/6. FULL BRANCH COVERAGE -- every data-dependent arm is synthesised from a
 *      real captured entry and proven EQUAL (RAM + all registers + pc) AND proven
 *      to carry the SAME cycle TOTAL on both sides (teeth against a wrong/over-
 *      collapsed total): wrap, gate-ret, proceed(C2-nz), stage@E0 (MARIO<0x80 and
 *      MARIO>=0x80), record@C0 (LEVEL-odd+MARIO>=0x80, LEVEL-even+MARIO<0x80).
 *
 * WHY THIS TEST DRIVES A POKE (like 127c/084b). loc_18c6 is deep in the L2 "how
 * high" board-advance and NEVER dispatches from boot attract. An IDENTICAL-BOTH-
 * SIDES poke (Karl's sanctioned "poke the board state to reach a state for
 * validation") forces it from frame 100: 0x6005=3 (GAME_STATE), 0x600A=0x16
 * (-> loc_1615), 0x6227=0 (bits 0+1 clear -> fall to sub_1641), 0x6340=0
 * (sub_1dbd's benign idle-ret arm), 0x6388=5 (rst-0x28 table idx 5 -> loc_18c6),
 * and 0x62AF=0x41 (dec 0x40 on the first frame -> the proceed arm that writes the
 * 0x6A25 the teeth corrupt; the counter then walks down, firing the routine ~31
 * times over the window: proceed on multiples of 8, gate-ret otherwise). The poke
 * is threaded via a custom makeMachine factory (m.pokes) driving the game-agnostic
 * CORE engine, applied to baseline and optimized alike so equivalence is preserved.
 *
 * THE CYCLE FINDING this routine adds: loc_18c6 is ATOMIC (NMI-path, non-reentrant)
 * so its per-instruction m.step charges collapse to one total per straight-line
 * segment (split only where the sub_3009 call forces it) -- and whole-machine EQUAL
 * confirms the collapse is safe (a wrong total would diverge at the spin count).
 * No hardware (0x7Dxx) write anywhere, so no write-bus-cycle trace is at stake.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_18c6 as translated_18c6 } from "../../translated/state0.js";
import { loc_18c6 as optimized_18c6 } from "../loc_18c6.js";
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

const TARGET = 0x18c6;
const FRAMES = 130; // loc_18c6 is forced to dispatch from frame 100 on
const POKE_FRAME = 100;

// The blink flag the proceed arm toggles (xor 0x80). A plain work-RAM data cell
// in the diffed dump (0x6000-0x6BFF), NOT a dispatch index -> a wrong value there
// gives a clean, persistent diff and never routes the run into an unimplemented
// handler. Written on the first (proceed) dispatch, frame 100.
const BROKEN_ADDR = 0x6a25;

const MARIO_X_ADDR = 0x6203; // ram.js MARIO_X -- read by stage/record arms
const LEVEL_ADDR = 0x6229; // ram.js LEVEL   -- read by the record arm's rrca

// Identical-both-sides poke forcing the how-high board-advance path: state 3 /
// sub-state 0x16 / BOARD bits clear / sub_1dbd idle / 0x6388 seq idx 5, with the
// 0x62AF counter seeded so frame 100 takes the proceed arm. The game holds this
// state on its own after frame 100 (nothing resets it until the counter wraps),
// so one-shot (dur 1) pokes suffice; the counter then walks down naturally.
const FORCE_18C6_POKE = [
  { addr: 0x6005, val: 0x03, frame: POKE_FRAME, dur: 1 }, // GAME_STATE = 3
  { addr: 0x600a, val: 0x16, frame: POKE_FRAME, dur: 1 }, // GAME_SUBSTATE = 0x16 -> loc_1615
  { addr: 0x6227, val: 0x00, frame: POKE_FRAME, dur: 1 }, // BOARD bits 0+1 clear -> sub_1641
  { addr: 0x6340, val: 0x00, frame: POKE_FRAME, dur: 1 }, // sub_1dbd -> idle ret (0x1E49)
  { addr: 0x6388, val: 0x05, frame: POKE_FRAME, dur: 1 }, // 0x1648 table idx 5 -> loc_18c6
  { addr: 0x62af, val: 0x41, frame: POKE_FRAME, dur: 1 }, // dec 0x40 -> proceed arm
];

const makeMachine = (overrides) => {
  const m = new Machine(ROM, overrides ? { overrides } : {});
  m.pokes = FORCE_18C6_POKE.map((p) => ({ ...p }));
  return m;
};

// Broken twin: behaviourally the optimized routine EXCEPT the first store to
// 0x6A25 lands a wrong value (XOR 0xFF, guaranteed to differ), letting every
// subroutine it calls otherwise run verbatim -- the representative "wrong value
// to one of the routine's own output addresses" bug the gate must catch.
function broken_18c6(m) {
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
    return optimized_18c6(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized loc_18c6 matches translated every frame", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, optimized_18c6]]));

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

test("EQUAL (unit): idiomatic optimized loc_18c6 matches translated in RAM + registers", () => {
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_18c6, optimized_18c6, { maxFrames: 150 });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical");
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong 0x6A25 store is CAUGHT and NOT-EQUAL", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, broken_18c6]]));

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
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_18c6, broken_18c6, { maxFrames: 150 });

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

/** Capture ONE real entry to loc_18c6 (via the engine's construction-time
 * snapshot override on the poke-driven host), so the synthesised arms inherit a
 * valid stack and realistic how-high RAM (the wrap arm reads BOARD_SEQ_PTR etc.). */
function captureEntry() {
  let entry = null;
  const snapshot = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_18c6(mm);
  }]]);
  const host = makeMachine(snapshot);
  host.runFrames(150);
  assert.ok(entry !== null, "failed to capture a loc_18c6 entry to synthesise arms from");
  return entry;
}

/** Run a fn on a clone and return the T-states it consumed (clone() neutralises
 * the NMI/frame machinery, so the count is exactly the routine's own). */
function cyclesOf(seed, fn) {
  const c = seed.clone();
  const before = c.cycles;
  fn(c);
  return c.cycles - before;
}

/** Prove one arm EQUAL. Sets the deciding RAM on a clone of a captured entry,
 * runs oracle vs optimized on two further clones, and asserts: RAM + every
 * register + pc identical, the SAME cycle total on both sides (teeth against a
 * wrong total), and -- non-vacuously -- that the arm actually took its path. */
function proveArm(entry, name, setup, check) {
  const seed = entry.clone();
  setup(seed);

  const a = seed.clone(); // translated oracle
  const b = seed.clone(); // optimized
  translated_18c6(a);
  optimized_18c6(b);

  const ram = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
  const regs = firstRegDiff(a.regs, b.regs);
  assert.equal(ram, null, ram ? `${name}: RAM diff at 0x${ram.addr.toString(16)} (${ram.a} vs ${ram.b})` : "");
  assert.equal(regs, null, regs ? `${name}: reg diff at ${regs.reg} (${regs.a} vs ${regs.b})` : "");
  assert.equal(a.pc, b.pc, `${name}: pc must match`);

  const cycT = cyclesOf(seed, translated_18c6);
  const cycO = cyclesOf(seed, optimized_18c6);
  assert.ok(cycT > 0, `${name}: oracle must consume cycles`);
  assert.equal(cycO, cycT, `${name}: cycle total ${cycO} != oracle ${cycT}`);

  check(seed, a, name);
  console.log(`  ARM ${name}: EQUAL (RAM+regs+pc); cycle total ${cycO}`);
}

const rd = (m, addr) => m.mem.read8(addr);

test("BRANCH wrap (0x62AF dec -> 0): delegates to loc_18c6_wrap — EQUAL", () => {
  const entry = captureEntry();
  proveArm(entry, "wrap (0x62AF 1->0)",
    (s) => { s.mem.write8(0x62af, 1); },
    (seed, a, name) => {
      assert.equal(rd(a, 0x600a), 8, `${name}: wrap must hand GAME_SUBSTATE 0x600A=8`);
      assert.equal(rd(a, 0x62af), 0, `${name}: counter dec'd to 0`);
    });
});

test("BRANCH gate-ret ((post-dec & 7) != 0): ticks and rets — EQUAL", () => {
  const entry = captureEntry();
  proveArm(entry, "gate-ret (0x62AF 3->2)",
    (s) => { s.mem.write8(0x62af, 3); s.mem.write8(0x6a25, 0x11); },
    (seed, a, name) => {
      assert.equal(rd(a, 0x62af), 2, `${name}: counter dec'd to 2`);
      assert.equal(rd(a, 0x6a25), 0x11, `${name}: blink flag untouched (early ret)`);
    });
});

test("BRANCH proceed C2-nz (8th tick, counter != 0xE0/0xC0): toggles blink flags — EQUAL", () => {
  const entry = captureEntry();
  proveArm(entry, "proceed C2-nz (0x62AF 0x41->0x40)",
    (s) => { s.mem.write8(0x62af, 0x41); s.mem.write8(0x6a25, 0x00); },
    (seed, a, name) => {
      assert.equal(rd(a, 0x62af), 0x40, `${name}: counter dec'd to 0x40 (mult of 8)`);
      assert.equal(rd(a, 0x6a25), 0x80, `${name}: 0x6A25 toggled 0x00 ^ 0x80`);
    });
});

test("BRANCH stage @0xE0: MARIO_X < 0x80 and >= 0x80 — both EQUAL", () => {
  const entry = captureEntry();

  // MARIO_X < 0x80: jp nc NOT taken -> writes 0x694D=0x80, 0x694C=0x5F.
  proveArm(entry, "stage@E0 MARIO<0x80",
    (s) => { s.mem.write8(0x62af, 0xe1); s.mem.write8(MARIO_X_ADDR, 0x40); },
    (seed, a, name) => {
      assert.equal(rd(a, 0x694f), 0x50, `${name}: 0x694F seeded 0x50`);
      assert.equal(rd(a, 0x694d), 0x80, `${name}: 0x694D = 0x80 (MARIO<0x80 arm)`);
      assert.equal(rd(a, 0x694c), 0x5f, `${name}: 0x694C = 0x5F (MARIO<0x80 arm)`);
    });

  // MARIO_X >= 0x80: jp nc taken -> the 0/0x9F seeds stand.
  proveArm(entry, "stage@E0 MARIO>=0x80",
    (s) => { s.mem.write8(0x62af, 0xe1); s.mem.write8(MARIO_X_ADDR, 0x90); },
    (seed, a, name) => {
      assert.equal(rd(a, 0x694f), 0x50, `${name}: 0x694F seeded 0x50`);
      assert.equal(rd(a, 0x694d), 0x00, `${name}: 0x694D = 0x00 (skip arm)`);
      assert.equal(rd(a, 0x694c), 0x9f, `${name}: 0x694C = 0x9F (skip arm)`);
    });
});

test("BRANCH record @0xC0: LEVEL parity x MARIO_X threshold — both EQUAL", () => {
  const entry = captureEntry();

  // LEVEL odd (bit0 set -> jr c, keep 0x0C) + MARIO_X >= 0x80 (ret nc, no 0x6F).
  proveArm(entry, "record@C0 LEVEL-odd+MARIO>=0x80",
    (s) => { s.mem.write8(0x62af, 0xc1); s.mem.write8(LEVEL_ADDR, 0x01); s.mem.write8(MARIO_X_ADDR, 0x90); },
    (seed, a, name) => {
      assert.equal(rd(a, 0x608a), 0x0c, `${name}: SND_PRIORITY kept 0x0C (LEVEL odd)`);
      assert.equal(rd(a, 0x608b), 0x03, `${name}: SND_PRIORITY_FRAMES = 0x03`);
      assert.equal(rd(a, 0x6a20), 0x8f, `${name}: 0x6A20 record byte 0x8F (MARIO>=0x80, no 0x6F)`);
    });

  // LEVEL even (bit0 clear -> write 0x05) + MARIO_X < 0x80 (write 0x6F to 0x6A20).
  proveArm(entry, "record@C0 LEVEL-even+MARIO<0x80",
    (s) => { s.mem.write8(0x62af, 0xc1); s.mem.write8(LEVEL_ADDR, 0x02); s.mem.write8(MARIO_X_ADDR, 0x40); },
    (seed, a, name) => {
      assert.equal(rd(a, 0x608a), 0x05, `${name}: SND_PRIORITY = 0x05 (LEVEL even)`);
      assert.equal(rd(a, 0x608b), 0x03, `${name}: SND_PRIORITY_FRAMES = 0x03`);
      assert.equal(rd(a, 0x6a20), 0x6f, `${name}: 0x6A20 overwritten 0x6F (MARIO<0x80)`);
    });
});
